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
  emitBatch(frames: Record<string, unknown>[]): void;
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
  setAbort(handler: (command: Record<string, unknown>) => void): void;
  setUpdate(handler: (notification: acp.SessionNotification) => Promise<void>): void;
  setUsage(handler: (usage: SessionUsageUpdate) => void): void;
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
  const emitBatch = (frames: Record<string, unknown>[]) =>
    output.enqueue(new TextEncoder().encode(`${frames.map((frame) => JSON.stringify(frame)).join("\n")}\n`));
  const reply = (command: Record<string, unknown>, data: unknown = {}) =>
    emit({ type: "response", id: command.id, command: command.type, success: true, data });
  let onPrompt = (command: Record<string, unknown>) => {
    reply(command, {});
    emit({ type: "message_update", messageId: "assistant-1", message: { role: "assistant" }, assistantMessageEvent: { type: "text_delta", delta: "hello" } });
    emit({ type: "prompt_result", id: command.id, agentInvoked: true, status: "completed", sessionSettled: true });
  };
  const updates: acp.SessionNotification[] = [];
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
  const usages: SessionUsageUpdate[] = [];
  let onUsage = (usage: SessionUsageUpdate): void => {
    usages.push(usage);
  };
  const host = {
    update: (notification: acp.SessionNotification) => onUpdate(notification),
    usage: (usage: SessionUsageUpdate) => onUsage(usage),
    failure: () => {},
  };
  return {
    connection: new OmpRpcConnection({ readable, writable }, host),
    emit,
    emitBatch,
    state,
    received,
    updates,
    usages,
    setPrompt(handler: (command: Record<string, unknown>) => void) {
      onPrompt = handler;
    },
    setAbort(handler: (command: Record<string, unknown>) => void) {
      onAbort = handler;
    },
    setUpdate(handler: (notification: acp.SessionNotification) => Promise<void>) {
      onUpdate = handler;
    },
    setUsage(handler: (usage: SessionUsageUpdate) => void) {
      onUsage = handler;
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
  it("completes a legacy agent prompt from agent_end", async () => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    p.setPrompt((command) => {
      p.emit({ type: "response", id: command.id, command: "prompt", success: true });
      p.emit({ type: "message_update", messageId: "assistant-legacy", message: { role: "assistant" }, assistantMessageEvent: { type: "text_delta", delta: "legacy" } });
      p.emit({ type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] });
    });
    await expect(p.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "legacy" }] }))
      .resolves.toEqual({ stopReason: "end_turn" });
  });
  it("completes legacy agentInvoked prompts from agent_end", async () => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    p.setPrompt((command) => {
      p.emit({ type: "response", id: command.id, command: "prompt", success: true, data: { agentInvoked: true } });
      p.emit({ type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] });
    });
    await expect(p.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "/retry" }] }))
      .resolves.toEqual({ stopReason: "end_turn" });
  });

  it("keeps a legacy prompt pending across a nonterminal agent_end", async () => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    const updateStarted = deferred<void>();
    let settled = false;
    p.setUpdate(async () => {
      updateStarted.resolve(undefined);
    });
    p.setPrompt((command) => {
      p.emit({ type: "response", id: command.id, command: "prompt", success: true });
      p.emit({ type: "agent_end", isTerminal: false, messages: [] });
      p.emit({ type: "message_update", messageId: "assistant-legacy", message: { role: "assistant" }, assistantMessageEvent: { type: "text_delta", delta: "still running" } });
    });
    const prompt = p.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "legacy" }] });
    void prompt.then(() => { settled = true; });
    await updateStarted.promise;
    expect(settled).toBe(false);
    p.emit({ type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] });
    await expect(prompt).resolves.toEqual({ stopReason: "end_turn" });
  });

  it("completes a legacy local prompt from prompt_result", async () => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    p.setPrompt((command) => {
      p.emit({ type: "response", id: command.id, command: "prompt", success: true });
      p.emit({ type: "prompt_result", id: command.id, agentInvoked: false });
    });
    await expect(p.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "/help" }] }))
      .resolves.toEqual({ stopReason: "end_turn" });
  });

  it("waits for a legacy agent_end before completing cancellation", async () => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    p.setPrompt((command) => {
      p.emit({ type: "response", id: command.id, command: "prompt", success: true });
    });
    p.setAbort((command) => {
      p.emit({ type: "response", id: command.id, command: "abort", success: true });
      p.emit({
        type: "agent_end",
        messages: [{ role: "assistant", stopReason: "aborted" }],
      });
    });
    const prompt = p.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "cancel" }] });
    await p.connection.cancel({ sessionId: session.sessionId });
    await expect(prompt).resolves.toEqual({ stopReason: "cancelled" });
  });
  it("confirms a message-less legacy cancel only after abort acknowledgement", async () => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    p.setPrompt((command) => {
      p.emit({ type: "response", id: command.id, command: "prompt", success: true });
    });
    p.setAbort((command) => {
      p.emitBatch([
        { type: "agent_end", messages: [] },
        { type: "response", id: command.id, command: "abort", success: true },
      ]);
    });
    const prompt = p.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "cancel" }] });
    await p.connection.cancel({ sessionId: session.sessionId });
    await expect(prompt).resolves.toEqual({ stopReason: "cancelled" });
  });

  it("does not turn a normal legacy stop into cancellation", async () => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    p.setPrompt((command) => {
      p.emit({ type: "response", id: command.id, command: "prompt", success: true });
    });
    p.setAbort((command) => {
      p.emit({ type: "response", id: command.id, command: "abort", success: true });
      p.emit({ type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] });
    });
    const prompt = p.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "race" }] });
    await p.connection.cancel({ sessionId: session.sessionId });
    await expect(prompt).resolves.toEqual({ stopReason: "end_turn" });
  });
  it("rejects a legacy terminal with a non-boolean isTerminal discriminator", async () => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    p.setPrompt((command) => {
      p.emitBatch([
        { type: "response", id: command.id, command: "prompt", success: true },
        { type: "agent_end", isTerminal: "true", messages: [] },
      ]);
    });
    await expect(p.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "bad discriminator" }] }))
      .rejects.toThrow("OMP prompt failed");
  });

  it("rejects a legacy terminal with an unknown assistant stop reason", async () => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    p.setPrompt((command) => {
      p.emitBatch([
        { type: "response", id: command.id, command: "prompt", success: true },
        { type: "agent_end", messages: [{ role: "assistant", stopReason: "future_reason" }] },
      ]);
    });
    await expect(p.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "bad stop reason" }] }))
      .rejects.toThrow("OMP prompt failed");
  });
  it.each(["constructor", "toString", "__proto__"])("rejects inherited legacy stop reason %s", async (stopReason) => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    p.setPrompt((command) => {
      p.emitBatch([
        { type: "response", id: command.id, command: "prompt", success: true },
        { type: "agent_end", messages: [{ role: "assistant", stopReason }] },
      ]);
    });
    await expect(p.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "bad inherited reason" }] }))
      .rejects.toThrow("OMP prompt failed");
  });
  it("ignores prototype-inherited yielded on agent_end and fails closed without messages", async () => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    p.setPrompt((command) => {
      p.emit({ type: "response", id: command.id, command: "prompt", success: true });
    });
    const prompt = p.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "proto yielded" }] });
    await Promise.resolve();
    await Promise.resolve();
    const frame = Object.create({ yielded: true }) as Record<string, unknown>;
    frame.type = "agent_end";
    (p.connection as unknown as { event(frame: Record<string, unknown>): void }).event(frame);
    await expect(prompt).rejects.toThrow("OMP prompt failed");
  });

  it("ignores prototype-inherited isTerminal:false and still requires a legacy terminal", async () => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    p.setPrompt((command) => {
      p.emit({ type: "response", id: command.id, command: "prompt", success: true });
    });
    const prompt = p.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "proto isTerminal" }] });
    await Promise.resolve();
    await Promise.resolve();
    const frame = Object.create({ isTerminal: false }) as Record<string, unknown>;
    frame.type = "agent_end";
    (p.connection as unknown as { event(frame: Record<string, unknown>): void }).event(frame);
    await expect(prompt).rejects.toThrow("OMP prompt failed");
  });

  it("waits for a current agent_end prompt_result before resolving", async () => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    p.setPrompt((command) => {
      p.emit({ type: "response", id: command.id, command: "prompt", success: true });
      p.emit({ type: "agent_end", yielded: true, messages: [] });
      p.emit({
        type: "prompt_result",
        id: command.id,
        agentInvoked: true,
        status: "error",
        sessionSettled: true,
        error: { message: "synthetic provider failure" },
      });
    });
    await expect(p.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "fail" }] }))
      .rejects.toThrow("OMP prompt failed");
  });
  it("rejects a legacy terminal agent error", async () => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    p.setPrompt((command) => {
      p.emit({ type: "response", id: command.id, command: "prompt", success: true });
      p.emit({
        type: "agent_end",
        isTerminal: true,
        messages: [{ role: "assistant", stopReason: "error", errorMessage: "synthetic legacy provider failure" }],
      });
    });
    await expect(p.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "fail" }] }))
      .rejects.toThrow("OMP prompt failed");
  });
  it("rejects a local result that also carries a current error status", async () => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    p.setPrompt((command) => {
      p.emit({ type: "response", id: command.id, command: "prompt", success: true });
      p.emit({
        type: "prompt_result",
        id: command.id,
        agentInvoked: false,
        status: "error",
        sessionSettled: true,
        error: { message: "local provider failure" },
      });
    });
    await expect(p.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "fail" }] }))
      .rejects.toThrow("OMP prompt failed");
  });
  it("waits for session settlement when a local result carries current fields", async () => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    const usageSeen = deferred<void>();
    p.setUsage(() => {
      usageSeen.resolve(undefined);
    });
    p.setPrompt((command) => {
      p.emit({ type: "response", id: command.id, command: "prompt", success: true });
      p.emit({ type: "prompt_result", id: command.id, agentInvoked: false, status: "completed", sessionSettled: false });
      p.emit({
        type: "message_end",
        messageId: "local-message",
        message: {
          role: "assistant",
          provider: "fixture",
          model: "model",
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
        },
      });
    });
    const request = { sessionId: session.sessionId, prompt: [{ type: "text" as const, text: "local" }] };
    const prompt = p.connection.prompt(request);
    await usageSeen.promise;
    await expect(p.connection.prompt(request)).rejects.toThrow("active");
    p.emit({ type: "session_settled" });
    await expect(prompt).resolves.toEqual({ stopReason: "end_turn" });
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
  it("drains notifications enqueued after settlement starts before resolving", async () => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    const gate = deferred<void>();
    const firstStarted = deferred<void>();
    const order: string[] = [];
    p.setUpdate(async (notification) => {
      if (p.updates.length === 0) {
        firstStarted.resolve(undefined);
        await gate.promise;
      }
      p.updates.push(notification);
      order.push(`update:${(notification.update as { content?: { text?: string } }).content?.text ?? "?"}`);
    });
    p.setUsage(() => {
      order.push("usage");
    });
    p.setPrompt((command) => {
      p.emitBatch([
        { type: "response", id: command.id, command: "prompt", success: true },
        { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "first" } },
        { type: "prompt_result", id: command.id, agentInvoked: true, status: "completed", sessionSettled: true },
      ]);
    });
    const prompt = p.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "tail" }] });
    void prompt.then(() => { order.push("terminal"); });
    await firstStarted.promise;
    p.emit({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "late" },
    });
    p.emit({
      type: "message_end",
      messageId: "late-usage",
      message: {
        role: "assistant",
        provider: "fixture",
        model: "model",
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    gate.resolve(undefined);
    await expect(prompt).resolves.toEqual({ stopReason: "end_turn" });
    expect(order.indexOf("update:late")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("usage")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("terminal")).toBeGreaterThan(order.indexOf("update:late"));
    expect(order.indexOf("terminal")).toBeGreaterThan(order.indexOf("usage"));
  });
  it("rejects RPC agentInvoked:false when response data carries current error status", async () => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    p.setPrompt((command) => {
      p.emit({
        type: "response",
        id: command.id,
        command: "prompt",
        success: true,
        data: { agentInvoked: false, status: "error", sessionSettled: true, error: { message: "secret" } },
      });
    });
    await expect(p.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "/help" }] }))
      .rejects.toThrow("OMP prompt failed");
  });
  it("waits for settlement when RPC agentInvoked:false carries sessionSettled:false", async () => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    p.setPrompt((command) => {
      p.emit({
        type: "response",
        id: command.id,
        command: "prompt",
        success: true,
        data: { agentInvoked: false, status: "completed", sessionSettled: false },
      });
    });
    const request = { sessionId: session.sessionId, prompt: [{ type: "text" as const, text: "/help" }] };
    const prompt = p.connection.prompt(request);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await expect(p.connection.prompt(request)).rejects.toThrow("active");
    p.emit({ type: "session_settled" });
    await expect(prompt).resolves.toEqual({ stopReason: "end_turn" });
  });
  it("rejects non-string status that String() would coerce into a valid current status", async () => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    p.setPrompt((command) => {
      p.emit({
        type: "response",
        id: command.id,
        command: "prompt",
        success: true,
        data: { agentInvoked: false, status: ["completed"], sessionSettled: true },
      });
    });
    await expect(p.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "/help" }] }))
      .rejects.toThrow("OMP prompt failed");
  });

    it("waits for queued notifications before rejecting a failed prompt command", async () => {
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
    p.setPrompt((command) => {
      p.emitBatch([
        { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "before failure" } },
        { type: "response", id: command.id, command: "prompt", success: false, error: "synthetic RPC failure" },
      ]);
    });
    const prompt = p.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "failure" }] });
    void prompt.then(() => { settled = true; }, () => { settled = true; });
    await updateStarted.promise;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    gate.resolve(undefined);
    await expect(prompt).rejects.toThrow("OMP RPC command failed");
    expect(p.updates).toHaveLength(1);
  });
  it("does not let a prompt RPC failure be overwritten by a same-batch legacy terminal", async () => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    p.setPrompt((command) => {
      p.emitBatch([
        { type: "response", id: command.id, command: "prompt", success: false, error: "provider-secret" },
        { type: "agent_end", messages: [] },
      ]);
    });
    await expect(p.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "failure race" }] }))
      .rejects.toThrow("OMP RPC command failed");
  });
  it("captures the session identity when queuing a notification", async () => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    const gate = deferred<void>();
    const firstUpdateStarted = deferred<void>();
    let updateCount = 0;
    p.setUpdate(async (notification) => {
      if (updateCount++ === 0) {
        firstUpdateStarted.resolve(undefined);
        await gate.promise;
      }
      p.updates.push(notification);
    });
    p.setPrompt((command) => {
      p.emitBatch([
        { type: "response", id: command.id, command: "prompt", success: true },
        { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "first" } },
        { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "second" } },
        { type: "prompt_result", id: command.id, agentInvoked: true, status: "completed", sessionSettled: true },
      ]);
    });
    const prompt = p.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "identity" }] });
    await firstUpdateStarted.promise;
    // The regression needs to model a session switch while the notification tail is blocked.
    const internals = p.connection as unknown as { sessionId: string };
    internals.sessionId = "/tmp/omp-next-session.jsonl";
    gate.resolve(undefined);
    await expect(prompt).resolves.toEqual({ stopReason: "end_turn" });
    expect(p.updates).toHaveLength(2);
    expect(p.updates[0]?.sessionId).toBe(session.sessionId);
    expect(p.updates[1]?.sessionId).toBe(session.sessionId);
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
  it("accounts legacy message_end usage by responseId", async () => {
    const p = peer();
    peers.push(p);
    p.setPrompt((command) => {
      p.emit({ type: "response", id: command.id, command: "prompt", success: true });
      p.emit({
        type: "message_end",
        message: {
          role: "assistant",
          provider: "fixture",
          model: "legacy-model",
          responseId: "legacy-response-1",
          usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, totalTokens: 18 },
        },
      });
      p.emit({ type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] });
    });
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    await p.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "legacy usage" }] });
    expect(p.usages).toHaveLength(1);
    expect(p.usages[0]?.modelUsage).toMatchObject({
      "fixture/legacy-model": { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 2, cacheCreationInputTokens: 1 },
    });
  });
  it("does not attribute a late message_end to a replacement session", async () => {
    const p = peer();
    peers.push(p);
    await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    const directory = await mkdtemp(join(tmpdir(), "omp-late-usage-test-"));
    directories.push(directory);
    const replacement = join(directory, "replacement.jsonl");
    await writeFile(replacement, '{"type":"session"}\n');
    p.state.sessionFile = replacement;
    await p.connection.loadSession({ sessionId: replacement, cwd: "/work", mcpServers: [] });
    p.emit({
      type: "message_end",
      messageId: "old-message",
      message: {
        role: "assistant",
        provider: "fixture",
        model: "old-model",
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
      },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(p.usages).toHaveLength(0);
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
  it("keeps new work blocked until a terminal-before-ack cancellation settles", async () => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    const abortStarted = deferred<void>();
    const abortResponse = deferred<void>();
    let promptCount = 0;
    p.setPrompt((command) => {
      p.emit({ type: "response", id: command.id, command: command.type, success: true, data: {} });
      if (promptCount++ > 0) p.emit({ type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] });
    });
    p.setAbort((command) => {
      abortStarted.resolve(undefined);
      p.emit({ type: "agent_end", messages: [{ role: "assistant", stopReason: "aborted" }] });
      void abortResponse.promise.then(() => {
        p.emit({ type: "response", id: command.id, command: "abort", success: true });
      });
    });
    const prompt = p.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "cancel" }] });
    const cancellation = p.connection.cancel({ sessionId: session.sessionId });
    await abortStarted.promise;
    await Promise.resolve();
    await expect(p.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "too early" }] }))
      .rejects.toThrow("active");
    await expect(p.connection.newSession({ cwd: "/work", mcpServers: [] })).rejects.toThrow("active");
    abortResponse.resolve(undefined);
    await expect(cancellation).resolves.toBeUndefined();
    await expect(prompt).resolves.toEqual({ stopReason: "cancelled" });
    await expect(p.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "after ack" }] }))
      .resolves.toEqual({ stopReason: "end_turn" });
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
  it.each(["missing", "empty"] as const)("invalid exact session switch (%s) invalidates the previous ACP identity", async (kind) => {
    const p = peer();
    peers.push(p);
    const previous = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    const directory = await mkdtemp(join(tmpdir(), "omp-invalid-switch-test-"));
    directories.push(directory);
    const target = join(directory, `${kind}.jsonl`);
    if (kind === "empty") await writeFile(target, "");
    await expect(p.connection.loadSession({ sessionId: target, cwd: "/work", mcpServers: [] })).rejects.toThrow();
    await expect(p.connection.prompt({ sessionId: previous.sessionId, prompt: [{ type: "text", text: "old identity" }] }))
      .rejects.toThrow("identity");
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
