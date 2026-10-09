import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const entry = resolve(process.argv[2] ?? "dist/index.js");
await access(entry);
const version = spawnSync("omp", ["--version"], { encoding: "utf8" });
if (version.error || version.status !== 0 || !version.stdout.startsWith("omp/")) {
  throw new Error("OMP is required on PATH for the ACP adapter smoke");
}

const scratch = await mkdtemp(join(tmpdir(), "lody-omp-smoke-"));
const home = join(scratch, "home");
const workdir = join(scratch, "workspace");
const profile = `lody-smoke-${process.pid}`;
const agentDir = join(home, ".omp", "profiles", profile, "agent");
await Promise.all([
  mkdir(agentDir, { recursive: true }),
  mkdir(workdir, { recursive: true }),
]);
const modelConfig = [
  "providers:",
  "  lody-smoke:",
  "    baseUrl: http://127.0.0.1:9/v1",
  "    api: openai-completions",
  "    auth: none",
  "    models:",
  "      - id: smoke-model",
  "        name: Lody Smoke Model",
  "        api: openai-completions",
  "        reasoning: false",
  "        input: [text]",
  "        contextWindow: 4096",
  "        maxTokens: 256",
].join("\n");
await writeFile(join(agentDir, "models.yml"), `${modelConfig}\n`, "utf8");
const env = {
  PATH: process.env.PATH ?? "",
  HOME: home,
  USERPROFILE: home,
  OMP_PROFILE: profile,
  XDG_CONFIG_HOME: join(home, ".config"),
  XDG_DATA_HOME: join(home, ".local", "share"),
  XDG_CACHE_HOME: join(home, ".cache"),
  TMPDIR: scratch,
  TMP: scratch,
  TEMP: scratch,
  ...(process.platform === "win32"
    ? {
        APPDATA: join(home, "AppData", "Roaming"),
        LOCALAPPDATA: join(home, "AppData", "Local"),
      }
    : {}),
};

const child = spawn(process.execPath, [entry], {
  cwd: workdir,
  env,
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
let adapterExit;
let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});
const pending = new Map();
let nextRequestId = 0;
createInterface({ input: child.stdout }).on("line", (line) => {
  const message = JSON.parse(line);
  const response = pending.get(message.id);
  if (!response) return;
  pending.delete(message.id);
  if (message.error) {
    response.reject(new Error(message.error.message ?? "ACP request failed"));
  } else {
    response.resolve(message.result);
  }
});
child.on("exit", (code, signal) => {
  adapterExit = { code, signal };
  for (const response of pending.values()) {
    response.reject(new Error(`OMP adapter exited (${code ?? signal}): ${stderr}`));
  }
  pending.clear();
});

const request = (method, params) => {
  const id = ++nextRequestId;
  const result = new Promise((resolveResponse, rejectResponse) => {
    pending.set(id, { resolve: resolveResponse, reject: rejectResponse });
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return result;
};

const withTimeout = async (stage, operation) => {
  let timeout;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`ACP smoke ${stage} timed out after 15s`)), 15_000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
};

try {
  const initialized = await withTimeout(
    "initialize",
    request("initialize", { protocolVersion: 1, clientCapabilities: {} })
  );
  if (initialized.agentInfo?.name !== "omp-rpc") {
    throw new Error("ACP adapter did not identify as omp-rpc");
  }
  const session = await withTimeout(
    "session/new",
    request("session/new", { cwd: workdir, mcpServers: [] })
  );
  if (!session.sessionId) throw new Error("OMP did not create a persistent session");
  await withTimeout(
    "session/load",
    request("session/load", {
      sessionId: session.sessionId,
      cwd: workdir,
      mcpServers: [],
    })
  );
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    const closed = once(child, "exit");
    const terminate = setTimeout(() => child.kill("SIGTERM"), 5_000);
    const force = setTimeout(() => child.kill("SIGKILL"), 10_000);
    child.stdin.end();
    await closed;
    clearTimeout(terminate);
    clearTimeout(force);
  }
  await rm(scratch, { recursive: true, force: true });
}
if (!adapterExit || adapterExit.code !== 0 || adapterExit.signal !== null) {
  const status = adapterExit?.signal ?? adapterExit?.code ?? "unknown";
  throw new Error(`ACP adapter exited unsuccessfully (${status})`);
}
process.stdout.write(
  `OMP ${version.stdout.trim()}: ACP initialize/new/load passed in an isolated profile; no prompt sent.\n`
);
