import assert from "node:assert/strict";
import { access, copyFile, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { constants, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve, sep } from "node:path";

// Real OMP, synthetic model only: no user profile, credentials, or external endpoint.
const entry = resolve(process.argv[2] ?? "dist/index.js");
const executable = process.argv[3];
await access(entry);
// Both the repo build and an installed package keep package.json one level above dist/.
const adapterPackage = JSON.parse(await readFile(join(dirname(entry), "..", "package.json"), "utf8"));
const selectedExecutable = executable ? resolve(executable) : undefined;
const scratch = await mkdtemp(join(tmpdir(), "omp-contract-"));
const home = join(scratch, "home");
const workdir = join(scratch, "workspace");
const agentDir = join(home, ".omp", "profiles", "contract", "agent");
const clients = [];
let version;
let nextMode = "complete";
let requestStarted;
let streamClosed;
let requestCount = 0;
let requestHadHistory = false;
const endpoint = createServer(async (request, response) => {
  // 只保留“已知合成回答是否在历史中”这一布尔值；不记录请求正文或 headers。
  let body = "";
  for await (const chunk of request) body += chunk;
  requestHadHistory = JSON.parse(body).messages?.some((message) =>
    message.role === "assistant" && JSON.stringify(message.content).includes("contract answer")
  ) ?? false;
  requestCount++;
  if (nextMode === "error") {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "Synthetic contract rejection", type: "invalid_request_error" } }));
    return;
  }
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const chunk = (value) => response.write(`data: ${JSON.stringify({ id: "contract-completion", object: "chat.completion.chunk", created: 1, model: "contract-model", ...value })}\n\n`);
  chunk({ choices: [{ index: 0, delta: { role: "assistant", content: "contract answer" }, finish_reason: null }] });
  if (nextMode === "cancel") {
    response.once("close", () => streamClosed.resolve());
    requestStarted?.resolve();
    return; // Native abort closes this HTTP stream; no guessed sleeps.
  }
  chunk({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
  chunk({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
  response.end("data: [DONE]\n\n");
});

function deadline(promise, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), 30_000); }),
  ]).finally(() => clearTimeout(timer));
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

// 只读观察真实 child 的安全字段；不改真实 OMP 的命令、参数或帧。
async function observeNative(journal, fixture) {
  const { default: cp } = await import("node:child_process");
  const { syncBuiltinESMExports } = await import("node:module");
  const { appendFileSync } = await import("node:fs");
  const { createInterface } = await import("node:readline");
  const original = cp.spawn;
  const record = (event) => appendFileSync(journal, `${JSON.stringify(event)}\n`);
  cp.spawn = (command, args, options) => {
    if (command !== "omp") return original(command, args, options);
    // 合成 RPC 证据单列；Windows 不经 .cmd shell，不声称夹具证明真实 .exe。
    const child = fixture
      ? original(process.execPath, [fixture, ...args], options)
      : original(command, args, options);
    record({ type: "spawn", pid: child.pid });
    const input = createInterface({ input: child.stdout });
    input.on("line", (line) => {
      let frame;
      try { frame = JSON.parse(line); } catch { return; }
      if (frame.type === "response" && frame.command === "abort") {
        record({ type: "abort_ack", success: frame.success });
      }
      if (frame.type === "response" && frame.command === "get_state") {
        record({ type: "state", sessionFile: frame.data?.sessionFile });
      }
      if (frame.type === "message_update" && frame.assistantMessageEvent?.type === "text_delta") {
        record({ type: "text", text: frame.assistantMessageEvent.delta });
      }
      if (frame.type === "prompt_result") {
        record({ type: "terminal", status: frame.status, settled: frame.sessionSettled });
      }
      if (frame.type === "session_settled") record({ type: "settled" });
      if (frame.type === "agent_end" && !("yielded" in frame) && frame.isTerminal !== false) {
        const message = frame.messages?.findLast((value) => value.role === "assistant");
        record({ type: "legacy_terminal", status: message?.stopReason ?? "empty" });
      }
    });
    return child;
  };
  syncBuiltinESMExports();
}

