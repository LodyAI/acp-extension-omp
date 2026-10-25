import type * as NodeFS from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { constants, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { ndJsonStream } from "@agentclientprotocol/sdk";
import type * as acp from "@agentclientprotocol/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import packageJson from "../package.json" with { type: "json" };
import { closeOnSignals, serve } from "../src/server.js";

// node:fs live bindings are not configurable, so vi.spyOn(writeSync) cannot see the diagnostic.
const fsControl = vi.hoisted(() => ({
  failFd2: false,
  writes: [] as string[],
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFS>();
  return {
    ...actual,
    writeSync: ((fd: number, data: string | NodeJS.ArrayBufferView, ...rest: never[]) => {
      if (fd === 2 && fsControl.failFd2) {
        fsControl.writes.push(String(data));
        throw new Error("synthetic stderr EPIPE");
      }
      return actual.writeSync(fd, data as never, ...rest);
    }) as typeof actual.writeSync,
  };
});

type SyntheticSpawn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const tempDirectories: string[] = [];

// Every wait names its bound: a forced close needs two real 1s grace periods (SIGTERM, then SIGKILL).
const RPC_TIMEOUT_MS = 3_000;
const FORCED_CLOSE_TIMEOUT_MS = 6_000;
const STDIO_RELEASE_BOUND_MS = 2_500;

function withTimeout<T>(promise: Promise<T>, label: string, ms: number): Promise<T> {
  // Integration boundary: protect against a real ACP/child-process deadlock.
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

function restorePath(value: string | undefined): void {
  if (value === undefined) delete process.env.PATH;
  else process.env.PATH = value;
}


type ForkCase = "success" | "source-missing" | "source-empty" | "wrong-source" | "cancelled" | "busy"
  | "invalid-fork" | "same-file" | "missing-file" | "empty-file" | "missing-identity" | "empty-identity" | "state-failure"
  | "streaming" | "compacting" | "pending-async" | "queued" | "hold-switch" | "hold-prompt";

const modelCatalog = [
  { provider: "fixture", id: "model", name: "Fixture" },
  { provider: "other", id: "family/x", name: "Fixture" },
  { provider: "org/branch", id: "leaf", name: "Branch" },
  { provider: "fixture", id: "fork-model", name: "Fork model" },
];
type ModelCase = "success" | "conflict" | "empty" | "missing-current" | "malformed-catalog" | "catalog-error"
  | "set-error" | "set-invalid" | "set-wrong-return" | "state-mismatch" | "state-error" | "state-missing"
  | "state-wrong-file" | "post-catalog-conflict" | "streaming" | "compacting" | "pending-async" | "queued" | "unsettled";

async function fakeOmp(
  mode: "serve" | "mcp-session" | "fork-session" | "model-config" | "title-control" | "notify" | "exit" | "eof" | "malformed" | "missing" | "ignore-eof" | "abort-rejected",
  forkCase: ForkCase = "success",
  modelCase: ModelCase = "success",
) {
  const directory = await mkdtemp(join(tmpdir(), "acp-extension-omp-test-"));
  tempDirectories.push(directory);
  if (mode === "missing") return directory;
  const executable = join(directory, "omp");
  const sessionFile = mode === "mcp-session" || mode === "model-config" || mode === "title-control" ? join(directory, "native-session.jsonl")
    : mode === "fork-session" ? join(directory, "source-session.jsonl") : "/tmp/fake-omp-session.jsonl";
  const forkFile = join(directory, "native fork 精确.jsonl");
  if (mode === "mcp-session" || mode === "model-config" || mode === "title-control" || (mode === "fork-session" && forkCase !== "source-missing")) {
    await writeFile(sessionFile, forkCase === "source-empty" ? "" : '{"type":"session","id":"synthetic-source"}\n');
  }
  if ((mode === "fork-session" || mode === "model-config") && forkCase !== "missing-file") {
    await writeFile(forkFile, forkCase === "empty-file" ? "" : '{"type":"session","id":"synthetic-fork"}\n');
  }
  if (mode === "fork-session" || mode === "model-config" || mode === "title-control") {
    await writeFile(join(directory, "other-session.jsonl"), '{"type":"session","id":"synthetic-other"}\n');
  }
  const source = `#!/usr/bin/env node
const readline = require("node:readline");
const args = process.argv.slice(2);
if (${JSON.stringify(mode)} === "exit") process.exit(23);
if (${JSON.stringify(mode)} === "abort-rejected") {
  require("node:fs").writeFileSync(require("node:path").join(__dirname, "child.pid"), String(process.pid));
}
if (${JSON.stringify(mode)} === "ignore-eof") {
  process.on("SIGTERM", () => {});
  require("node:fs").writeFileSync(require("node:path").join(__dirname, "child.pid"), String(process.pid));
  const holdOpen = require("node:net").createServer();
  holdOpen.listen(0, "127.0.0.1");
  // Bounds the orphan if the test runner dies before its cleanup runs.
  setTimeout(() => process.exit(0), 30_000);
}
if (args.join(" ") !== "--mode rpc") process.exit(42);
if (${JSON.stringify(mode)} === "eof") process.stdout.end();
if (${JSON.stringify(mode)} === "malformed") process.stdout.write("not-json\\n");
const input = readline.createInterface({ input: process.stdin });
let currentSession = ${JSON.stringify(mode)} === "fork-session"
  ? require("node:path").join(__dirname, "other-session.jsonl") : ${JSON.stringify(sessionFile)};
let forked = false;
let fixtureReleased = false;
let heldSwitch;
let heldPrompt;
let currentModel = ${JSON.stringify(modelCatalog[0])};
let modelMutation = false;
let modelRecovered = false;
let currentTitle = "Previous user title";
let holdModelType;
let heldModelResponse;
const models = ${JSON.stringify(modelCatalog)};
const emit = (frame) => process.stdout.write(JSON.stringify(frame) + "\\n");
const availableModels = () => {
  if (${JSON.stringify(mode)} !== "model-config") return [models[0], models[3]];
  if (${JSON.stringify(modelCase)} === "empty") return [];
  if (${JSON.stringify(modelCase)} === "missing-current") return models.slice(1);
  if (${JSON.stringify(modelCase)} === "conflict" ||
      (modelMutation && !modelRecovered && ${JSON.stringify(modelCase)} === "post-catalog-conflict")) {
    return [...models, { provider: "org", id: "branch/leaf", name: "Ambiguous" }];
  }
  return models;
};
const modelResponse = (command, response) => {
  if (command.type === holdModelType) {
    holdModelType = undefined;
    heldModelResponse = response;
    process.stderr.write("synthetic-model-held:" + command.type + "\\n");
  } else response();
};
const respond = (command, data, success = true, error) =>
  process.stdout.write(JSON.stringify({ type: "response", id: command.id, command: command.type, success, data, error }) + "\\n");
const switchToSource = (command) => {
  // The selected path is independent fixture state, never an echo of sessionPath.
  currentSession = !fixtureReleased && ${JSON.stringify(forkCase)} === "wrong-source"
    ? require("node:path").join(__dirname, "other-session.jsonl") : ${JSON.stringify(sessionFile)};
  forked = false;
  respond(command, { cancelled: false });
};
input.on("line", (line) => {
  if (!["serve", "mcp-session", "fork-session", "model-config", "title-control", "notify", "ignore-eof", "abort-rejected"].includes(${JSON.stringify(mode)})) return;
  const command = JSON.parse(line);
  if (command.type === "fixture_hold") {
    holdModelType = command.command;
    return;
  }
  if (command.type === "fixture_recover") {
    modelRecovered = true;
    currentSession = ${JSON.stringify(sessionFile)};
    currentModel = models[0];
    currentTitle = "Previous user title";
    process.stderr.write("synthetic-model-recovered\\n");
    return;
  }
  if (command.type === "fixture_release") {
    fixtureReleased = true;
    process.stderr.write("synthetic-fixture-released\\n");
    if (heldModelResponse) {
      const response = heldModelResponse;
      heldModelResponse = undefined;
      response();
    }
    if (heldSwitch) { switchToSource(heldSwitch); heldSwitch = undefined; }
    if (heldPrompt) {
      process.stdout.write(JSON.stringify({ type: "prompt_result", id: heldPrompt.id, status: "completed", sessionSettled: true }) + "\\n");
      heldPrompt = undefined;
    }
    return;
  }
  if (${JSON.stringify(mode)} === "mcp-session" || ${JSON.stringify(mode)} === "fork-session" || ${JSON.stringify(mode)} === "model-config" || ${JSON.stringify(mode)} === "title-control") {
    require("node:fs").appendFileSync(require("node:path").join(__dirname, "rpc-commands.jsonl"), line + "\\n");
  }
  if (command.type === "switch_session" && ${JSON.stringify(mode)} === "fork-session") {
    if (${JSON.stringify(forkCase)} === "hold-switch") {
      heldSwitch = command;
      process.stderr.write("synthetic-switch-held\\n");
    } else switchToSource(command);
  } else if (command.type === "new_session" || command.type === "switch_session") {
    respond(command, { cancelled: false });
  } else if (command.type === "fork") {
    if (${JSON.stringify(forkCase)} === "busy") respond(command, undefined, false, "synthetic session busy");
    else if (${JSON.stringify(forkCase)} === "cancelled") respond(command, { cancelled: true });
    else if (${JSON.stringify(forkCase)} === "invalid-fork") respond(command, { cancelled: "false" });
    else {
      forked = true;
      currentModel = models[3];
      currentSession = ${JSON.stringify(forkCase)} === "same-file" ? ${JSON.stringify(sessionFile)} : ${JSON.stringify(forkFile)};
      respond(command, { cancelled: false });
    }
  } else if (command.type === "get_available_models") {
    modelResponse(command, () => {
      if (${JSON.stringify(mode)} === "model-config" && !modelRecovered && ${JSON.stringify(modelCase)} === "catalog-error")
        respond(command, undefined, false, "private-catalog-error");
      else if (${JSON.stringify(mode)} === "model-config" && !modelRecovered && ${JSON.stringify(modelCase)} === "malformed-catalog")
        respond(command, { models: [{ provider: "", id: "broken", name: "Broken" }] });
      else respond(command, { models: availableModels() });
    });
  } else if (command.type === "set_model") {
    modelResponse(command, () => {
      modelMutation = true;
      const selected = availableModels().find((model) => model.provider === command.provider && model.id === command.modelId);
      if (!selected || (!modelRecovered && ${JSON.stringify(modelCase)} === "set-error"))
        respond(command, undefined, false, "private-set-error");
      else if (!modelRecovered && ${JSON.stringify(modelCase)} === "set-invalid") respond(command, { cancelled: true });
      else {
        currentModel = selected;
        respond(command, !modelRecovered && ${JSON.stringify(modelCase)} === "set-wrong-return" ? models[0] : currentModel);
      }
    });
  } else if (command.type === "set_session_name") {
    modelResponse(command, () => {
      const cleaned = command.name.replace(/\\p{Cc}/gu, " ").replace(/ +/g, " ").trim();
      if (!cleaned) respond(command, undefined, false, "synthetic native rejected empty title");
      else {
        currentTitle = cleaned;
        require("node:fs").appendFileSync(currentSession, JSON.stringify({ type: "synthetic-title-write", title: currentTitle }) + "\\n");
        respond(command);
      }
    });
  } else if (command.type === "get_session_stats") {
    modelResponse(command, () => respond(command, {
      sessionFile: currentSession, sessionId: forked ? "native-fork-id" : "native-source-id",
      tokens: { input: 900, output: 800 }, cost: 777,
    }));
  } else if (command.type === "get_state") {
    modelResponse(command, () => {
    if ((forked && ${JSON.stringify(forkCase)} === "state-failure") ||
        (modelMutation && !modelRecovered && ${JSON.stringify(modelCase)} === "state-error")) {
      respond(command, undefined, false, "synthetic state unavailable");
    } else respond(command, {
      sessionFile: forked && ${JSON.stringify(forkCase)} === "missing-identity" ? undefined
        : forked && ${JSON.stringify(forkCase)} === "empty-identity" ? ""
        : modelMutation && !modelRecovered && ${JSON.stringify(modelCase)} === "state-missing" ? undefined
        : modelMutation && !modelRecovered && ${JSON.stringify(modelCase)} === "state-wrong-file"
          ? require("node:path").join(__dirname, "other-session.jsonl") : currentSession,
      sessionId: forked ? "native-fork-id" : "native-source-id",
      sessionName: ${JSON.stringify(mode)} === "title-control" ? currentTitle : undefined,
      isStreaming: !fixtureReleased && ((currentSession === ${JSON.stringify(sessionFile)} && ${JSON.stringify(forkCase)} === "streaming") || ${JSON.stringify(modelCase)} === "streaming"),
      isCompacting: !fixtureReleased && ((currentSession === ${JSON.stringify(sessionFile)} && ${JSON.stringify(forkCase)} === "compacting") || ${JSON.stringify(modelCase)} === "compacting"),
      isSettled: fixtureReleased || (currentSession !== ${JSON.stringify(sessionFile)} || !["streaming", "compacting", "pending-async", "queued"].includes(${JSON.stringify(forkCase)})) && ${JSON.stringify(modelCase)} !== "unsettled",
      hasPendingAsyncWork: !fixtureReleased && ((currentSession === ${JSON.stringify(sessionFile)} && ${JSON.stringify(forkCase)} === "pending-async") || ${JSON.stringify(modelCase)} === "pending-async"),
      queuedMessageCount: !fixtureReleased && ((currentSession === ${JSON.stringify(sessionFile)} && ${JSON.stringify(forkCase)} === "queued") || ${JSON.stringify(modelCase)} === "queued") ? 1 : 0,
      model: ${JSON.stringify(mode)} === "model-config"
        ? modelMutation && !modelRecovered && ${JSON.stringify(modelCase)} === "state-mismatch" ? models[0] : currentModel
        : { provider: "fixture", id: forked ? "fork-model" : "model", name: forked ? "Fork model" : "Fixture", input: ["text", "image"] },
    });
    });
  } else if (command.type === "prompt" && ${JSON.stringify(mode)} === "title-control" && /^\\/rename\\s*$/.test(command.message)) {
    currentTitle = "Generated fixture title";
    emit({ type: "session_info_update", title: currentTitle, sessionId: "native-source-id" });
    respond(command, { agentInvoked: false });
  } else if (command.type === "prompt" && ${JSON.stringify(mode)} === "notify") {
    // No ACK or terminal: notification failure must terminate this otherwise-live work.
    process.stdout.write(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "synthetic" } }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "message_end", messageId: "usage-1", message: { role: "assistant", provider: "fixture", model: "model", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } } }) + "\\n");
  } else if (command.type === "prompt") {
    if (${JSON.stringify(mode)} === "fork-session" && ${JSON.stringify(forkCase)} === "hold-prompt") {
      heldPrompt = command;
      process.stderr.write("synthetic-prompt-held\\n");
      respond(command, {});
      return;
    }
    process.stdout.write(JSON.stringify({ type: "response", id: command.id, command: "prompt", success: true }) + "\\n");
    if (${JSON.stringify(mode)} === "mcp-session" || ${JSON.stringify(mode)} === "fork-session" || ${JSON.stringify(mode)} === "model-config" || ${JSON.stringify(mode)} === "title-control") {
      if (${JSON.stringify(mode)} === "fork-session") {
        require("node:fs").appendFileSync(currentSession, JSON.stringify({ type: "synthetic-prompt-write" }) + "\\n");
        process.stdout.write(JSON.stringify({ type: "message_update", sessionId: forked ? "native-fork-id" : "native-source-id", assistantMessageEvent: { type: "text_delta", delta: "synthetic fork reply" } }) + "\\n");
      }
      if (${JSON.stringify(mode)} === "model-config") {
        emit({ type: "message_update", messageId: "reply-" + command.id, assistantMessageEvent: { type: "text_delta", delta: currentModel.provider + "/" + currentModel.id } });
        emit({ type: "message_end", messageId: "reply-" + command.id, message: {
          role: "assistant", provider: currentModel.provider, model: currentModel.id,
          usage: { input: 3, output: 2, cacheRead: 0, cacheWrite: 0 },
        } });
      }
      if (${JSON.stringify(mode)} === "title-control") {
        emit({ type: "session_info_update", title: "Unknown native title frame", sessionId: "native-source-id" });
        emit({ type: "message_update", messageId: "ordinary-" + command.id, assistantMessageEvent: { type: "text_delta", delta: "ordinary native prompt" } });
      }
      process.stdout.write(JSON.stringify({ type: "prompt_result", id: command.id, agentInvoked: true, status: "completed", sessionSettled: true }) + "\\n");
    }
  } else if (command.type === "abort") {
    process.stdout.write(JSON.stringify({ type: "response", id: command.id, command: "abort", success: false }) + "\\n");
  }
});
`;
  await Promise.all([
    writeFile(executable, source, "utf8"),
    writeFile(join(directory, "omp-runner.cjs"), source, "utf8"),
  ]);
  await chmod(executable, 0o755);
  return directory;
}

// Windows fixtures launch Node directly so serve owns the runner PID without a .cmd shell.
function syntheticSpawn(directory: string, onSpawn?: (child: ChildProcess) => void): SyntheticSpawn {
  return (command, args, options) => {
    if (command !== "omp") throw new Error(`Expected synthetic OMP command, got ${command}`);
    const child = process.platform === "win32"
      ? spawn(process.execPath, [join(directory, "omp-runner.cjs"), ...args], options)
      : spawn(command, args, options);
    onSpawn?.(child);
    return child;
  };
}

// Answers the synthetic OMP RPC commands that session/new needs, for in-process ChildProcess doubles.
function answerRpc(stdin: PassThrough, stdout: PassThrough): void {
  let buffered = "";
  stdin.on("data", (bytes: Buffer) => {
    buffered += bytes.toString();
    for (;;) {
      const separator = buffered.indexOf("\n");
      if (separator < 0) break;
      const command = JSON.parse(buffered.slice(0, separator)) as { id: string; type: string };
      buffered = buffered.slice(separator + 1);
      const data = command.type === "get_state"
        ? { sessionFile: "/tmp/fake-omp-session.jsonl", model: { provider: "fixture", id: "model", name: "Fixture" } }
        : command.type === "get_available_models" ? { models: [modelCatalog[0]] } : {};
      stdout.write(`${JSON.stringify({ type: "response", id: command.id, success: true, data })}\n`);
    }
  });
}

function noSuchProcess(): NodeJS.ErrnoException {
  const error = new Error("No such process") as NodeJS.ErrnoException;
  error.code = "ESRCH";
  return error;
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
};

type PendingRequest = Deferred<unknown>;

type Harness = {
  request<T>(method: string, params: Record<string, unknown>): Promise<T>;
  notify(method: string, params: Record<string, unknown>): void;
  inputEvents: ("eof" | "error" | "cancel")[];
  endInput(): void;
  errorInput(reason: unknown): void;
  closed: Promise<void>;
  isClosed(): boolean;
  close(): Promise<void>;
  serverClose(): Promise<void>;
};

function harness(
  spawnProcess?: SyntheticSpawn,
  onParentFailure: (error: Error) => void = () => {},
  onOutput: (message: { id?: number; method?: string; result?: unknown; params?: unknown }, controller: WritableStreamDefaultController) => void | Promise<void> = () => {},
): Harness {
  let input!: ReadableStreamDefaultController<Uint8Array>;
  const pending = new Map<number, PendingRequest>();
  let nextId = 0;
  let buffered = "";
  const inputEvents: ("eof" | "error" | "cancel")[] = [];
  const output = new WritableStream<Uint8Array>({
    async write(bytes, controller) {
      buffered += decoder.decode(bytes, { stream: true });
      for (;;) {
        const separator = buffered.indexOf("\n");
        if (separator < 0) return;
        const line = buffered.slice(0, separator);
        buffered = buffered.slice(separator + 1);
        if (!line) continue;
        const message = JSON.parse(line) as { id?: number; method?: string; result?: unknown; params?: unknown; error?: { message?: string } };
        await onOutput(message, controller);
        if (message.id === undefined) continue;
        const request = pending.get(message.id);
        if (!request) continue;
        pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message ?? "ACP request failed"));
        else request.resolve(message.result);
      }
    },
  });
  const inputStream = new ReadableStream<Uint8Array>({
    start(controller) {
      input = controller;
    },
    cancel() {
      inputEvents.push("cancel");
    },
  });
  const server = serve(ndJsonStream(output, inputStream), {
    onParentFailure,
    ...(spawnProcess ? { spawnProcess } : {}),
  });
  return {
    inputEvents,
    endInput() {
      input.close();
      inputEvents.push("eof");
    },
    errorInput(reason: unknown) {
      input.error(reason);
      inputEvents.push("error");
    },
    closed: server.connection.closed,
    request<T>(method: string, params: Record<string, unknown>) {
      const id = ++nextId;
      const result = Promise.withResolvers<unknown>();
      pending.set(id, result);
      input.enqueue(encoder.encode(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`));
      return result.promise as Promise<T>;
    },
    notify(method: string, params: Record<string, unknown>) {
      input.enqueue(encoder.encode(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`));
    },
    isClosed() {
      return server.connection.signal.aborted;
    },
    async close() {
      try {
        input.close();
      } catch {
        // The ACP input may already be closed after a child failure.
      }
      await server.close();
    },
    serverClose: server.close,
  };
}

async function closeCauseFixture(
  mode: "serve" | "notify" | "title-control",
  onOutput: Parameters<typeof harness>[2] = () => {},
) {
  const directory = await fakeOmp(mode);
  const previousPath = process.env.PATH;
  const previousExitCode = process.exitCode;
  process.env.PATH = [directory, dirname(process.execPath)].join(delimiter);
  process.exitCode = 0;
  const trace: string[] = [];
  const failures: Error[] = [];
  const exited = Promise.withResolvers<void>();
  let child: ChildProcess | undefined;
  const client = harness(syntheticSpawn(directory, (owned) => {
    child = owned;
    owned.once("exit", () => {
      trace.push("owned-child-exit");
      exited.resolve();
    });
  }), (error) => {
    trace.push("parent-failure");
    failures.push(error);
  }, onOutput);
  void client.closed.then(() => { trace.push("sdk-closed"); });
  return {
    directory, client, failures, trace, exited: exited.promise,
    get child() { return child; },
    async cleanup() {
      const result = await Promise.allSettled([client.close()]);
      restorePath(previousPath);
      process.exitCode = previousExitCode;
      return result;
    },
  };
}

describe("016 ACP close cause", () => {
  it("reports one parent failure and exit 1 when a real output write rejects with parent input open", async () => {
    const writeFault = Promise.withResolvers<void>();
    const responses: { id?: number; result?: unknown }[] = [];
    let faultCount = 0;
    const fixture = await closeCauseFixture("notify", (message) => {
      if (message.method === "session/update") {
        faultCount += 1;
        fixture.trace.push("output-write-rejected");
        writeFault.resolve();
        throw new Error("synthetic real output rejection");
      }
      responses.push(message);
    });
    let cleanup: PromiseSettledResult<void>[] = [];
    try {
      await fixture.client.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
      const session = await fixture.client.request<acp.NewSessionResponse>("session/new", {
        cwd: fixture.directory, mcpServers: [],
      });
      const successesBefore = responses.filter((message) => message.id !== undefined && message.result !== undefined).length;
      let pendingSucceeded = false;
      void fixture.client.request("session/prompt", {
        sessionId: session.sessionId, prompt: [{ type: "text", text: "notification failure without caller EOF" }],
      }).then(() => { pendingSucceeded = true; }, () => {});
      await withTimeout(writeFault.promise, "016 real output write rejection", RPC_TIMEOUT_MS);
      await withTimeout(fixture.client.closed, "016 SDK close after write rejection", RPC_TIMEOUT_MS);
      await withTimeout(fixture.exited, "016 owned OMP exit after write rejection", FORCED_CLOSE_TIMEOUT_MS);
      expect(fixture.client.inputEvents).not.toContain("eof");
      expect(fixture.client.inputEvents).not.toContain("error");
      expect(faultCount).toBe(1);
      expect(pendingSucceeded).toBe(false);
      expect(responses.filter((message) => message.id !== undefined && message.result !== undefined)).toHaveLength(successesBefore);
      expect(fixture.child?.pid).toBeDefined();
      expect(processExists(fixture.child!.pid!)).toBe(false);
      if (process.platform !== "win32") expect(processExists(-fixture.child!.pid!)).toBe(false);
      expect(process.exitCode).toBe(1);
      expect(fixture.failures).toHaveLength(1);
      expect(fixture.trace.indexOf("output-write-rejected")).toBeLessThan(fixture.trace.indexOf("sdk-closed"));
      expect(fixture.trace.indexOf("parent-failure")).toBeLessThan(fixture.trace.indexOf("sdk-closed"));
    } finally {
      cleanup = await fixture.cleanup();
    }
    expect(cleanup[0]?.status).toBe("fulfilled");
  });

  it("closes from actual decoded input EOF without explicit server close and leaves exit 0", async () => {
    const fixture = await closeCauseFixture("serve");
    let cleanup: PromiseSettledResult<void>[] = [];
    try {
      await fixture.client.request("session/new", { cwd: fixture.directory, mcpServers: [] });
      fixture.trace.push("parent-input-eof-requested");
      fixture.client.endInput();
      await withTimeout(fixture.client.closed, "016 decoded EOF SDK close", RPC_TIMEOUT_MS);
      await withTimeout(fixture.exited, "016 decoded EOF owned process exit", FORCED_CLOSE_TIMEOUT_MS);
      expect(fixture.client.inputEvents).toEqual(["eof"]);
      expect(fixture.trace.indexOf("parent-input-eof-requested")).toBeLessThan(fixture.trace.indexOf("sdk-closed"));
      expect(fixture.failures).toEqual([]);
      expect(process.exitCode).toBe(0);
      expect(fixture.child?.pid).toBeDefined();
      expect(processExists(fixture.child!.pid!)).toBe(false);
      if (process.platform !== "win32") expect(processExists(-fixture.child!.pid!)).toBe(false);
    } finally {
      cleanup = await fixture.cleanup();
    }
    expect(cleanup[0]?.status).toBe("fulfilled");
  });

  it.each([
    { label: "an Error whose text resembles normal closure", reason: new Error("ACP connection closed") },
    { label: "an undefined error reason", reason: undefined },
  ])("does not treat an actual errored input as graceful EOF: $label", async ({ reason }) => {
    const fixture = await closeCauseFixture("serve");
    let cleanup: PromiseSettledResult<void>[] = [];
    try {
      await fixture.client.request("session/new", { cwd: fixture.directory, mcpServers: [] });
      fixture.trace.push("parent-input-error-requested");
      fixture.client.errorInput(reason);
      await withTimeout(fixture.client.closed, "016 errored source SDK close", RPC_TIMEOUT_MS);
      await withTimeout(fixture.exited, "016 errored source owned process exit", FORCED_CLOSE_TIMEOUT_MS);
      expect(fixture.client.inputEvents).toContain("error");
      expect(fixture.client.inputEvents).not.toContain("eof");
      expect(fixture.failures).toHaveLength(1);
      expect(process.exitCode).toBe(1);
      expect(fixture.child?.pid).toBeDefined();
      expect(processExists(fixture.child!.pid!)).toBe(false);
      if (process.platform !== "win32") expect(processExists(-fixture.child!.pid!)).toBe(false);
    } finally {
      cleanup = await fixture.cleanup();
    }
    expect(cleanup[0]?.status).toBe("fulfilled");
  });

  it("keeps explicit close graceful when its derived decoded EOF follows", async () => {
    const fixture = await closeCauseFixture("serve");
    let cleanup: PromiseSettledResult<void>[] = [];
    try {
      await fixture.client.request("session/new", { cwd: fixture.directory, mcpServers: [] });
      fixture.trace.push("explicit-close-requested");
      await withTimeout(fixture.client.serverClose(), "016 explicit server close", FORCED_CLOSE_TIMEOUT_MS);
      fixture.client.endInput();
      await withTimeout(fixture.client.closed, "016 EOF after explicit close", RPC_TIMEOUT_MS);
      expect(fixture.failures).toEqual([]);
      expect(process.exitCode).toBe(0);
      expect(fixture.child?.pid).toBeDefined();
      expect(processExists(fixture.child!.pid!)).toBe(false);
      if (process.platform !== "win32") expect(processExists(-fixture.child!.pid!)).toBe(false);
    } finally {
      cleanup = await fixture.cleanup();
    }
    expect(cleanup[0]?.status).toBe("fulfilled");
  });

  it("keeps a decoded EOF first cause when an already-entered output write rejects later", async () => {
    const entered = Promise.withResolvers<void>();
    const releaseWrite = Promise.withResolvers<void>();
    const rejected = Promise.withResolvers<void>();
    const fixture = await closeCauseFixture("notify", async (message) => {
      if (message.method !== "session/update") return;
      fixture.trace.push("output-write-entered");
      entered.resolve();
      try {
        await releaseWrite.promise;
      } catch (error) {
        fixture.trace.push("output-write-rejected");
        rejected.resolve();
        throw error;
      }
    });
    let cleanup: PromiseSettledResult<void>[] = [];
    try {
      const session = await fixture.client.request<acp.NewSessionResponse>("session/new", {
        cwd: fixture.directory, mcpServers: [],
      });
      let pendingSucceeded = false;
      void fixture.client.request("session/prompt", {
        sessionId: session.sessionId, prompt: [{ type: "text", text: "held real output write" }],
      }).then(() => { pendingSucceeded = true; }, () => {});
      await withTimeout(entered.promise, "016 output sink entered", RPC_TIMEOUT_MS);
      fixture.trace.push("parent-input-eof-requested");
      fixture.client.endInput();
      await withTimeout(fixture.client.closed, "016 EOF wins before held write rejects", RPC_TIMEOUT_MS);
      await withTimeout(fixture.exited, "016 EOF first owned process exit", FORCED_CLOSE_TIMEOUT_MS);
      expect(fixture.trace).not.toContain("output-write-rejected");
      expect(fixture.failures).toEqual([]);
      expect(process.exitCode).toBe(0);
      releaseWrite.reject(new Error("synthetic late output rejection"));
      await withTimeout(rejected.promise, "016 release rejected output producer", RPC_TIMEOUT_MS);
      // Drain the already-rejected Writable/SDK promise chain, not a wall-clock success delay.
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(fixture.trace.indexOf("sdk-closed")).toBeLessThan(fixture.trace.indexOf("output-write-rejected"));
      expect(fixture.client.inputEvents).toEqual(["eof"]);
      expect(pendingSucceeded).toBe(false);
      expect(fixture.failures).toEqual([]);
      expect(process.exitCode).toBe(0);
      expect(fixture.child?.pid).toBeDefined();
      expect(processExists(fixture.child!.pid!)).toBe(false);
      if (process.platform !== "win32") expect(processExists(-fixture.child!.pid!)).toBe(false);
    } finally {
      releaseWrite.resolve();
      cleanup = await fixture.cleanup();
    }
    expect(cleanup[0]?.status).toBe("fulfilled");
  });
});

afterEach(async () => {
  for (const directory of tempDirectories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("015 model config ACP consumer", () => {
  it("lists the exact native catalog across providers and slashes on session/new", async () => {
    const directory = await fakeOmp("model-config");
    const previousPath = process.env.PATH;
    process.env.PATH = [directory, dirname(process.execPath)].join(delimiter);
    const client = harness(syntheticSpawn(directory));
    try {
      const initialized = await client.request<acp.InitializeResponse>("initialize", {
        protocolVersion: 1, clientCapabilities: {},
      });
      expect(initialized.agentCapabilities).toEqual({
        promptCapabilities: { image: false, embeddedContext: false },
      });
      const session = await withTimeout(client.request<acp.NewSessionResponse>("session/new", {
        cwd: directory, mcpServers: [],
      }), "015 catalog session/new", RPC_TIMEOUT_MS);
      expect(session.sessionId).toBe(join(directory, "native-session.jsonl"));
      expect(session.configOptions).toEqual([{
        id: "model", name: expect.any(String), category: "model", type: "select", currentValue: "fixture/model",
        options: [
          { value: "fixture/model", name: "Fixture" },
          { value: "other/family/x", name: "Fixture" },
          { value: "org/branch/leaf", name: "Branch" },
          { value: "fixture/fork-model", name: "Fork model" },
        ],
      }]);
    } finally {
      restorePath(previousPath);
      await client.close();
    }
  });

  it("uses standard set_config_option and the native provider/id pair for A to B to A", async () => {
    const directory = await fakeOmp("model-config");
    const previousPath = process.env.PATH;
    process.env.PATH = [directory, dirname(process.execPath)].join(delimiter);
    const notifications: acp.SessionNotification[] = [];
    const sequence: string[] = [];
    const client = harness(syntheticSpawn(directory), undefined, (message) => {
      if (message.method === "session/update") {
        notifications.push(message.params as acp.SessionNotification);
        sequence.push("update");
      }
    });
    try {
      const session = await client.request<acp.NewSessionResponse>("session/new", { cwd: directory, mcpServers: [] });
      for (const value of ["other/family/x", "org/branch/leaf", "fixture/model"]) {
        const before = notifications.length;
        const result = await withTimeout(client.request<acp.SetSessionConfigOptionResponse>("session/set_config_option", {
          sessionId: session.sessionId, configId: "model", value,
        }), "015 standard model setter", RPC_TIMEOUT_MS);
        sequence.push("response");
        expect(result.configOptions).toEqual([{
          id: "model", name: expect.any(String), category: "model", type: "select", currentValue: value,
          options: modelCatalog.map((model) => ({ value: `${model.provider}/${model.id}`, name: model.name })),
        }]);
        expect(notifications.slice(before)).toEqual([{
          sessionId: session.sessionId,
          update: { sessionUpdate: "config_option_update", configOptions: result.configOptions },
        }]);
        await expect(client.request("session/prompt", {
          sessionId: session.sessionId, prompt: [{ type: "text", text: "observe actual model" }],
        })).resolves.toEqual({ stopReason: "end_turn" });
        expect(notifications.at(-1)?.update).toEqual({
          sessionUpdate: "agent_message_chunk", content: { type: "text", text: value },
        });
      }
      const commands = (await readFile(join(directory, "rpc-commands.jsonl"), "utf8"))
        .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(commands.filter((command) => command.type === "set_model").map(({ id, ...command }) => command)).toEqual([
        { type: "set_model", provider: "other", modelId: "family/x" },
        { type: "set_model", provider: "org/branch", modelId: "leaf" },
        { type: "set_model", provider: "fixture", modelId: "model" },
      ]);
      expect(sequence.slice(0, 2)).toEqual(["update", "response"]);
    } finally {
      restorePath(previousPath);
      await client.close();
    }
  });

  it.each([
    { configId: "other", value: "fixture/model" },
    { configId: "model", value: "not-listed/model" },
    { configId: "model", value: true, type: "boolean" },
    { sessionId: "/tmp/unprepared-model-session.jsonl", configId: "model", value: "fixture/model" },
  ])("rejects an unlisted config choice before native mutation: $configId/$value", async (choice) => {
    const directory = await fakeOmp("model-config");
    const previousPath = process.env.PATH;
    process.env.PATH = [directory, dirname(process.execPath)].join(delimiter);
    const notifications: unknown[] = [];
    const client = harness(syntheticSpawn(directory), undefined, (message) => {
      if (message.method === "session/update") notifications.push(message.params);
    });
    try {
      const session = await client.request<acp.NewSessionResponse>("session/new", { cwd: directory, mcpServers: [] });
      await expect(client.request("session/set_config_option", { sessionId: session.sessionId, ...choice })).rejects.toThrow();
      const commands = (await readFile(join(directory, "rpc-commands.jsonl"), "utf8"))
        .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(commands.filter((command) => command.type === "set_model")).toEqual([]);
      expect(notifications).toEqual([]);
      await expect(client.request("session/prompt", {
        sessionId: session.sessionId, prompt: [{ type: "text", text: "validation did not change session" }],
      })).resolves.toEqual({ stopReason: "end_turn" });
    } finally {
      restorePath(previousPath);
      await client.close();
    }
  });

  it.each(["conflict", "empty", "missing-current", "malformed-catalog", "catalog-error"] satisfies ModelCase[])(
    "rejects session preparation with an unrepresentable native catalog: %s",
    async (failure) => {
      const directory = await fakeOmp("model-config", "success", failure);
      const previousPath = process.env.PATH;
      process.env.PATH = [directory, dirname(process.execPath)].join(delimiter);
      const client = harness(syntheticSpawn(directory));
      try {
        await expect(client.request("session/new", { cwd: directory, mcpServers: [] })).rejects.toThrow();
        await expect(client.request("session/prompt", {
          sessionId: join(directory, "native-session.jsonl"), prompt: [{ type: "text", text: "not prepared" }],
        })).rejects.toThrow();
        const commands = (await readFile(join(directory, "rpc-commands.jsonl"), "utf8"))
          .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
        expect(commands.filter((command) => command.type === "prompt" || command.type === "set_model")).toEqual([]);
      } finally {
        restorePath(previousPath);
        await client.close();
      }
    },
  );

  it.each([
    "set-error", "set-invalid", "set-wrong-return", "state-mismatch", "state-error",
    "state-missing", "state-wrong-file", "post-catalog-conflict",
  ] satisfies ModelCase[])("invalidates unverified model changes and recovers only by exact preparation: %s", async (failure) => {
    const directory = await fakeOmp("model-config", "success", failure);
    const previousPath = process.env.PATH;
    process.env.PATH = [directory, dirname(process.execPath)].join(delimiter);
    const notifications: unknown[] = [];
    const recovered = Promise.withResolvers<void>();
    let child: ChildProcess | undefined;
    const client = harness(syntheticSpawn(directory, (owned) => {
      child = owned;
      let stderr = "";
      owned.stderr?.on("data", (bytes: Buffer) => {
        stderr += bytes.toString();
        if (stderr.includes("synthetic-model-recovered")) recovered.resolve();
      });
    }), undefined, (message) => {
      if (message.method === "session/update") notifications.push(message.params);
    });
    try {
      const session = await client.request<acp.NewSessionResponse>("session/new", { cwd: directory, mcpServers: [] });
      await expect(client.request("session/set_config_option", {
        sessionId: session.sessionId, configId: "model", value: "other/family/x",
      })).rejects.toThrow();
      expect(notifications).toEqual([]);
      await expect(client.request("session/prompt", {
        sessionId: session.sessionId, prompt: [{ type: "text", text: "unverified old identity" }],
      })).rejects.toThrow();
      const beforeRecovery = (await readFile(join(directory, "rpc-commands.jsonl"), "utf8"))
        .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(beforeRecovery.filter((command) => command.type === "set_model")).toHaveLength(1);
      expect(beforeRecovery.filter((command) => command.type === "prompt")).toEqual([]);
      child?.stdin?.write(`${JSON.stringify({ type: "fixture_recover" })}\n`);
      await withTimeout(recovered.promise, "015 native model recovery", RPC_TIMEOUT_MS);
      const resumed = await client.request<acp.NewSessionResponse>("session/resume", {
        cwd: directory, sessionId: session.sessionId, mcpServers: [],
      });
      expect(resumed.sessionId).toBe(session.sessionId);
      expect(resumed.configOptions?.[0]).toMatchObject({ currentValue: "fixture/model", category: "model" });
      await expect(client.request("session/prompt", {
        sessionId: session.sessionId, prompt: [{ type: "text", text: "verified recovery" }],
      })).resolves.toEqual({ stopReason: "end_turn" });
    } finally {
      restorePath(previousPath);
      await client.close();
    }
  });

  it.each(["streaming", "compacting", "pending-async", "queued", "unsettled"] satisfies ModelCase[])(
    "refuses a model mutation when native state reports %s",
    async (busy) => {
      const directory = await fakeOmp("model-config", "success", busy);
      const previousPath = process.env.PATH;
      process.env.PATH = [directory, dirname(process.execPath)].join(delimiter);
      const client = harness(syntheticSpawn(directory));
      try {
        const session = await client.request<acp.NewSessionResponse>("session/new", { cwd: directory, mcpServers: [] });
        await expect(client.request("session/set_config_option", {
          sessionId: session.sessionId, configId: "model", value: "other/family/x",
        })).rejects.toThrow();
        const commands = (await readFile(join(directory, "rpc-commands.jsonl"), "utf8"))
          .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
        expect(commands.filter((command) => command.type === "set_model")).toEqual([]);
      } finally {
        restorePath(previousPath);
        await client.close();
      }
    },
  );

  it.each(["new", "load", "resume", "fork"] as const)(
    "keeps standard session/%s busy until its independent native catalog response",
    async (operation) => {
      const directory = await fakeOmp("model-config");
      const source = join(directory, "native-session.jsonl");
      const previousPath = process.env.PATH;
      process.env.PATH = [directory, dirname(process.execPath)].join(delimiter);
      const held = Promise.withResolvers<void>();
      let child: ChildProcess | undefined;
      const client = harness(syntheticSpawn(directory, (owned) => {
        child = owned;
        let stderr = "";
        owned.stderr?.on("data", (bytes: Buffer) => {
          stderr += bytes.toString();
          if (stderr.includes("synthetic-model-held:get_available_models")) held.resolve();
        });
        owned.stdin?.write(`${JSON.stringify({ type: "fixture_hold", command: "get_available_models" })}\n`);
      }));
      const request = { cwd: directory, sessionId: source, mcpServers: [] };
      const pending = client.request<acp.NewSessionResponse | acp.LoadSessionResponse>(`session/${operation}`, request);
      let finished = false;
      const outcome = pending.then(
        (value) => { finished = true; return { ok: true as const, value }; },
        (error: unknown) => { finished = true; return { ok: false as const, error }; },
      );
      try {
        await withTimeout(Promise.race([
          held.promise,
          outcome.then(() => { throw new Error("ACP preparation completed before the native catalog response"); }),
        ]), "015 catalog admission gate", RPC_TIMEOUT_MS);
        expect(finished).toBe(false);
        for (const competing of ["new", "load", "resume", "fork"]) {
          await expect(client.request(`session/${competing}`, request)).rejects.toThrow();
        }
        await expect(client.request("session/prompt", {
          sessionId: source, prompt: [{ type: "text", text: "catalog is not prepared" }],
        })).rejects.toThrow();
        await expect(client.request("session/set_config_option", {
          sessionId: source, configId: "model", value: "other/family/x",
        })).rejects.toThrow();
        child?.stdin?.write(`${JSON.stringify({ type: "fixture_release" })}\n`);
        const result = await withTimeout(pending, "015 complete session preparation", RPC_TIMEOUT_MS);
        expect(result.configOptions).toEqual([{
          id: "model", name: expect.any(String), category: "model", type: "select",
          currentValue: operation === "fork" ? "fixture/fork-model" : "fixture/model",
          options: modelCatalog.map((model) => ({ value: `${model.provider}/${model.id}`, name: model.name })),
        }]);
        if ("sessionId" in result) expect(result.sessionId).toBe(operation === "fork"
          ? join(directory, "native fork 精确.jsonl") : source);
      } finally {
        child?.stdin?.write(`${JSON.stringify({ type: "fixture_release" })}\n`);
        restorePath(previousPath);
        await client.close();
      }
    },
  );
});

describe("OMP ACP server lifecycle", () => {
  it("launches OMP with only the supported RPC arguments", async () => {
    const directory = await fakeOmp("serve");
    const previousPath = process.env.PATH;
    process.env.PATH = [directory, previousPath ?? ""].join(delimiter);
    const client = harness(process.platform === "win32" ? syntheticSpawn(directory) : undefined);
    try {
      const initialized = await client.request("initialize", {
        protocolVersion: 1,
        clientCapabilities: {},
      });
      // Exact match: an optional capability (load, resume, MCP, images, context) must not appear unreviewed.
      expect(initialized).toEqual({
        protocolVersion: 1,
        agentInfo: { name: "omp-rpc", version: packageJson.version },
        agentCapabilities: { promptCapabilities: { image: false, embeddedContext: false } },
        authMethods: [],
      });
      const session = await withTimeout(
        client.request<{ sessionId: string }>("session/new", { cwd: directory, mcpServers: [] }),
        "session/new",
        RPC_TIMEOUT_MS
      );
      expect(session.sessionId).toBe("/tmp/fake-omp-session.jsonl");
    } finally {
      restorePath(previousPath);
      await client.close();
    }
  });

  it.for(["new", "load", "resume"] as const)("accepts non-empty lody stdio MCP for session/%s without forwarding it", async (operation) => {
    const directory = await fakeOmp("mcp-session");
    const nativeSession = join(directory, "native-session.jsonl");
    const previousPath = process.env.PATH;
    process.env.PATH = [directory, dirname(process.execPath)].join(delimiter);
    const client = harness(process.platform === "win32" ? syntheticSpawn(directory) : undefined);
    try {
      await client.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
      const result = await withTimeout(
        client.request<{ sessionId?: string }>(`session/${operation}`, {
          cwd: directory,
          ...(operation === "new" ? {} : { sessionId: nativeSession }),
          mcpServers: [{
            name: "lody",
            command: "synthetic-lody-mcp",
            args: ["--stdio"],
            env: [{ name: "SYNTHETIC_MCP_TOKEN", value: "not-a-real-secret" }],
          }],
        }),
        `session/${operation}`,
        RPC_TIMEOUT_MS,
      );
      if (operation !== "load") expect(result.sessionId).toBe(nativeSession);
      await expect(withTimeout(
        client.request("session/prompt", {
          sessionId: nativeSession,
          prompt: [{ type: "text", text: "synthetic MCP session" }],
        }),
        "session/prompt",
        RPC_TIMEOUT_MS,
      )).resolves.toEqual({ stopReason: "end_turn" });
      const commands = (await readFile(join(directory, "rpc-commands.jsonl"), "utf8"))
        .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(commands.map(({ id, ...command }) => command)).toEqual([
        operation === "new" ? { type: "new_session" } : { type: "switch_session", sessionPath: nativeSession },
        { type: "get_state" },
        { type: "get_available_models" },
        { type: "get_state" },
        { type: "prompt", message: "synthetic MCP session" },
      ]);
    } finally {
      restorePath(previousPath);
      await client.close();
    }
  });

  it.each(["cold", "warm"] as const)("forks the exact source on a %s ACP connection and only prompts the new identity", async (temperature) => {
    const directory = await fakeOmp("fork-session");
    const source = join(directory, "source-session.jsonl");
    const fork = join(directory, "native fork 精确.jsonl");
    const original = await readFile(source, "utf8");
    const notifications: unknown[] = [];
    const previousPath = process.env.PATH;
    process.env.PATH = [directory, dirname(process.execPath)].join(delimiter);
    const client = harness(syntheticSpawn(directory), undefined, (message) => {
      if (message.method === "session/update") notifications.push(message.params);
    });
    try {
      await client.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
      const previous = temperature === "warm"
        ? await client.request<acp.NewSessionResponse>("session/new", { cwd: directory, mcpServers: [] }) : undefined;
      const request: acp.ForkSessionRequest = {
        cwd: directory, sessionId: source, additionalDirectories: [],
        mcpServers: [{ name: "lody", command: "synthetic-lody-mcp", args: ["--stdio"], env: [] }],
        _meta: { lody: { turnId: "ordinary-current-turn-correlation" } },
      };
      const result = await withTimeout(client.request<acp.ForkSessionResponse>("session/fork", request), "session/fork", RPC_TIMEOUT_MS);
      expect(result.sessionId).toBe(fork);
      expect(result.configOptions).toContainEqual(expect.objectContaining({
        id: "model", category: "model", currentValue: "fixture/fork-model",
      }));
      for (const obsolete of [source, ...(previous ? [previous.sessionId] : [])]) {
        await expect(client.request("session/prompt", {
          sessionId: obsolete, prompt: [{ type: "text", text: "obsolete identity" }],
        })).rejects.toThrow();
      }
      await expect(withTimeout(client.request("session/prompt", {
        sessionId: result.sessionId, prompt: [{ type: "text", text: "continue fork" }],
      }), "fork prompt", RPC_TIMEOUT_MS)).resolves.toEqual({ stopReason: "end_turn" });
      expect(notifications).toContainEqual({
        sessionId: fork,
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "synthetic fork reply" } },
      });
      expect(await readFile(source, "utf8")).toBe(original);
      expect(await readFile(fork, "utf8")).toContain("synthetic-prompt-write");
      const commands = (await readFile(join(directory, "rpc-commands.jsonl"), "utf8"))
        .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
      const opened = commands.findIndex((command) => command.type === "switch_session");
      const forked = commands.findIndex((command) => command.type === "fork");
      expect(commands[opened]).toEqual({ id: expect.any(String), type: "switch_session", sessionPath: source });
      expect(commands[forked]).toEqual({ id: expect.any(String), type: "fork" });
      expect(commands.slice(opened + 1, forked)).toContainEqual({ id: expect.any(String), type: "get_state" });
      const prompted = commands.findIndex((command) => command.type === "prompt");
      expect(commands.slice(forked + 1, prompted)).toContainEqual({ id: expect.any(String), type: "get_state" });
      for (const command of commands.filter((value) => value.type === "prompt")) {
        expect(command).toEqual({ id: expect.any(String), type: "prompt", message: "continue fork" });
      }
      for (const command of commands) expect(command).not.toHaveProperty("mcpServers");
    } finally {
      restorePath(previousPath);
      await client.close();
    }
  });

  it.each([
    "source-missing", "source-empty", "wrong-source", "cancelled", "busy", "invalid-fork",
    "same-file", "missing-file", "empty-file", "missing-identity", "empty-identity", "state-failure",
    "streaming", "compacting", "pending-async", "queued",
  ] satisfies ForkCase[])("rejects session/fork %s without reporting a new session", async (failure) => {
    const directory = await fakeOmp("fork-session", failure);
    const source = join(directory, "source-session.jsonl");
    const sourceBytes = failure === "source-missing" ? undefined : await readFile(source, "utf8");
    const previousPath = process.env.PATH;
    process.env.PATH = [directory, dirname(process.execPath)].join(delimiter);
    const released = Promise.withResolvers<void>();
    let child: ChildProcess | undefined;
    const client = harness(syntheticSpawn(directory, (owned) => {
      child = owned;
      let stderr = "";
      owned.stderr?.on("data", (bytes: Buffer) => {
        stderr += bytes.toString();
        if (stderr.includes("synthetic-fixture-released")) released.resolve();
      });
    }));
    try {
      await client.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
      const previous = await client.request<acp.NewSessionResponse>("session/new", { cwd: directory, mcpServers: [] });
      const outcome = await withTimeout(client.request("session/fork", {
        cwd: directory, sessionId: source, mcpServers: [],
      }).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      ), `fork ${failure}`, RPC_TIMEOUT_MS);
      expect(outcome.ok).toBe(false);
      const commands = (await readFile(join(directory, "rpc-commands.jsonl"), "utf8"))
        .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
      if (["source-missing", "source-empty", "wrong-source", "streaming", "compacting", "pending-async", "queued"].includes(failure)) {
        expect(commands.filter((command) => command.type === "fork")).toEqual([]);
      } else {
        expect(commands).toContainEqual({ id: expect.any(String), type: "fork" });
      }
      if (sourceBytes === undefined) await expect(readFile(source)).rejects.toThrow();
      else expect(await readFile(source, "utf8")).toBe(sourceBytes);
      if (!["source-missing", "source-empty"].includes(failure)) {
        for (const identity of [previous.sessionId, source, join(directory, "native fork 精确.jsonl")]) {
          await expect(client.request("session/prompt", {
            sessionId: identity, prompt: [{ type: "text", text: "unverified fork must not prompt" }],
          })).rejects.toThrow();
        }
        child?.stdin?.write(`${JSON.stringify({ type: "fixture_release" })}\n`);
        await withTimeout(released.promise, "native fixture release", RPC_TIMEOUT_MS);
        await withTimeout(
          client.request("session/resume", { cwd: directory, sessionId: source, mcpServers: [] }),
          "prepare after failed fork", RPC_TIMEOUT_MS,
        );
        await expect(withTimeout(client.request("session/prompt", {
          sessionId: source, prompt: [{ type: "text", text: "after verified recovery" }],
        }), "prompt after failed fork recovery", RPC_TIMEOUT_MS)).resolves.toEqual({ stopReason: "end_turn" });
      }
    } finally {
      restorePath(previousPath);
      await client.close();
    }
  });

  it.each([
    { label: "forkAtTurn", extra: { _meta: { lody: { forkAtTurn: { version: 1, turnId: "synthetic-history-turn" } } } } },
    { label: "additional roots", extra: { additionalDirectories: ["/synthetic/extra-root"] } },
  ])("rejects unsupported fork $label instead of silently doing a full fork", async ({ extra }) => {
    const directory = await fakeOmp("fork-session");
    const previousPath = process.env.PATH;
    process.env.PATH = [directory, dirname(process.execPath)].join(delimiter);
    const client = harness(syntheticSpawn(directory));
    try {
      const current = await client.request<acp.NewSessionResponse>("session/new", { cwd: directory, mcpServers: [] });
      await expect(client.request("session/fork", {
        cwd: directory, sessionId: join(directory, "source-session.jsonl"), mcpServers: [], ...extra,
      })).rejects.toThrow();
      await expect(withTimeout(client.request("session/prompt", {
        sessionId: current.sessionId, prompt: [{ type: "text", text: "still current" }],
      }), "prompt after unsupported fork", RPC_TIMEOUT_MS)).resolves.toEqual({ stopReason: "end_turn" });
      const commands = (await readFile(join(directory, "rpc-commands.jsonl"), "utf8"))
        .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(commands.filter((command) => command.type === "fork" || command.type === "switch_session")).toEqual([]);
    } finally {
      restorePath(previousPath);
      await client.close();
    }
  });

  it("rejects a warm fork for a different cwd without changing the current session", async () => {
    const directory = await fakeOmp("fork-session");
    const previousPath = process.env.PATH;
    process.env.PATH = [directory, dirname(process.execPath)].join(delimiter);
    const client = harness(syntheticSpawn(directory));
    try {
      const current = await client.request<acp.NewSessionResponse>("session/new", { cwd: directory, mcpServers: [] });
      await expect(client.request("session/fork", {
        cwd: tmpdir(), sessionId: join(directory, "source-session.jsonl"), mcpServers: [],
      })).rejects.toThrow();
      await expect(withTimeout(client.request("session/prompt", {
        sessionId: current.sessionId, prompt: [{ type: "text", text: "same cwd" }],
      }), "prompt after cwd rejection", RPC_TIMEOUT_MS)).resolves.toEqual({ stopReason: "end_turn" });
      const commands = (await readFile(join(directory, "rpc-commands.jsonl"), "utf8"))
        .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(commands.filter((command) => command.type === "fork" || command.type === "switch_session")).toEqual([]);
    } finally {
      restorePath(previousPath);
      await client.close();
    }
  });

  it.each(["hold-prompt", "hold-switch"] as const)("keeps fork mutually exclusive with %s work", async (mode) => {
    const directory = await fakeOmp("fork-session", mode);
    const previousPath = process.env.PATH;
    process.env.PATH = [directory, dirname(process.execPath)].join(delimiter);
    const held = Promise.withResolvers<void>();
    let child: ChildProcess | undefined;
    const client = harness(syntheticSpawn(directory, (owned) => {
      child = owned;
      let stderr = "";
      owned.stderr?.on("data", (bytes: Buffer) => {
        stderr += bytes.toString();
        if (stderr.includes(mode === "hold-prompt" ? "synthetic-prompt-held" : "synthetic-switch-held")) held.resolve();
      });
    }));
    try {
      const current = await client.request<acp.NewSessionResponse>("session/new", { cwd: directory, mcpServers: [] });
      const request = { cwd: directory, sessionId: join(directory, "source-session.jsonl"), mcpServers: [] };
      const inFlight = mode === "hold-prompt"
        ? client.request("session/prompt", { sessionId: current.sessionId, prompt: [{ type: "text", text: "held" }] })
        : client.request("session/resume", request);
      // Attach immediately: an assertion failure must not leave an unhandled shutdown rejection.
      const settled = inFlight.then((value) => ({ value }), (error: unknown) => ({ error }));
      await withTimeout(held.promise, mode, RPC_TIMEOUT_MS);
      await expect(client.request("session/fork", request)).rejects.toThrow();
      child?.stdin?.write(`${JSON.stringify({ type: "fixture_release" })}\n`);
      expect(await withTimeout(settled, "release held work", RPC_TIMEOUT_MS)).not.toHaveProperty("error");
      const commands = (await readFile(join(directory, "rpc-commands.jsonl"), "utf8"))
        .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(commands.filter((command) => command.type === "fork")).toEqual([]);
    } finally {
      restorePath(previousPath);
      await client.close();
    }
  });

  it("blocks prompts and competing session changes until fork preparation completes", async () => {
    const directory = await fakeOmp("fork-session", "hold-switch");
    const previousPath = process.env.PATH;
    process.env.PATH = [directory, dirname(process.execPath)].join(delimiter);
    const held = Promise.withResolvers<void>();
    let child: ChildProcess | undefined;
    const client = harness(syntheticSpawn(directory, (owned) => {
      child = owned;
      let stderr = "";
      owned.stderr?.on("data", (bytes: Buffer) => {
        stderr += bytes.toString();
        if (stderr.includes("synthetic-switch-held")) held.resolve();
      });
    }));
    try {
      const current = await client.request<acp.NewSessionResponse>("session/new", { cwd: directory, mcpServers: [] });
      const request = { cwd: directory, sessionId: join(directory, "source-session.jsonl"), mcpServers: [] };
      const pending = client.request<acp.ForkSessionResponse>("session/fork", request);
      const settled = pending.then((value) => ({ value }), (error: unknown) => ({ error }));
      await withTimeout(Promise.race([
        held.promise,
        settled.then((result) => {
          if ("error" in result) throw result.error;
          throw new Error("Fork completed before exact source preparation");
        }),
      ]), "fork source preparation", RPC_TIMEOUT_MS);
      for (const method of ["session/new", "session/resume", "session/fork"]) {
        await expect(client.request(method, request)).rejects.toThrow();
      }
      await expect(client.request("session/prompt", {
        sessionId: current.sessionId, prompt: [{ type: "text", text: "cannot race fork" }],
      })).rejects.toThrow();
      child?.stdin?.write(`${JSON.stringify({ type: "fixture_release" })}\n`);
      expect(await withTimeout(settled, "prepared fork", RPC_TIMEOUT_MS)).toMatchObject({
        value: { sessionId: join(directory, "native fork 精确.jsonl") },
      });
    } finally {
      restorePath(previousPath);
      await client.close();
    }
  });

  it("routes image-only ACP prompts without advertising image support or fetching uri", async () => {
    const directory = await fakeOmp("mcp-session");
    const previousPath = process.env.PATH;
    process.env.PATH = [directory, dirname(process.execPath)].join(delimiter);
    const client = harness(syntheticSpawn(directory));
    try {
      const current = await client.request<acp.NewSessionResponse>("session/new", { cwd: directory, mcpServers: [] });
      await expect(withTimeout(client.request("session/prompt", {
        sessionId: current.sessionId,
        prompt: [{ type: "image", data: "AAECA/8=", mimeType: "image/x-synthetic", uri: "file:///not-a-real-image" }],
      }), "image-only ACP prompt", RPC_TIMEOUT_MS)).resolves.toEqual({ stopReason: "end_turn" });
      const commands = (await readFile(join(directory, "rpc-commands.jsonl"), "utf8"))
        .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(commands.find((command) => command.type === "prompt")).toEqual({
        id: expect.any(String), type: "prompt", message: "",
        images: [{ type: "image", data: "AAECA/8=", mimeType: "image/x-synthetic" }],
      });
    } finally {
      restorePath(previousPath);
      await client.close();
    }
  });

  it.for(["exit", "eof", "malformed", "missing"] as const)("closes the actual ACP connection after OMP %s", async (mode, { skip }) => {
    // A live Node process cannot EOF its stdout on Windows: libuv duplicates the stdio pipe handle and never closes fds 0-2.
    if (mode === "eof" && process.platform === "win32") skip();
    const directory = await fakeOmp(mode);
    const previousPath = process.env.PATH;
    const previousExitCode = process.exitCode;
    // Keep "missing" free of any directory that could hold a real omp.
    process.env.PATH = mode === "missing" ? directory : [directory, dirname(process.execPath)].join(delimiter);
    const client = harness(mode === "missing" || process.platform !== "win32" ? undefined : syntheticSpawn(directory));
    try {
      await client.request<{ agentInfo: { name: string } }>("initialize", {
        protocolVersion: 1,
        clientCapabilities: {},
      });
      void client
        .request("session/new", { cwd: directory, mcpServers: [] })
        .catch(() => undefined);
      await withTimeout(client.closed, "ACP connection.closed", RPC_TIMEOUT_MS);
      expect(client.isClosed()).toBe(true);
      expect(process.exitCode).toBe(1);
    } finally {
      restorePath(previousPath);
      process.exitCode = previousExitCode;
      await client.close();
    }
  });
  it.each(["text-reject", "usage-reject", "output-closed"] as const)(
    "closes ACP and reaps OMP after SDK notification %s without a terminal",
    async (mode) => {
      const directory = await fakeOmp("notify");
      const previousPath = process.env.PATH;
      const previousExitCode = process.exitCode;
      process.env.PATH = [directory, dirname(process.execPath)].join(delimiter);
      let child: ChildProcess | undefined;
      const exited = Promise.withResolvers<void>();
      const responses: { id?: number; method?: string; result?: unknown }[] = [];
      const client = harness(
        syntheticSpawn(directory, (owned) => {
          child = owned;
          owned.once("exit", () => exited.resolve());
        }),
        undefined,
        (message, controller) => {
          responses.push(message);
          const text = message.method === "session/update";
          const usage = message.method === "_lody/session/usage_update";
          if (mode === "output-closed" && text) controller.error(new Error("synthetic-private-output-closed"));
          if ((mode === "text-reject" && text) || (mode === "usage-reject" && usage)) {
            throw new Error("synthetic-private-writable-rejection");
          }
        },
      );
      try {
        const session = await withTimeout(
          client.request<{ sessionId: string }>("session/new", { cwd: directory, mcpServers: [] }),
          "session/new",
          RPC_TIMEOUT_MS,
        );
        void client.request("session/prompt", {
          sessionId: session.sessionId,
          prompt: [{ type: "text", text: "synthetic" }],
        }).catch(() => undefined);
        await withTimeout(client.closed, "ACP closure after notification failure", RPC_TIMEOUT_MS);
        await withTimeout(exited.promise, "OMP exit after notification failure", FORCED_CLOSE_TIMEOUT_MS);
        expect(client.isClosed()).toBe(true);
        const failedMethod = mode === "usage-reject" ? "_lody/session/usage_update" : "session/update";
        expect(responses.some((message) => message.method === failedMethod)).toBe(true);
        expect(responses.some((message) => message.id === 2 && message.result !== undefined)).toBe(false);
        expect(child?.pid).toBeDefined();
        expect(processExists(child!.pid!)).toBe(false);
      } finally {
        restorePath(previousPath);
        try {
          await client.close();
        } finally {
          process.exitCode = previousExitCode;
        }
      }
    },
    3 * FORCED_CLOSE_TIMEOUT_MS,
  );

  it("closes ACP and reaps the OMP child when abort is rejected during a prompt", async () => {
    const directory = await fakeOmp("abort-rejected");
    const previousPath = process.env.PATH;
    const previousExitCode = process.exitCode;
    let ownedChild: ChildProcess | undefined;
    const failures: Error[] = [];
    process.env.PATH = [directory, dirname(process.execPath)].join(delimiter);
    const client = harness(syntheticSpawn(directory, (child) => { ownedChild = child; }), (error) => { failures.push(error); });
    try {
      await client.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
      const session = await withTimeout(
        client.request<{ sessionId: string }>("session/new", { cwd: directory, mcpServers: [] }),
        "session/new", RPC_TIMEOUT_MS,
      );
      void client.request("session/prompt", {
        sessionId: session.sessionId, prompt: [{ type: "text", text: "keep running" }],
      }).catch(() => undefined);
      client.notify("session/cancel", { sessionId: session.sessionId });
      await withTimeout(client.closed, "ACP close after abort rejection", RPC_TIMEOUT_MS);
      expect(client.isClosed()).toBe(true);
      expect(failures).toHaveLength(1);
      expect(process.exitCode).toBe(1);
      await withTimeout(client.serverClose(), "OMP cleanup after abort rejection", FORCED_CLOSE_TIMEOUT_MS);
      const pid = Number(await readFile(join(directory, "child.pid"), "utf8"));
      expect(pid).toBe(ownedChild?.pid);
      expect(processExists(pid)).toBe(false);
    } finally {
      restorePath(previousPath);
      process.exitCode = previousExitCode;
      await client.close();
    }
  }, FORCED_CLOSE_TIMEOUT_MS);
  // Real child-process exit and the production grace period require the OS clock; fake timers cannot terminate this process.
  it("force-terminates an OMP child that ignores stdin EOF", async () => {
    const previousExitCode = process.exitCode;
    const directory = await fakeOmp("ignore-eof");
    const previousPath = process.env.PATH;
    let fixturePid: number | undefined;
    let ownedChild: ChildProcess | undefined;
    const spawnProcess = syntheticSpawn(directory, (child) => { ownedChild = child; });
    process.env.PATH = [directory, dirname(process.execPath), previousPath ?? ""].join(delimiter);
    const client = harness(spawnProcess);
    try {
      await client.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
      await withTimeout(
        client.request("session/new", { cwd: directory, mcpServers: [] }),
        "session/new",
        RPC_TIMEOUT_MS
      );
      fixturePid = Number(await readFile(join(directory, "child.pid"), "utf8"));
      expect(fixturePid).toBeGreaterThan(0);
      const child = ownedChild;
      if (!child) throw new Error("serve did not spawn its OMP child");
      expect(fixturePid).toBe(child.pid);
      await withTimeout(client.close(), "ACP server close", FORCED_CLOSE_TIMEOUT_MS);
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
      expect(processExists(fixturePid)).toBe(false);
    } finally {
      restorePath(previousPath);
      try {
        await client.close();
      } finally {
        try {
          if (ownedChild && ownedChild.exitCode === null && ownedChild.signalCode === null) {
            const exited = Promise.withResolvers<void>();
            ownedChild.once("exit", () => exited.resolve());
            ownedChild.kill("SIGKILL");
            await withTimeout(exited.promise, "synthetic OMP cleanup", RPC_TIMEOUT_MS);
          } else if (fixturePid !== undefined && processExists(fixturePid)) {
            process.kill(fixturePid, "SIGKILL");
          }
        } finally {
          process.exitCode = previousExitCode;
        }
      }
    }
  }, 3 * FORCED_CLOSE_TIMEOUT_MS);
  it.each(["false", "async-error"] as const)("handles forced-kill failure races (%s)", async (failureMode) => {
    const previousExitCode = process.exitCode;

    async function runScenario(exitAfterForce: boolean): Promise<void> {
      const killCalls: NodeJS.Signals[] = [];
      const child = Object.assign(new EventEmitter(), {
        pid: process.platform === "win32" ? 123_456_789 : Number.MAX_SAFE_INTEGER,
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        exitCode: null as number | null,
        signalCode: null as NodeJS.Signals | null,
        unref: vi.fn(),
        kill(signal: NodeJS.Signals) {
          killCalls.push(signal);
          if (signal === "SIGKILL") {
            if (failureMode === "false") {
              if (exitAfterForce) queueMicrotask(exitChild);
              return false;
            }
            queueMicrotask(() => {
              child.emit("error", new Error("synthetic child kill failure"));
              if (exitAfterForce) exitChild();
            });
            return true;
          }
          return false;
        },
      });

      function exitChild(): void {
        child.exitCode = 0;
        child.emit("exit", 0, null);
      }

      answerRpc(child.stdin, child.stdout);

      const killSpy = process.platform === "win32"
        ? undefined
        : vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: NodeJS.Signals | number) => {
            if (signal === "SIGTERM") return true;
            // The double's process group lives exactly as long as the double itself.
            if (signal === 0) {
              if (child.exitCode !== null) throw noSuchProcess();
              return true;
            }
            if (signal === "SIGKILL") {
              if (failureMode === "false") {
                if (exitAfterForce) queueMicrotask(exitChild);
                throw noSuchProcess();
              }
              queueMicrotask(() => {
                child.emit("error", new Error("synthetic child kill failure"));
                if (exitAfterForce) exitChild();
              });
              return true;
            }
            return true;
          }) as typeof process.kill);
      const failures: Error[] = [];
      const client = harness(
        // A structural double: serve only touches pid, stdio, exit state, kill, unref and events.
        () => child as unknown as ChildProcess,
        (error) => failures.push(error)
      );
      try {
        await client.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
        await client.request("session/new", { cwd: tmpdir(), mcpServers: [] });
        // writeSync(2) is synchronous, so the signal path cannot lose this line on an async pipe.
        fsControl.failFd2 = true;
        fsControl.writes.length = 0;
        try {
          if (exitAfterForce) {
            await withTimeout(client.close(), "ACP server close", FORCED_CLOSE_TIMEOUT_MS);
          } else {
            await expect(withTimeout(client.close(), "ACP server close", FORCED_CLOSE_TIMEOUT_MS)).rejects.toThrow(/terminat|kill/i);
          }
        } finally {
          fsControl.failFd2 = false;
        }
        if (exitAfterForce) {
          expect(child.exitCode).toBe(0);
          expect(process.exitCode).toBe(previousExitCode);
          expect(failures).toEqual([]);
          // Stdio is released on every path now; unref and the diagnostic mark only the failure branch.
          expect(child.unref).not.toHaveBeenCalled();
          expect(fsControl.writes).toEqual([]);
        } else {
          expect(process.exitCode).toBe(1);
          expect(failures).toHaveLength(1);
          expect(failures[0]?.message).toMatch(/terminat|kill/i);
          // The adapter must not stay alive on a child it could not terminate.
          expect(child.unref).toHaveBeenCalledOnce();
          expect([child.stdin.destroyed, child.stdout.destroyed, child.stderr.destroyed]).toEqual([true, true, true]);
          expect(fsControl.writes.join("")).toMatch(/did not exit after force termination/);
        }
        if (process.platform === "win32") expect(killCalls).toEqual(["SIGKILL"]);
      } finally {
        killSpy?.mockRestore();
        child.stdout.destroy();
        child.stdin.destroy();
        child.stderr.destroy();
        process.exitCode = previousExitCode;
      }
    }

    await runScenario(false);
    await runScenario(true);
  }, 3 * FORCED_CLOSE_TIMEOUT_MS);
  it("delivers OMP's last stderr output written after its exit", async () => {
    const previousExitCode = process.exitCode;
    // Exits on the close request, then flushes a final diagnostic before its pipes end, as a real OMP may.
    const child = Object.assign(new EventEmitter(), {
      pid: process.platform === "win32" ? 123_456_789 : Number.MAX_SAFE_INTEGER,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      unref: vi.fn(),
      kill: vi.fn(() => true),
    });
    answerRpc(child.stdin, child.stdout);
    child.stdin.on("finish", () => {
      child.exitCode = 0;
      child.emit("exit", 0, null);
      setTimeout(() => {
        child.stderr.end("omp: final diagnostic\n");
        child.stdout.end();
      }, 300);
    });
    const killSpy = process.platform === "win32"
      ? undefined
      : vi.spyOn(process, "kill").mockImplementation(((_pid: number, signal?: NodeJS.Signals | number) => {
          if (signal === 0 && child.exitCode !== null) throw noSuchProcess();
          return true;
        }) as typeof process.kill);
    const forwarded: string[] = [];
    const client = harness(() => child as unknown as ChildProcess);
    try {
      await client.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
      await client.request("session/new", { cwd: tmpdir(), mcpServers: [] });
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
        forwarded.push(String(chunk));
        return true;
      }) as typeof process.stderr.write);
      try {
        await withTimeout(client.close(), "ACP server close", FORCED_CLOSE_TIMEOUT_MS);
      } finally {
        stderrSpy.mockRestore();
      }
      expect(forwarded.join("")).toContain("omp: final diagnostic");
    } finally {
      killSpy?.mockRestore();
      child.stdout.destroy();
      child.stdin.destroy();
      child.stderr.destroy();
      process.exitCode = previousExitCode;
    }
  }, 3 * FORCED_CLOSE_TIMEOUT_MS);
  it("delivers OMP's last stderr output written after force-kill", async () => {
    const previousExitCode = process.exitCode;
    let groupAlive = true;
    const child = Object.assign(new EventEmitter(), {
      pid: process.platform === "win32" ? 123_456_789 : Number.MAX_SAFE_INTEGER,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      unref: vi.fn(),
      kill: vi.fn((signal: NodeJS.Signals) => {
        if (signal === "SIGKILL") onForceKill();
        return true;
      }),
    });
    // Destroy can race the late write on the unfixed deadline; don't surface that as an unhandled error.
    child.stdout.on("error", () => undefined);
    child.stderr.on("error", () => undefined);
    answerRpc(child.stdin, child.stdout);

    const realNow = performance.now.bind(performance);
    let skew = 0;
    // SIGKILL confirmation can land after the absolute drain deadline (grace start + two grace
    // periods). Jumping the monotonic clock there reproduces that without racing the 1s boundaries.
    let lateDiagnostic: NodeJS.Timeout | undefined;
    function onForceKill(): void {
      skew = 5_000;
      groupAlive = false;
      child.signalCode = "SIGKILL";
      child.emit("exit", null, "SIGKILL");
      lateDiagnostic = setTimeout(() => {
        child.stderr.end("omp: final diagnostic\n");
        child.stdout.end();
      }, 300);
    }

    const killSpy = process.platform === "win32"
      ? undefined
      : vi.spyOn(process, "kill").mockImplementation(((_pid: number, signal?: NodeJS.Signals | number) => {
          if (signal === "SIGTERM") return true;
          if (signal === 0) {
            if (!groupAlive) throw noSuchProcess();
            return true;
          }
          if (signal === "SIGKILL") {
            onForceKill();
            return true;
          }
          return true;
        }) as typeof process.kill);
    const forwarded: string[] = [];
    const client = harness(() => child as unknown as ChildProcess);
    try {
      await client.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
      await client.request("session/new", { cwd: tmpdir(), mcpServers: [] });
      const clock = vi.spyOn(performance, "now").mockImplementation(() => realNow() + skew);
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
        forwarded.push(String(chunk));
        return true;
      }) as typeof process.stderr.write);
      try {
        await withTimeout(client.close(), "ACP server close", FORCED_CLOSE_TIMEOUT_MS);
      } finally {
        stderrSpy.mockRestore();
        clock.mockRestore();
      }
      expect(forwarded.join("")).toContain("omp: final diagnostic");
    } finally {
      clearTimeout(lateDiagnostic);
      killSpy?.mockRestore();
      child.stdout.destroy();
      child.stdin.destroy();
      child.stderr.destroy();
      process.exitCode = previousExitCode;
    }
  }, 3 * FORCED_CLOSE_TIMEOUT_MS);
  it("releases OMP stdio when the child exits but inherited pipes stay open", async () => {
    const previousExitCode = process.exitCode;
    const signals: (NodeJS.Signals | number | undefined)[] = [];
    // Exits on the close request but never ends its pipes, as when a grandchild still holds them.
    const child = Object.assign(new EventEmitter(), {
      pid: process.platform === "win32" ? 123_456_789 : Number.MAX_SAFE_INTEGER,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      unref: vi.fn(),
      kill: vi.fn(() => true),
    });
    answerRpc(child.stdin, child.stdout);
    child.stdin.on("finish", () => {
      child.exitCode = 0;
      child.emit("exit", 0, null);
    });
    const killSpy = process.platform === "win32"
      ? undefined
      : vi.spyOn(process, "kill").mockImplementation(((_pid: number, signal?: NodeJS.Signals | number) => {
          signals.push(signal);
          if (signal === 0 && child.exitCode !== null) throw noSuchProcess();
          return true;
        }) as typeof process.kill);
    const failures: Error[] = [];
    const client = harness(() => child as unknown as ChildProcess, (error) => failures.push(error));
    try {
      await client.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
      await client.request("session/new", { cwd: tmpdir(), mcpServers: [] });
      const started = performance.now();
      const closing = client.close();
      // A wall-clock step back mid-close (NTP, VM resume) must not stretch the bounded wait.
      const realNow = Date.now.bind(Date);
      const clockSpy = vi.spyOn(Date, "now").mockImplementation(() => realNow() - 60_000);
      try {
        await withTimeout(closing, "ACP server close", FORCED_CLOSE_TIMEOUT_MS);
      } finally {
        clockSpy.mockRestore();
      }
      // Two 1s grace periods bound the release; the slack covers polling and slow runners.
      expect(performance.now() - started).toBeLessThan(STDIO_RELEASE_BOUND_MS);
      expect([child.stdout.destroyed, child.stderr.destroyed]).toEqual([true, true]);
      expect(failures).toEqual([]);
      expect(process.exitCode).toBe(previousExitCode);
      expect(child.unref).not.toHaveBeenCalled();
      expect(child.kill).not.toHaveBeenCalled();
      expect(signals).not.toContain("SIGKILL");
    } finally {
      killSpy?.mockRestore();
      child.stdout.destroy();
      child.stdin.destroy();
      child.stderr.destroy();
      process.exitCode = previousExitCode;
    }
  }, 3 * FORCED_CLOSE_TIMEOUT_MS);
  it.each(["SIGTERM", "SIGINT", "SIGHUP"] as const)("reaps OMP before re-raising %s", async (signal) => {
    const directory = await fakeOmp("serve");
    const previousPath = process.env.PATH;
    let ownedChild: ChildProcess | undefined;
    process.env.PATH = [directory, dirname(process.execPath), previousPath ?? ""].join(delimiter);
    const client = harness(syntheticSpawn(directory, (child) => { ownedChild = child; }));
    const target = Object.assign(new EventEmitter(), { pid: 4242, kill: vi.fn(() => true), exit: vi.fn() });
    try {
      closeOnSignals(client.serverClose, target);
      await client.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
      await withTimeout(client.request("session/new", { cwd: directory, mcpServers: [] }), "session/new", RPC_TIMEOUT_MS);
      const child = ownedChild;
      if (!child) throw new Error("serve did not spawn its OMP child");
      const reraised = Promise.withResolvers<void>();
      target.kill.mockImplementation(() => {
        reraised.resolve();
        return true;
      });
      target.emit(signal);
      await withTimeout(reraised.promise, "signal re-raise", RPC_TIMEOUT_MS);
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
      expect(target.kill).toHaveBeenCalledExactlyOnceWith(4242, signal);
      expect(target.listenerCount(signal)).toBe(0);
    } finally {
      restorePath(previousPath);
      await client.close();
      if (ownedChild && ownedChild.exitCode === null && ownedChild.signalCode === null) ownedChild.kill("SIGKILL");
    }
  });
  it("re-raises the signal when closing OMP fails", async () => {
    const target = Object.assign(new EventEmitter(), { pid: 4242, kill: vi.fn(() => true), exit: vi.fn() });
    const reraised = Promise.withResolvers<void>();
    target.kill.mockImplementation(() => {
      reraised.resolve();
      return true;
    });
    closeOnSignals(() => Promise.reject(new Error("OMP child process did not exit after force termination")), target);
    target.emit("SIGTERM");
    await withTimeout(reraised.promise, "signal re-raise", RPC_TIMEOUT_MS);
    expect(target.kill).toHaveBeenCalledExactlyOnceWith(4242, "SIGTERM");
  });
  it("exits with the signal status when re-raising is unsupported", async () => {
    const exited = Promise.withResolvers<void>();
    const target = Object.assign(new EventEmitter(), {
      pid: 4242,
      kill: vi.fn(() => {
        const error = new Error("function not implemented") as NodeJS.ErrnoException;
        error.code = "ENOSYS";
        throw error;
      }),
      exit: vi.fn(() => exited.resolve()),
    });
    closeOnSignals(() => Promise.resolve(), target);
    target.emit("SIGHUP");
    await withTimeout(exited.promise, "signal exit fallback", RPC_TIMEOUT_MS);
    expect(target.kill).toHaveBeenCalledExactlyOnceWith(4242, "SIGHUP");
    expect(target.exit).toHaveBeenCalledExactlyOnceWith(128 + constants.signals.SIGHUP);
  });
  it("force-kills and exits on a second shutdown signal during grace", async () => {
    const closing = Promise.withResolvers<void>();
    const forceKill = vi.fn();
    const target = Object.assign(new EventEmitter(), {
      pid: 4242,
      kill: vi.fn(() => true),
      exit: vi.fn(),
    });
    closeOnSignals(() => closing.promise, target, forceKill);
    target.emit("SIGTERM");
    for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) expect(target.listenerCount(signal)).toBe(1);
    expect(forceKill).not.toHaveBeenCalled();
    expect(target.kill).not.toHaveBeenCalled();

    target.emit("SIGINT");
    expect(forceKill).toHaveBeenCalledOnce();
    expect(target.kill).toHaveBeenCalledExactlyOnceWith(4242, "SIGINT");
    for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) expect(target.listenerCount(signal)).toBe(0);

    closing.resolve();
    await closing.promise;
    await Promise.resolve();
    // close() finishing must not re-raise the first signal on top of the second.
    expect(target.kill).toHaveBeenCalledExactlyOnceWith(4242, "SIGINT");
    expect(target.exit).not.toHaveBeenCalled();
  });
  it("exits by the second signal when re-raising it is unsupported", async () => {
    const closing = Promise.withResolvers<void>();
    const forceKill = vi.fn();
    const target = Object.assign(new EventEmitter(), {
      pid: 4242,
      kill: vi.fn(() => {
        const error = new Error("function not implemented") as NodeJS.ErrnoException;
        error.code = "ENOSYS";
        throw error;
      }),
      exit: vi.fn(),
    });
    closeOnSignals(() => closing.promise, target, forceKill);
    target.emit("SIGTERM");
    target.emit("SIGINT");
    expect(forceKill).toHaveBeenCalledOnce();
    expect(target.kill).toHaveBeenCalledExactlyOnceWith(4242, "SIGINT");
    expect(target.exit).toHaveBeenCalledExactlyOnceWith(128 + constants.signals.SIGINT);
    closing.resolve();
    await closing.promise;
    await Promise.resolve();
    expect(target.kill).toHaveBeenCalledOnce();
    expect(target.exit).toHaveBeenCalledOnce();
  });
});

