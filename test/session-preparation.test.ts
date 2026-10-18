import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type * as acp from "@agentclientprotocol/sdk";
import type { SessionUsageUpdate } from "acp-extension-core";
import { OmpRpcConnection } from "../src/connection.js";

type Frame = Record<string, unknown>;
type Operation = "new" | "load" | "resume";

type Peer = {
  connection: OmpRpcConnection;
  state: { sessionFile: string; sessionId: string };
  received: Frame[];
  updates: acp.SessionNotification[];
  usages: SessionUsageUpdate[];
  failures: Error[];
  emit(frame: Frame): void;
  reply(command: Frame, data?: unknown): void;
  setState(handler: (command: Frame) => void): void;
  restoreState(): void;
  close(): void;
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function preparationPeer(): Peer {
  let output!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  const received: Frame[] = [];
  const updates: acp.SessionNotification[] = [];
  const usages: SessionUsageUpdate[] = [];
  const failures: Error[] = [];
  const state = { sessionFile: "/tmp/previous-preparation.jsonl", sessionId: "native-preparation" };
  const emit = (frame: Frame) => output.enqueue(new TextEncoder().encode(`${JSON.stringify(frame)}\n`));
  const reply = (command: Frame, data: unknown = {}) => emit({
    type: "response", id: command.id, command: command.type, success: true, data,
  });
  let readState = (command: Frame) => reply(command, state);
  let promptSequence = 0;
  const connection = new OmpRpcConnection({
    readable: new ReadableStream<Uint8Array>({ start(controller) { output = controller; } }),
    writable: new WritableStream<Uint8Array>({
      write(bytes) {
        const command = JSON.parse(new TextDecoder().decode(bytes)) as Frame;
        received.push(command);
        if (command.type === "get_state") readState(command);
        else if (command.type === "prompt") {
          reply(command);
          emit({ type: "message_end", messageId: `prep-${++promptSequence}`, message: {
            role: "assistant", provider: "fixture", model: "prep-model",
            usage: { input: 3, output: 2, cacheRead: 0, cacheWrite: 0 },
          } });
          emit({ type: "prompt_result", id: command.id, status: "completed", sessionSettled: true });
        } else if (command.type === "new_session" || command.type === "switch_session") reply(command, { cancelled: false });
        else throw new Error(`Unexpected command: ${String(command.type)}`);
      },
    }),
  }, {
    update: async (value) => { updates.push(value); },
    usage: (value) => { usages.push(value); },
    failure: (error) => { failures.push(error); },
  });
  return {
    connection, state, received, updates, usages, failures, emit, reply,
    setState(handler: (command: Frame) => void) { readState = handler; },
    restoreState() { readState = (command) => reply(command, state); },
    close() { if (!closed) { closed = true; output.close(); } },
  };
}

function change(p: Peer, operation: Operation, target: string) {
  const request = { sessionId: target, cwd: "/work", mcpServers: [] };
  return operation === "new" ? p.connection.newSession(request)
    : operation === "load" ? p.connection.loadSession(request) : p.connection.resumeSession(request);
}
function prompt(p: Peer, sessionId: string) {
  return p.connection.prompt({ sessionId, prompt: [{ type: "text", text: "prepare" }] });
}
function stale(p: Peer) {
  p.emit({ type: "message_update", messageId: "stale-preparation", assistantMessageEvent: { type: "text_delta", delta: "STALE" } });
  p.emit({ type: "message_end", messageId: "stale-preparation", message: {
    role: "assistant", provider: "fixture", model: "stale-model",
    usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
  } });
}

const operations = ["new", "load", "resume"] as const;

describe("OMP session preparation", () => {
  const peers: Peer[] = [];
  const directories: string[] = [];
  afterEach(async () => {
    for (const p of peers.splice(0)) p.close();
    for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
  });
  async function setup() {
    const p = preparationPeer();
    peers.push(p);
    const directory = await mkdtemp(join(tmpdir(), "omp-prepare-"));
    directories.push(directory);
    const target = join(directory, "target.jsonl");
    await writeFile(target, '{"type":"session"}\n');
    const previous = await p.connection.newSession({ cwd: directory, mcpServers: [] });
    await prompt(p, previous.sessionId);
    return { p, target, previous };
  }

  it.each(operations.flatMap((operation) => (["rejected", "missing", "empty"] as const).map((failure) => ({ operation, failure }))))(
    "$operation get_state $failure invalidates identity and permits verified recovery",
    async ({ operation, failure }) => {
      const { p, target, previous } = await setup();
      const before = p.received.length;
      const oldScope = p.usages[0]?._meta?.lody?.usageScopeId;
      p.setState((command) => {
        stale(p);
        if (failure === "rejected") p.emit({ type: "response", id: command.id, command: "get_state", success: false });
        else p.reply(command, failure === "missing" ? { sessionId: "unusable-native" } : { sessionFile: "", sessionId: "unusable-native" });
      });
      await expect(change(p, operation, target)).rejects.toThrow();
      await expect(prompt(p, previous.sessionId)).rejects.toThrow("identity");
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(p.received.slice(before).map((command) => command.type)).toEqual([
        operation === "new" ? "new_session" : "switch_session", "get_state",
      ]);
      expect(p.updates).toEqual([]);
      expect(p.usages).toHaveLength(1);
      p.restoreState();
      p.state.sessionFile = target;
      // Exercise each public recovery operation, not only newSession.
      await change(p, operation, target);
      await expect(prompt(p, previous.sessionId)).rejects.toThrow("identity");
      await expect(prompt(p, target)).resolves.toEqual({ stopReason: "end_turn" });
      expect(p.usages).toHaveLength(2);
      expect(p.usages[1]?.sessionId).toBe(target);
      expect(Object.keys(p.usages[1]?.modelUsage ?? {})).toEqual(["fixture/prep-model"]);
      expect(p.usages[1]?.modelUsage).toMatchObject({
        "fixture/prep-model": { inputTokens: 3, outputTokens: 2, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
      });
      expect(p.usages[1]?._meta?.lody?.usageScopeId).toBeDefined();
      expect(p.usages[1]?._meta?.lody?.usageScopeId).not.toBe(oldScope);
      expect(p.failures).toEqual([]);
    },
  );

  it.each(["load", "resume"] as const)("rejects %s selecting another file and allows subsequent exact recovery", async (operation) => {
    const { p, target, previous } = await setup();
    const before = p.received.length;
    await expect(change(p, operation, target)).rejects.toThrow("different session");
    await expect(prompt(p, previous.sessionId)).rejects.toThrow("identity");
    expect(p.received.slice(before).map((command) => command.type)).toEqual(["switch_session", "get_state"]);
    stale(p);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(p.updates).toEqual([]);
    expect(p.usages).toHaveLength(1);
    p.state.sessionFile = target;
    await change(p, operation, target);
    await expect(prompt(p, target)).resolves.toEqual({ stopReason: "end_turn" });
    expect(p.usages[1]?.sessionId).toBe(target);
    expect(p.usages[1]?.modelUsage?.["fixture/prep-model"]?.inputTokens).toBe(3);
    expect(p.usages[1]?._meta?.lody?.usageScopeId).toBeDefined();
    expect(p.usages[1]?._meta?.lody?.usageScopeId).not.toBe(p.usages[0]?._meta?.lody?.usageScopeId);
  });

  it.each(["load", "resume"] as const)("fails %s on EOF after switch ACK without admitting fallback work", async (operation) => {
    const { p, target, previous } = await setup();
    const before = p.received.length;
    p.setState(() => p.close());
    await expect(change(p, operation, target)).rejects.toThrow("stream closed");
    await expect(prompt(p, previous.sessionId)).rejects.toThrow("identity");
    await expect(change(p, "new", target)).rejects.toThrow("stream closed");
    expect(p.received.slice(before).map((command) => command.type)).toEqual(["switch_session", "get_state"]);
    expect(p.updates).toEqual([]);
    expect(p.usages).toHaveLength(1);
    expect(p.failures.map((error) => error.message)).toEqual(["OMP RPC stream closed"]);
  });

  it.each(operations.flatMap((first) => operations.map((second) => ({ first, second }))))(
    "blocks $second while $first is waiting for get_state, then releases admission",
    async ({ first, second }) => {
      const { p, target, previous } = await setup();
      const prepared = deferred<Frame>();
      p.setState((command) => prepared.resolve(command));
      p.state.sessionFile = target;
      const before = p.received.length;
      const pending = change(p, first, target);
      const command = await prepared.promise;
      await expect(change(p, second, target)).rejects.toThrow("active");
      await expect(prompt(p, previous.sessionId)).rejects.toThrow("active");
      stale(p);
      p.reply(command, p.state);
      await pending;
      expect(p.received.slice(before).map((value) => value.type)).toEqual([
        first === "new" ? "new_session" : "switch_session", "get_state",
      ]);
      expect(p.updates).toEqual([]);
      expect(p.usages).toHaveLength(1);
      await expect(prompt(p, previous.sessionId)).rejects.toThrow("identity");
      await expect(prompt(p, target)).resolves.toEqual({ stopReason: "end_turn" });
      p.restoreState();
      await change(p, second, target);
      await expect(prompt(p, target)).resolves.toEqual({ stopReason: "end_turn" });
      expect(p.usages.map((value) => value.modelUsage?.["fixture/prep-model"]?.inputTokens)).toEqual([3, 3, 3]);
      expect(new Set(p.usages.map((value) => value._meta?.lody?.usageScopeId)).size).toBe(3);
    },
  );
});