function start({ fixture, childEnv = env, expectedExit = 0 } = {}) {
  const journal = join(scratch, `native-${clients.length}.jsonl`);
  const observer = `data:text/javascript,${encodeURIComponent(`await (${observeNative.toString()})(${JSON.stringify(journal)}, ${JSON.stringify(fixture)});`)}`;
  const child = spawn(process.execPath, ["--import", observer, entry], {
    cwd: workdir, env: childEnv, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  });
  child.stderr.on("data", () => {}); // 不输出 provider/profile 数据。
  const closed = new Promise((done) => child.once("close", (code, signal) => done({ code, signal })));
  const pending = new Map();
  const events = [];
  const prompts = [];
  let active;
  let failure;
  let sequence = 0;
  const native = () => {
    try { return readFileSync(journal, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; }
  };
  const fail = (error) => {
    failure ??= error;
    for (const operation of pending.values()) operation.reject(error);
    pending.clear();
  };
  child.on("error", () => fail(new Error("Adapter spawn failed")));
  child.stdin.on("error", () => fail(new Error("Adapter input closed")));
  child.on("close", () => fail(new Error("Adapter closed before response")));
  createInterface({ input: child.stdout }).on("line", (line) => {
    let frame;
    try { frame = JSON.parse(line); } catch { fail(new Error("Invalid ACP JSON")); return; }
    events.push(frame);
    if (frame.method === "session/update" || frame.method === "_lody/session/usage_update") {
      if (!active || frame.params.sessionId !== active.sessionId) {
        fail(new Error("Notification outside its active prompt/session"));
      } else active.notifications.push(frame);
    }
    const operation = pending.get(frame.id);
    if (!operation) return;
    pending.delete(frame.id);
    if (operation.prompt) {
      operation.prompt.response = frame;
      operation.prompt.native = native().slice(operation.prompt.nativeStart);
      active = undefined;
    }
    if (frame.error) operation.reject(new Error(frame.error.message ?? "ACP failure"));
    else operation.resolve(frame.result);
  });
  const value = {
    child, events, prompts, native, closed, expectedExit,
    request(method, params) {
      if (failure) return Promise.reject(failure);
      const id = ++sequence;
      const operation = Promise.withResolvers();
      if (method === "session/prompt") {
        assert.equal(active, undefined, "Runner must correlate each prompt separately");
        active = { id, sessionId: params.sessionId, notifications: [], nativeStart: native().length };
        operation.prompt = active;
        prompts.push(active);
      }
      pending.set(id, operation);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      return deadline(operation.promise, method);
    },
    notify(method, params) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    },
    async close() {
      try {
        if (child.exitCode === null && child.signalCode === null) {
          child.stdin.end();
          try { await deadline(closed, "Adapter shutdown"); }
          catch (error) {
            child.kill("SIGTERM");
            try { await deadline(closed, "Adapter termination"); }
            catch {
              child.kill("SIGKILL");
              await deadline(closed, "Adapter forced exit");
            }
            throw error;
          }
        }
        await deadline(closed, "Adapter stdio closure"); // exit 不等于 stdio 已释放。
        if (failure && failure.message !== "Adapter closed before response") throw failure;
      } finally {
        // adapter 超时/强杀也不能留下它启动的独立 OMP 进程组。
        const live = await reapNativePids(
          native().filter((event) => event.type === "spawn" && event.pid).map(({ pid }) => pid),
          "Native child reap timed out",
        );
        assert.equal(live.length, 0, "Adapter left a native child alive; runner reaped it");
      }
    },
  };
  clients.push(value);
  return value;
}

function assertPromptOrder(client, prompt) {
  const terminalIndex = client.events.indexOf(prompt.response);
  assert.ok(terminalIndex >= 0, "Each prompt needs its own terminal response");
  for (const notification of prompt.notifications) {
    assert.ok(client.events.indexOf(notification) < terminalIndex, "Every text/usage notification must precede its own terminal");
  }
  const nativeText = prompt.native.filter((event) => event.type === "text").map((event) => event.text);
  const acpText = prompt.notifications.filter((event) => event.method === "session/update").map((event) => event.params.update.content?.text);
  assert.deepEqual(acpText, nativeText, "Every native text delta must arrive before its prompt response");
}

