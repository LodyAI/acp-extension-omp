import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

// Real OMP, synthetic model only: no user profile, credentials, or external endpoint.
const entry = resolve(process.argv[2] ?? "dist/index.js");
const executable = process.argv[3];
await access(entry);
const version = spawnSync(executable ?? "omp", ["--version"], { encoding: "utf8" });
assert.equal(version.status, 0, "OMP executable must be available");
assert.match(version.stdout, /^omp\//);
const scratch = await mkdtemp(join(tmpdir(), "omp-contract-"));
const home = join(scratch, "home");
const workdir = join(scratch, "workspace");
const agentDir = join(home, ".omp", "profiles", "contract", "agent");
const clients = [];
let nextMode = "complete";
let requestStarted;
let requestCount = 0;
const endpoint = createServer(async (request, response) => {
  for await (const _ of request) { /* Drain without storing prompts or headers. */ }
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

function start() {
  const child = spawn(process.execPath, [entry], { cwd: workdir, env, stdio: ["pipe", "pipe", "pipe"] });
  // Drain diagnostics, but never print raw provider output or profile data.
  child.stderr.on("data", () => {});
  const closed = once(child, "exit");
  const pending = new Map();
  const events = [];
  let sequence = 0;
  createInterface({ input: child.stdout }).on("line", (line) => {
    let frame;
    try { frame = JSON.parse(line); } catch { child.kill(); return; }
    events.push(frame);
    const operation = pending.get(frame.id);
    if (!operation) return;
    pending.delete(frame.id);
    if (frame.error) operation.reject(new Error(frame.error.message ?? "ACP failure"));
    else operation.resolve(frame.result);
  });
  child.on("exit", () => {
    for (const operation of pending.values()) operation.reject(new Error("Adapter exited before response"));
    pending.clear();
  });
  const value = {
    child, events,
    request(method, params) {
      const id = ++sequence;
      const operation = Promise.withResolvers();
      pending.set(id, operation);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      return deadline(operation.promise, method);
    },
    notify(method, params) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    },
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.stdin.end();
      try { await deadline(closed, "Adapter shutdown"); } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }
    },
  };
  clients.push(value);
  return value;
}

const env = {
  PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home,
  OMP_PROFILE: "contract", XDG_CONFIG_HOME: join(home, ".config"),
  XDG_DATA_HOME: join(home, ".local", "share"), XDG_CACHE_HOME: join(home, ".cache"),
  TMPDIR: scratch, TMP: scratch, TEMP: scratch,
};
try {
  await Promise.all([mkdir(agentDir, { recursive: true }), mkdir(workdir, { recursive: true })]);
  if (executable) {
    const bin = join(scratch, "bin");
    await mkdir(bin);
    await symlink(resolve(executable), join(bin, "omp"));
    env.PATH = `${bin}:${dirname(process.execPath)}:${env.PATH}`;
  }
  endpoint.listen(0, "127.0.0.1");
  await once(endpoint, "listening");
  const port = endpoint.address().port;
  await writeFile(join(agentDir, "models.yml"), `providers:\n  contract:\n    baseUrl: http://127.0.0.1:${port}/v1\n    api: openai-completions\n    auth: none\n    models:\n      - id: contract-model\n        name: Contract Model\n        reasoning: false\n        input: [text]\n        contextWindow: 262144\n        maxTokens: 256\n`);
  await writeFile(join(agentDir, "config.yml"), "modelRoles:\n  default: contract/contract-model\n  smol: contract/contract-model\n  slow: contract/contract-model\n");
  const initialized = (client) => client.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
  const sessionParams = { cwd: workdir, mcpServers: [] };
  const promptParams = (sessionId) => ({ sessionId, prompt: [{ type: "text", text: "Return the synthetic response." }] });
  const usageFrames = (client) => client.events.filter((event) => event.method === "_lody/session/usage_update");
  const first = start();
  await initialized(first);
  const session = await first.request("session/new", sessionParams);
  assert.ok(session.sessionId.startsWith(home), "Native session must stay in isolated home");
  await access(session.sessionId);
  assert.equal((await first.request("session/prompt", promptParams(session.sessionId))).stopReason, "end_turn");
  assert.ok(requestCount > 0, "Actual OMP must call the loopback model");
  const text = first.events.filter((event) => event.method === "session/update").map((event) => event.params.update.content?.text ?? "").join("");
  assert.equal(text, "contract answer");
  const initialUsage = usageFrames(first).at(-1)?.params;
  assert.ok(initialUsage, "OMP terminal assistant usage must be forwarded");
  assert.equal(initialUsage.modelUsage["contract/contract-model"].inputTokens, 10);
  assert.equal(initialUsage.modelUsage["contract/contract-model"].outputTokens, 5);
  assert.ok(first.events.indexOf(usageFrames(first).at(-1)) < first.events.findIndex((event) => event.result?.stopReason === "end_turn"), "Usage must precede terminal response");
  await first.close();
  const resumed = start();
  await initialized(resumed);
  const exact = await resumed.request("session/resume", { ...sessionParams, sessionId: session.sessionId });
  assert.equal(exact.sessionId, session.sessionId);
  await resumed.request("session/load", { ...sessionParams, sessionId: session.sessionId });
  assert.equal((await resumed.request("session/prompt", promptParams(session.sessionId))).stopReason, "end_turn");
  const restoredUsage = usageFrames(resumed).at(-1)?.params;
  assert.notEqual(restoredUsage._meta.lody.usageScopeId, initialUsage._meta.lody.usageScopeId, "Restart must use a new accounting scope");
  assert.equal(restoredUsage.modelUsage["contract/contract-model"].inputTokens, 10, "New scope must not recount history");
  assert.equal((await resumed.request("session/prompt", { sessionId: session.sessionId, prompt: [{ type: "text", text: "/help" }] })).stopReason, "end_turn");
  nextMode = "cancel";
  requestStarted = Promise.withResolvers();
  const cancelled = resumed.request("session/prompt", promptParams(session.sessionId));
  await deadline(requestStarted.promise, "Model stream started");
  resumed.notify("session/cancel", { sessionId: session.sessionId });
  assert.equal((await cancelled).stopReason, "cancelled");
  nextMode = "error";
  await assert.rejects(resumed.request("session/prompt", promptParams(session.sessionId)));
  await assert.rejects(resumed.request("session/load", { ...sessionParams, sessionId: join(home, "missing.jsonl") }));
  const invalid = join(home, "invalid.jsonl");
  await writeFile(invalid, "not-a-native-session\n");
  await assert.rejects(resumed.request("session/load", { ...sessionParams, sessionId: invalid }));
  console.log(`${version.stdout.trim()}: real ACP prompt/cancel/exact load/resume/usage/restart/order/error contracts passed with loopback-only model.`);
} finally {
  for (const client of clients) await client.close();
  endpoint.closeAllConnections();
  await new Promise((done) => endpoint.close(done));
  await rm(scratch, { recursive: true, force: true });
}
