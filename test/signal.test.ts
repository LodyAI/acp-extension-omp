import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const SIGNALS = ["SIGTERM", "SIGINT", "SIGHUP"] as const;

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

type OmpMode = "serve" | "unkillable" | "straggler";

// Ignores SIGTERM, inherits OMP's stdout/stderr, and publishes its pid only once the handler is in place.
// The watchdog bounds the orphan's life when a failed run never reaps it.
const STRAGGLER = `process.on("SIGTERM", () => {});
const fs = require("node:fs");
fs.writeFileSync(process.argv[1] + ".tmp", String(process.pid));
fs.renameSync(process.argv[1] + ".tmp", process.argv[1]);
setTimeout(() => process.exit(0), 30_000);`;

async function syntheticOmp(mode: OmpMode = "serve"): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "acp-extension-omp-signal-"));
  const executable = join(directory, "omp");
  // "Unkillable" ignores SIGTERM and stdin EOF; SIGKILL is dropped in the adapter by DROP_GROUP_SIGKILL.
  // Its watchdog bounds the orphan's life when a failed run never learns its pid.
  const holdOpen = mode === "unkillable"
    ? `process.on("SIGTERM", () => {});
require("node:net").createServer().listen(0, "127.0.0.1");
setTimeout(() => process.exit(0), 30_000);
`
    : mode === "straggler"
      ? `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(STRAGGLER)}, require("node:path").join(__dirname, "grandchild.pid")], { stdio: ["ignore", "inherit", "inherit"] });
`
      : "";
  // Rename publishes the pid atomically, so a reader never sees a truncated number.
  await writeFile(executable, `#!/usr/bin/env node
${holdOpen}const pidFile = require("node:path").join(__dirname, "child.pid");
require("node:fs").writeFileSync(pidFile + ".tmp", String(process.pid));
require("node:fs").renameSync(pidFile + ".tmp", pidFile);
if (process.argv.slice(2).join(" ") !== "--mode rpc") process.exit(42);
require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
  const command = JSON.parse(line);
  const data = command.type === "get_state"
    ? { sessionFile: "/tmp/fake-omp-session.jsonl", model: { provider: "fixture", id: "model", name: "Fixture" } }
    : {};
  process.stdout.write(JSON.stringify({ type: "response", id: command.id, command: command.type, success: true, data }) + "\\n");
});
`, "utf8");
  await chmod(executable, 0o755);
  return directory;
}

// Preloaded into the adapter to simulate an OMP process group that survives SIGKILL.
const DROP_GROUP_SIGKILL = `data:text/javascript,${encodeURIComponent(
  "const kill = process.kill.bind(process); process.kill = (pid, signal) => (signal === 'SIGKILL' && pid < 0 ? true : kill(pid, signal));"
)}`;

async function readPid(directory: string, name: string): Promise<number> {
  const path = join(directory, name);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const pid = Number(await readFile(path, "utf8").catch(() => "0"));
    if (pid > 0) return pid;
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error(`${name} was not published`);
}