// 这些边界不能用真实 OMP 的 provider 响应伪造，故经实际 entry 单列合成 RPC 证据。
async function syntheticCases(initialized, sessionParams, promptParams) {
  const fixture = join(scratch, "fixture.cjs");
  const identity = join(home, "synthetic-session.jsonl");
  const other = join(home, "synthetic-other.jsonl");
  await Promise.all([writeFile(identity, '{"type":"session"}\n'), writeFile(other, '{"type":"session"}\n')]);
  await writeFile(fixture, `
const { createInterface } = require("node:readline");
const send = (frame) => process.stdout.write(JSON.stringify(frame) + "\\n");
if (process.argv.slice(2).join(" ") !== "--mode rpc") process.exit(42);
const identity = ${JSON.stringify(identity)};
const mode = process.env.CONTRACT_FIXTURE;
const model = { provider: "fixture", id: "a", name: "Fixture A" };
let calls = 0;
createInterface({ input: process.stdin }).on("line", (line) => {
  const c = JSON.parse(line);
  const reply = (data = {}) => send({ type: "response", id: c.id, command: c.type, success: true, data });
  if (c.type === "get_state") return reply({ sessionFile: identity, model });
  if (c.type === "get_available_models") return reply({ models: [model] });
  if (c.type !== "prompt") return reply();
  reply();
  if (mode === "exit") return process.exit(23);
  if (mode === "malformed") return process.stdout.write("not-json\\n");
  if (mode === "eof") return process.stdout.end();
  const usage = (id, model, values) => send({ type: "message_end", messageId: id, message: {
    role: "assistant", provider: "fixture", model, usage: values,
  } });
  const a = { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, reasoningTokens: 3 };
  if (calls++ === 0) {
    usage("one", "a", a);
    usage("one", "a", a);
  } else {
    usage("one", "a", { ...a, output: 8, reasoningTokens: 4, cost: { total: 0.25 } });
    usage("two", "b", { input: 7, output: 2, cacheRead: 1, cacheWrite: 0 });
  }
  send({ type: "prompt_result", id: c.id, status: "completed", sessionSettled: true });
});
`);
  const usageClient = start({ fixture, childEnv: { ...env, CONTRACT_FIXTURE: "usage" } });
  await initialized(usageClient);
  await usageClient.request("session/new", sessionParams);
  await usageClient.request("session/prompt", promptParams(identity));
  const updates = () => usageClient.events.filter((event) => event.method === "_lody/session/usage_update").map((event) => event.params);
  assert.equal(updates().length, 1, "Duplicate message id must not bill twice");
  const first = updates()[0];
  const row = first.modelUsage["fixture/a"];
  assert.equal(row.inputTokens, 10);
  assert.equal(row.outputTokens, 5);
  assert.equal(row.cacheReadInputTokens, 2);
  assert.equal(row.cacheCreationInputTokens, 1);
  assert.equal(row.reasoningOutputTokens, 3);
  for (const value of [row, first.usage, first.delta.usage, first.delta.modelUsage["fixture/a"]]) {
    assert.equal(Object.hasOwn(value, "costUSD"), false, "Missing cost must stay unknown, not zero");
  }
  await usageClient.request("session/prompt", promptParams(identity));
  assert.equal(updates().length, 3, "Correction and second model each produce one update");
  const corrected = updates()[1];
  assert.equal(corrected.modelUsage["fixture/a"].inputTokens, 10);
  assert.equal(corrected.modelUsage["fixture/a"].outputTokens, 8);
  assert.equal(corrected.modelUsage["fixture/a"].reasoningOutputTokens, 4);
  assert.equal(corrected.modelUsage["fixture/a"].costUSD, 0.25);
  assert.equal(corrected.delta.modelUsage["fixture/a"].outputTokens, 3);
  assert.equal(corrected.delta.modelUsage["fixture/a"].inputTokens, 0);
  const final = updates()[2];
  assert.deepEqual(Object.keys(final.modelUsage).sort(), ["fixture/a", "fixture/b"]);
  assert.equal(final.modelUsage["fixture/a"].outputTokens, 8);
  assert.equal(final.modelUsage["fixture/b"].inputTokens, 7);
  assert.equal(final.modelUsage["fixture/b"].outputTokens, 2);
  assert.equal(final.usage.costUSD, undefined, "Unknown model cost must propagate");
  assert.equal(final._meta.lody.usageScopeId, first._meta.lody.usageScopeId);
  for (const method of ["session/load", "session/resume"]) {
    await assert.rejects(usageClient.request(method, { ...sessionParams, sessionId: other }), "Different native identity must fail");
    await assert.rejects(usageClient.request("session/prompt", promptParams(identity)), "Failed switch must invalidate old identity");
    await assert.rejects(usageClient.request("session/prompt", promptParams(other)), "No empty fallback identity");
    await usageClient.request("session/new", sessionParams);
  }
  await usageClient.close();

  const faultModes = ["missing", "exit", "malformed", ...(process.platform === "win32" ? [] : ["eof"])];
  for (const mode of faultModes) {
    const client = start({
      fixture: mode === "missing" ? undefined : fixture,
      childEnv: { ...env, CONTRACT_FIXTURE: mode, ...(mode === "missing" ? { PATH: join(scratch, "no-executable") } : {}) },
      expectedExit: 1,
    });
    await initialized(client);
    if (mode === "missing") {
      await assert.rejects(client.request("session/new", sessionParams));
    } else {
      await client.request("session/new", sessionParams);
      await assert.rejects(client.request("session/prompt", promptParams(identity)), "Child fault cannot fabricate success");
    }
    const status = await deadline(client.closed, `Synthetic ${mode} adapter closure`);
    assert.equal(status.code, 1, `${mode} must close the actual adapter entry unsuccessfully`);
    assert.equal(status.signal, null);
    for (const event of client.native().filter((event) => event.type === "spawn" && event.pid)) {
      assert.throws(() => process.kill(event.pid, 0), { code: "ESRCH" }, "Fault child must be reaped");
    }
  }
  console.log(`Synthetic actual-entry evidence: usage dedup/correction/model/cache/reasoning/unknown-cost, wrong identity, ${faultModes.join("/")} passed${process.platform === "win32" ? "; live Node stdout EOF unsupported on Windows (not tested)" : ""}.`);
}

