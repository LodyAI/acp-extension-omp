import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type * as acp from "@agentclientprotocol/sdk";
import type { SessionUsageUpdate } from "acp-extension-core";
import { OmpRpcConnection } from "../src/connection.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Peer = {
  connection: OmpRpcConnection;
  emit(frame: Record<string, unknown>): void;
  state: {
    sessionFile: string;
    sessionId: string;
    thinkingLevel: string;
    model: { provider: string; id: string; name: string };
  };
  received: Record<string, unknown>[];
  updates: acp.SessionNotification[];
  usages: SessionUsageUpdate[];
  setPrompt(handler: (command: Record<string, unknown>) => void): void;
  setUpdate(handler: (notification: acp.SessionNotification) => Promise<void>): void;
  close(): void;
  exited: Promise<void>;
};

function peer(): Peer {
  let output!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  const received: Record<string, unknown>[] = [];
  const exited = deferred<void>();
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      output = controller;
    },
  });
  const state = {
    sessionFile: "/tmp/omp-session.jsonl",
    sessionId: "native-omp-session",
    thinkingLevel: "high",
    model: { provider: "fixture", id: "model", name: "Fixture" },
  };
  const emit = (frame: Record<string, unknown>) =>
    output.enqueue(new TextEncoder().encode(`${JSON.stringify(frame)}\n`));
  const reply = (command: Record<string, unknown>, data: unknown = {}) =>
    emit({ type: "response", id: command.id, command: command.type, success: true, data });
  let onPrompt = (command: Record<string, unknown>) => {
    reply(command, {});
    emit({ type: "message_update", messageId: "assistant-1", message: { role: "assistant" }, assistantMessageEvent: { type: "text_delta", delta: "hello" } });
    emit({ type: "prompt_result", id: command.id, agentInvoked: true, status: "completed", sessionSettled: true });
  };
  let onUpdate = async (notification: acp.SessionNotification) => {
    updates.push(notification);
  };
  let onAbort = (command: Record<string, unknown>) => {
    reply(command, {});
    const prompt = [...received].reverse().find((candidate) => candidate.type === "prompt");
    if (!prompt) throw new Error("Abort has no active prompt");
    emit({ type: "prompt_result", id: prompt.id, agentInvoked: true, status: "aborted", sessionSettled: true });
  };
  const writable = new WritableStream<Uint8Array>({
    write(bytes) {
      const command = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
      received.push(command);
      switch (command.type) {
        case "get_state":
          reply(command, state);
          break;
        case "new_session":
          reply(command, { cancelled: false });
          break;
        case "switch_session":
          reply(command, { cancelled: false });
          break;
        case "prompt":
          onPrompt(command);
          break;
        case "abort":
          onAbort(command);
          break;
        default:
          throw new Error(`Unexpected command: ${String(command.type)}`);
      }
    },
  });
  const updates: acp.SessionNotification[] = [];
  const usages: SessionUsageUpdate[] = [];
  const host = {
    update: (notification: acp.SessionNotification) => onUpdate(notification),
    usage: (usage: SessionUsageUpdate) => usages.push(usage),
    failure: () => {},
  };
  return {
    connection: new OmpRpcConnection({ readable, writable }, host),
    emit,
    state,
    received,
    updates,
    usages,
    setPrompt(handler: (command: Record<string, unknown>) => void) {
      onPrompt = handler;
    },
    setUpdate(handler: (notification: acp.SessionNotification) => Promise<void>) {
      onUpdate = handler;
    },
    close() {
      if (closed) return;
      closed = true;
      output.close();
      exited.resolve();
    },
    exited: exited.promise,
  };
}

