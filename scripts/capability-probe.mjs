// Release 1 已宣告能力的真实探针（docs-ai/019）：resume、fork、图片和 resource_link。
// 真实 OMP + 本地回环模型，隔离 HOME/profile，无用户凭据。每个新的 OMP 目标行都要重跑。
// 用法：node scripts/capability-probe.mjs /abs/dist/index.js /abs/omp
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";

const entry = resolve(process.argv[2]);
const binary = resolve(process.argv[3]);
const scratch = await mkdtemp(join(tmpdir(), "omp-capability-probe-"));
const home = join(scratch, "home");
const workdir = join(scratch, "workspace");
const agentDir = join(home, ".omp", "profiles", "probe", "agent");
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const LINK = { type: "resource_link", uri: "file:///synthetic/probe-image.png", name: "probe-image.png", mimeType: "image/png", size: 70 };
const requests = [];
const endpoint = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  // 只保留布尔观察值，不保存请求正文。
  requests.push({
    // OMP 会把内联图片转码（观察到 PNG 变成 WebP），所以核对最后一条用户消息里的图片部件，而不是原始字节。
    hasImage: ((JSON.parse(body).messages ?? []).filter((m) => m.role === "user").at(-1)?.content ?? [])
      .some?.((part) => part.type === "image_url" && String(part.image_url?.url).startsWith("data:image/")) ?? false,
    hasOriginalImageBytes: body.includes(PNG),
    hasLinkText: body.includes(`${LINK.name}: ${LINK.uri}`),
    hasHistory: (JSON.parse(body).messages ?? []).some((m) => m.role === "assistant" && JSON.stringify(m.content).includes("probe answer"))
      && (JSON.parse(body).messages ?? []).some((m) => m.role === "user" && JSON.stringify(m.content).includes("source turn one")),
  });
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const chunk = (value) => response.write(`data: ${JSON.stringify({ id: "probe", object: "chat.completion.chunk", created: 1, model: "probe-model", ...value })}\n\n`);
  chunk({ choices: [{ index: 0, delta: { role: "assistant", content: "probe answer" }, finish_reason: null }] });
  chunk({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
  chunk({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
  response.end("data: [DONE]\n\n");
});

const env = {
  PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home, OMP_PROFILE: "probe",
  XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local", "share"),
  XDG_CACHE_HOME: join(home, ".cache"), TMPDIR: scratch, TMP: scratch, TEMP: scratch,
};
const clients = [];
function start() {
  const child = spawn(process.execPath, [entry], { cwd: workdir, env, stdio: ["pipe", "pipe", "pipe"] });
  child.stderr.on("data", () => {});
  const closed = new Promise((done) => child.once("close", (code, signal) => done({ code, signal })));
  const pending = new Map();
  let sequence = 0;
  createInterface({ input: child.stdout }).on("line", (line) => {
    const frame = JSON.parse(line);
    const operation = pending.get(frame.id);
    if (!operation || frame.method) return;
    pending.delete(frame.id);
    if (frame.error) operation.reject(new Error(frame.error.message ?? "ACP failure"));
    else operation.resolve(frame.result);
  });
  const client = {
    closed,
    request(method, params) {
      const id = ++sequence;
      const operation = Promise.withResolvers();
      pending.set(id, operation);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      let timer;
      return Promise.race([
        operation.promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${method} timed out`)), 60_000); }),
      ]).finally(() => clearTimeout(timer));
    },
    async close() { child.stdin.end(); return closed; },
  };
  clients.push(client);
  return client;
}
const sha = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");
const text = (value) => [{ type: "text", text: value }];

const out = {};
try {
  await Promise.all([mkdir(agentDir, { recursive: true }), mkdir(workdir, { recursive: true })]);
  const bin = join(scratch, "bin");
  await mkdir(bin);
  await symlink(binary, join(bin, "omp"));
  env.PATH = [bin, dirname(process.execPath), env.PATH].join(delimiter);
  const version = spawnSync("omp", ["--version"], { cwd: workdir, env, encoding: "utf8", timeout: 15_000 });
  assert.match(version.stdout, /^omp\//);
  out.omp = version.stdout.trim();
  endpoint.listen(0, "127.0.0.1");
  await once(endpoint, "listening");
  await writeFile(join(agentDir, "models.yml"), `providers:\n  probe:\n    baseUrl: http://127.0.0.1:${endpoint.address().port}/v1\n    api: openai-completions\n    auth: none\n    models:\n      - id: probe-model\n        name: Probe Model\n        reasoning: false\n        input: [text, image]\n        contextWindow: 262144\n        maxTokens: 256\n`);
  await writeFile(join(agentDir, "config.yml"), "modelRoles:\n  default: probe/probe-model\n  smol: probe/probe-model\n  slow: probe/probe-model\n");
  const init = { protocolVersion: 1, clientCapabilities: {} };
  const session = { cwd: workdir, mcpServers: [] };

  // 源会话：一轮文字 prompt，产生持久文件。
  const source = start();
  out.capabilities = (await source.request("initialize", init)).agentCapabilities;
  const created = await source.request("session/new", session);
  const sourceFile = created.sessionId;
  assert.equal((await source.request("session/prompt", { sessionId: sourceFile, prompt: text("source turn one") })).stopReason, "end_turn");
  const before = await sha(sourceFile);

  // fork：源连接仍存活，另一连接对同一文件 fork。
  const forker = start();
  await forker.request("initialize", init);
  const forked = await forker.request("session/fork", { sessionId: sourceFile, ...session });
  const after = await sha(sourceFile);
  out.fork = {
    differentFile: forked.sessionId !== sourceFile,
    sourceUnchangedAcrossFork: before === after,
  };
  assert.ok(out.fork.differentFile, "fork must select a different sessionFile");
  assert.ok(out.fork.sourceUnchangedAcrossFork, "fork must not modify the source sessionFile");

  // 图片 + resource_link：在 fork 出的会话上发，核对回环端点实际收到的请求。
  const mark = requests.length;
  const imageTurn = await forker.request("session/prompt", {
    sessionId: forked.sessionId,
    prompt: [{ type: "text", text: "describe the attachment" }, { type: "image", data: PNG, mimeType: "image/png" }, LINK],
  });
  assert.equal(imageTurn.stopReason, "end_turn");
  const seen = requests.slice(mark);
  out.image = {
    modelRequests: seen.length,
    imagePartReachedModel: seen.some((r) => r.hasImage),
    originalBytesPreserved: seen.some((r) => r.hasOriginalImageBytes),
    linkTextReachedModel: seen.some((r) => r.hasLinkText),
    forkCarriedSourceHistory: seen.some((r) => r.hasHistory),
  };
  assert.ok(out.image.imagePartReachedModel, "an image part must reach the model request");
  assert.ok(out.image.linkTextReachedModel, "resource_link text must reach the model request");
  assert.ok(out.image.forkCarriedSourceHistory, "fork must carry the source history");
  const forkFileAfterImage = await sha(forked.sessionId);

  // 源会话在 fork 之后仍可继续，且不影响 fork 出的文件。
  assert.equal((await source.request("session/prompt", { sessionId: sourceFile, prompt: text("source turn two") })).stopReason, "end_turn");
  out.fork.sourceStillUsable = true;
  out.fork.forkFileUntouchedBySource = forkFileAfterImage === await sha(forked.sessionId);
  assert.ok(out.fork.forkFileUntouchedBySource);
  for (const client of [source, forker]) await client.close();

  // resume：新连接恢复源文件并完成一轮，模型请求带有历史。
  const resumer = start();
  await resumer.request("initialize", init);
  const resumed = await resumer.request("session/resume", { sessionId: sourceFile, ...session });
  const resumeMark = requests.length;
  assert.equal((await resumer.request("session/prompt", { sessionId: sourceFile, prompt: text("after resume") })).stopReason, "end_turn");
  out.resume = {
    sameFile: resumed.sessionId === undefined || resumed.sessionId === sourceFile,
    historyReachedModel: requests.slice(resumeMark).some((r) => r.hasHistory),
  };
  assert.ok(out.resume.sameFile && out.resume.historyReachedModel);
  await resumer.close();
  console.log(JSON.stringify(out, null, 2));
  console.log("CAPABILITY PROBE PASS");
} catch (error) {
  console.log(JSON.stringify(out, null, 2));
  console.log(`CAPABILITY PROBE FAIL: ${error.message}`);
  process.exitCode = 1;
} finally {
  for (const client of clients) await Promise.race([client.close(), new Promise((done) => setTimeout(done, 5_000))]).catch(() => {});
  endpoint.close();
  await rm(scratch, { recursive: true, force: true });
}
