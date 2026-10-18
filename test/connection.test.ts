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
    sessionId?: string;
    thinkingLevel: string;
    model: { provider: string; id: string; name: string };
  };
  received: Record<string, unknown>[];
  updates: acp.SessionNotification[];
  usages: SessionUsageUpdate[];
  failures: Error[];
  setPrompt(handler: (command: Record<string, unknown>) => void): void;
  setAbort(handler: (command: Record<string, unknown>) => void): void;
  setSessionChange(handler: (command: Record<string, unknown>) => void): void;
  setUpdate(handler: (notification: acp.SessionNotification) => Promise<void>): void;
  setUsage(handler: (usage: SessionUsageUpdate) => void | Promise<void>): void;
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
  let onSessionChange = (command: Record<string, unknown>) => {
    reply(command, { cancelled: false });
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
        case "switch_session":
          onSessionChange(command);
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
  let onUsage = (usage: SessionUsageUpdate): void | Promise<void> => {
    usages.push(usage);
  };
  const failures: Error[] = [];
  const host = {
    update: (notification: acp.SessionNotification) => onUpdate(notification),
    usage: (usage: SessionUsageUpdate) => onUsage(usage),
    failure: (error: Error) => { failures.push(error); },
  };
  return {
    connection: new OmpRpcConnection({ readable, writable }, host),
    emit,
    emitBatch,
    state,
    received,
    updates,
    usages,
    failures,
    setPrompt(handler: (command: Record<string, unknown>) => void) {
      onPrompt = handler;
    },
    setAbort(handler: (command: Record<string, unknown>) => void) {
      onAbort = handler;
    },
    setSessionChange(handler: (command: Record<string, unknown>) => void) {
      onSessionChange = handler;
    },
    setUpdate(handler: (notification: acp.SessionNotification) => Promise<void>) {
      onUpdate = handler;
    },
    setUsage(handler: (usage: SessionUsageUpdate) => void | Promise<void>) {
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
  it.each([
    ["text-reject", true, false],
    ["text-reject", false, false],
    ["usage-reject", true, false],
    ["usage-reject", false, false],
    ["text-throw", true, false],
    ["text-throw", false, false],
    ["text-reject", true, true],
    ["usage-reject", true, true],
  ] as const)("fails promptly after %s (ACK: %s, terminal queued: %s)", async (mode, acknowledge, terminal) => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    const gate = deferred<void>();
    const started = deferred<void>();
    const delivered: string[] = [];
    const failNotification = () => {
      started.resolve();
      if (mode === "text-throw") throw "synthetic-private-notification-error";
      return gate.promise;
    };
    p.setUpdate((notification) => {
      const update = notification.update;
      if (update.sessionUpdate !== "agent_message_chunk" || update.content.type !== "text") {
        throw new Error("Expected text notification");
      }
      const text = update.content.text;
      if (text === "fail") return failNotification();
      delivered.push(text);
      return Promise.resolve();
    });
    p.setUsage(() => {
      if (mode === "usage-reject") return failNotification();
      delivered.push("usage");
    });
    p.setPrompt((command) => {
      p.emitBatch([
        ...(acknowledge ? [{ type: "response", id: command.id, command: "prompt", success: true }] : []),
        { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "first" } },
        ...(mode === "usage-reject" ? [] : [
          { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "fail" } },
        ]),
        {
          type: "message_end",
          messageId: "usage-1",
          message: {
            role: "assistant", provider: "fixture", model: "model",
            usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
          },
        },
        { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "after failure" } },
        ...(terminal ? [{ type: "prompt_result", id: command.id, status: "completed", sessionSettled: true }] : []),
      ]);
    });
    let outcome = "pending";
    let rejection: Error | undefined;
    const prompt = p.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "fail" }] });
    const observed = prompt.then(
      () => { outcome = "resolved"; },
      (error: Error) => { rejection = error; outcome = "rejected"; },
    );
    await started.promise;
    if (mode !== "text-throw") {
      expect(outcome).toBe("pending");
      expect(p.failures).toEqual([]);
      gate.reject(new Error("synthetic-private-notification-error"));
    }
    await expect.poll(() => outcome, { timeout: 1_000 }).toBe("rejected");
    await observed;
    expect(rejection?.message).not.toContain("synthetic-private");
    expect(p.failures).toHaveLength(1);
    expect(p.failures[0]?.message).not.toContain("synthetic-private");
    expect(delivered).toEqual(["first"]);
    const commandsBefore = p.received.length;
    await expect(p.connection.newSession({ cwd: "/work", mcpServers: [] })).rejects.toThrow();
    expect(p.received).toHaveLength(commandsBefore);
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
    await expect(p.connection.newSession({ cwd: "/work", mcpServers: [] })).rejects.toThrow("active");
    await expect(p.connection.loadSession({ sessionId: session.sessionId, cwd: "/work", mcpServers: [] }))
      .rejects.toThrow("active");
    await expect(p.connection.resumeSession({ sessionId: session.sessionId, cwd: "/work", mcpServers: [] }))
      .rejects.toThrow("active");
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

  it.each(["message_start", "message_update", "message_end", "idle", "wrong-session"] as const)(
    "ignores proven stale %s messages while a replacement prompt is active",
    async (origin) => {
      const p = peer();
      peers.push(p);
      const first = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
      const old = {
        messageId: "old-generation",
        message: {
          role: "assistant", provider: "fixture", model: "old-model",
          usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
        },
      };
      p.setPrompt((command) => {
        p.emitBatch([
          { type: "response", id: command.id, command: "prompt", success: true },
          ...(origin.startsWith("message_") ? [{
            ...old, type: origin,
            assistantMessageEvent: { type: "text_delta", delta: "original" },
          }] : []),
          { type: "prompt_result", id: command.id, status: "completed", sessionSettled: true },
        ]);
      });
      await p.connection.prompt({ sessionId: first.sessionId, prompt: [{ type: "text", text: "first" }] });
      p.state.sessionFile = "/tmp/replacement-generation.jsonl";
      p.state.sessionId = "replacement-native-id";
      const current = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
      if (origin === "idle") {
        p.emit({ ...old, type: "message_start" });
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      const updateCount = p.updates.length;
      const usageCount = p.usages.length;
      p.setPrompt((command) => {
        const identity = origin === "wrong-session" ? { sessionId: "native-omp-session" } : {};
        p.emitBatch([
          { type: "response", id: command.id, command: "prompt", success: true },
          { ...old, ...identity, type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "STALE" } },
          { ...old, ...identity, type: "message_end" },
          { type: "message_update", messageId: "fresh-current", sessionId: "replacement-native-id",
            assistantMessageEvent: { type: "text_delta", delta: "CURRENT" } },
          { type: "message_end", messageId: "fresh-current", sessionId: "replacement-native-id",
            message: { ...old.message, model: "current-model", usage: { input: 3, output: 2, cacheRead: 0, cacheWrite: 0 } } },
          { type: "prompt_result", id: command.id, status: "completed", sessionSettled: true },
        ]);
      });
      await expect(p.connection.prompt({ sessionId: current.sessionId, prompt: [{ type: "text", text: "current" }] }))
        .resolves.toEqual({ stopReason: "end_turn" });
      expect(p.updates.slice(updateCount)).toEqual([{
        sessionId: current.sessionId,
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "CURRENT" } },
      }]);
      expect(p.usages.slice(usageCount)).toHaveLength(1);
      expect(Object.keys(p.usages.at(-1)?.modelUsage ?? {})).toEqual(["fixture/current-model"]);
      expect(p.usages.at(-1)?.modelUsage).toMatchObject({
        "fixture/current-model": { inputTokens: 3, outputTokens: 2, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
      });
    },
  );

  it.each(["current", "legacy"] as const)("accounts fresh %s usage through repeated new/load/resume generations", async (protocol) => {
    const p = peer();
    peers.push(p);
    const directory = await mkdtemp(join(tmpdir(), "omp-generations-"));
    directories.push(directory);
    const target = join(directory, "native.jsonl");
    await writeFile(target, '{"type":"session"}\n');
    p.state.sessionFile = target;
    const scopes = new Set<string>();
    for (const [index, operation] of ["new", "load", "resume", "new", "load", "resume"].entries()) {
      const request = { cwd: directory, mcpServers: [], sessionId: target };
      if (operation === "new") await p.connection.newSession(request);
      else if (operation === "load") await p.connection.loadSession(request);
      else await p.connection.resumeSession(request);
      p.setPrompt((command) => {
        const id = `fresh-${index}`;
        const message = {
          role: "assistant", provider: "fixture", model: "model",
          ...(protocol === "legacy" ? { responseId: id } : {}),
          usage: { input: 4, output: 2, cacheRead: 0, cacheWrite: 0 },
        };
        const frame = { type: "message_end", ...(protocol === "current" ? { messageId: id } : {}), message };
        p.emitBatch([
          { type: "response", id: command.id, command: "prompt", success: true },
          frame, frame,
          { ...frame, message: { ...message, usage: { ...message.usage, output: 3 } } },
          { type: "prompt_result", id: command.id, status: "completed", sessionSettled: true },
        ]);
      });
      await expect(p.connection.prompt({ sessionId: target, prompt: [{ type: "text", text: "usage" }] }))
        .resolves.toEqual({ stopReason: "end_turn" });
      expect(p.usages).toHaveLength((index + 1) * 2);
      expect(p.usages.at(-1)?.modelUsage?.["fixture/model"]).toMatchObject({ inputTokens: 4, outputTokens: 3 });
      expect(p.usages.at(-1)?.modelUsage?.["fixture/model"]?.costUSD).toBeUndefined();
      const scope = p.usages.at(-1)?._meta?.lody?.usageScopeId;
      expect(scope).toBeDefined();
      expect(scopes.has(scope!)).toBe(false);
      scopes.add(scope!);
    }
  });

  it.each(["current", "legacy"] as const)("ignores old %s message IDs after cancellation and a session switch", async (protocol) => {
    const p = peer();
    peers.push(p);
    const first = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    const message = {
      role: "assistant", provider: "fixture", model: "old-model",
      ...(protocol === "legacy" ? { responseId: "cancelled-message" } : {}),
      usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
    };
    const identity = protocol === "current" ? { messageId: "cancelled-message" } : {};
    const started = deferred<void>();
    p.setPrompt((command) => {
      p.emitBatch([
        { type: "response", id: command.id, command: "prompt", success: true },
        { type: "message_start", ...identity, message },
      ]);
      started.resolve(undefined);
    });
    const pending = p.connection.prompt({ sessionId: first.sessionId, prompt: [{ type: "text", text: "cancel" }] });
    await started.promise;
    await p.connection.cancel({ sessionId: first.sessionId });
    await expect(pending).resolves.toEqual({ stopReason: "cancelled" });
    p.state.sessionFile = "/tmp/after-cancel.jsonl";
    const current = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    p.setPrompt((command) => {
      p.emitBatch([
        { type: "response", id: command.id, command: "prompt", success: true },
        { type: "message_end", ...identity, message },
        { type: "prompt_result", id: command.id, sessionId: "wrong-native",
          status: "error", sessionSettled: true },
        { type: "message_end", messageId: "after-cancel-current", message: {
          ...message, responseId: "after-cancel-response", model: "current-model",
          usage: { input: 2, output: 1, cacheRead: 0, cacheWrite: 0 },
        } },
        { type: "prompt_result", id: command.id, status: "completed", sessionSettled: true },
      ]);
    });
    await expect(p.connection.prompt({ sessionId: current.sessionId, prompt: [{ type: "text", text: "after" }] }))
      .resolves.toEqual({ stopReason: "end_turn" });
    expect(p.usages).toHaveLength(1);
    expect(Object.keys(p.usages[0]?.modelUsage ?? {})).toEqual(["fixture/current-model"]);
    expect(p.usages[0]?.modelUsage?.["fixture/current-model"]).toMatchObject({ inputTokens: 2, outputTokens: 1 });
  });

  it.each(["dual-to-legacy", "legacy-to-dual", "preseen-top", "preseen-response"] as const)("retains old responseId provenance across %s representations", async (representation) => {
    const p = peer();
    peers.push(p);
    const message = {
      role: "assistant", provider: "fixture", model: "old-model", responseId: "old-response",
      usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
    };
    const first = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    p.setPrompt((command) => p.emitBatch([
      { type: "response", id: command.id, command: "prompt", success: true },
      { type: "message_start", ...(representation === "dual-to-legacy" || representation === "preseen-response"
        ? { messageId: "old-top" } : {}), message: representation === "preseen-response" ? { role: "assistant" } : message },
      { type: "prompt_result", id: command.id, status: "completed", sessionSettled: true },
    ]));
    await p.connection.prompt({ sessionId: first.sessionId, prompt: [{ type: "text", text: "first" }] });
    const current = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    p.setPrompt((command) => p.emitBatch([
      { type: "response", id: command.id, command: "prompt", success: true },
      ...(representation === "preseen-top" ? [{ type: "message_start", messageId: "late-top" }] : []),
      ...(representation === "preseen-response" ? [{ type: "message_start", message: { responseId: "old-response" } }] : []),
      { type: "message_end", ...(representation !== "dual-to-legacy" ? {
        messageId: representation === "preseen-response" ? "old-top" : "late-top",
      } : {}), message },
      ...(representation === "preseen-top" ? [{ type: "message_end", messageId: "late-top", message: { ...message, responseId: undefined } }] : []),
      ...(representation === "preseen-response" ? [{ type: "message_end", message }] : []),
      { type: "message_end", messageId: "fresh-top", message: { ...message, responseId: "fresh-response", model: "current-model",
        usage: { input: 3, output: 1, cacheRead: 0, cacheWrite: 0 } } },
      { type: "message_end", message: { ...message, responseId: "fresh-response", model: "current-model",
        usage: { input: 3, output: 2, cacheRead: 0, cacheWrite: 0 } } },
      { type: "prompt_result", id: command.id, status: "completed", sessionSettled: true },
    ]));
    await expect(p.connection.prompt({ sessionId: current.sessionId, prompt: [{ type: "text", text: "current" }] }))
      .resolves.toEqual({ stopReason: "end_turn" });
    expect(p.usages).toHaveLength(2);
    expect(Object.keys(p.usages.at(-1)?.modelUsage ?? {})).toEqual(["fixture/current-model"]);
    expect(p.usages.at(-1)?.modelUsage?.["fixture/current-model"]).toMatchObject({ inputTokens: 3, outputTokens: 2 });
  });

  it.each(["top-first", "response-first", "top-accounted", "response-accounted"] as const)("merges separately observed aliases without double accounting (%s)", async (order) => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    const top = { type: "message_start", messageId: "separate-top" };
    const legacy = { type: "message_start", message: { responseId: "separate-response" } };
    const message = { role: "assistant", provider: "fixture", model: "model", responseId: "separate-response",
      usage: { input: 3, output: 1, cacheRead: 0, cacheWrite: 0 } };
    p.setPrompt((command) => p.emitBatch([
      { type: "response", id: command.id, command: "prompt", success: true },
      ...(order.startsWith("top") ? [top, legacy] : [legacy, top]),
      ...(order === "top-accounted" ? [{ type: "message_end", messageId: "separate-top", message: { ...message, responseId: undefined } }] : []),
      ...(order === "response-accounted" ? [{ type: "message_end", message }] : []),
      { type: "message_end", messageId: "separate-top", message },
      { type: "message_end", message },
      { type: "message_end", message: { ...message, usage: { ...message.usage, output: 2 } } },
      { type: "prompt_result", id: command.id, status: "completed", sessionSettled: true },
    ]));
    await p.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "aliases" }] });
    expect(p.usages).toHaveLength(2);
    expect(p.usages.at(-1)?.modelUsage?.["fixture/model"]).toMatchObject({ inputTokens: 3, outputTokens: 2 });
  });

  it.each(["initially", "after-switch"] as const)("accounts fresh usage with native sessionId absent %s", async (absence) => {
    const p = peer();
    peers.push(p);
    if (absence === "initially") delete p.state.sessionId;
    const first = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    p.setPrompt((command) => p.emitBatch([
      { type: "response", id: command.id, command: "prompt", success: true },
      { type: "message_start", messageId: "known-old-without-native" },
      { type: "prompt_result", id: command.id, status: "completed", sessionSettled: true },
    ]));
    await p.connection.prompt({ sessionId: first.sessionId, prompt: [{ type: "text", text: "old" }] });
    delete p.state.sessionId;
    const current = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    const message = { role: "assistant", provider: "fixture", model: "model",
      usage: { input: 3, output: 2, cacheRead: 0, cacheWrite: 0 } };
    p.setPrompt((command) => p.emitBatch([
      { type: "response", id: command.id, command: "prompt", success: true },
      { type: "message_end", messageId: "known-old-without-native", message },
      { type: "message_end", sessionId: "unverifiable-native-id", messageId: "fresh-without-native", message },
      { type: "prompt_result", id: command.id, status: "completed", sessionSettled: true },
    ]));
    await expect(p.connection.prompt({ sessionId: current.sessionId, prompt: [{ type: "text", text: "current" }] }))
      .resolves.toEqual({ stopReason: "end_turn" });
    expect(p.usages).toHaveLength(1);
    expect(p.usages[0]?.modelUsage?.["fixture/model"]).toMatchObject({ inputTokens: 3, outputTokens: 2 });
  });

  it.each(["messageId", "responseId"] as const)("does not confuse an old %s with an unassociated fresh ID in the other namespace", async (oldKind) => {
    const p = peer();
    peers.push(p);
    const first = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    p.setPrompt((command) => p.emitBatch([
      { type: "response", id: command.id, command: "prompt", success: true },
      { type: "message_start", ...(oldKind === "messageId" ? { messageId: "same-string" } : { message: { responseId: "same-string" } }) },
      { type: "prompt_result", id: command.id, status: "completed", sessionSettled: true },
    ]));
    await p.connection.prompt({ sessionId: first.sessionId, prompt: [{ type: "text", text: "old" }] });
    const current = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    const message = { role: "assistant", provider: "fixture", model: "model",
      ...(oldKind === "messageId" ? { responseId: "same-string" } : {}),
      usage: { input: 3, output: 2, cacheRead: 0, cacheWrite: 0 } };
    p.setPrompt((command) => p.emitBatch([
      { type: "response", id: command.id, command: "prompt", success: true },
      { type: "message_end", ...(oldKind === "responseId" ? { messageId: "same-string" } : {}), message },
      { type: "prompt_result", id: command.id, status: "completed", sessionSettled: true },
    ]));
    await expect(p.connection.prompt({ sessionId: current.sessionId, prompt: [{ type: "text", text: "fresh" }] }))
      .resolves.toEqual({ stopReason: "end_turn" });
    expect(p.usages).toHaveLength(1);
    expect(p.usages[0]?.modelUsage?.["fixture/model"]).toMatchObject({ inputTokens: 3, outputTokens: 2 });
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

  describe.each([
    { status: "completed", stopReason: "end_turn", cancelResult: "done" },
    { status: "aborted", stopReason: "cancelled", cancelResult: "done" },
    { status: "error", stopReason: "error", cancelResult: "error" },
  ])("late cancel after $status settlement", ({ status, stopReason, cancelResult }) => {
    it.each(["prompt_result", "session_settled"] as const)(
      "skips abort after native settlement via %s while notifications drain",
      async (settlement) => {
        const p = peer();
        peers.push(p);
        const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
        const updateStarted = deferred<void>();
        const drain = deferred<void>();
        const order: string[] = [];
        p.setUpdate(async () => {
          updateStarted.resolve(undefined);
          await drain.promise;
          order.push("update");
        });
        p.setPrompt((command) => {
          p.emitBatch([
            { type: "response", id: command.id, command: "prompt", success: true },
            { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "last" } },
            { type: "prompt_result", id: command.id, status, sessionSettled: settlement === "prompt_result" },
            ...(settlement === "session_settled" ? [{ type: "session_settled" }] : []),
          ]);
        });
        p.setAbort((command) => {
          p.emit({ type: "response", id: command.id, command: "abort", success: false, error: "Already settled" });
        });
        const request = { sessionId: session.sessionId, prompt: [{ type: "text" as const, text: "late cancel" }] };
        const prompt = p.connection.prompt(request).then(
          (result) => { order.push("prompt"); return result.stopReason; },
          () => { order.push("prompt"); return "error"; },
        );
        await updateStarted.promise;
        const cancellation = p.connection.cancel({ sessionId: session.sessionId }).then(
          () => { order.push("cancel"); return "done"; },
          () => { order.push("cancel"); return "error"; },
        );
        try {
          await new Promise<void>((resolve) => setImmediate(resolve));
          expect(p.received.filter((command) => command.type === "abort")).toEqual([]);
          expect(order).toEqual([]);
          await expect(p.connection.prompt(request)).rejects.toThrow("active");
          await expect(p.connection.newSession({ cwd: "/work", mcpServers: [] })).rejects.toThrow("active");
        } finally {
          drain.resolve(undefined);
        }
        await expect(prompt).resolves.toBe(stopReason);
        await expect(cancellation).resolves.toBe(cancelResult);
        expect(order).toEqual(["update", "prompt", "cancel"]);
        expect(p.failures).toEqual([]);
        await expect(p.connection.newSession({ cwd: "/work", mcpServers: [] })).resolves.toHaveProperty("sessionId");
      },
    );
  });

  describe.each(["completed", "aborted", "error"] as const)("cancel settlement for %s", (status) => {
    it.each(["before cancel", "before ACK", "after ACK", "settled before ACK"] as const)(
      "waits for native settlement and notification drain with terminal %s",
      async (timing) => {
        const p = peer();
        peers.push(p);
        const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
        const promptStarted = deferred<Record<string, unknown>>();
        const abortStarted = deferred<Record<string, unknown>>();
        p.setPrompt((command) => {
          p.emit({ type: "response", id: command.id, command: "prompt", success: true });
          promptStarted.resolve(command);
        });
        p.setAbort((command) => { abortStarted.resolve(command); });
        const request = { sessionId: session.sessionId, prompt: [{ type: "text" as const, text: "wait" }] };
        const order: string[] = [];
        const prompt = p.connection.prompt(request).then(
          (result) => { order.push("prompt"); return result.stopReason; },
          () => { order.push("prompt"); return "error"; },
        );
        const command = await promptStarted.promise;
        const terminal = { type: "prompt_result", id: command.id, status, sessionSettled: false };
        if (timing === "before cancel") {
          p.emit(terminal);
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        const cancellation = p.connection.cancel({ sessionId: session.sessionId }).then(
          () => { order.push("cancel"); return "done"; },
          () => { order.push("cancel"); return "error"; },
        );
        const abort = await abortStarted.promise;
        if (timing !== "before cancel" && timing !== "after ACK") p.emit(terminal);
        if (timing === "settled before ACK") {
          p.emit({ type: "session_settled" });
          await new Promise<void>((resolve) => setImmediate(resolve));
          expect(order).toEqual([]);
        }
        p.emit({ type: "response", id: abort.id, command: "abort", success: true });
        if (timing === "after ACK") {
          await new Promise<void>((resolve) => setImmediate(resolve));
          p.emit(terminal);
        }
        if (timing !== "settled before ACK") {
          await new Promise<void>((resolve) => setImmediate(resolve));
          expect(order).toEqual([]);
          const sent = p.received.length;
          await expect(p.connection.prompt(request)).rejects.toThrow("active");
          const switchRequest = { sessionId: session.sessionId, cwd: "/work", mcpServers: [] };
          await expect(p.connection.newSession(switchRequest)).rejects.toThrow("active");
          await expect(p.connection.loadSession(switchRequest)).rejects.toThrow("active");
          await expect(p.connection.resumeSession(switchRequest)).rejects.toThrow("active");
          expect(p.received).toHaveLength(sent);
          const updateStarted = deferred<void>();
          const drain = deferred<void>();
          p.setUpdate(async () => {
            updateStarted.resolve(undefined);
            await drain.promise;
            order.push("update");
          });
          p.setUsage(() => { order.push("usage"); });
          p.emitBatch([
            { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "last" } },
            {
              type: "message_end",
              messageId: "last",
              message: {
                role: "assistant", provider: "fixture", model: "model",
                usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
              },
            },
            { type: "session_settled" },
          ]);
          await updateStarted.promise;
          await expect(p.connection.prompt(request)).rejects.toThrow("active");
          expect(order).toEqual([]);
          drain.resolve(undefined);
        }
        await expect(prompt).resolves.toBe(status === "completed" ? "end_turn" : status === "aborted" ? "cancelled" : "error");
        await expect(cancellation).resolves.toBe(status === "error" ? "error" : "done");
        expect(order).toEqual(timing === "settled before ACK" ? ["prompt", "cancel"] : ["update", "usage", "prompt", "cancel"]);
        expect(p.failures).toEqual([]);
        await expect(p.connection.newSession({ cwd: "/work", mcpServers: [] })).resolves.toHaveProperty("sessionId");
      },
    );
  });

  describe.each(["rejected", "transport failure"] as const)("abort %s", (failure) => {
    it.each(["no terminal", "unsettled terminal", "settled terminal"] as const)(
      "closes the connection and refuses replacement work with %s",
      async (terminal) => {
        const p = peer();
        peers.push(p);
        const directory = await mkdtemp(join(tmpdir(), "omp-abort-failure-test-"));
        directories.push(directory);
        p.state.sessionFile = join(directory, "existing.jsonl");
        await writeFile(p.state.sessionFile, '{"type":"session"}\n');
        const session = await p.connection.newSession({ cwd: directory, mcpServers: [] });
        const promptStarted = deferred<Record<string, unknown>>();
        const abortStarted = deferred<Record<string, unknown>>();
        p.setPrompt((command) => {
          p.emit({ type: "response", id: command.id, command: "prompt", success: true });
          promptStarted.resolve(command);
        });
        p.setAbort((command) => { abortStarted.resolve(command); });
        const request = { sessionId: session.sessionId, prompt: [{ type: "text" as const, text: "running" }] };
        const prompt = p.connection.prompt(request).then(
          () => "resolved",
          () => "rejected",
        );
        const command = await promptStarted.promise;
        const cancellation = p.connection.cancel({ sessionId: session.sessionId });
        const cancelled = expect(cancellation).rejects.toThrow();
        const abort = await abortStarted.promise;
        if (terminal !== "no terminal") {
          p.emit({ type: "prompt_result", id: command.id, status: "completed", sessionSettled: terminal === "settled terminal" });
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        if (failure === "rejected") {
          p.emit({ type: "response", id: abort.id, command: "abort", success: false, error: "fixture-secret" });
        } else {
          p.close();
        }
        await cancelled;
        await expect(prompt).resolves.toBe("rejected");
        expect(p.failures).toHaveLength(1);
        expect(p.failures[0]?.message).not.toContain("fixture-secret");
        const sent = p.received.length;
        await expect(p.connection.prompt(request)).rejects.toThrow();
        const switchRequest = { sessionId: session.sessionId, cwd: directory, mcpServers: [] };
        await expect(p.connection.loadSession(switchRequest)).rejects.toThrow();
        await expect(p.connection.resumeSession(switchRequest)).rejects.toThrow();
        await expect(p.connection.newSession(switchRequest)).rejects.toThrow();
        expect(p.received).toHaveLength(sent);
      },
    );
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
  it.each([
    ["load", "missing"], ["load", "empty"], ["load", "directory"],
    ["resume", "missing"], ["resume", "empty"], ["resume", "directory"],
  ] as const)("invalid %s session switch (%s) invalidates the previous ACP identity", async (operation, kind) => {
    const p = peer();
    peers.push(p);
    const previous = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    const directory = await mkdtemp(join(tmpdir(), "omp-invalid-switch-test-"));
    directories.push(directory);
    const target = kind === "directory" ? directory : join(directory, `${kind}.jsonl`);
    if (kind === "empty") await writeFile(target, "");
    const request = { sessionId: target, cwd: "/work", mcpServers: [] };
    const changed = operation === "load" ? p.connection.loadSession(request) : p.connection.resumeSession(request);
    await expect(changed).rejects.toThrow();
    expect(p.received.some((command) => command.type === "switch_session")).toBe(false);
    await expect(p.connection.prompt({ sessionId: previous.sessionId, prompt: [{ type: "text", text: "old identity" }] }))
      .rejects.toThrow("identity");
    expect(p.received.some((command) => command.type === "prompt")).toBe(false);
  });

  it.each([
    ["new", "rejected"], ["new", "cancelled"],
    ["load", "rejected"], ["load", "cancelled"],
    ["resume", "rejected"], ["resume", "cancelled"],
  ] as const)("failed %s session switch (%s) stays closed until a fresh session is verified", async (operation, failure) => {
    const p = peer();
    peers.push(p);
    const previous = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    const directory = await mkdtemp(join(tmpdir(), "omp-failed-switch-test-"));
    directories.push(directory);
    const target = join(directory, "replacement.jsonl");
    await writeFile(target, '{"type":"session"}\n');
    const started = deferred<Record<string, unknown>>();
    p.setSessionChange((command) => started.resolve(command));
    const request = { sessionId: target, cwd: "/work", mcpServers: [] };
    const changed = operation === "new" ? p.connection.newSession(request)
      : operation === "load" ? p.connection.loadSession(request) : p.connection.resumeSession(request);
    const command = await started.promise;
    const oldPrompt = { sessionId: previous.sessionId, prompt: [{ type: "text" as const, text: "old identity" }] };
    await expect(p.connection.prompt(oldPrompt)).rejects.toThrow("active");
    const rejected = expect(changed).rejects.toThrow(failure === "rejected" ? "OMP RPC command failed" : "cancelled");
    p.emit({
      type: "response", id: command.id, command: command.type,
      success: failure !== "rejected", data: { cancelled: true },
    });
    await rejected;
    await expect(p.connection.prompt(oldPrompt)).rejects.toThrow("identity");
    expect(p.received.some((command) => command.type === "prompt")).toBe(false);
    p.emitBatch([
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "stale text" } },
      {
        type: "message_end", messageId: "stale-message",
        message: {
          role: "assistant", provider: "fixture", model: "model",
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
        },
      },
    ]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(p.updates).toEqual([]);
    expect(p.usages).toEqual([]);

    p.setSessionChange((next) => p.emit({
      type: "response", id: next.id, command: next.type, success: true, data: { cancelled: false },
    }));
    p.state.sessionFile = target;
    const fresh = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    expect(fresh.sessionId).toBe(target);
    await expect(p.connection.prompt(oldPrompt)).rejects.toThrow("identity");
    await expect(p.connection.prompt({ ...oldPrompt, sessionId: fresh.sessionId })).resolves.toEqual({ stopReason: "end_turn" });
    expect(p.updates).toEqual([{
      sessionId: target,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } },
    }]);
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