describe("015 explicit title ACP consumer", () => {
  it("publishes only a verified explicit title from a literal rename prompt", async () => {
    const updates: acp.SessionNotification[] = [];
    const usage: unknown[] = [];
    const fixture = await closeCauseFixture("title-control", (message) => {
      if (message.method === "session/update") updates.push(message.params as acp.SessionNotification);
      if (message.method === "_lody/session/usage_update") usage.push(message.params);
    });
    let cleanup: PromiseSettledResult<void>[] = [];
    try {
      const initialized = await fixture.client.request<acp.InitializeResponse>("initialize", {
        protocolVersion: 1, clientCapabilities: {},
      });
      expect(initialized.agentCapabilities).toEqual({
        promptCapabilities: { image: false, embeddedContext: false },
      });
      const session = await fixture.client.request<acp.NewSessionResponse>("session/new", {
        cwd: fixture.directory, mcpServers: [],
      });
      expect(session.sessionId).toBe(join(fixture.directory, "native-session.jsonl"));
      await expect(fixture.client.request("session/prompt", {
        sessionId: session.sessionId, prompt: [{ type: "text", text: "/rename  用户 标题 / A  " }],
      })).resolves.toEqual({ stopReason: "end_turn" });
      expect(updates.filter((notification) => notification.update.sessionUpdate === "session_info_update")).toEqual([{
        sessionId: session.sessionId,
        update: {
          sessionUpdate: "session_info_update", title: "用户 标题 / A",
          _meta: { lody: { titleSource: "explicit" } },
        },
      }]);
      expect(updates.filter((notification) => notification.update.sessionUpdate === "agent_message_chunk")).toEqual([]);
      expect(usage).toEqual([]);
      const commands = (await readFile(join(fixture.directory, "rpc-commands.jsonl"), "utf8"))
        .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(commands.filter((command) => command.type === "set_session_name").map(({ id, ...command }) => command)).toEqual([
        { type: "set_session_name", name: "用户 标题 / A" },
      ]);
      expect(commands.filter((command) => command.type === "prompt")).toEqual([]);
      const renamed = commands.findIndex((command) => command.type === "set_session_name");
      expect(commands.slice(renamed).map((command) => command.type)).toEqual([
        "set_session_name", "get_session_stats", "get_state",
      ]);
      const journal = (await readFile(session.sessionId, "utf8")).trim().split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(journal).toContainEqual({ type: "synthetic-title-write", title: "用户 标题 / A" });
    } finally {
      cleanup = await fixture.cleanup();
    }
    expect(cleanup[0]?.status).toBe("fulfilled");
  });

  it.each([
    { label: "same already stored user name", raw: "Previous user title", expected: "Previous user title" },
    {
      label: "C0 C1 and repeated ASCII spaces",
      raw: `Alpha  Beta${String.fromCharCode(10)}Gamma${String.fromCharCode(0, 128)} Delta`,
      expected: "Alpha Beta Gamma Delta",
    },
  ])("uses the native persisted readback for $label", async ({ raw, expected }) => {
    const updates: acp.SessionNotification[] = [];
    const fixture = await closeCauseFixture("title-control", (message) => {
      if (message.method === "session/update") updates.push(message.params as acp.SessionNotification);
    });
    let cleanup: PromiseSettledResult<void>[] = [];
    try {
      const session = await fixture.client.request<acp.NewSessionResponse>("session/new", {
        cwd: fixture.directory, mcpServers: [],
      });
      await expect(fixture.client.request("session/prompt", {
        sessionId: session.sessionId, prompt: [{ type: "text", text: `/rename   ${raw}   ` }],
      })).resolves.toEqual({ stopReason: "end_turn" });
      expect(updates).toEqual([{
        sessionId: session.sessionId,
        update: {
          sessionUpdate: "session_info_update", title: expected,
          _meta: { lody: { titleSource: "explicit" } },
        },
      }]);
      const commands = (await readFile(join(fixture.directory, "rpc-commands.jsonl"), "utf8"))
        .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(commands.filter((command) => command.type === "set_session_name").map((command) => command.name)).toEqual([raw]);
      expect(commands.filter((command) => command.type === "prompt")).toEqual([]);
      expect((await readFile(session.sessionId, "utf8")).split("\n").filter(Boolean)
        .map((line) => JSON.parse(line))).toContainEqual({ type: "synthetic-title-write", title: expected });
    } finally {
      cleanup = await fixture.cleanup();
    }
    expect(cleanup[0]?.status).toBe("fulfilled");
  });

  it.each(["/rename", "/rename   "])("keeps generated %s on the native prompt route without explicit ownership", async (text) => {
    const updates: acp.SessionNotification[] = [];
    const fixture = await closeCauseFixture("title-control", (message) => {
      if (message.method === "session/update") updates.push(message.params as acp.SessionNotification);
    });
    let cleanup: PromiseSettledResult<void>[] = [];
    try {
      const session = await fixture.client.request<acp.NewSessionResponse>("session/new", {
        cwd: fixture.directory, mcpServers: [],
      });
      await expect(fixture.client.request("session/prompt", {
        sessionId: session.sessionId, prompt: [{ type: "text", text }],
      })).resolves.toEqual({ stopReason: "end_turn" });
      expect(updates.filter((notification) => notification.update.sessionUpdate === "session_info_update")).toEqual([]);
      const commands = (await readFile(join(fixture.directory, "rpc-commands.jsonl"), "utf8"))
        .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(commands.filter((command) => command.type === "set_session_name")).toEqual([]);
      expect(commands.filter((command) => command.type === "prompt")).toEqual([{
        id: expect.any(String), type: "prompt", message: text,
      }]);
    } finally {
      cleanup = await fixture.cleanup();
    }
    expect(cleanup[0]?.status).toBe("fulfilled");
  });

  it("fails and reaps the actual connection when the explicit title output write rejects", async () => {
    const rejected = Promise.withResolvers<void>();
    const successfulResponses: unknown[] = [];
    const fixture = await closeCauseFixture("title-control", (message) => {
      const notification = message.params as acp.SessionNotification | undefined;
      if (message.method === "session/update" && notification?.update.sessionUpdate === "session_info_update") {
        rejected.resolve();
        throw new Error("synthetic title output failure");
      }
      if (message.id !== undefined && message.result !== undefined) successfulResponses.push(message.result);
    });
    let cleanup: PromiseSettledResult<void>[] = [];
    try {
      const session = await fixture.client.request<acp.NewSessionResponse>("session/new", {
        cwd: fixture.directory, mcpServers: [],
      });
      const successfulBefore = successfulResponses.length;
      const pending = fixture.client.request("session/prompt", {
        sessionId: session.sessionId, prompt: [{ type: "text", text: "/rename No false success" }],
      });
      const outcome = pending.then((value) => ({ value }), (error: unknown) => ({ error }));
      await withTimeout(Promise.race([
        rejected.promise,
        outcome.then(() => { throw new Error("Explicit title did not reach its real failing output sink"); }),
      ]), "015 title output rejection", RPC_TIMEOUT_MS);
      await withTimeout(fixture.client.closed, "015 title failed SDK close", RPC_TIMEOUT_MS);
      await withTimeout(fixture.exited, "015 title owned group cleanup", FORCED_CLOSE_TIMEOUT_MS);
      expect(successfulResponses).toHaveLength(successfulBefore);
      expect(fixture.failures).toHaveLength(1);
      expect(process.exitCode).toBe(1);
      expect(fixture.child?.pid).toBeDefined();
      expect(processExists(fixture.child!.pid!)).toBe(false);
      if (process.platform !== "win32") expect(processExists(-fixture.child!.pid!)).toBe(false);
    } finally {
      cleanup = await fixture.cleanup();
    }
    expect(cleanup[0]?.status).toBe("fulfilled");
  });
});
