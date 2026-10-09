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

async function syntheticOmp(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "acp-extension-omp-signal-"));
  const executable = join(directory, "omp");
  await writeFile(executable, `#!/usr/bin/env node
require("node:fs").writeFileSync(require("node:path").join(__dirname, "child.pid"), String(process.pid));
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

function startAdapter(entry: string, ompDirectory: string) {
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, PATH: [ompDirectory, dirname(process.execPath), process.env.PATH ?? ""].join(delimiter) },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.resume();
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
  return { child, exited, request };
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
});
