import { stat } from "node:fs/promises";
import type * as acp from "@agentclientprotocol/sdk";
import { z } from "zod";
import { SessionUsageAccumulator, type SessionUsageUpdate } from "acp-extension-core";

import { OmpRpcTransport, type OmpStream } from "./rpc-transport.js";

export type OmpHost = {
  update(notification: acp.SessionNotification): Promise<void>;
  usage(usage: SessionUsageUpdate): void | Promise<void>;
  failure(error: Error): void;
};

const ompStateSchema = z.object({
  sessionFile: z.string().optional(),
  sessionId: z.string().optional(),
  model: z.object({ provider: z.string(), id: z.string(), name: z.string() }).optional(),
  thinkingLevel: z.string().optional(),
});

type OmpState = z.infer<typeof ompStateSchema>;

type ActivePrompt = {
  id: string;
  resolve(value: acp.PromptResponse): void;
  reject(error: Error): void;
  done: Promise<acp.PromptResponse>;
  generation: number;
  terminal?: Record<string, unknown>;
  legacyTerminal: boolean;
  abortState?: "requested" | "acknowledged";
  pendingLegacyCancel?: boolean;
  commandFailure?: Error;
};

const legacyStopReasons = new Set([
  "stop",
  "length",
  "toolUse",
  "aborted",
  "error",
]);

const currentPromptStatuses = new Set(["completed", "aborted", "error"]);

function hasOwn(frame: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(frame, key);
}

/** Apply current-protocol status/settlement rules; returns true when the prompt is still waiting. */
function applyCurrentPromptSettlement(
  active: ActivePrompt,
  frame: Record<string, unknown>,
  finish: (active: ActivePrompt, frame: Record<string, unknown>) => void,
  fail: (error: Error) => void,
): boolean {
  if (
    typeof frame.status !== "string" ||
    !currentPromptStatuses.has(frame.status) ||
    typeof frame.sessionSettled !== "boolean"
  ) {
    fail(new Error("OMP terminal result does not provide verified status and settlement"));
    return false;
  }
  if (frame.sessionSettled) finish(active, frame);
  else active.terminal = frame;
  return !frame.sessionSettled;
}

const assistantMessageSchema = z.object({
  role: z.literal("assistant"),
  provider: z.string().min(1),
  model: z.string().min(1),
  usage: z.object({
    input: z.number().nonnegative(),
    output: z.number().nonnegative(),
    cacheRead: z.number().nonnegative(),
    cacheWrite: z.number().nonnegative(),
    reasoningTokens: z.number().nonnegative().optional(),
    cost: z.object({ total: z.number().nonnegative() }).optional(),
  }),
});

const assistantUsageFrameSchema = z.object({
  messageId: z.string().min(1),
  message: assistantMessageSchema,
});

const legacyAssistantUsageFrameSchema = z.object({
  message: assistantMessageSchema.extend({ responseId: z.string().min(1) }),
});

