import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
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
    sessionName?: string;
  };
  models: { provider: string; id: string; name: string }[];
  received: Record<string, unknown>[];
  updates: acp.SessionNotification[];
  usages: SessionUsageUpdate[];
  failures: Error[];
  reply(command: Record<string, unknown>, data?: unknown): void;
  setState(handler: (command: Record<string, unknown>) => void): void;
  setModels(handler: (command: Record<string, unknown>) => void): void;
  setModel(handler: (command: Record<string, unknown>) => void): void;
  setFork(handler: (command: Record<string, unknown>) => void): void;
  setName(handler: (command: Record<string, unknown>) => void): void;
  setPrompt(handler: (command: Record<string, unknown>) => void): void;
  setAbort(handler: (command: Record<string, unknown>) => void): void;
  setSessionChange(handler: (command: Record<string, unknown>) => void): void;
  setStats(handler: (command: Record<string, unknown>) => void): void;
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
  const state: Peer["state"] = {
    sessionFile: "/tmp/omp-session.jsonl",
    sessionId: "native-omp-session",
    thinkingLevel: "high",
    model: { provider: "fixture", id: "model", name: "Fixture" },
    sessionName: "Previous user title",
  };
  const models = [
    state.model,
    { provider: "other", id: "family/x", name: "Fixture" },
    { provider: "org/branch", id: "leaf", name: "Branch" },
  ];
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
  let onStats = (command: Record<string, unknown>) => {
    reply(command, { sessionFile: state.sessionFile });
  };
  let onState = (command: Record<string, unknown>) => { reply(command, state); };
  let onModels = (command: Record<string, unknown>) => { reply(command, { models }); };
  let onModel = (command: Record<string, unknown>) => {
    const selected = models.find((model) => model.provider === command.provider && model.id === command.modelId);
    if (!selected) {
      emit({ type: "response", id: command.id, command: command.type, success: false });
      return;
    }
    state.model = selected;
    reply(command, selected);
  };
  let onFork = (command: Record<string, unknown>) => { reply(command, { cancelled: false }); };
  let onName = (command: Record<string, unknown>) => {
    const name = String(command.name).replace(/\p{Cc}/gu, " ").replace(/ +/g, " ").trim();
    if (!name) {
      emit({ type: "response", id: command.id, command: command.type, success: false });
      return;
    }
    state.sessionName = name;
    emit({ type: "response", id: command.id, command: command.type, success: true });
  };
  const writable = new WritableStream<Uint8Array>({
    write(bytes) {
      const command = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
      received.push(command);
      switch (command.type) {
        case "get_state":
          onState(command);
          break;
        case "get_available_models":
          onModels(command);
          break;
        case "set_model":
          onModel(command);
          break;
        case "fork":
          onFork(command);
          break;
        case "set_session_name":
          onName(command);
          break;
        case "get_session_stats":
          onStats(command);
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
    models,
    reply,
    setState(handler: (command: Record<string, unknown>) => void) { onState = handler; },
    setModels(handler: (command: Record<string, unknown>) => void) { onModels = handler; },
    setModel(handler: (command: Record<string, unknown>) => void) { onModel = handler; },
    setFork(handler: (command: Record<string, unknown>) => void) { onFork = handler; },
    setName(handler: (command: Record<string, unknown>) => void) { onName = handler; },
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
    setStats(handler: (command: Record<string, unknown>) => void) {
      onStats = handler;
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

  it.each(["new", "load", "resume"] as const)("accepts non-empty lody stdio MCP for %s without forwarding it", async (operation) => {
    const p = peer();
    peers.push(p);
    const directory = await mkdtemp(join(tmpdir(), "omp-mcp-session-test-"));
    directories.push(directory);
    const nativeSession = join(directory, "native-session.jsonl");
    await writeFile(nativeSession, '{"type":"session"}\n');
    p.state.sessionFile = nativeSession;
    const request = {
      cwd: directory,
      sessionId: nativeSession,
      mcpServers: [{
        name: "lody",
        command: "synthetic-lody-mcp",
        args: ["--stdio"],
        env: [{ name: "SYNTHETIC_MCP_TOKEN", value: "not-a-real-secret" }],
      }],
    };
    const result = operation === "new"
      ? await p.connection.newSession({ cwd: directory, mcpServers: request.mcpServers })
      : operation === "load"
        ? await p.connection.loadSession(request)
        : await p.connection.resumeSession(request);
    if (operation !== "load") expect(result).toHaveProperty("sessionId", nativeSession);
    await expect(p.connection.prompt({
      sessionId: nativeSession,
      prompt: [{ type: "text", text: "synthetic MCP session" }],
    })).resolves.toEqual({ stopReason: "end_turn" });
    expect(p.updates).toEqual([{
      sessionId: nativeSession,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } },
    }]);
    expect(p.received.map(({ id, ...command }) => command)).toEqual([
      operation === "new" ? { type: "new_session" } : { type: "switch_session", sessionPath: nativeSession },
      { type: "get_state" },
      { type: "get_available_models" },
      { type: "get_state" },
      { type: "prompt", message: "synthetic MCP session" },
    ]);
  });

  it("preserves text joining and inline image order without rewriting data or mimeType", async () => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    await expect(p.connection.prompt({
      sessionId: session.sessionId,
      prompt: [
        { type: "text", text: "  first\n" },
        { type: "image", data: "AAEC/w==", mimeType: "image/x-synthetic", uri: "file:///never-read-this-image" },
        { type: "text", text: "" },
        { type: "image", data: "aW1hZ2UtdHdv", mimeType: "image/svg+xml", uri: "https://invalid.example/never-fetch" },
        { type: "text", text: "last  " },
      ],
    })).resolves.toEqual({ stopReason: "end_turn" });
    const command = p.received.find((value) => value.type === "prompt");
    expect(command).toEqual({
      id: expect.any(String), type: "prompt", message: "  first\n\n\n\n\nlast  ",
      images: [
        { type: "image", data: "AAEC/w==", mimeType: "image/x-synthetic" },
        { type: "image", data: "aW1hZ2UtdHdv", mimeType: "image/svg+xml" },
      ],
    });
    expect(p.updates).toContainEqual({
      sessionId: session.sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } },
    });
  });

  it("submits image-only input with an empty native message", async () => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    await expect(p.connection.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "image", data: "c3ludGhldGlj", mimeType: "image/x-fixture" }],
    })).resolves.toEqual({ stopReason: "end_turn" });
    expect(p.received.find((value) => value.type === "prompt")).toEqual({
      id: expect.any(String), type: "prompt", message: "",
      images: [{ type: "image", data: "c3ludGhldGlj", mimeType: "image/x-fixture" }],
    });
  });

  it("keeps the existing text-only payload and blank-block joining without an images field", async () => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    await expect(p.connection.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "first" }, { type: "text", text: "" }, { type: "text", text: "last" }],
    })).resolves.toEqual({ stopReason: "end_turn" });
    expect(p.received.find((value) => value.type === "prompt")).toEqual({
      id: expect.any(String), type: "prompt", message: "first\n\n\n\nlast",
    });
  });

  it.each([
    { type: "audio", data: "c291bmQ=", mimeType: "audio/wav" },
    { type: "resource", resource: { uri: "file:///synthetic-context", text: "embedded context" } },
    { type: "resource_link", uri: "https://invalid.example/context", name: "synthetic context" },
  ] satisfies acp.ContentBlock[])("rejects a mixed $type request atomically and remains usable", async (unsupported) => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    await expect(p.connection.prompt({
      sessionId: session.sessionId,
      prompt: [
        { type: "text", text: "must not be sent first" },
        { type: "image", data: "AAEC", mimeType: "image/png" },
        unsupported,
      ],
    })).rejects.toThrow();
    expect(p.received.filter((value) => value.type === "prompt")).toEqual([]);
    expect(p.updates).toEqual([]);
    await expect(p.connection.prompt({
      sessionId: session.sessionId, prompt: [{ type: "text", text: "after rejection" }],
    })).resolves.toEqual({ stopReason: "end_turn" });
    expect(p.received.find((value) => value.type === "prompt")).toEqual({
      id: expect.any(String), type: "prompt", message: "after rejection",
    });
  });

  it("surfaces native image refusal without a text fallback and permits the next prompt", async () => {
    const p = peer();
    peers.push(p);
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    p.setPrompt((command) => {
      p.emit({
        type: "response", id: command.id, command: "prompt", success: false,
        error: "synthetic model does not support image input",
      });
    });
    await expect(p.connection.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "do not retry as text" }, { type: "image", data: "AAEC", mimeType: "image/png" }],
    })).rejects.toThrow();
    expect(p.received).toContainEqual({
      id: expect.any(String), type: "prompt", message: "do not retry as text",
      images: [{ type: "image", data: "AAEC", mimeType: "image/png" }],
    });
    for (const command of p.received.filter((value) => value.type === "prompt")) {
      expect(command).toMatchObject({
        message: "do not retry as text", images: [{ type: "image", data: "AAEC", mimeType: "image/png" }],
      });
    }
    p.setPrompt((command) => {
      p.emit({ type: "response", id: command.id, command: "prompt", success: true, data: {} });
      p.emit({ type: "prompt_result", id: command.id, status: "completed", sessionSettled: true });
    });
    await expect(p.connection.prompt({
      sessionId: session.sessionId, prompt: [{ type: "text", text: "continue without image" }],
    })).resolves.toEqual({ stopReason: "end_turn" });
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
  describe("013 held root yield", () => {
    async function heldPrompt(initialStatus = "completed") {
      const p = peer();
      peers.push(p);
      const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
      p.setPrompt((command) => {
        p.emitBatch([
          { type: "response", id: command.id, command: "prompt", success: true },
          { type: "prompt_result", id: command.id, status: initialStatus, sessionSettled: false },
        ]);
      });
      const request = { sessionId: session.sessionId, prompt: [{ type: "text" as const, text: "held root" }] };
      let settled = false;
      const outcome = p.connection.prompt(request).then(
        (result) => {
          settled = true;
          return { kind: "resolved" as const, result };
        },
        (error: unknown) => {
          settled = true;
          return { kind: "rejected" as const, error };
        },
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      return { p, request, outcome, isSettled: () => settled };
    }

    it.each(["error", "aborted"] as const)("propagates later root %s after settlement", async (stopReason) => {
      const { p, request, outcome, isSettled } = await heldPrompt();
      p.emit({
        type: "agent_end", yielded: true, isTerminal: false, awaitingAsyncWork: true,
        messages: [{ role: "assistant", stopReason }],
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(isSettled()).toBe(false);
      const commandsBefore = p.received.slice();
      await expect(p.connection.prompt(request)).rejects.toBeInstanceOf(Error);
      expect(p.received).toEqual(commandsBefore);
      expect(isSettled()).toBe(false);
      p.emit({ type: "session_settled" });
      await expect(outcome).resolves.toEqual(stopReason === "error"
        ? { kind: "rejected", error: expect.any(Error) }
        : { kind: "resolved", result: { stopReason: "cancelled" } });
    });

    it.each([
      { initial: "completed", reasons: ["error", "stop"], expected: "error" },
      { initial: "completed", reasons: ["error", "aborted", "stop"], expected: "error" },
      { initial: "completed", reasons: ["aborted", "error", "stop"], expected: "error" },
      { initial: "completed", reasons: ["aborted", "stop"], expected: "cancelled" },
      { initial: "error", reasons: ["stop"], expected: "error" },
      { initial: "aborted", reasons: ["stop"], expected: "cancelled" },
    ])("preserves $initial through $reasons as $expected", async ({ initial, reasons, expected }) => {
      const { p, outcome } = await heldPrompt(initial);
      p.emitBatch([
        ...reasons.map((stopReason) => ({
          type: "agent_end", yielded: true, messages: [{ role: "assistant", stopReason }],
        })),
        { type: "session_settled" },
      ]);
      await expect(outcome).resolves.toEqual(expected === "error"
        ? { kind: "rejected", error: expect.any(Error) }
        : { kind: "resolved", result: { stopReason: expected } });
    });

    it("ignores a non-yielded retry error and reads only the last assistant at the final yield", async () => {
      const { p, outcome, isSettled } = await heldPrompt();
      p.emit({
        type: "agent_end", yielded: false, isTerminal: false,
        messages: [{ role: "assistant", stopReason: "error" }],
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(isSettled()).toBe(false);
      p.emitBatch([
        { type: "agent_end", yielded: true, messages: [
          { role: "assistant", stopReason: "error" },
          { role: "assistant", stopReason: "stop" },
          { role: "toolResult", toolCallId: "old-tool", content: [], isError: false },
        ] },
        { type: "session_settled" },
      ]);
      await expect(outcome).resolves.toEqual({ kind: "resolved", result: { stopReason: "end_turn" } });
    });

    it("isolates non-current, child, foreign-session and independent-task outcomes", async () => {
      const { p, outcome, isSettled } = await heldPrompt();
      p.emitBatch([
        { type: "agent_end", messages: [{ role: "assistant", stopReason: "error" }] },
        { type: "agent_end", sessionId: "different-session", yielded: true,
          messages: [{ role: "assistant", stopReason: "error" }] },
        { type: "subagent_event", payload: { id: "child", event: {
          type: "agent_end", yielded: true, messages: [{ role: "assistant", stopReason: "error" }],
        } } },
        { type: "subagent_event", payload: { id: "child", event: {
          type: "agent_end", yielded: true, messages: [{ role: "assistant", stopReason: "aborted" }],
        } } },
        { type: "subagent_progress", payload: { progress: { id: "child", status: "failed" } } },
        { type: "tool_execution_update", toolCallId: "background-bash", toolName: "bash",
          partialResult: { content: [{ type: "text", text: "independent job failed" }],
            details: { async: { state: "failed", jobId: "background-job", type: "bash" } } } },
      ]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(isSettled()).toBe(false);
      p.emitBatch([
        { type: "agent_end", yielded: true, messages: [{ role: "assistant", stopReason: "stop" }] },
        { type: "session_settled" },
      ]);
      await expect(outcome).resolves.toEqual({ kind: "resolved", result: { stopReason: "end_turn" } });
    });

    it.each([
      { label: "stop", messages: [{ role: "assistant", stopReason: "stop" }] },
      { label: "length", messages: [{ role: "assistant", stopReason: "length" }] },
      { label: "toolUse", messages: [{ role: "assistant", stopReason: "toolUse" }] },
      { label: "empty messages", messages: [] },
      { label: "no assistant", messages: [{ role: "user", content: "local input" }] },
    ])("accepts legal $label without bypassing settlement", async ({ messages }) => {
      const { p, outcome, isSettled } = await heldPrompt();
      p.emit({ type: "agent_end", yielded: true, messages });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(isSettled()).toBe(false);
      p.emit({ type: "session_settled" });
      await expect(outcome).resolves.toEqual({ kind: "resolved", result: { stopReason: "end_turn" } });
    });

    it.each([
      { label: "unknown stopReason", fields: { messages: [{ role: "assistant", stopReason: "future_reason" }] } },
      { label: "missing stopReason", fields: { messages: [{ role: "assistant" }] } },
      { label: "non-string stopReason", fields: { messages: [{ role: "assistant", stopReason: ["stop"] }] } },
      { label: "missing messages", fields: {} },
      { label: "non-array messages", fields: { messages: { role: "assistant", stopReason: "stop" } } },
    ])("fails safely for $label instead of defaulting to completed", async ({ fields }) => {
      const { p, outcome } = await heldPrompt();
      p.emitBatch([
        { type: "agent_end", yielded: true, ...fields },
        { type: "session_settled" },
      ]);
      await expect(outcome).resolves.toEqual({ kind: "rejected", error: expect.any(Error) });
    });

    it.each(["same batch", "split"] as const)("fails for invalid yielded with %s settlement", async (timing) => {
      const { p, outcome } = await heldPrompt();
      try {
        if (timing === "same batch") {
          p.emitBatch([
            { type: "agent_end", yielded: "true", messages: [] },
            { type: "session_settled" },
          ]);
        } else {
          p.emit({ type: "agent_end", yielded: "true", messages: [] });
          await new Promise<void>((resolve) => setImmediate(resolve));
          if (p.failures.length === 0) p.emit({ type: "session_settled" });
        }
        await expect(outcome).resolves.toEqual({ kind: "rejected", error: expect.any(Error) });
      } finally {
        p.close();
        await outcome;
      }
    });

    it("fails for invalid yielded while abort ACK follows settlement", async () => {
      const { p, request, outcome } = await heldPrompt();
      const abortStarted = deferred<Record<string, unknown>>();
      p.setAbort((command) => { abortStarted.resolve(command); });
      const cancellation = p.connection.cancel({ sessionId: request.sessionId }).then(
        () => ({ kind: "resolved" as const }),
        (error: unknown) => ({ kind: "rejected" as const, error }),
      );
      try {
        const abort = await abortStarted.promise;
        expect(p.received.some((command) => command.type === "abort" && command.id === abort.id)).toBe(true);
        p.emitBatch([
          { type: "agent_end", yielded: "true", messages: [] },
          { type: "session_settled" },
        ]);
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (p.failures.length === 0) {
          p.emit({ type: "response", id: abort.id, command: "abort", success: true });
        }
        await expect(outcome).resolves.toEqual({ kind: "rejected", error: expect.any(Error) });
        await expect(cancellation).resolves.toEqual({ kind: "rejected", error: expect.any(Error) });
      } finally {
        p.close();
        await Promise.all([outcome, cancellation]);
      }
    });

    it.each([
      { label: "invalid isTerminal", fields: { isTerminal: "true", messages: [] } },
      { label: "non-array messages", fields: { messages: {} } },
      { label: "unknown stopReason", fields: { messages: [{ role: "assistant", stopReason: "future_reason" }] } },
      { label: "missing assistant", fields: { messages: [] } },
      { label: "valid assistant error", fields: { messages: [{ role: "assistant", stopReason: "error" }] } },
    ])("retains legacy $label failure against a later current completion", async ({ fields }) => {
      const p = peer();
      peers.push(p);
      const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
      const request = { sessionId: session.sessionId, prompt: [{ type: "text" as const, text: "legacy error" }] };
      p.setPrompt((command) => {
        p.emitBatch([
          { type: "response", id: command.id, command: "prompt", success: true },
          { type: "agent_end", ...fields },
          { type: "prompt_result", id: command.id, status: "completed", sessionSettled: true },
        ]);
      });
      const outcome = p.connection.prompt(request).then(
        (result) => ({ kind: "resolved" as const, result }),
        (error: unknown) => ({ kind: "rejected" as const, error }),
      );
      try {
        await expect(outcome).resolves.toEqual({ kind: "rejected", error: expect.any(Error) });
        expect(p.failures).toEqual([]);
        p.setPrompt((command) => {
          p.emitBatch([
            { type: "response", id: command.id, command: "prompt", success: true },
            { type: "prompt_result", id: command.id, status: "completed", sessionSettled: true },
          ]);
        });
        await expect(p.connection.prompt(request)).resolves.toEqual({ stopReason: "end_turn" });
      } finally {
        p.close();
        await outcome;
      }
    });

    it("preserves native legacy abort against same-chunk completed without a cancel request", async () => {
      const p = peer();
      peers.push(p);
      const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
      const request = { sessionId: session.sessionId, prompt: [{ type: "text" as const, text: "native aborted" }] };
      p.setPrompt((command) => {
        p.emitBatch([
          { type: "response", id: command.id, command: "prompt", success: true, data: {} },
          { type: "agent_end", messages: [{ role: "assistant", stopReason: "aborted" }] },
          { type: "prompt_result", id: command.id, status: "completed", sessionSettled: true },
        ]);
      });
      const outcome = p.connection.prompt(request).then(
        (result) => ({ kind: "resolved" as const, result }),
        (error: unknown) => ({ kind: "rejected" as const, error }),
      );
      try {
        await expect(outcome).resolves.toEqual({ kind: "resolved", result: { stopReason: "cancelled" } });
        expect(p.received.some((command) => command.type === "abort")).toBe(false);
        expect(p.failures).toEqual([]);
        p.setPrompt((command) => {
          p.emitBatch([
            { type: "response", id: command.id, command: "prompt", success: true },
            { type: "prompt_result", id: command.id, status: "completed", sessionSettled: true },
          ]);
        });
        await expect(p.connection.prompt(request)).resolves.toEqual({ stopReason: "end_turn" });
      } finally {
        p.close();
        await outcome;
      }
    });

    it.each(["ACK first", "drain first"] as const)("preserves native legacy abort with %s before delivery", async (timing) => {
      const p = peer();
      peers.push(p);
      const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
      const request = { sessionId: session.sessionId, prompt: [{ type: "text" as const, text: "native aborted" }] };
      let promptCommand: Record<string, unknown> | undefined;
      let abortCommand: Record<string, unknown> | undefined;
      p.setPrompt((command) => {
        promptCommand = command;
        p.emit({ type: "response", id: command.id, command: "prompt", success: true, data: {} });
      });
      p.setAbort((command) => { abortCommand = command; });
      const drain = deferred<void>();
      const delivered: string[] = [];
      p.setUpdate(async () => {
        await drain.promise;
        delivered.push("native notification");
      });
      let completed = false;
      const outcome = p.connection.prompt(request).then(
        (result) => { completed = true; return { kind: "resolved" as const, result }; },
        (error: unknown) => { completed = true; return { kind: "rejected" as const, error }; },
      );
      let cancellation: Promise<unknown> | undefined;
      try {
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (!promptCommand) throw new Error("Native prompt was not dispatched");
        cancellation = p.connection.cancel({ sessionId: request.sessionId }).then(
          () => ({ kind: "resolved" as const, result: undefined }),
          (error: unknown) => ({ kind: "rejected" as const, error }),
        );
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (!abortCommand) throw new Error("Native abort was not dispatched");
        p.emitBatch([
          { type: "message_update", messageId: "legacy-abort-drain",
            assistantMessageEvent: { type: "text_delta", delta: "native notification" } },
          { type: "agent_end", messages: [{ role: "assistant", stopReason: "aborted" }] },
          { type: "prompt_result", id: promptCommand.id, status: "completed", sessionSettled: true },
        ]);
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(completed).toBe(false);
        expect(delivered).toEqual([]);
        if (timing === "ACK first") {
          p.emit({ type: "response", id: abortCommand.id, command: "abort", success: true });
        } else {
          drain.resolve(undefined);
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(completed).toBe(false);
        if (timing === "ACK first") drain.resolve(undefined);
        else p.emit({ type: "response", id: abortCommand.id, command: "abort", success: true });
        await expect(outcome).resolves.toEqual({ kind: "resolved", result: { stopReason: "cancelled" } });
        await expect(cancellation).resolves.toEqual({ kind: "resolved", result: undefined });
        expect(delivered).toEqual(["native notification"]);
        expect(p.failures).toEqual([]);
        p.setPrompt((command) => {
          p.emitBatch([
            { type: "response", id: command.id, command: "prompt", success: true },
            { type: "prompt_result", id: command.id, status: "completed", sessionSettled: true },
          ]);
        });
        await expect(p.connection.prompt(request)).resolves.toEqual({ stopReason: "end_turn" });
      } finally {
        drain.resolve(undefined);
        p.close();
        await Promise.all([outcome, cancellation]);
      }
    });

    it("ignores disabled legacy validation fields after a verified current result", async () => {
      const { p, outcome } = await heldPrompt();
      p.emitBatch([
        { type: "agent_end", isTerminal: "legacy-only", messages: {} },
        { type: "agent_end", yielded: true, isTerminal: "legacy-only",
          messages: [{ role: "assistant", stopReason: "stop" }] },
        { type: "session_settled" },
      ]);
      await expect(outcome).resolves.toEqual({ kind: "resolved", result: { stopReason: "end_turn" } });
      expect(p.failures).toEqual([]);
    });

    it.each([
      { label: "missing messages", fields: {} },
      { label: "unknown stopReason", fields: { messages: [{ role: "assistant", stopReason: "future_reason" }] } },
    ])("retains malformed $label failure when settlement precedes abort ACK", async ({ fields }) => {
      const { p, request, outcome, isSettled } = await heldPrompt();
      const abortStarted = deferred<Record<string, unknown>>();
      p.setAbort((command) => { abortStarted.resolve(command); });
      const cancellation = p.connection.cancel({ sessionId: request.sessionId }).then(
        () => ({ kind: "resolved" as const }),
        (error: unknown) => ({ kind: "rejected" as const, error }),
      );
      try {
        const abort = await abortStarted.promise;
        expect(p.received.some((command) => command.type === "abort" && command.id === abort.id)).toBe(true);
        expect(isSettled()).toBe(false);
        p.emitBatch([
          { type: "agent_end", yielded: true, ...fields },
          { type: "session_settled" },
        ]);
        await new Promise<void>((resolve) => setImmediate(resolve));
        // A protocol-close may already have rejected the pending abort.
        // Otherwise release the deliberately withheld ACK only after finish microtasks.
        if (p.failures.length === 0) {
          p.emit({ type: "response", id: abort.id, command: "abort", success: true });
        }
        await expect(outcome).resolves.toEqual({ kind: "rejected", error: expect.any(Error) });
        await expect(cancellation).resolves.toEqual({ kind: "rejected", error: expect.any(Error) });
      } finally {
        p.close();
        await Promise.all([outcome, cancellation]);
      }
    });

    it.each([
      { reason: "error", expected: "error", lateReason: "stop" },
      { reason: "aborted", expected: "cancelled", lateReason: "error" },
      { reason: "stop", expected: "end_turn", lateReason: "error" },
    ])("freezes settled $reason while notifications drain and late cancel waits", async ({ reason, expected, lateReason }) => {
      const { p, request, outcome, isSettled } = await heldPrompt();
      const updateStarted = deferred<void>();
      const drain = deferred<void>();
      const order: string[] = [];
      p.setUpdate(async () => {
        updateStarted.resolve(undefined);
        await drain.promise;
        order.push("update");
      });
      p.setAbort((command) => {
        p.emit({ type: "response", id: command.id, command: "abort", success: false, error: "Already settled" });
      });
      p.emitBatch([
        { type: "message_update", messageId: "held-final", assistantMessageEvent: { type: "text_delta", delta: "final" } },
        { type: "agent_end", yielded: true, messages: [{ role: "assistant", stopReason: reason }] },
        { type: "session_settled" },
      ]);
      let cancellation: Promise<string> | undefined;
      try {
        await updateStarted.promise;
        await new Promise<void>((resolve) => setImmediate(resolve));
        p.emit({ type: "agent_end", yielded: true, messages: [{ role: "assistant", stopReason: lateReason }] });
        cancellation = p.connection.cancel({ sessionId: request.sessionId }).then(
          () => { order.push("cancel"); return "done"; },
          () => { order.push("cancel"); return "error"; },
        );
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(isSettled()).toBe(false);
        expect(order).toEqual([]);
        expect(p.received.some((command) => command.type === "abort")).toBe(false);
        const commandsBefore = p.received.slice();
        await expect(p.connection.prompt(request)).rejects.toBeInstanceOf(Error);
        expect(p.received).toEqual(commandsBefore);
        expect(isSettled()).toBe(false);
      } finally {
        drain.resolve(undefined);
      }
      const result = await outcome;
      expect(order[0]).toBe("update");
      expect(result).toEqual(expected === "error"
        ? { kind: "rejected", error: expect.any(Error) }
        : { kind: "resolved", result: { stopReason: expected } });
      await expect(cancellation).resolves.toBe(expected === "error" ? "error" : "done");
      expect(p.failures).toEqual([]);
    });

    it("does not retain an absorbed root error for the next prompt", async () => {
      const { p, request, outcome } = await heldPrompt();
      p.emitBatch([
        { type: "agent_end", yielded: true, messages: [{ role: "assistant", stopReason: "error" }] },
        { type: "session_settled" },
      ]);
      await expect(outcome).resolves.toEqual({ kind: "rejected", error: expect.any(Error) });
      p.setPrompt((command) => {
        p.emitBatch([
          { type: "response", id: command.id, command: "prompt", success: true },
          { type: "prompt_result", id: command.id, status: "completed", sessionSettled: false },
          { type: "agent_end", yielded: true, messages: [{ role: "assistant", stopReason: "stop" }] },
          { type: "session_settled" },
        ]);
      });
      await expect(p.connection.prompt(request)).resolves.toEqual({ stopReason: "end_turn" });
    });
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
  describe("014 post-local identity", () => {
    function observe<T>(promise: Promise<T>) {
      return promise.then(
        (value) => ({ kind: "resolved" as const, value }),
        (error: unknown) => ({ kind: "rejected" as const, error }),
      );
    }

    function statsReply(p: Peer, command: Record<string, unknown>, sessionFile: string) {
      p.emit({ type: "response", id: command.id, command: "get_session_stats", success: true, data: {
        sessionFile, tokens: { input: 9_000_000, output: 8_000_000 }, cost: 7_000_000,
        credits: 6_000_000, contextUsage: { tokens: 5_000_000 },
      } });
    }

    function normalAgent(p: Peer, usageInput?: number) {
      p.setPrompt((command) => {
        p.emitBatch([
          { type: "response", id: command.id, command: "prompt", success: true, data: { agentInvoked: true } },
          ...(usageInput === undefined ? [] : [{
            type: "message_end", messageId: `normal-${String(command.id)}`, message: {
              role: "assistant", provider: "fixture", model: "model",
              usage: { input: usageInput, output: 1, cacheRead: 0, cacheWrite: 0 },
            },
          }]),
          { type: "prompt_result", id: command.id, agentInvoked: true, status: "completed", sessionSettled: true },
        ]);
      });
    }

    async function identityPeer() {
      const p = peer();
      peers.push(p);
      const cwd = await mkdtemp(join(tmpdir(), "omp-local-identity-"));
      directories.push(cwd);
      const source = join(cwd, "A.jsonl");
      const target = join(cwd, "B.jsonl");
      await writeFile(source, '{"type":"session","id":"native-omp-session"}\n');
      p.state.sessionFile = source;
      p.setStats((command) => { statsReply(p, command, source); });
      const session = await p.connection.newSession({ cwd, mcpServers: [] });
      const request = { sessionId: session.sessionId, prompt: [{ type: "text" as const, text: "local operation" }] };
      return { p, cwd, source, target, request };
    }

    it.each([
      { label: "legacy ACK", carrier: "ACK", current: false },
      { label: "current ACK", carrier: "ACK", current: true },
      { label: "legacy result", carrier: "result", current: false },
      { label: "current result", carrier: "result", current: true },
    ])("rejects moved native file after $label without dispatching old A", async ({ carrier, current }) => {
      const { p, source, target, request } = await identityPeer();
      const nativeId = p.state.sessionId;
      let command: Record<string, unknown> | undefined;
      p.setPrompt((value) => { command = value; });
      // The stats identity is fixture-owned B, never copied from the query or ACP request.
      p.setStats((query) => { statsReply(p, query, target); });
      const start = p.received.length;
      const outcome = observe(p.connection.prompt(request));
      try {
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (!command) throw new Error("Native prompt was not dispatched");
        await rename(source, target);
        p.state.sessionFile = target;
        const local = { agentInvoked: false, ...(current ? { status: "completed", sessionSettled: true } : {}) };
        p.emitBatch([
          { type: "response", id: command.id, command: "prompt", success: true,
            data: carrier === "ACK" ? local : {} },
          ...(carrier === "result" ? [{ type: "prompt_result", id: command.id, ...local }] : []),
        ]);
        await expect(outcome).resolves.toEqual({ kind: "rejected", error: expect.any(Error) });
        expect(p.state.sessionId).toBe(nativeId);
        expect(p.received.slice(start).map((frame) => frame.type)).toEqual(["prompt", "get_session_stats"]);
        const commandsBefore = p.received.slice();
        await expect(p.connection.prompt(request)).rejects.toBeInstanceOf(Error);
        expect(p.received).toEqual(commandsBefore);
        expect(p.failures).toEqual([]);
        expect(p.usages).toEqual([]);
      } finally {
        p.close();
        await outcome;
      }
    });

    it("does not regress same-chunk settlement when a stale false ACK resumes after the result", async () => {
      const { p, source, request } = await identityPeer();
      let query: Record<string, unknown> | undefined;
      const markers: string[] = [];
      p.setStats((command) => { query = command; });
      p.setUpdate(async (notification) => {
        const update = notification.update;
        if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
          markers.push(update.content.text);
        }
      });
      p.setPrompt((command) => {
        const local = { agentInvoked: false, status: "completed", sessionSettled: false };
        p.emitBatch([
          { type: "response", id: command.id, command: "prompt", success: true, data: local },
          { type: "prompt_result", id: command.id, ...local },
          { type: "session_settled" },
          { type: "message_update", messageId: "same-chunk-settle",
            assistantMessageEvent: { type: "text_delta", delta: "settled-read" } },
        ]);
      });
      let completed = false;
      const outcome = observe(p.connection.prompt(request)).then((value) => { completed = true; return value; });
      try {
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (!query) throw new Error("Same-chunk settlement did not start the identity probe");
        expect(markers).toEqual(["settled-read"]);
        expect(completed).toBe(false);
        p.emitBatch([
          { type: "response", id: query.id, command: "get_session_stats", success: true, data: { sessionFile: source } },
          { type: "message_update", messageId: "same-chunk-settle",
            assistantMessageEvent: { type: "text_delta", delta: "probe-reply-read" } },
        ]);
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(markers).toEqual(["settled-read", "probe-reply-read"]);
        // Fail on an observable still-held operation, not on awaiting its timeout.
        expect(completed).toBe(true);
        await expect(outcome).resolves.toEqual({ kind: "resolved", value: { stopReason: "end_turn" } });
        await expect(p.connection.cancel({ sessionId: request.sessionId })).resolves.toBeUndefined();
        expect(p.received.some((command) => command.type === "abort")).toBe(false);
        normalAgent(p);
        await expect(p.connection.prompt(request)).resolves.toEqual({ stopReason: "end_turn" });
        expect(p.received.filter((command) => command.type === "get_session_stats")).toHaveLength(1);
      } finally {
        p.close();
        await outcome;
      }
    });

    it.each(["error", "aborted"] as const)("preserves absorbed root %s against stale completed ACK", async (stopReason) => {
      const { p, source, request } = await identityPeer();
      let query: Record<string, unknown> | undefined;
      p.setStats((command) => { query = command; });
      p.setPrompt((command) => {
        p.emitBatch([
          { type: "response", id: command.id, command: "prompt", success: true,
            data: { agentInvoked: false, status: "completed", sessionSettled: true } },
          { type: "prompt_result", id: command.id, agentInvoked: false, status: "completed", sessionSettled: false },
          { type: "agent_end", yielded: true, messages: [{ role: "assistant", stopReason }] },
          { type: "session_settled" },
        ]);
      });
      const outcome = observe(p.connection.prompt(request));
      let cancellation: Promise<unknown> | undefined;
      try {
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (!query) throw new Error("Settled root outcome did not start its identity query");
        cancellation = observe(p.connection.cancel({ sessionId: request.sessionId }));
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(p.received.some((command) => command.type === "abort")).toBe(false);
        statsReply(p, query, source);
        await expect(outcome).resolves.toEqual(stopReason === "error"
          ? { kind: "rejected", error: expect.any(Error) }
          : { kind: "resolved", value: { stopReason: "cancelled" } });
        await expect(cancellation).resolves.toEqual(stopReason === "error"
          ? { kind: "rejected", error: expect.any(Error) }
          : { kind: "resolved", value: undefined });
        normalAgent(p);
        await expect(p.connection.prompt(request)).resolves.toEqual({ stopReason: "end_turn" });
        expect(p.received.filter((command) => command.type === "get_session_stats")).toHaveLength(1);
      } finally {
        p.close();
        await Promise.all([outcome, cancellation]);
      }
    });

    it("keeps same-file help successful and ignores stats accounting without changing usage scope", async () => {
      const { p, request } = await identityPeer();
      normalAgent(p, 3);
      await expect(p.connection.prompt(request)).resolves.toEqual({ stopReason: "end_turn" });
      const beforeUsage = p.usages.slice();
      const scope = p.usages.at(-1)?._meta?.lody?.usageScopeId;
      expect(scope).toBeDefined();
      p.setPrompt((command) => {
        p.emit({ type: "response", id: command.id, command: "prompt", success: true, data: { agentInvoked: false } });
      });
      await expect(p.connection.prompt({
        ...request, prompt: [{ type: "text", text: "/help" }],
      })).resolves.toEqual({ stopReason: "end_turn" });
      expect(p.received.filter((frame) => frame.type === "get_session_stats")).toHaveLength(1);
      expect(p.usages).toEqual(beforeUsage);
      normalAgent(p, 5);
      await expect(p.connection.prompt(request)).resolves.toEqual({ stopReason: "end_turn" });
      expect(p.usages.at(-1)?._meta?.lody?.usageScopeId).toBe(scope);
      expect(p.usages.at(-1)?.sessionId).toBe(request.sessionId);
      expect(p.received.filter((frame) => frame.type === "get_session_stats")).toHaveLength(1);
    });

    it.each(["text rejection", "image rejection", "local error ACK", "local error result"] as const)(
      "preserves same-file %s and allows the next ordinary prompt",
      async (mode) => {
        const { p, request } = await identityPeer();
        p.setPrompt((command) => {
          if (mode === "text rejection" || mode === "image rejection") {
            p.emit({ type: "response", id: command.id, command: "prompt", success: false, error: "private-provider-failure" });
          } else {
            const local = { agentInvoked: false, status: "error", sessionSettled: true };
            p.emitBatch([
              { type: "response", id: command.id, command: "prompt", success: true,
                data: mode === "local error ACK" ? local : {} },
              ...(mode === "local error result" ? [{ type: "prompt_result", id: command.id, ...local }] : []),
            ]);
          }
        });
        const prompt: acp.ContentBlock[] = mode === "image rejection"
          ? [{ type: "image", data: "AAEC", mimeType: "image/x-fixture" }]
          : request.prompt;
        const outcome = await observe(p.connection.prompt({ ...request, prompt }));
        expect(outcome).toEqual({ kind: "rejected", error: expect.any(Error) });
        expect(p.received.filter((frame) => frame.type === "get_session_stats")).toHaveLength(1);
        expect(p.failures).toEqual([]);
        normalAgent(p);
        await expect(p.connection.prompt(request)).resolves.toEqual({ stopReason: "end_turn" });
        expect(p.received.filter((frame) => frame.type === "get_session_stats")).toHaveLength(1);
      },
    );

    it.each([
      { label: "missing file", data: {}, localStatus: "completed" },
      { label: "empty file", data: { sessionFile: "" }, localStatus: "completed" },
      { label: "non-string file", data: { sessionFile: 42 }, localStatus: "error" },
      { label: "malformed stats", data: null, localStatus: "completed" },
      { label: "unsupported stats", data: undefined, localStatus: "error" },
    ])("invalidates identity for $label without adopting or restoring a session", async ({ data, localStatus }) => {
      const { p, source, request } = await identityPeer();
      p.setStats((command) => {
        p.emit({ type: "response", id: command.id, command: "get_session_stats", success: data !== undefined,
          data, error: "private-stats-diagnostic" });
      });
      p.setPrompt((command) => {
        p.emitBatch([
          { type: "response", id: command.id, command: "prompt", success: true },
          { type: "prompt_result", id: command.id, agentInvoked: false, status: localStatus, sessionSettled: true },
        ]);
      });
      const start = p.received.length;
      const outcome = await observe(p.connection.prompt(request));
      expect(outcome).toEqual({ kind: "rejected", error: expect.any(Error) });
      if (outcome.kind === "rejected") {
        expect(String(outcome.error)).not.toContain(source);
        expect(String(outcome.error)).not.toContain("private-stats");
      }
      expect(p.received.slice(start).map((command) => command.type)).toEqual(["prompt", "get_session_stats"]);
      const commandsBefore = p.received.slice();
      await expect(p.connection.prompt(request)).rejects.toBeInstanceOf(Error);
      expect(p.received).toEqual(commandsBefore);
      expect(p.failures).toEqual([]);
    });

    it("compares the raw file exactly and recovers only through explicit session preparation", async () => {
      const { p, cwd, source, request } = await identityPeer();
      p.setStats((command) => { statsReply(p, command, ` ${source}`); });
      p.setPrompt((command) => {
        p.emit({ type: "response", id: command.id, command: "prompt", success: true, data: { agentInvoked: false } });
      });
      await expect(observe(p.connection.prompt(request))).resolves.toEqual({ kind: "rejected", error: expect.any(Error) });
      await expect(p.connection.prompt(request)).rejects.toBeInstanceOf(Error);
      p.setStats((command) => { statsReply(p, command, source); });
      const prepared = await p.connection.newSession({ cwd, mcpServers: [] });
      expect(prepared.sessionId).toBe(source);
      normalAgent(p);
      await expect(p.connection.prompt(request)).resolves.toEqual({ stopReason: "end_turn" });
    });

    it("waits for current settlement before probing and blocks all admissions during the query", async () => {
      const { p, cwd, source, request } = await identityPeer();
      let query: Record<string, unknown> | undefined;
      p.setStats((command) => { query = command; });
      p.setPrompt((command) => {
        const local = { agentInvoked: false, status: "completed", sessionSettled: false };
        p.emitBatch([
          { type: "response", id: command.id, command: "prompt", success: true, data: local },
          { type: "prompt_result", id: command.id, ...local },
        ]);
      });
      let completed = false;
      const outcome = observe(p.connection.prompt(request)).then((value) => { completed = true; return value; });
      try {
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(completed).toBe(false);
        expect(query).toBeUndefined();
        p.emit({ type: "session_settled" });
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (!query) throw new Error("Post-local identity query was not dispatched at settlement");
        expect(completed).toBe(false);
        const commandsBefore = p.received.slice();
        await expect(p.connection.prompt(request)).rejects.toBeInstanceOf(Error);
        await expect(p.connection.newSession({ cwd, mcpServers: [] })).rejects.toBeInstanceOf(Error);
        await expect(p.connection.loadSession({ cwd, mcpServers: [], sessionId: source })).rejects.toBeInstanceOf(Error);
        await expect(p.connection.resumeSession({ cwd, mcpServers: [], sessionId: source })).rejects.toBeInstanceOf(Error);
        await expect(p.connection.forkSession({ cwd, mcpServers: [], sessionId: source })).rejects.toBeInstanceOf(Error);
        expect(p.received).toEqual(commandsBefore);
        statsReply(p, query, source);
        await expect(outcome).resolves.toEqual({ kind: "resolved", value: { stopReason: "end_turn" } });
        expect(p.received.filter((command) => command.type === "get_session_stats")).toHaveLength(1);
      } finally {
        p.close();
        await outcome;
      }
    });

    it("preserves stable notification drain and late-cancel settlement while the query is pending", async () => {
      const { p, source, request } = await identityPeer();
      let query: Record<string, unknown> | undefined;
      p.setStats((command) => { query = command; });
      const drain = deferred<void>();
      const delivered: string[] = [];
      p.setUpdate(async (notification) => {
        await drain.promise;
        const update = notification.update;
        if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
          delivered.push(update.content.text);
        }
      });
      p.setPrompt((command) => {
        p.emitBatch([
          { type: "response", id: command.id, command: "prompt", success: true },
          { type: "message_update", messageId: "local-drain", assistantMessageEvent: { type: "text_delta", delta: "first" } },
          { type: "prompt_result", id: command.id, agentInvoked: false, status: "completed", sessionSettled: true },
        ]);
      });
      let completed = false;
      const outcome = observe(p.connection.prompt(request)).then((value) => { completed = true; return value; });
      let cancellation: Promise<unknown> | undefined;
      try {
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (!query) throw new Error("Post-local identity query did not start before notification drain");
        cancellation = observe(p.connection.cancel({ sessionId: request.sessionId }));
        expect(p.received.some((command) => command.type === "abort")).toBe(false);
        statsReply(p, query, source);
        p.emit({ type: "message_update", messageId: "local-drain",
          assistantMessageEvent: { type: "text_delta", delta: "late" } });
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(completed).toBe(false);
        expect(delivered).toEqual([]);
        drain.resolve(undefined);
        await expect(outcome).resolves.toEqual({ kind: "resolved", value: { stopReason: "end_turn" } });
        await expect(cancellation).resolves.toEqual({ kind: "resolved", value: undefined });
        expect(delivered).toEqual(["first", "late"]);
        expect(p.received.filter((command) => command.type === "get_session_stats")).toHaveLength(1);
      } finally {
        drain.resolve(undefined);
        p.close();
        await Promise.all([outcome, cancellation]);
      }
    });

    it("keeps a legacy local query behind the original abort ACK barrier without inventing cancelled", async () => {
      const { p, source, request } = await identityPeer();
      let query: Record<string, unknown> | undefined;
      let abort: Record<string, unknown> | undefined;
      p.setStats((command) => { query = command; });
      p.setAbort((command) => { abort = command; });
      p.setPrompt((command) => {
        p.emit({ type: "response", id: command.id, command: "prompt", success: true, data: { agentInvoked: false } });
      });
      let completed = false;
      const outcome = observe(p.connection.prompt(request)).then((value) => { completed = true; return value; });
      let cancellation: Promise<unknown> | undefined;
      try {
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (!query) throw new Error("Legacy local query was not dispatched");
        cancellation = observe(p.connection.cancel({ sessionId: request.sessionId }));
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (!abort) throw new Error("Legacy cancellation did not dispatch abort");
        statsReply(p, query, source);
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(completed).toBe(false);
        p.emit({ type: "response", id: abort.id, command: "abort", success: true });
        await expect(outcome).resolves.toEqual({ kind: "resolved", value: { stopReason: "end_turn" } });
        await expect(cancellation).resolves.toEqual({ kind: "resolved", value: undefined });
        expect(p.received.filter((command) => command.type === "get_session_stats")).toHaveLength(1);
      } finally {
        p.close();
        await Promise.all([outcome, cancellation]);
      }
    });

    it("retains a late current false error result after command rejection without a second query", async () => {
      const { p, source, request } = await identityPeer();
      let query: Record<string, unknown> | undefined;
      let command: Record<string, unknown> | undefined;
      p.setStats((value) => { query = value; });
      p.setPrompt((value) => {
        command = value;
        p.emit({ type: "response", id: value.id, command: "prompt", success: false, error: "private-local-failure" });
      });
      let completed = false;
      const outcome = observe(p.connection.prompt(request)).then((value) => { completed = true; return value; });
      try {
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (!query || !command) throw new Error("Command failure did not reach its conditional identity query");
        p.emit({ type: "prompt_result", id: command.id, agentInvoked: false, status: "error", sessionSettled: false });
        await new Promise<void>((resolve) => setImmediate(resolve));
        statsReply(p, query, source);
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(completed).toBe(false);
        p.emit({ type: "session_settled" });
        await expect(outcome).resolves.toEqual({ kind: "rejected", error: expect.any(Error) });
        expect(p.received.filter((value) => value.type === "get_session_stats")).toHaveLength(1);
        normalAgent(p);
        await expect(p.connection.prompt(request)).resolves.toEqual({ stopReason: "end_turn" });
      } finally {
        p.close();
        await outcome;
      }
    });

    it.each(["EOF", "notification failure"] as const)("does not revive identity from a query after %s", async (failure) => {
      const { p, source, request } = await identityPeer();
      let query: Record<string, unknown> | undefined;
      p.setStats((command) => { query = command; });
      p.setPrompt((command) => {
        p.emit({ type: "response", id: command.id, command: "prompt", success: true, data: { agentInvoked: false } });
      });
      const outcome = observe(p.connection.prompt(request));
      try {
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (!query) throw new Error("Local identity query was not pending at failure");
        if (failure === "EOF") {
          // EOF rejects the pending query; its continuation must not restore the active or A.
          p.close();
        } else {
          p.setUpdate(async () => { throw new Error("private-notification-failure"); });
          p.emit({ type: "message_update", messageId: "query-failure", assistantMessageEvent: { type: "text_delta", delta: "fail" } });
          await new Promise<void>((resolve) => setImmediate(resolve));
          statsReply(p, query, source);
        }
        await expect(outcome).resolves.toEqual({ kind: "rejected", error: expect.any(Error) });
        await new Promise<void>((resolve) => setImmediate(resolve));
        const commandsBefore = p.received.slice();
        await expect(p.connection.prompt(request)).rejects.toBeInstanceOf(Error);
        expect(p.received).toEqual(commandsBefore);
        expect(p.failures).not.toEqual([]);
      } finally {
        p.close();
        await outcome;
      }
    });

    it.each([true, undefined, "false"])("does not probe normal outcomes with non-local marker %s", async (marker) => {
      const { p, request } = await identityPeer();
      p.setPrompt((command) => {
        p.emitBatch([
          { type: "response", id: command.id, command: "prompt", success: true, data: { agentInvoked: true } },
          { type: "prompt_result", id: "another-prompt", agentInvoked: false, status: "completed", sessionSettled: true },
          { type: "prompt_result", id: command.id, agentInvoked: marker, status: "completed", sessionSettled: true },
        ]);
      });
      await expect(p.connection.prompt(request)).resolves.toEqual({ stopReason: "end_turn" });
      expect(p.received.some((command) => command.type === "get_session_stats")).toBe(false);
    });
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

describe("015 model config connection", () => {
  const peers: Peer[] = [];
  const directories: string[] = [];
  afterEach(async () => {
    for (const p of peers.splice(0)) p.close();
    for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
  });

  async function setup() {
    const p = peer();
    peers.push(p);
    const directory = await mkdtemp(join(tmpdir(), "omp-model-config-"));
    directories.push(directory);
    const source = join(directory, "source.jsonl");
    const target = join(directory, "target.jsonl");
    const fork = join(directory, "fork.jsonl");
    await Promise.all([source, target, fork].map((file) => writeFile(file, '{"type":"session"}\n')));
    p.state.sessionFile = source;
    const session = await p.connection.newSession({ cwd: directory, mcpServers: [] });
    return { p, directory, source, target, fork, session };
  }

  async function accountedPrompt(p: Peer, sessionId: string, replay: Record<string, unknown>[] = []) {
    p.setPrompt((command) => {
      const model = p.state.model;
      p.reply(command);
      p.emitBatch([
        ...replay,
        { type: "message_update", messageId: `normal-${String(command.id)}`, assistantMessageEvent: {
          type: "text_delta", delta: `${model.provider}/${model.id}`,
        } },
        { type: "message_end", messageId: `normal-${String(command.id)}`, message: {
          role: "assistant", provider: model.provider, model: model.id,
          usage: { input: 3, output: 2, cacheRead: 0, cacheWrite: 0 },
        } },
        { type: "prompt_result", id: command.id, status: "completed", sessionSettled: true },
      ]);
    });
    await expect(p.connection.prompt({
      sessionId, prompt: [{ type: "text", text: "native model accounting" }],
    })).resolves.toEqual({ stopReason: "end_turn" });
  }

  it.each(["new", "load", "resume", "fork"] as const)(
    "holds %s admission until the complete native model catalog is ready",
    async (operation) => {
      const { p, directory, source, target, fork } = await setup();
      const started = deferred<void>();
      let held: Record<string, unknown> | undefined;
      p.setModels((command) => {
        held = command;
        started.resolve();
      });
      if (operation === "fork") {
        p.setFork((command) => {
          p.state.sessionFile = fork;
          p.state.model = p.models[2]!;
          p.reply(command, { cancelled: false });
        });
      } else p.state.sessionFile = target;
      const request = { cwd: directory, sessionId: operation === "fork" ? source : target, mcpServers: [] };
      const pending = operation === "new" ? p.connection.newSession(request)
        : operation === "load" ? p.connection.loadSession(request)
        : operation === "resume" ? p.connection.resumeSession(request) : p.connection.forkSession(request);
      let finished = false;
      const outcome = pending.then(
        (value) => { finished = true; return { ok: true as const, value }; },
        (error: unknown) => { finished = true; return { ok: false as const, error }; },
      );
      try {
        await Promise.race([
          started.promise,
          outcome.then(() => { throw new Error("Session preparation finished before its catalog gate"); }),
        ]);
        expect(finished).toBe(false);
        await expect(p.connection.newSession({ cwd: directory, mcpServers: [] })).rejects.toThrow();
        await expect(p.connection.loadSession(request)).rejects.toThrow();
        await expect(p.connection.resumeSession(request)).rejects.toThrow();
        await expect(p.connection.forkSession({ ...request, sessionId: source })).rejects.toThrow();
        await expect(p.connection.prompt({
          sessionId: source, prompt: [{ type: "text", text: "must remain busy" }],
        })).rejects.toThrow();
        await expect(p.connection.setSessionConfigOption({
          sessionId: source, configId: "model", value: "other/family/x",
        })).rejects.toThrow();
        expect(p.received.filter((command) => command.type === "prompt" || command.type === "set_model")).toEqual([]);
        if (!held) throw new Error("Catalog gate has no native request");
        p.reply(held, { models: p.models });
        held = undefined;
        const result = await pending;
        expect(result.configOptions).toEqual([{
          id: "model", name: expect.any(String), category: "model", type: "select",
          currentValue: operation === "fork" ? "org/branch/leaf" : "fixture/model",
          options: [
            { value: "fixture/model", name: "Fixture" },
            { value: "other/family/x", name: "Fixture" },
            { value: "org/branch/leaf", name: "Branch" },
          ],
        }]);
        const selectedFile = operation === "fork" ? fork : target;
        if ("sessionId" in result) expect(result.sessionId).toBe(selectedFile);
        await expect(p.connection.prompt({
          sessionId: selectedFile, prompt: [{ type: "text", text: "fully prepared" }],
        })).resolves.toEqual({ stopReason: "end_turn" });
      } finally {
        if (held) p.reply(held, { models: p.models });
        await outcome;
      }
    },
  );

  it.each(["preflight", "set", "catalog", "state", "notification"] as const)(
    "retains accounting, busy ownership and excluded message origins while model %s is held",
    async (phase) => {
      const { p, directory, source, session } = await setup();
      await accountedPrompt(p, session.sessionId);
      const previousScope = p.usages[0]?._meta?.lody?.usageScopeId;
      const previousUsage = structuredClone(p.usages);
      const started = deferred<void>();
      const notificationGate = deferred<void>();
      let release: (() => void) | undefined;
      let mutated = false;
      p.setState((command) => {
        if ((phase === "preflight" && !mutated) || (phase === "state" && mutated)) {
          release = () => { p.reply(command, p.state); };
          started.resolve();
        } else p.reply(command, p.state);
      });
      p.setModel((command) => {
        const selected = p.models.find((model) => model.provider === command.provider && model.id === command.modelId);
        if (!selected) throw new Error("Fixture did not find the raw provider/model pair");
        const respond = () => {
          mutated = true;
          p.state.model = selected;
          p.reply(command, selected);
        };
        if (phase === "set") {
          release = respond;
          started.resolve();
        } else respond();
      });
      p.setModels((command) => {
        if (phase === "catalog" && mutated) {
          release = () => { p.reply(command, { models: p.models }); };
          started.resolve();
        } else p.reply(command, { models: p.models });
      });
      p.setUpdate(async (notification) => {
        if (phase === "notification" && notification.update.sessionUpdate === "config_option_update") {
          release = () => { notificationGate.resolve(); };
          started.resolve();
          await notificationGate.promise;
        }
        p.updates.push(notification);
      });
      let finished = false;
      const pending = p.connection.setSessionConfigOption({
        sessionId: session.sessionId, configId: "model", value: "other/family/x",
      });
      const outcome = pending.then(
        (value) => { finished = true; return { ok: true as const, value }; },
        (error: unknown) => { finished = true; return { ok: false as const, error }; },
      );
      const unrelated: Record<string, unknown>[] = [];
      for (const nativeIdentity of [p.state.sessionId, undefined]) {
        const prefix = nativeIdentity ? "same-native" : "without-session";
        const identity = nativeIdentity ? { sessionId: nativeIdentity } : {};
        unrelated.push(
          { type: "message_update", ...identity, messageId: `${prefix}-message`, message: { responseId: `${prefix}-response` },
            assistantMessageEvent: { type: "text_delta", delta: "UNRELATED-CONTROL-TEXT" } },
          { type: "message_end", ...identity, messageId: `${prefix}-message`, message: {
            role: "assistant", responseId: `${prefix}-response`, provider: "unowned", model: "background",
            usage: { input: 900, output: 800, cacheRead: 0, cacheWrite: 0 },
          } },
          { type: "message_update", ...identity, message: { responseId: `${prefix}-legacy` },
            assistantMessageEvent: { type: "text_delta", delta: "UNRELATED-LEGACY-TEXT" } },
          { type: "message_end", ...identity, message: {
            role: "assistant", responseId: `${prefix}-legacy`, provider: "unowned", model: "legacy",
            usage: { input: 700, output: 600, cacheRead: 0, cacheWrite: 0 },
          } },
          ...["stop", "error", "aborted"].map((stopReason) => ({
            type: "agent_end", ...identity, messages: [{ role: "assistant", stopReason }],
          })),
          { type: "agent_end", ...identity, yielded: true, messages: [{ role: "assistant", stopReason: "error" }] },
          { type: "prompt_result", ...identity, id: "unrelated-prompt", status: "completed", sessionSettled: true },
          { type: "session_settled", ...identity },
        );
      }
      try {
        await Promise.race([
          started.promise,
          outcome.then(() => { throw new Error("Model mutation did not reach its owned gate"); }),
        ]);
        p.emitBatch(unrelated);
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(finished).toBe(false);
        expect(p.usages).toEqual(previousUsage);
        expect(p.updates.filter((notification) => notification.update.sessionUpdate === "agent_message_chunk")).toHaveLength(1);
        const beforeAdmissions = p.received.slice();
        const workspace = { cwd: directory, sessionId: source, mcpServers: [] };
        await expect(p.connection.prompt({ sessionId: source, prompt: [{ type: "text", text: "busy" }] })).rejects.toThrow();
        await expect(p.connection.newSession(workspace)).rejects.toThrow();
        await expect(p.connection.loadSession(workspace)).rejects.toThrow();
        await expect(p.connection.resumeSession(workspace)).rejects.toThrow();
        await expect(p.connection.forkSession(workspace)).rejects.toThrow();
        await expect(p.connection.setSessionConfigOption({
          sessionId: source, configId: "model", value: "fixture/model",
        })).rejects.toThrow();
        await p.connection.cancel({ sessionId: source });
        expect(p.received).toEqual(beforeAdmissions);
        const continueOperation = release;
        release = undefined;
        if (!continueOperation) throw new Error("Native model gate has no producer");
        continueOperation();
        const result = await pending;
        expect(result.configOptions[0]).toMatchObject({ currentValue: "other/family/x", category: "model" });
        expect(p.updates.filter((notification) => notification.update.sessionUpdate === "config_option_update")).toEqual([{
          sessionId: source, update: { sessionUpdate: "config_option_update", configOptions: result.configOptions },
        }]);
        const replay = unrelated.filter((frame) => frame.type === "message_update" || frame.type === "message_end");
        await accountedPrompt(p, source, replay);
        expect(p.usages).toHaveLength(2);
        expect(p.usages[1]?._meta?.lody?.usageScopeId).toBe(previousScope);
        expect(p.usages[1]?.modelUsage).toMatchObject({
          "fixture/model": { inputTokens: 3 },
          "other/family/x": { inputTokens: 3 },
        });
        expect(p.usages[1]?.modelUsage?.["unowned/background"]).toBeUndefined();
        expect(p.updates.flatMap((notification) => {
          const update = notification.update;
          return update.sessionUpdate === "agent_message_chunk" && update.content.type === "text" ? [update.content.text] : [];
        })).toEqual(["fixture/model", "other/family/x"]);
      } finally {
        release?.();
        notificationGate.resolve();
        await outcome;
      }
    },
  );

  it.each(["prompt", "cancel", "identity"] as const)(
    "refuses a setter while native %s ownership is still active",
    async (phase) => {
      const { p, source } = await setup();
      const promptStarted = deferred<Record<string, unknown>>();
      const heldControl = deferred<Record<string, unknown>>();
      p.setPrompt((command) => {
        promptStarted.resolve(command);
        p.reply(command, phase === "identity" ? { agentInvoked: false } : {});
      });
      p.setStats((command) => { heldControl.resolve(command); });
      p.setAbort((command) => { heldControl.resolve(command); });
      const pending = p.connection.prompt({ sessionId: source, prompt: [{ type: "text", text: "own turn" }] });
      const observed = pending.then((value) => value, () => undefined);
      const promptCommand = await promptStarted.promise;
      let cancellation: Promise<void> | undefined;
      let control: Record<string, unknown> | undefined;
      try {
        if (phase === "cancel") cancellation = p.connection.cancel({ sessionId: source });
        if (phase !== "prompt") control = await heldControl.promise;
        const before = p.received.slice();
        await expect(p.connection.setSessionConfigOption({
          sessionId: source, configId: "model", value: "other/family/x",
        })).rejects.toThrow();
        expect(p.received).toEqual(before);
      } finally {
        if (control) p.reply(control, phase === "identity" ? { sessionFile: source } : {});
        if (phase !== "identity") p.emit({
          type: "prompt_result", id: promptCommand.id,
          status: phase === "cancel" ? "aborted" : "completed", sessionSettled: true,
        });
        await observed;
        await cancellation;
      }
    },
  );

  it("does not acknowledge a model change after a config notification fails", async () => {
    const { p, source } = await setup();
    p.setUpdate(async () => { throw new Error("private-config-notification-failure"); });
    await expect(p.connection.setSessionConfigOption({
      sessionId: source, configId: "model", value: "other/family/x",
    })).rejects.toThrow();
    expect(p.failures).toHaveLength(1);
    expect(p.updates).toEqual([]);
    const nativeBefore = p.received.length;
    await expect(p.connection.prompt({ sessionId: source, prompt: [{ type: "text", text: "closed" }] })).rejects.toThrow();
    expect(p.received.slice(nativeBefore).filter((command) => command.type === "prompt")).toEqual([]);
  });

  it.each(["set_model", "get_available_models", "get_state"] as const)(
    "fails the model transaction on EOF while %s is outstanding",
    async (query) => {
      const { p, source } = await setup();
      const started = deferred<void>();
      const hold = () => { started.resolve(); };
      if (query === "set_model") p.setModel(hold);
      else if (query === "get_available_models") p.setModels(hold);
      else p.setState(hold);
      const pending = p.connection.setSessionConfigOption({
        sessionId: source, configId: "model", value: "other/family/x",
      });
      const outcome = pending.then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      await Promise.race([
        started.promise,
        outcome.then(() => { throw new Error("Model request did not reach EOF gate"); }),
      ]);
      p.close();
      await expect(pending).rejects.toThrow();
      expect(p.updates).toEqual([]);
      expect(p.usages).toEqual([]);
      expect(p.failures).toHaveLength(1);
    },
  );
});

describe("015 model catalog preparation readback", () => {
  it.each(["file", "model"] as const)("reads the real %s again after an asynchronous catalog refresh", async (changed) => {
    const p = peer();
    const directory = await mkdtemp(join(tmpdir(), "omp-model-refresh-"));
    const source = join(directory, "A.jsonl");
    const target = join(directory, "B.jsonl");
    await Promise.all([source, target].map((file) => writeFile(file, '{"type":"session"}\n')));
    p.state.sessionFile = source;
    const catalog = deferred<Record<string, unknown>>();
    p.setModels((command) => { catalog.resolve(command); });
    const pending = p.connection.newSession({ cwd: directory, mcpServers: [] });
    const outcome = pending.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    let held: Record<string, unknown> | undefined;
    try {
      held = await catalog.promise;
      if (changed === "file") p.state.sessionFile = target;
      else p.state.model = p.models[1]!;
      p.reply(held, { models: p.models });
      held = undefined;
      if (changed === "file") {
        await expect(pending).rejects.toThrow();
        const before = p.received.length;
        for (const sessionId of [source, target]) {
          await expect(p.connection.prompt({
            sessionId, prompt: [{ type: "text", text: "unverified catalog identity" }],
          })).rejects.toThrow();
        }
        expect(p.received.slice(before).filter((command) => command.type === "prompt")).toEqual([]);
        p.setModels((command) => { p.reply(command, { models: p.models }); });
        const recovered = await p.connection.newSession({ cwd: directory, mcpServers: [] });
        expect(recovered.sessionId).toBe(target);
        await expect(p.connection.prompt({
          sessionId: target, prompt: [{ type: "text", text: "explicit exact recovery" }],
        })).resolves.toEqual({ stopReason: "end_turn" });
      } else {
        const result = await pending;
        expect(result.sessionId).toBe(source);
        expect(result.configOptions?.[0]).toMatchObject({ currentValue: "other/family/x" });
      }
    } finally {
      if (held) p.reply(held, { models: p.models });
      await outcome;
      p.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("015 model notification EOF ownership", () => {
  it("rejects on EOF without waiting for a held config notification to become deliverable", async () => {
    const p = peer();
    const entered = deferred<void>();
    const gate = deferred<void>();
    const session = await p.connection.newSession({ cwd: "/work", mcpServers: [] });
    p.setUpdate(async (notification) => {
      if (notification.update.sessionUpdate === "config_option_update") {
        entered.resolve();
        await gate.promise;
      }
    });
    const pending = p.connection.setSessionConfigOption({
      sessionId: session.sessionId, configId: "model", value: "other/family/x",
    });
    const outcome = pending.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    try {
      await Promise.race([
        entered.promise,
        outcome.then(() => { throw new Error("Configuration did not reach its notification gate"); }),
      ]);
      p.close();
      await expect(pending).rejects.toThrow();
      expect(p.failures).toHaveLength(1);
      expect(p.usages).toEqual([]);
    } finally {
      gate.resolve();
      p.close();
      await outcome;
    }
  });
});

describe("015 explicit title connection consumer", () => {
  const peers: Peer[] = [];
  const directories: string[] = [];
  afterEach(async () => {
    for (const p of peers.splice(0)) p.close();
    for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
  });

  async function setup() {
    const p = peer();
    peers.push(p);
    const directory = await mkdtemp(join(tmpdir(), "omp-explicit-title-"));
    directories.push(directory);
    const source = join(directory, "A.jsonl");
    const target = join(directory, "B.jsonl");
    await Promise.all([source, target].map((file) => writeFile(file, '{"type":"session"}\n')));
    p.state.sessionFile = source;
    const session = await p.connection.newSession({ cwd: directory, mcpServers: [] });
    return { p, directory, source, target, session };
  }

  function ordinaryPrompt(
    p: Peer,
    sessionId: string,
    replay: Record<string, unknown>[] = [],
    root: "completed" | "error" | "aborted" = "completed",
  ) {
    p.setPrompt((command) => {
      p.reply(command);
      p.emitBatch([
        ...replay,
        { type: "message_update", messageId: `ordinary-title-${String(command.id)}`,
          assistantMessageEvent: { type: "text_delta", delta: "ordinary real prompt" } },
        { type: "message_end", messageId: `ordinary-title-${String(command.id)}`, message: {
          role: "assistant", provider: "fixture", model: "model",
          usage: { input: 3, output: 2, cacheRead: 0, cacheWrite: 0 },
        } },
        { type: "prompt_result", id: command.id, agentInvoked: true, status: "completed", sessionSettled: root === "completed" },
        ...(root === "completed" ? [] : [
          { type: "agent_end", yielded: true, messages: [{ role: "assistant", stopReason: root }] },
          { type: "session_settled" },
        ]),
      ]);
    });
    return p.connection.prompt({ sessionId, prompt: [{ type: "text", text: "an ordinary non-control prompt" }] });
  }

  function unrelatedActivity(nativeId: string | undefined, requestId = "unowned-prompt") {
    const frames: Record<string, unknown>[] = [];
    for (const sessionId of [nativeId, undefined]) {
      const prefix = sessionId ? "same-native-title" : "without-session-title";
      const identity = sessionId ? { sessionId } : {};
      frames.push(
        { type: "message_start", ...identity, messageId: `${prefix}-message`, message: { responseId: `${prefix}-response` } },
        { type: "message_update", ...identity, messageId: `${prefix}-message`, message: { responseId: `${prefix}-response` },
          assistantMessageEvent: { type: "text_delta", delta: "UNOWNED TITLE CONTROL TEXT" } },
        { type: "message_end", ...identity, messageId: `${prefix}-message`, message: {
          role: "assistant", responseId: `${prefix}-response`, provider: "unowned", model: "background",
          usage: { input: 900, output: 800, cacheRead: 0, cacheWrite: 0 },
        } },
        { type: "message_update", ...identity, message: { responseId: `${prefix}-legacy` },
          assistantMessageEvent: { type: "text_delta", delta: "UNOWNED RESPONSE ALIAS" } },
        { type: "message_end", ...identity, message: {
          role: "assistant", responseId: `${prefix}-legacy`, provider: "unowned", model: "legacy",
          usage: { input: 700, output: 600, cacheRead: 0, cacheWrite: 0 },
        } },
        ...["stop", "error", "aborted"].map((stopReason) => ({
          type: "agent_end", ...identity, messages: [{ role: "assistant", stopReason }],
        })),
        { type: "agent_end", ...identity, yielded: true, messages: [{ role: "assistant", stopReason: "error" }] },
        { type: "agent_end", ...identity, yielded: true },
        { type: "agent_end", ...identity, yielded: "not-a-boolean", messages: [] },
        { type: "prompt_result", ...identity, id: requestId, agentInvoked: false, status: "completed", sessionSettled: true },
        { type: "session_settled", ...identity },
        { type: "session_info_update", ...identity, title: "Unknown native title is not explicit" },
      );
    }
    return frames;
  }

  it.each([
    { label: "no arguments", prompt: [{ type: "text", text: "/rename" }] },
    { label: "whitespace arguments", prompt: [{ type: "text", text: "/rename   " }] },
    { label: "leading text", prompt: [{ type: "text", text: " /rename Named" }] },
    { label: "different case", prompt: [{ type: "text", text: "/Rename Named" }] },
    { label: "different command", prompt: [{ type: "text", text: "/renamed Named" }] },
    { label: "colon form", prompt: [{ type: "text", text: "/rename:Named" }] },
    { label: "embedded instruction", prompt: [{ type: "text", text: "discuss /rename Named" }] },
    { label: "multiple text blocks", prompt: [{ type: "text", text: "/rename Named" }, { type: "text", text: "extra" }] },
    {
      label: "mixed image",
      prompt: [{ type: "text", text: "/rename Named" }, { type: "image", data: "AAEC", mimeType: "image/x-synthetic" }],
    },
  ] satisfies { label: string; prompt: acp.ContentBlock[] }[])(
    "leaves $label on the ordinary native route and never tags unknown title frames explicit",
    async ({ prompt }) => {
      const { p, source } = await setup();
      p.setPrompt((command) => {
        p.emit({ type: "session_info_update", title: "Generated or unknown", sessionId: p.state.sessionId });
        p.reply(command, { agentInvoked: false });
      });
      const before = p.received.length;
      await expect(p.connection.prompt({ sessionId: source, prompt })).resolves.toEqual({ stopReason: "end_turn" });
      expect(p.updates).toEqual([]);
      expect(p.usages).toEqual([]);
      const commands = p.received.slice(before);
      expect(commands.filter((command) => command.type === "set_session_name")).toEqual([]);
      expect(commands.filter((command) => command.type === "prompt")).toEqual([expect.objectContaining({
        type: "prompt",
        message: prompt.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n\n"),
      })]);
      expect(commands.filter((command) => command.type === "get_session_stats")).toHaveLength(1);
    },
  );

  it("does not turn a nonempty input cleaned to an empty native title into success or lose same-file recovery", async () => {
    const { p, source } = await setup();
    const before = p.received.length;
    await expect(p.connection.prompt({
      sessionId: source, prompt: [{ type: "text", text: `/rename ${String.fromCharCode(1, 128)}` }],
    })).rejects.toThrow();
    expect(p.updates).toEqual([]);
    expect(p.usages).toEqual([]);
    expect(p.received.slice(before).map((command) => command.type)).toEqual(["set_session_name", "get_session_stats"]);
    await expect(ordinaryPrompt(p, source)).resolves.toEqual({ stopReason: "end_turn" });
    expect(p.failures).toEqual([]);
  });

  it.each(["set_session_name", "get_session_stats", "get_state", "notification"] as const)(
    "isolates every unrelated native output and completion while title %s is held",
    async (phase) => {
      const { p, directory, source } = await setup();
      await expect(ordinaryPrompt(p, source)).resolves.toEqual({ stopReason: "end_turn" });
      const scope = p.usages[0]?._meta?.lody?.usageScopeId;
      const accounting = structuredClone(p.usages);
      const started = deferred<void>();
      const notificationGate = deferred<void>();
      let release: (() => void) | undefined;
      let gated = false;
      p.setName((command) => {
        p.state.sessionName = String(command.name).replace(/\p{Cc}/gu, " ").replace(/ +/g, " ").trim();
        const respond = () => { p.emit({ type: "response", id: command.id, command: command.type, success: true }); };
        if (phase === "set_session_name" && !gated) {
          gated = true;
          release = respond;
          started.resolve();
        } else respond();
      });
      p.setStats((command) => {
        const respond = () => { p.reply(command, { sessionFile: p.state.sessionFile, cost: 999, tokens: { input: 999 } }); };
        if (phase === "get_session_stats" && !gated) {
          gated = true;
          release = respond;
          started.resolve();
        } else respond();
      });
      p.setState((command) => {
        if (phase === "get_state" && !gated) {
          gated = true;
          release = () => { p.reply(command, p.state); };
          started.resolve();
        } else p.reply(command, p.state);
      });
      p.setUpdate(async (notification) => {
        if (phase === "notification" && notification.update.sessionUpdate === "session_info_update" && !gated) {
          gated = true;
          release = () => { notificationGate.resolve(); };
          started.resolve();
          await notificationGate.promise;
        }
        p.updates.push(notification);
      });
      const before = p.received.length;
      let finished = false;
      const pending = p.connection.prompt({
        sessionId: source, prompt: [{ type: "text", text: "/rename Verified explicit name" }],
      });
      const outcome = pending.then(
        (value) => { finished = true; return { ok: true as const, value }; },
        (error: unknown) => { finished = true; return { ok: false as const, error }; },
      );
      try {
        await Promise.race([
          started.promise,
          outcome.then(() => { throw new Error("Explicit title did not reach its owned producer gate"); }),
        ]);
        const setter = p.received.slice(before).find((command) => command.type === "set_session_name");
        const unowned = unrelatedActivity(p.state.sessionId, String(setter?.id ?? "unowned-prompt"));
        p.emitBatch(unowned);
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(finished).toBe(false);
        expect(p.usages).toEqual(accounting);
        expect(p.failures).toEqual([]);
        expect(p.updates.filter((notification) => notification.update.sessionUpdate === "agent_message_chunk")).toHaveLength(1);
        const nativeBeforeAdmissions = p.received.slice();
        const workspace = { cwd: directory, sessionId: source, mcpServers: [] };
        await expect(p.connection.prompt({ sessionId: source, prompt: [{ type: "text", text: "still busy" }] })).rejects.toThrow();
        await expect(p.connection.newSession(workspace)).rejects.toThrow();
        await expect(p.connection.loadSession(workspace)).rejects.toThrow();
        await expect(p.connection.resumeSession(workspace)).rejects.toThrow();
        await expect(p.connection.forkSession(workspace)).rejects.toThrow();
        await expect(p.connection.setSessionConfigOption({
          sessionId: source, configId: "model", value: "other/family/x",
        })).rejects.toThrow();
        expect(p.received).toEqual(nativeBeforeAdmissions);
        const resume = release;
        release = undefined;
        if (!resume) throw new Error("Owned title producer is missing");
        resume();
        await expect(pending).resolves.toEqual({ stopReason: "end_turn" });
        expect(p.updates.filter((notification) => notification.update.sessionUpdate === "session_info_update")).toEqual([{
          sessionId: source,
          update: {
            sessionUpdate: "session_info_update", title: "Verified explicit name",
            _meta: { lody: { titleSource: "explicit" } },
          },
        }]);
        expect(p.received.slice(before).filter((command) => command.type === "prompt" || command.type === "abort")).toEqual([]);
        expect(p.received.slice(before).filter((command) => command.type === "get_session_stats")).toHaveLength(1);
        const replay = unowned.filter((frame) => frame.type === "message_start" || frame.type === "message_update" || frame.type === "message_end");
        await expect(ordinaryPrompt(p, source, replay)).resolves.toEqual({ stopReason: "end_turn" });
        expect(p.usages).toHaveLength(2);
        expect(p.usages[1]?._meta?.lody?.usageScopeId).toBe(scope);
        expect(p.usages[1]?.modelUsage).toMatchObject({ "fixture/model": { inputTokens: 6, outputTokens: 4 } });
        expect(p.usages[1]?.modelUsage?.["unowned/background"]).toBeUndefined();
        expect(p.updates.flatMap((notification) => {
          const update = notification.update;
          return update.sessionUpdate === "agent_message_chunk" && update.content.type === "text" ? [update.content.text] : [];
        })).toEqual(["ordinary real prompt", "ordinary real prompt"]);
      } finally {
        release?.();
        notificationGate.resolve();
        await outcome;
      }
    },
  );

  const titleFailures = [
    { failure: "setter-error", stage: "stats", invalidate: false },
    { failure: "stats-file-B", stage: "stats", invalidate: true },
    { failure: "stats-file-missing", stage: "stats", invalidate: true },
    { failure: "stats-file-empty", stage: "stats", invalidate: true },
    { failure: "stats-file-malformed", stage: "stats", invalidate: true },
    { failure: "stats-error", stage: "stats", invalidate: true },
    { failure: "state-file-B", stage: "state", invalidate: true },
    { failure: "state-file-missing", stage: "state", invalidate: true },
    { failure: "state-file-empty", stage: "state", invalidate: true },
    { failure: "state-file-malformed", stage: "state", invalidate: true },
    { failure: "state-error", stage: "state", invalidate: true },
    { failure: "name-missing", stage: "state", invalidate: false },
    { failure: "name-malformed", stage: "state", invalidate: false },
    { failure: "name-mismatch", stage: "state", invalidate: false },
  ] as const;
  it.each(titleFailures.flatMap((entry) => [false, true].map((cancel) => ({ ...entry, cancel }))))(
    "keeps $failure authoritative over unrelated outcomes and cancel=$cancel",
    async ({ failure, stage, invalidate, cancel }) => {
      const { p, directory, source, target } = await setup();
      const started = deferred<void>();
      let held: Record<string, unknown> | undefined;
      let gated = false;
      p.setName((command) => {
        if (failure === "setter-error") {
          p.emit({ type: "response", id: command.id, command: command.type, success: false, error: "PRIVATE-TITLE-DIAGNOSTIC" });
        } else {
          p.state.sessionName = String(command.name);
          p.emit({ type: "response", id: command.id, command: command.type, success: true });
        }
      });
      p.setStats((command) => {
        if (stage === "stats" && !gated) {
          gated = true;
          held = command;
          started.resolve();
        } else p.reply(command, { sessionFile: p.state.sessionFile });
      });
      p.setState((command) => {
        if (stage === "state" && !gated) {
          gated = true;
          held = command;
          started.resolve();
        } else p.reply(command, p.state);
      });
      const before = p.received.length;
      const pending = p.connection.prompt({
        sessionId: source, prompt: [{ type: "text", text: "/rename Requested explicit name" }],
      });
      const outcome = pending.then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      let cancellation: Promise<unknown> | undefined;
      try {
        await Promise.race([
          started.promise,
          outcome.then(() => { throw new Error("Explicit title did not reach its failure-readback gate"); }),
        ]);
        if (cancel) cancellation = p.connection.cancel({ sessionId: source }).then(() => undefined, () => undefined);
        p.emitBatch(unrelatedActivity(p.state.sessionId));
        if (!held) throw new Error("Native title readback is not held");
        const command = held;
        held = undefined;
        if (failure === "stats-error" || failure === "state-error") {
          p.emit({ type: "response", id: command.id, command: command.type, success: false, error: "PRIVATE-READBACK-DIAGNOSTIC" });
        } else {
          const data: Record<string, unknown> = stage === "stats" ? { sessionFile: source } : { ...p.state };
          if (failure.endsWith("file-B")) {
            p.state.sessionFile = target;
            data.sessionFile = target;
          } else if (failure.endsWith("file-missing")) delete data.sessionFile;
          else if (failure.endsWith("file-empty")) data.sessionFile = "";
          else if (failure.endsWith("file-malformed")) data.sessionFile = 123;
          else if (failure === "name-missing") delete data.sessionName;
          else if (failure === "name-malformed") data.sessionName = 123;
          else if (failure === "name-mismatch") {
            p.state.sessionName = "Another actual native title";
            data.sessionName = p.state.sessionName;
          }
          p.reply(command, data);
        }
        const result = await outcome;
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(String(result.error)).not.toContain("PRIVATE-TITLE-DIAGNOSTIC");
          expect(String(result.error)).not.toContain("PRIVATE-READBACK-DIAGNOSTIC");
        }
        await cancellation;
        expect(p.updates).toEqual([]);
        expect(p.usages).toEqual([]);
        expect(p.failures).toEqual([]);
        const control = p.received.slice(before);
        expect(control.filter((command) => command.type === "set_session_name")).toHaveLength(1);
        expect(control.filter((command) => command.type === "get_session_stats")).toHaveLength(1);
        expect(control.filter((command) => command.type === "get_state")).toHaveLength(stage === "state" ? 1 : 0);
        expect(control.filter((command) => command.type === "prompt" || command.type === "abort")).toEqual([]);
        if (invalidate) {
          const nativeBefore = p.received.length;
          for (const sessionId of [source, target]) {
            await expect(p.connection.prompt({ sessionId, prompt: [{ type: "text", text: "not adopted or restored" }] })).rejects.toThrow();
          }
          expect(p.received.slice(nativeBefore).filter((command) => command.type === "prompt")).toEqual([]);
          p.emit({ type: "response", id: command.id, command: command.type, success: true, data: { ...p.state, sessionFile: source } });
          await expect(p.connection.prompt({ sessionId: source, prompt: [{ type: "text", text: "late A cannot restore" }] })).rejects.toThrow();
          p.state.sessionFile = source;
          p.setState((query) => { p.reply(query, p.state); });
          p.setStats((query) => { p.reply(query, { sessionFile: p.state.sessionFile }); });
          const recovered = await p.connection.newSession({ cwd: directory, mcpServers: [] });
          expect(recovered.sessionId).toBe(source);
        }
        await expect(ordinaryPrompt(p, source)).resolves.toEqual({ stopReason: "end_turn" });
      } finally {
        if (held) p.reply(held, stage === "stats" ? { sessionFile: source } : p.state);
        await outcome;
        await cancellation;
      }
    },
  );

  it.each(["set_session_name", "get_session_stats", "get_state", "notification"] as const)(
    "keeps local cancel within its own %s wait and never sends native abort",
    async (phase) => {
      const { p, source } = await setup();
      const started = deferred<void>();
      const notificationGate = deferred<void>();
      let release: (() => void) | undefined;
      let gated = false;
      p.setName((command) => {
        p.state.sessionName = String(command.name);
        const respond = () => { p.emit({ type: "response", id: command.id, command: command.type, success: true }); };
        if (phase === "set_session_name" && !gated) {
          gated = true; release = respond; started.resolve();
        } else respond();
      });
      p.setStats((command) => {
        if (phase === "get_session_stats" && !gated) {
          gated = true;
          release = () => { p.reply(command, { sessionFile: p.state.sessionFile }); };
          started.resolve();
        } else p.reply(command, { sessionFile: p.state.sessionFile });
      });
      p.setState((command) => {
        if (phase === "get_state" && !gated) {
          gated = true; release = () => { p.reply(command, p.state); }; started.resolve();
        } else p.reply(command, p.state);
      });
      p.setUpdate(async (notification) => {
        if (phase === "notification" && notification.update.sessionUpdate === "session_info_update" && !gated) {
          gated = true; release = () => { notificationGate.resolve(); }; started.resolve();
          await notificationGate.promise;
        }
        p.updates.push(notification);
      });
      const before = p.received.length;
      const pending = p.connection.prompt({
        sessionId: source, prompt: [{ type: "text", text: "/rename Local cancel boundary" }],
      });
      let finished = false;
      const outcome = pending.then(
        (value) => { finished = true; return { ok: true as const, value }; },
        (error: unknown) => { finished = true; return { ok: false as const, error }; },
      );
      let cancellation: Promise<void> | undefined;
      let cancelFinished = false;
      try {
        await Promise.race([
          started.promise,
          outcome.then(() => { throw new Error("Local title cancel did not reach its gate"); }),
        ]);
        cancellation = p.connection.cancel({ sessionId: source });
        void cancellation.then(() => { cancelFinished = true; }, () => { cancelFinished = true; });
        p.emitBatch(unrelatedActivity(p.state.sessionId));
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(finished).toBe(false);
        expect(cancelFinished).toBe(false);
        expect(p.received.slice(before).filter((command) => command.type === "abort" || command.type === "prompt")).toEqual([]);
        const resume = release;
        release = undefined;
        if (!resume) throw new Error("Cancelled title producer is missing");
        resume();
        await expect(pending).resolves.toEqual({ stopReason: phase === "notification" ? "end_turn" : "cancelled" });
        await cancellation;
        expect(p.received.slice(before).filter((command) => command.type === "get_session_stats")).toHaveLength(1);
        expect(p.received.slice(before).filter((command) => command.type === "get_state")).toHaveLength(
          phase === "get_state" || phase === "notification" ? 1 : 0,
        );
        const titles = p.updates.filter((notification) => notification.update.sessionUpdate === "session_info_update");
        expect(titles).toHaveLength(phase === "notification" ? 1 : 0);
        expect(p.usages).toEqual([]);
        await expect(ordinaryPrompt(p, source)).resolves.toEqual({ stopReason: "end_turn" });
      } finally {
        release?.();
        notificationGate.resolve();
        await outcome;
        await cancellation?.catch(() => undefined);
      }
    },
  );

  it.each(["set_session_name", "get_session_stats", "get_state", "notification"] as const)(
    "fails globally on EOF while title %s is held without waiting for an unrelated outcome",
    async (phase) => {
      const { p, source } = await setup();
      const started = deferred<void>();
      const notificationGate = deferred<void>();
      let held: Record<string, unknown> | undefined;
      let gated = false;
      let closed = false;
      p.setName((command) => {
        p.state.sessionName = String(command.name);
        if (phase === "set_session_name" && !gated) {
          gated = true; held = command; started.resolve();
        } else p.emit({ type: "response", id: command.id, command: command.type, success: true });
      });
      p.setStats((command) => {
        if (phase === "get_session_stats" && !gated) {
          gated = true; held = command; started.resolve();
        } else p.reply(command, { sessionFile: p.state.sessionFile });
      });
      p.setState((command) => {
        if (phase === "get_state" && !gated) {
          gated = true; held = command; started.resolve();
        } else p.reply(command, p.state);
      });
      p.setUpdate(async (notification) => {
        if (phase === "notification" && notification.update.sessionUpdate === "session_info_update" && !gated) {
          gated = true; started.resolve();
          await notificationGate.promise;
        }
      });
      const pending = p.connection.prompt({
        sessionId: source, prompt: [{ type: "text", text: "/rename EOF cannot acknowledge me" }],
      });
      const outcome = pending.then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      try {
        await Promise.race([
          started.promise,
          outcome.then(() => { throw new Error("Title operation did not reach its EOF gate"); }),
        ]);
        p.emitBatch(unrelatedActivity(p.state.sessionId));
        p.close();
        closed = true;
        await expect(pending).rejects.toThrow();
        expect(p.failures).toHaveLength(1);
        expect(p.usages).toEqual([]);
      } finally {
        notificationGate.resolve();
        if (held && !closed) {
          if (phase === "set_session_name") p.emit({ type: "response", id: held.id, command: held.type, success: true });
          else p.reply(held, phase === "get_session_stats" ? { sessionFile: source } : p.state);
        }
        await outcome;
      }
    },
  );

  it.each(["error", "aborted"] as const)("retains ordinary NativePrompt root %s after a completed title control", async (root) => {
    const { p, source } = await setup();
    await expect(p.connection.prompt({
      sessionId: source, prompt: [{ type: "text", text: "/rename Before a real prompt" }],
    })).resolves.toEqual({ stopReason: "end_turn" });
    const prompt = ordinaryPrompt(p, source, [], root);
    if (root === "error") await expect(prompt).rejects.toThrow();
    else await expect(prompt).resolves.toEqual({ stopReason: "cancelled" });
    expect(p.failures).toEqual([]);
    await expect(ordinaryPrompt(p, source)).resolves.toEqual({ stopReason: "end_turn" });
  });
});