describe("OMP RPC connection", () => {
  const peers: Peer[] = [];
  const directories: string[] = [];
  afterEach(async () => {
    for (const value of peers.splice(0)) value.close();
    for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
  });

  it("streams a completed OMP prompt as ACP text and end_turn", async () => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    await expect(
      p.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "hello" }] })
    ).resolves.toEqual({ stopReason: "end_turn" });
    expect(p.updates).toContainEqual({
      sessionId: session.sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } },
    });
  });

  it("finishes a locally handled prompt without waiting for a nonexistent terminal frame", async () => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    p.setPrompt((command) => {
      p.emit({ type: "response", id: command.id, command: "prompt", success: true, data: { agentInvoked: false } });
    });
    await expect(p.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "/help" }] }))
      .resolves.toEqual({ stopReason: "end_turn" });
    await expect(p.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "/help" }] }))
      .resolves.toEqual({ stopReason: "end_turn" });
  });
  it("waits for queued notifications before resolving the terminal prompt", async () => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    const gate = deferred<void>();
    const updateStarted = deferred<void>();
    p.setUpdate(async (notification) => {
      updateStarted.resolve(undefined);
      await gate.promise;
      p.updates.push(notification);
    });
    let settled = false;
    const prompt = p.connection.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "ordered" }],
    });
    void prompt.then(() => {
      settled = true;
    });
    await updateStarted.promise;
    expect(settled).toBe(false);
    expect(p.updates).toHaveLength(0);
    gate.resolve(undefined);
    await expect(prompt).resolves.toEqual({ stopReason: "end_turn" });
    expect(p.updates).toHaveLength(1);
  });

  it("keeps replacement prompts blocked until native session settlement", async () => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    const delivered = deferred<void>();
    p.setUpdate(async () => { delivered.resolve(undefined); });
    p.setPrompt((command) => {
      p.emit({ type: "response", id: command.id, command: "prompt", success: true, data: {} });
      p.emit({ type: "prompt_result", id: command.id, status: "completed", sessionSettled: false });
      p.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "background result" } });
    });
    const request = { sessionId: session.sessionId, prompt: [{ type: "text" as const, text: "wait" }] };
    const prompt = p.connection.prompt(request);
    await delivered.promise;
    await expect(p.connection.prompt(request)).rejects.toThrow("active");
    p.emit({ type: "session_settled" });
    await expect(prompt).resolves.toEqual({ stopReason: "end_turn" });
  });

  it("accounts each OMP message id once without inventing a missing cost", async () => {
    const p = peer();
    peers.push(p);
    p.setPrompt((command) => {
      p.emit({ type: "response", id: command.id, command: command.type, success: true, data: {} });
      const message = {
        role: "assistant",
        provider: "fixture",
        model: "model",
        usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, totalTokens: 18 },
      };
      p.emit({ type: "message_end", messageId: "operation-1", message });
      p.emit({ type: "message_end", messageId: "operation-1", message });
      p.emit({ type: "prompt_result", id: command.id, agentInvoked: true, status: "completed", sessionSettled: true });
    });
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    await p.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "usage" }] });
    expect(p.usages).toHaveLength(1);
    const usage = p.usages[0];
    expect(usage?.modelUsage).toMatchObject({
      "fixture/model": { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 2, cacheCreationInputTokens: 1 },
    });
    expect(usage?.modelUsage?.["fixture/model"]?.costUSD).toBeUndefined();
  });

  it("waits for OMP's terminal abort before completing cancellation", async () => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    p.setPrompt((command) => {
      p.emit({ type: "response", id: command.id, command: command.type, success: true, data: {} });
    });
    const prompt = p.connection.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "wait" }],
    });
    await p.connection.cancel({ sessionId: session.sessionId });
    await expect(prompt).resolves.toEqual({ stopReason: "cancelled" });
  });

  it("rejects an exact resume when OMP selects another native session", async () => {
    const p = peer();
    peers.push(p);
    const previous = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    p.state.sessionFile = "/tmp/other.jsonl";
    const directory = await mkdtemp(join(tmpdir(), "omp-session-test-"));
    directories.push(directory);
    const expected = join(directory, "expected.jsonl");
    await writeFile(expected, '{"type":"session"}\n');
    await expect(
      p.connection.resumeSession({ sessionId: expected, cwd: "/work", mcpServers: [] })
    ).rejects.toThrow("different session");
    await expect(p.connection.prompt({ sessionId: previous.sessionId, prompt: [{ type: "text", text: "old identity" }] }))
      .rejects.toThrow("identity");
  });

  it("rejects a missing native session instead of creating an empty replacement", async () => {
    const p = peer();
    peers.push(p);
    const directory = await mkdtemp(join(tmpdir(), "omp-missing-test-"));
    directories.push(directory);
    p.state.sessionFile = join(directory, "missing.jsonl");
    await expect(p.connection.loadSession({ sessionId: p.state.sessionFile, cwd: "/work", mcpServers: [] }))
      .rejects.toThrow();
    expect(p.received.some((command) => command.type === "switch_session")).toBe(false);
  });

  it.each(["new", "load", "resume"] as const)("refuses session %s while a prompt is active", async (operation) => {
    const p = peer();
    peers.push(p);
    const directory = await mkdtemp(join(tmpdir(), "omp-busy-test-"));
    directories.push(directory);
    p.state.sessionFile = join(directory, "existing.jsonl");
    await writeFile(p.state.sessionFile, '{"type":"session"}\n');
    const session = await p.connection.newSession({ cwd: directory, mcpServers: [] });
    p.setPrompt((command) => {
      p.emit({ type: "response", id: command.id, command: "prompt", success: true, data: {} });
    });
    const prompt = p.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "wait" }] });
    void prompt.catch(() => undefined);
    const request = { sessionId: session.sessionId, cwd: directory, mcpServers: [] };
    const changed = operation === "new" ? p.connection.newSession(request)
      : operation === "load" ? p.connection.loadSession(request) : p.connection.resumeSession(request);
    await expect(changed).rejects.toThrow("active");
    await p.connection.cancel({ sessionId: session.sessionId });
    await expect(prompt).resolves.toEqual({ stopReason: "cancelled" });
  });

  it("does not admit a prompt while a replacement native session is being prepared", async () => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    const replacement = p.connection.newSession({ cwd: "/work", mcpServers: [] });
    await expect(p.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "race" }] }))
      .rejects.toThrow("active");
    await replacement;
  });

  it("fails an active ACP prompt when OMP's RPC stream closes", async () => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    p.setPrompt((command) => {
      p.emit({ type: "response", id: command.id, command: command.type, success: true, data: {} });
    });
    const prompt = p.connection.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "wait" }],
    });
    p.close();
    await expect(prompt).rejects.toThrow("OMP RPC stream closed");
  });
});
