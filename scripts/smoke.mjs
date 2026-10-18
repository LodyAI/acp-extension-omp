import assert from "node:assert/strict";
import { constants } from "node:fs";
import { access, copyFile, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve, sep } from "node:path";

const entry = resolve(process.argv[2] ?? "dist/index.js");
await access(entry);
const executable = process.argv[3] ? resolve(process.argv[3]) : undefined;
const scratch = await mkdtemp(join(tmpdir(), "lody-omp-smoke-"));
const home = join(scratch, "home");
const workdir = join(scratch, "workspace");
const profile = `lody-smoke-${process.pid}`;
const agentDir = join(home, ".omp", "profiles", profile, "agent");
const pidFile = join(scratch, "native-pids.jsonl");
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
  APPDATA: join(home, "AppData", "Roaming"),
  LOCALAPPDATA: join(home, "AppData", "Local"),
  ...(process.platform === "win32"
    ? { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR }
    : {}),
};

let child;
let closed;
let version;
let protocolFailure;
const pending = new Map();
let nextRequestId = 0;
const fail = (error) => {
  protocolFailure ??= error;
  for (const response of pending.values()) response.reject(error);
  pending.clear();
};
const request = (method, params) => {
  if (protocolFailure) return Promise.reject(protocolFailure);
  const id = ++nextRequestId;
  const result = Promise.withResolvers();
  pending.set(id, result);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return result.promise;
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

// 仅记录本次 adapter 启动的 child pid，供失败收尾；不替换生产 spawn。
async function trackNative(pidFile) {
  const { default: cp } = await import("node:child_process");
  const { syncBuiltinESMExports } = await import("node:module");
  const { appendFileSync } = await import("node:fs");
  const original = cp.spawn;
  cp.spawn = (command, args, options) => {
    const child = original(command, args, options);
    if (command === "omp" && child.pid) appendFileSync(pidFile, `${child.pid}\n`);
    return child;
  };
  syncBuiltinESMExports();
}

// POSIX：组长已退出时 kill(pid, 0) 为 ESRCH，进程组里仍可能有子孙。探测、强杀、等待都走 -pid。
function nativeSignalTarget(pid) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`Invalid native pid ${pid}`);
  return process.platform === "win32" ? pid : -pid;
}