const textMessageUpdateFrameSchema = z.object({
  assistantMessageEvent: z.object({ type: z.literal("text_delta"), delta: z.string().min(1) }),
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function asState(value: unknown): OmpState {
  const parsed = ompStateSchema.safeParse(value);
  if (!parsed.success) throw new Error("OMP did not return a session state");
  return parsed.data;
}

function promptText(blocks: acp.ContentBlock[]): string {
  const text: string[] = [];
  for (const block of blocks) {
    if (block.type !== "text") throw new Error("OMP ACP adapter V1 supports text prompts only");
    text.push(block.text);
  }
  return text.join("\n\n");
}

/** ACP translation for one OMP RPC session process. */
export class OmpRpcConnection {
  private readonly rpc: OmpRpcTransport;
  private sessionId = "";
  private sessionGeneration = 0;
  private active: ActivePrompt | undefined;
  private cancellationInFlight: ActivePrompt | undefined;
  private sessionChanging = false;
  private usage = new SessionUsageAccumulator();
  private notificationTail = Promise.resolve();
  private notificationFailure: Error | undefined;

  constructor(stream: OmpStream, private readonly host: OmpHost) {
    this.rpc = new OmpRpcTransport(stream, (frame) => this.event(frame), (error) => this.fail(error));
  }


  async newSession(request: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    this.rejectMcp(request.mcpServers);
    if (this.active || this.sessionChanging || this.cancellationInFlight) throw new Error("OMP work is still active");
    this.sessionChanging = true;
    try {
      this.sessionId = "";
      const result = await this.rpc.request("new_session");
      if (this.cancelled(result)) throw new Error("OMP cancelled session creation");
      return await this.prepareSession();
    } finally {
      this.sessionChanging = false;
    }
  }

  async resumeSession(request: acp.ResumeSessionRequest): Promise<acp.NewSessionResponse> {
    this.rejectMcp(request.mcpServers);
    return this.openExactSession(request.sessionId);
  }

  async loadSession(request: acp.LoadSessionRequest): Promise<acp.LoadSessionResponse> {
    this.rejectMcp(request.mcpServers);
    const result = await this.openExactSession(request.sessionId);
    return { configOptions: result.configOptions };
  }

  async prompt(request: acp.PromptRequest): Promise<acp.PromptResponse> {
    if (this.active || this.sessionChanging || this.cancellationInFlight) throw new Error("OMP work is still active");
    this.assertSession(request.sessionId);
    const requestId = `prompt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const pending = deferred<acp.PromptResponse>();
    const active: ActivePrompt = {
      id: requestId,
      ...pending,
      done: pending.promise,
      generation: this.sessionGeneration,
      legacyTerminal: true,
    };
    this.active = active;
    try {
      const result = await this.rpc.requestWithId(
        requestId,
        "prompt",
        { message: promptText(request.prompt) },
        (error) => {
          if (this.active === active) active.commandFailure = error;
        },
      );
      const invoked = z.object({ agentInvoked: z.boolean() }).safeParse(result);
      if (invoked.success && this.active === active && !invoked.data.agentInvoked) {
        const record =
          result !== null && typeof result === "object"
            ? (result as Record<string, unknown>)
            : {};
        if (!hasOwn(record, "status") && !hasOwn(record, "sessionSettled")) {
          await this.finishPrompt(active, { status: "completed" });
        } else {
          applyCurrentPromptSettlement(
            active,
            record,
            (target, frame) => {
              void this.finishPrompt(target, frame);
            },
            (error) => this.fail(error),
          );
        }
      }
    } catch (error) {
      if (this.active === active) {
        active.commandFailure = this.promptError(error);
        void this.finishPrompt(active, {
          status: "error",
          error: { message: active.commandFailure.message },
        });
      }
    }
    return pending.promise;
  }

  async cancel(request: acp.CancelNotification): Promise<void> {
    this.assertSession(request.sessionId);
    if (this.cancellationInFlight) throw new Error("OMP cancellation is still active");
    const active = this.active;
    if (!active) return;
    this.cancellationInFlight = active;
    try {
      if (active.terminal?.sessionSettled === true) {
        await active.done;
        return;
      }
      active.abortState = "requested";
      await this.rpc.request("abort");
      active.abortState = "acknowledged";
      if (active.terminal && active.terminal.sessionSettled !== false) void this.finishPrompt(active, active.terminal);
      else if (active.pendingLegacyCancel) void this.finishPrompt(active, { status: "aborted" });
      await active.done;
    } catch (error) {
      if (active.abortState === "requested") this.rpc.close();
      throw error;
    } finally {
      if (this.cancellationInFlight === active) this.cancellationInFlight = undefined;
    }
  }

  close(): void {
    this.rpc.close();
  }

  private async openExactSession(nativeSession: string): Promise<acp.NewSessionResponse> {
    if (!nativeSession) throw new Error("OMP native session id is required");
    if (this.active || this.sessionChanging || this.cancellationInFlight) throw new Error("OMP work is still active");
    this.sessionChanging = true;
    try {
      this.sessionId = "";
      const file = await stat(nativeSession);
      if (!file.isFile() || file.size === 0) throw new Error("OMP native session file is invalid");
      const result = await this.rpc.request("switch_session", { sessionPath: nativeSession });
      if (this.cancelled(result)) throw new Error("OMP cancelled session resume");
      return await this.prepareSession(nativeSession);
    } finally {
      this.sessionChanging = false;
    }
  }

  private async prepareSession(expectedSession?: string): Promise<acp.NewSessionResponse> {
    const state = await this.readState();
    if (!state.sessionFile) throw new Error("OMP did not provide a persistent native session");
    if (expectedSession && state.sessionFile !== expectedSession) throw new Error("OMP selected a different session");
    this.sessionId = state.sessionFile;
    this.sessionGeneration += 1;
    this.usage = new SessionUsageAccumulator();
    const configOptions: acp.SessionConfigOption[] = state.model
      ? [
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: `${state.model.provider}/${state.model.id}`,
            options: [{ value: `${state.model.provider}/${state.model.id}`, name: state.model.name }],
          },
        ]
      : [];
    return { sessionId: this.sessionId, configOptions };
  }

  private async readState(): Promise<OmpState> {
    return asState(await this.rpc.request("get_state"));
  }

  private event(frame: Record<string, unknown>): void {
    const active = this.active;
    if (frame.type === "agent_end" && active) {
      if (active.commandFailure) return;
      if (hasOwn(frame, "yielded")) {
        if (typeof frame.yielded !== "boolean") {
          void this.finishPrompt(active, { status: "error" });
          return;
        }
        active.legacyTerminal = false;
        return;
      }
      if (!active.legacyTerminal) return;
      if (hasOwn(frame, "isTerminal")) {
        if (typeof frame.isTerminal !== "boolean") {
          void this.finishPrompt(active, { status: "error" });
          return;
        }
        if (frame.isTerminal === false) return;
      }
      if (hasOwn(frame, "messages") && !Array.isArray(frame.messages)) {
        void this.finishPrompt(active, { status: "error" });
        return;
      }
      const messages = hasOwn(frame, "messages") && Array.isArray(frame.messages) ? frame.messages : [];
      let assistantMessage: Record<string, unknown> | undefined;
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const value = messages[index];
        if (value === null || typeof value !== "object") continue;
        const message = value as Record<string, unknown>;
        if (message.role === "assistant") {
          assistantMessage = message;
          break;
        }
      }
      if (!assistantMessage) {
        if (active.abortState === "requested") {
          active.pendingLegacyCancel = true;
          return;
        }
        if (active.abortState === "acknowledged") {
          void this.finishPrompt(active, { status: "aborted" });
          return;
        }
        void this.finishPrompt(active, { status: "error" });
        return;
      }
      const assistantStopReason = assistantMessage.stopReason;
      if (typeof assistantStopReason !== "string" || !legacyStopReasons.has(assistantStopReason)) {
        void this.finishPrompt(active, { status: "error" });
        return;
      }
      if (assistantStopReason === "error") {
        void this.finishPrompt(active, { status: "error" });
        return;
      }
      void this.finishPrompt(active, {
        status: assistantStopReason === "aborted" ? "aborted" : "completed",
      });
      return;
    }
    if (frame.type === "prompt_result" && typeof frame.id === "string") {
      if (!active || active.id !== frame.id || active.commandFailure) return;
      const hasCurrentSettlement = hasOwn(frame, "status") || hasOwn(frame, "sessionSettled");
      if (frame.agentInvoked === false && !hasCurrentSettlement) {
        void this.finishPrompt(active, { status: "completed" });
        return;
      }
      applyCurrentPromptSettlement(
        active,
        frame,
        (target, terminal) => {
          void this.finishPrompt(target, terminal);
        },
        (error) => this.fail(error),
      );
      return;
    }
    if (frame.type === "session_settled" && this.active?.terminal) {
      void this.finishPrompt(this.active, { ...this.active.terminal, sessionSettled: true });
      return;
    }
    if (frame.type === "message_end" && active) this.accountUsage(frame, active.generation);
    if (frame.type === "message_update") this.forwardMessage(frame);
  }

  private forwardMessage(frame: Record<string, unknown>): void {
    if (!this.sessionId || !this.active) return;
    const parsed = textMessageUpdateFrameSchema.safeParse(frame);
    if (!parsed.success) return;
    const sessionId = this.sessionId;
    this.enqueueNotification(() =>
      this.host.update({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: parsed.data.assistantMessageEvent.delta },
        },
      })
    );
  }

  private accountUsage(frame: Record<string, unknown>, generation: number): void {
    const sessionId = this.sessionId;
    if (!sessionId || generation !== this.sessionGeneration) return;
    const parsed = assistantUsageFrameSchema.safeParse(frame);
    let message: z.infer<typeof assistantMessageSchema>;
    let messageId: string;
    if (parsed.success) {
      message = parsed.data.message;
      messageId = parsed.data.messageId;
    } else {
      const legacyParsed = legacyAssistantUsageFrameSchema.safeParse(frame);
      if (!legacyParsed.success) return;
      message = legacyParsed.data.message;
      messageId = legacyParsed.data.message.responseId;
    }
    const row = {
      inputTokens: message.usage.input,
      outputTokens: message.usage.output,
      cacheReadInputTokens: message.usage.cacheRead,
      cacheCreationInputTokens: message.usage.cacheWrite,
      ...(message.usage.reasoningTokens === undefined
        ? {}
        : { reasoningOutputTokens: message.usage.reasoningTokens }),
      ...(message.usage.cost?.total === undefined ? {} : { costUSD: message.usage.cost.total }),
    };
    const usage = this.usage.update(sessionId, messageId, {
      [`${message.provider}/${message.model}`]: row,
    });
    if (usage) this.enqueueNotification(() => this.host.usage(usage));
  }

  private enqueueNotification(task: () => void | Promise<void>): void {
    const run = this.notificationTail.then(async () => {
      if (this.notificationFailure) return;
      try {
        await task();
      } catch (error) {
        this.notificationFailure = error instanceof Error ? error : new Error(String(error));
        this.rpc.close();
      }
    });
    this.notificationTail = run.catch(() => undefined);
  }

  private async finishPrompt(active: ActivePrompt, frame: Record<string, unknown>): Promise<void> {
    if (frame.sessionSettled === true) active.terminal = frame;
    for (;;) {
      const observed = this.notificationTail;
      await observed;
      if (this.notificationTail === observed) break;
    }
    if (this.active !== active) return;
    const terminal = active.commandFailure
      ? { status: "error", error: { message: active.commandFailure.message } }
      : frame;
    if (this.cancellationInFlight === active && active.abortState === "requested") {
      active.terminal = terminal;
      return;
    }
    this.active = undefined;
    if (this.cancellationInFlight === active) this.cancellationInFlight = undefined;
    if (terminal.status === "completed") active.resolve({ stopReason: "end_turn" });
    else if (terminal.status === "aborted") active.resolve({ stopReason: "cancelled" });
    else active.reject(active.commandFailure ?? new Error(this.errorMessage(terminal)));
  }

  private fail(error: Error): void {
    const safe = this.safeError(error);
    const active = this.active;
    this.active = undefined;
    this.cancellationInFlight = undefined;
    active?.reject(safe);
    this.host.failure(safe);
  }

  private assertSession(sessionId: string): void {
    if (!this.sessionId || sessionId !== this.sessionId) throw new Error("OMP session identity does not match");
  }

  private rejectMcp(servers: acp.McpServer[] | undefined): void {
    if (servers?.length) throw new Error("OMP ACP adapter V1 does not support MCP server configuration");
  }

  private cancelled(value: unknown): boolean {
    return z.object({ cancelled: z.literal(true) }).safeParse(value).success;
  }

  private errorMessage(_frame: Record<string, unknown>): string {
    return "OMP prompt failed";
  }

  private promptError(error: unknown): Error {
    return this.safeError(error instanceof Error ? error : new Error("OMP prompt failed"));
  }

  private safeError(error: Error): Error {
    const allowed = [
      "OMP RPC command failed",
      "OMP RPC connection closed",
      "OMP RPC stream closed",
      "OMP RPC connection failed",
      "OMP prompt failed",
    ];
    return new Error(allowed.includes(error.message) ? error.message : "OMP prompt failed");
  }
}