const env = {
  PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home,
  APPDATA: join(home, "AppData", "Roaming"), LOCALAPPDATA: join(home, "AppData", "Local"),
  ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR } : {}),
  OMP_PROFILE: "contract", XDG_CONFIG_HOME: join(home, ".config"),
  XDG_DATA_HOME: join(home, ".local", "share"), XDG_CACHE_HOME: join(home, ".cache"),
  TMPDIR: scratch, TMP: scratch, TEMP: scratch,
};
try {
  await Promise.all([mkdir(agentDir, { recursive: true }), mkdir(workdir, { recursive: true })]);
  const bin = join(scratch, "bin");
  await mkdir(bin);
  let binary = selectedExecutable;
  if (!binary) binary = await resolveOmpFromPath(env.PATH);
  assert.ok(binary, "Install a real OMP on PATH; Windows requires a native omp.exe (or argv[3] .exe), not .cmd");
  if (process.platform === "win32") {
    assert.match(binary, /\.exe$/i, "Windows requires a native OMP .exe; shell/.cmd is unsupported");
    await copyFile(binary, join(bin, "omp.exe")); // 无 symlink 权限要求，支持空格路径。
  } else await symlink(binary, join(bin, "omp"));
  env.PATH = [bin, dirname(process.execPath), env.PATH].join(delimiter);
  version = spawnSync("omp", ["--version"], { cwd: workdir, env, encoding: "utf8", timeout: 15_000, windowsHide: true });
  assert.equal(version.error, undefined, "Isolated OMP version probe must start and finish");
  assert.equal(version.status, 0, "OMP executable must be available");
  assert.match(version.stdout, /^omp\//);
  endpoint.listen(0, "127.0.0.1");
  await once(endpoint, "listening");
  const port = endpoint.address().port;
  await writeFile(join(agentDir, "models.yml"), `providers:\n  contract:\n    baseUrl: http://127.0.0.1:${port}/v1\n    api: openai-completions\n    auth: none\n    models:\n      - id: contract-model\n        name: Contract Model\n        reasoning: false\n        input: [text]\n        contextWindow: 262144\n        maxTokens: 256\n`);
  await writeFile(join(agentDir, "config.yml"), "modelRoles:\n  default: contract/contract-model\n  smol: contract/contract-model\n  slow: contract/contract-model\n");
  // Required case 1, and no unreviewed capability: load, resume, MCP, images and embedded context stay unadvertised.
  const expectedInitialize = {
    protocolVersion: 1,
    agentInfo: { name: "omp-rpc", version: adapterPackage.version },
    agentCapabilities: { promptCapabilities: { image: false, embeddedContext: false } },
    authMethods: [],
  };
  const initialized = async (client) => {
    const result = await client.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
    assert.deepEqual(result, expectedInitialize, "initialize must advertise exactly the reviewed capability set");
    return result;
  };
  const sessionParams = { cwd: workdir, mcpServers: [] };
  const promptParams = (sessionId) => ({ sessionId, prompt: [{ type: "text", text: "Return the synthetic response." }] });
  const usageFrames = (client) => client.events.filter((event) => event.method === "_lody/session/usage_update");
  const first = start();
  await initialized(first);
  const session = await first.request("session/new", sessionParams);
  assert.ok(
    typeof session.sessionId === "string" && resolve(session.sessionId).startsWith(`${resolve(home)}${sep}`),
    "Native session must stay in isolated home"
  );
  await access(session.sessionId);
  assert.equal((await first.request("session/prompt", promptParams(session.sessionId))).stopReason, "end_turn");
  assert.ok(requestCount > 0, "Actual OMP must call the loopback model");
  const initialPrompt = first.prompts.at(-1);
  const text = initialPrompt.notifications.filter((event) => event.method === "session/update").map((event) => event.params.update.content?.text ?? "").join("");
  assert.equal(text, "contract answer");
  const initialUsage = usageFrames(first).at(-1)?.params;
  assert.ok(initialUsage, "OMP terminal assistant usage must be forwarded");
  assert.deepEqual(Object.keys(initialUsage.modelUsage), ["contract/contract-model"]);
  assert.equal(initialUsage.modelUsage["contract/contract-model"].inputTokens, 10);
  assert.equal(initialUsage.modelUsage["contract/contract-model"].outputTokens, 5);
  await first.close();
  const resumed = start();
  await initialized(resumed);
  const exact = await resumed.request("session/resume", { ...sessionParams, sessionId: session.sessionId });
  assert.equal(exact.sessionId, session.sessionId);
  assert.equal(resumed.native().filter((event) => event.type === "state").at(-1)?.sessionFile, session.sessionId);
  await resumed.request("session/load", { ...sessionParams, sessionId: session.sessionId });
  assert.equal(resumed.native().filter((event) => event.type === "state").at(-1)?.sessionFile, session.sessionId, "Load must select the exact native file");
  assert.equal(usageFrames(resumed).length, 0, "Load/resume must not recount history");
  assert.equal((await resumed.request("session/prompt", promptParams(session.sessionId))).stopReason, "end_turn");
  assert.equal(requestHadHistory, true, "Exact load/resume must preserve native history, not create an empty fallback");
  const restoredUsage = usageFrames(resumed).at(-1)?.params;
  assert.notEqual(restoredUsage._meta.lody.usageScopeId, initialUsage._meta.lody.usageScopeId, "Restart must use a new accounting scope");
  assert.equal(restoredUsage.modelUsage["contract/contract-model"].inputTokens, 10, "New scope must not recount history");
  assert.equal((await resumed.request("session/prompt", { sessionId: session.sessionId, prompt: [{ type: "text", text: "/help" }] })).stopReason, "end_turn");
  nextMode = "cancel";
  requestStarted = Promise.withResolvers();
  streamClosed = Promise.withResolvers();
  const cancelled = resumed.request("session/prompt", promptParams(session.sessionId));
  // 同时观察 rejection，避免等待端点时发生未处理 rejection。
  void cancelled.catch(() => {});
  await deadline(requestStarted.promise, "Model stream started");
  resumed.notify("session/cancel", { sessionId: session.sessionId });
  assert.equal((await cancelled).stopReason, "cancelled");
  const cancelNative = resumed.prompts.at(-1).native;
  assert.ok(cancelNative.some((event) => event.type === "abort_ack" && event.success === true), "Cancelled response requires observed native abort ACK before ACP terminal");
  assert.ok(cancelNative.some((event) =>
    (event.type === "terminal" && event.status === "aborted" && (event.settled === true || cancelNative.some((value) => value.type === "settled"))) ||
    (event.type === "legacy_terminal" && ["aborted", "empty"].includes(event.status))
  ), "Cancelled response requires an observed native terminal");
  await deadline(streamClosed.promise, "Aborted loopback stream closure");
  nextMode = "error";
  await assert.rejects(resumed.request("session/prompt", promptParams(session.sessionId)));
  const invalid = join(home, "invalid.jsonl");
  const empty = join(home, "empty.jsonl");
  await writeFile(invalid, "not-a-native-session\n");
  await writeFile(empty, "");
  for (const method of ["session/load", "session/resume"]) {
    for (const target of [join(home, "missing.jsonl"), invalid, empty, home]) {
      const before = requestCount;
      await assert.rejects(resumed.request(method, { ...sessionParams, sessionId: target }));
      await assert.rejects(resumed.request("session/prompt", promptParams(session.sessionId)), "Failed load/resume must invalidate old identity");
      await assert.rejects(resumed.request("session/prompt", promptParams(target)), "Failed load/resume cannot create an empty fallback");
      assert.equal(requestCount, before, "Rejected identities must not reach the model");
      const recovered = await resumed.request("session/new", sessionParams);
      assert.ok(
        typeof recovered.sessionId === "string" && resolve(recovered.sessionId).startsWith(`${resolve(home)}${sep}`),
        "Native session must stay in isolated home"
      );
      await resumed.request("session/resume", { ...sessionParams, sessionId: session.sessionId });
    }
  }
  await resumed.close();
  await syntheticCases(initialized, sessionParams, promptParams);
} finally {
  // 所有清理都尝试；一个 close 失败不能跳过端点或临时目录。
  const cleanupErrors = [];
  const results = await Promise.allSettled(clients.map((client) => client.close()));
  for (const result of results) if (result.status === "rejected") cleanupErrors.push(result.reason);
  try {
    endpoint.closeAllConnections();
    if (endpoint.listening) await new Promise((done, reject) => endpoint.close((error) => error ? reject(error) : done()));
  } catch (error) { cleanupErrors.push(error); }
  try { await rm(scratch, { recursive: true, force: true }); } catch (error) { cleanupErrors.push(error); }
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Contract cleanup failed");
}
for (const client of clients) {
  assert.equal(client.child.signalCode, null, "ACP adapter must not exit by signal");
  assert.equal(client.child.exitCode, client.expectedExit, "ACP adapter must exit with the expected status");
  for (const prompt of client.prompts) {
    if (prompt.response) assertPromptOrder(client, prompt);
    else assert.equal(client.expectedExit, 1, "Only process-fault fixtures may lack a terminal response");
  }
}
console.log(`${version.stdout.trim()}: real ACP prompt/cancel ACK+terminal+stream-close/exact load/resume/usage/restart/per-event order/error contracts passed with loopback-only model.`);