function nativeAlive(pid) {
  try {
    process.kill(nativeSignalTarget(pid), 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

async function reapNativePids(pids, timeoutMessage) {
  const live = pids.filter((pid) => nativeAlive(pid));
  for (const pid of live) {
    try { process.kill(nativeSignalTarget(pid), "SIGKILL"); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  }
  const reapEnds = performance.now() + 5_000;
  for (const pid of live) {
    for (;;) {
      if (!nativeAlive(pid)) break;
      if (performance.now() >= reapEnds) throw new Error(timeoutMessage);
      await new Promise((done) => setTimeout(done, 25));
    }
  }
  return live;
}

// PATH 查找对齐 spawn：跳过目录和非可执行项，继续后面的可执行普通文件。
// Windows 按 PATHEXT 补扩展名；只接受原生 .exe，避免 .cmd/.bat 挡住后面的 omp.exe。
function ompNamesFor(platform, pathext) {
  if (platform !== "win32") return ["omp"];
  const source = typeof pathext === "string" && pathext.length > 0 ? pathext : ".COM;.EXE;.BAT;.CMD";
  const names = [];
  for (const raw of source.split(";")) {
    const entry = raw.trim();
    if (!entry) continue;
    const dotted = entry.startsWith(".") ? entry : `.${entry}`;
    if (dotted.toLowerCase() !== ".exe") continue;
    names.push(`omp${dotted}`);
  }
  return names;
}

async function executableRegularFile(candidate) {
  let info;
  try { info = await stat(candidate); }
  catch { return false; }
  if (!info.isFile()) return false;
  if (process.platform === "win32") return true;
  try { await access(candidate, constants.X_OK); return true; }
  catch { return false; }
}

async function resolveOmpFromPath(pathValue) {
  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    for (const name of ompNamesFor(process.platform, process.env.PATHEXT)) {
      const candidate = resolve(directory, name);
      if (await executableRegularFile(candidate)) return candidate;
    }
  }
  return undefined;
}

try {
  await Promise.all([
    mkdir(agentDir, { recursive: true }),
    mkdir(workdir, { recursive: true }),
  ]);
  await writeFile(join(agentDir, "models.yml"), `${modelConfig}\n`, "utf8");
  // 与 adapter 相同的隔离 env/cwd/PATH；不执行用户 profile 中的版本探测。
  const bin = join(scratch, "bin");
  await mkdir(bin);
  let binary = executable;
  if (!binary) binary = await resolveOmpFromPath(env.PATH);
  assert.ok(binary, "OMP is required on PATH; Windows requires native omp.exe (or argv[3] .exe), not .cmd");
  if (process.platform === "win32") {
    assert.match(binary, /\.exe$/i, "Windows requires native OMP .exe; shell/.cmd is unsupported");
    await copyFile(binary, join(bin, "omp.exe"));
  } else await symlink(binary, join(bin, "omp"));
  env.PATH = [bin, dirname(process.execPath), env.PATH].join(delimiter);
  version = spawnSync("omp", ["--version"], {
    cwd: workdir, env, encoding: "utf8", timeout: 15_000, windowsHide: true,
  });
  if (version.error || version.status !== 0 || !version.stdout.startsWith("omp/")) {
    throw new Error("Isolated OMP version probe failed; a real OMP executable is required");
  }
  const observer = `data:text/javascript,${encodeURIComponent(`await (${trackNative.toString()})(${JSON.stringify(pidFile)});`)}`;
  child = spawn(process.execPath, ["--import", observer, entry], {
    cwd: workdir, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  });
  closed = new Promise((done) => child.once("close", (code, signal) => done({ code, signal })));
  // 诊断只排空，不保存/打印 profile 或 provider 的原始内容。
  child.stderr.on("data", () => {});
  child.on("error", () => fail(new Error("ACP adapter spawn failed")));
  child.stdin.on("error", () => fail(new Error("ACP adapter input closed")));
  child.on("close", () => {
    for (const response of pending.values()) response.reject(new Error("ACP adapter closed before response"));
    pending.clear();
  });
  createInterface({ input: child.stdout }).on("line", (line) => {
    let message;
    try { message = JSON.parse(line); } catch { fail(new Error("Invalid ACP JSON")); return; }
    const response = pending.get(message.id);
    if (!response) return;
    pending.delete(message.id);
    if (message.error) response.reject(new Error(message.error.message ?? "ACP request failed"));
    else response.resolve(message.result);
  });
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
  assert.ok(
    typeof session.sessionId === "string" && resolve(session.sessionId).startsWith(`${resolve(home)}${sep}`),
    "Persistent native session must stay in isolated home"
  );
  await access(session.sessionId);
  await withTimeout(
    "session/load",
    request("session/load", {
      sessionId: session.sessionId,
      cwd: workdir,
      mcpServers: [],
    })
  );
} finally {
  try {
    if (child) {
      if (child.exitCode === null && child.signalCode === null) {
        const terminate = setTimeout(() => child.kill("SIGTERM"), 5_000);
        const force = setTimeout(() => child.kill("SIGKILL"), 10_000);
        child.stdin.end();
        try { await withTimeout("shutdown", closed); }
        catch (error) {
          child.kill("SIGKILL");
          await withTimeout("forced exit", closed);
          throw error;
        } finally { clearTimeout(terminate); clearTimeout(force); }
      } else await withTimeout("stdio closure", closed);
      if (protocolFailure) throw protocolFailure;
      assert.equal(child.signalCode, null, "ACP adapter must not exit by signal");
      assert.equal(child.exitCode, 0, "ACP adapter must exit successfully");
    }
  } finally {
    try {
      const pids = await readFile(pidFile, "utf8").catch((error) => {
        if (error.code === "ENOENT") return "";
        throw error;
      });
      const live = await reapNativePids(
        pids.trim().split("\n").filter(Boolean).map(Number),
        "OMP child reap timed out",
      );
      assert.equal(live.length, 0, "Adapter left OMP alive; smoke reaped it");
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
}
process.stdout.write(
  `OMP ${version.stdout.trim()}: ACP initialize/new/load passed in an isolated profile; no prompt sent.\n`
);