function startAdapter(entry: string, ompDirectory: string, nodeArgs: string[] = []) {
  const child = spawn(process.execPath, [...nodeArgs, entry], {
    env: { ...process.env, PATH: [ompDirectory, dirname(process.execPath), process.env.PATH ?? ""].join(delimiter) },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const exited = once(child, "exit") as Promise<[number | null, NodeJS.Signals | null]>;
  const pending = new Map<number, (message: { result?: unknown; error?: unknown }) => void>();
  let nextId = 0;
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line) as { id?: number; result?: unknown; error?: unknown };
    if (typeof message.id === "number") pending.get(message.id)?.(message);
  });
  const request = (method: string, params: unknown) =>
    new Promise<{ result?: unknown; error?: unknown }>((done) => {
      const id = ++nextId;
      pending.set(id, done);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  return { child, exited, request, stderr: () => stderr };
}

// Exercises the built entry end to end: index.ts wiring, the real process, and Node's default signal exit.
// Windows has no deliverable SIGTERM/SIGHUP, so the injected-target tests in server.test.ts cover it there.
describe.skipIf(process.platform === "win32")("adapter process shutdown signals", () => {
  let buildDirectory: string;
  const cleanup: string[] = [];
  const adapters: ChildProcess[] = [];

  beforeAll(async () => {
    // Inside the repo so the emitted `../package.json` import and node_modules resolve as they do from dist/.
    buildDirectory = await mkdtemp(join(repoRoot, ".signal-test-"));
    cleanup.push(buildDirectory);
    const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
    const build = spawnSync(process.execPath, [tsc, "-p", join(repoRoot, "tsconfig.json"), "--outDir", buildDirectory], {
      encoding: "utf8",
    });
    if (build.status !== 0) throw new Error(`TypeScript build failed: ${build.stdout}${build.stderr}`);
  }, 60_000);

  afterAll(async () => {
    for (const adapter of adapters) {
      if (adapter.exitCode === null && adapter.signalCode === null) adapter.kill("SIGKILL");
    }
    await Promise.all(cleanup.map((path) => rm(path, { recursive: true, force: true })));
  });

  it.each(SIGNALS)("reaps OMP and exits by %s", async (signal) => {
    const ompDirectory = await syntheticOmp();
    cleanup.push(ompDirectory);
    const adapter = startAdapter(join(buildDirectory, "index.js"), ompDirectory);
    adapters.push(adapter.child);
    let ompPid: number | undefined;
    try {
      const initialized = await adapter.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
      expect(initialized.error).toBeUndefined();
      const session = await adapter.request("session/new", { cwd: ompDirectory, mcpServers: [] });
      expect(session.error).toBeUndefined();
      ompPid = Number(await readFile(join(ompDirectory, "child.pid"), "utf8"));
      expect(processExists(ompPid)).toBe(true);

      adapter.child.kill(signal);
      const [code, exitSignal] = await adapter.exited;
      expect({ code, signal: exitSignal }).toEqual({ code: null, signal });
      expect(processExists(ompPid)).toBe(false);
    } finally {
      if (ompPid !== undefined && processExists(ompPid)) process.kill(ompPid, "SIGKILL");
    }
  }, 15_000);

  // Guards the ordinary shutdown: no listener or handle may keep the compiled entry alive after EOF.
  it("reaps OMP and exits with code 0 after stdin EOF", async () => {
    const ompDirectory = await syntheticOmp();
    cleanup.push(ompDirectory);
    const adapter = startAdapter(join(buildDirectory, "index.js"), ompDirectory);
    adapters.push(adapter.child);
    let ompPid: number | undefined;
    try {
      await adapter.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
      const session = await adapter.request("session/new", { cwd: ompDirectory, mcpServers: [] });
      expect(session.error).toBeUndefined();
      ompPid = Number(await readFile(join(ompDirectory, "child.pid"), "utf8"));

      adapter.child.stdin.end();
      const [code, exitSignal] = await adapter.exited;
      expect({ code, signal: exitSignal }).toEqual({ code: 0, signal: null });
      expect(processExists(ompPid)).toBe(false);
      expect(adapter.stderr()).toBe("");
    } finally {
      if (ompPid !== undefined && processExists(ompPid)) process.kill(ompPid, "SIGKILL");
    }
  }, 15_000);

  it("exits with code 1 when OMP survives force termination", async () => {
    const ompDirectory = await syntheticOmp("unkillable");
    cleanup.push(ompDirectory);
    const adapter = startAdapter(join(buildDirectory, "index.js"), ompDirectory, ["--import", DROP_GROUP_SIGKILL]);
    adapters.push(adapter.child);
    let ompPid: number | undefined;
    try {
      await adapter.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
      const session = await adapter.request("session/new", { cwd: ompDirectory, mcpServers: [] });
      expect(session.error).toBeUndefined();
      ompPid = Number(await readFile(join(ompDirectory, "child.pid"), "utf8"));

      adapter.child.stdin.end();
      const [code, exitSignal] = await adapter.exited;
      expect({ code, signal: exitSignal }).toEqual({ code: 1, signal: null });
      expect(adapter.stderr()).toMatch(/did not exit after force termination/);
      // The adapter released the child it could not terminate; it is left running, not reaped.
      expect(processExists(ompPid)).toBe(true);
    } finally {
      // This fixture never exits on its own, so also reap it when the test failed before reading its pid.
      ompPid ??= Number(await readFile(join(ompDirectory, "child.pid"), "utf8").catch(() => "0"));
      if (ompPid > 0 && processExists(ompPid)) process.kill(ompPid, "SIGKILL");
    }
  }, 15_000);

  it("reaps a SIGTERM-ignoring grandchild that holds OMP's pipes", async () => {
    const ompDirectory = await syntheticOmp("straggler");
    cleanup.push(ompDirectory);
    const adapter = startAdapter(join(buildDirectory, "index.js"), ompDirectory);
    adapters.push(adapter.child);
    let grandchildPid: number | undefined;
    try {
      await adapter.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
      const session = await adapter.request("session/new", { cwd: ompDirectory, mcpServers: [] });
      expect(session.error).toBeUndefined();
      const ompPid = await readPid(ompDirectory, "child.pid");
      grandchildPid = await readPid(ompDirectory, "grandchild.pid");

      adapter.child.stdin.end();
      const [code, exitSignal] = await adapter.exited;
      expect({ code, signal: exitSignal }).toEqual({ code: 0, signal: null });
      expect(processExists(ompPid)).toBe(false);
      expect(processExists(grandchildPid)).toBe(false);
      expect(adapter.stderr()).toBe("");
    } finally {
      grandchildPid ??= Number(await readFile(join(ompDirectory, "grandchild.pid"), "utf8").catch(() => "0"));
      if (grandchildPid > 0 && processExists(grandchildPid)) process.kill(grandchildPid, "SIGKILL");
    }
  }, 15_000);

  it("exits with code 1 when a grandchild survives the group force termination", async () => {
    const ompDirectory = await syntheticOmp("straggler");
    cleanup.push(ompDirectory);
    const adapter = startAdapter(join(buildDirectory, "index.js"), ompDirectory, ["--import", DROP_GROUP_SIGKILL]);
    adapters.push(adapter.child);
    let grandchildPid: number | undefined;
    try {
      await adapter.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
      const session = await adapter.request("session/new", { cwd: ompDirectory, mcpServers: [] });
      expect(session.error).toBeUndefined();
      grandchildPid = await readPid(ompDirectory, "grandchild.pid");

      adapter.child.stdin.end();
      const [code, exitSignal] = await adapter.exited;
      expect({ code, signal: exitSignal }).toEqual({ code: 1, signal: null });
      expect(adapter.stderr()).toMatch(/process group did not exit after force termination/);
      // The adapter released the group it could not terminate; the grandchild is left running.
      expect(processExists(grandchildPid)).toBe(true);
    } finally {
      grandchildPid ??= Number(await readFile(join(ompDirectory, "grandchild.pid"), "utf8").catch(() => "0"));
      if (grandchildPid > 0 && processExists(grandchildPid)) process.kill(grandchildPid, "SIGKILL");
    }
  }, 15_000);
});
