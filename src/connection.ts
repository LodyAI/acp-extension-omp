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
  terminal?: Record<string, unknown>;
};

const assistantUsageFrameSchema = z.object({
  messageId: z.string().min(1),
  message: z.object({
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
  }),
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
  private active: ActivePrompt | undefined;
  private sessionChanging = false;
  private usage = new SessionUsageAccumulator();
  private notificationTail = Promise.resolve();
  private notificationFailure: Error | undefined;

  constructor(stream: OmpStream, private readonly host: OmpHost) {
    this.rpc = new OmpRpcTransport(stream, (frame) => this.event(frame), (error) => this.fail(error));
  }


  async newSession(request: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    this.rejectMcp(request.mcpServers);
    if (this.active || this.sessionChanging) throw new Error("OMP work is still active");
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
    if (this.active || this.sessionChanging) throw new Error("OMP work is still active");
    this.assertSession(request.sessionId);
    const requestId = `prompt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const pending = deferred<acp.PromptResponse>();
    this.active = { id: requestId, ...pending, done: pending.promise };
    try {
      const result = await this.rpc.requestWithId(requestId, "prompt", { message: promptText(request.prompt) });
      if (z.object({ agentInvoked: z.literal(false) }).safeParse(result).success && this.active?.id === requestId) {
        await this.finishPrompt(this.active, { status: "completed" });
      }
    } catch (error) {
      if (this.active?.id === requestId) {
        this.active = undefined;
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
    return pending.promise;
  }

  async cancel(request: acp.CancelNotification): Promise<void> {
    this.assertSession(request.sessionId);
    const active = this.active;
    if (!active) return;
    await this.rpc.request("abort");
    await active.done;
  }

  close(): void {
    this.rpc.close();
  }

  private async openExactSession(nativeSession: string): Promise<acp.NewSessionResponse> {
    if (!nativeSession) throw new Error("OMP native session id is required");
    if (this.active || this.sessionChanging) throw new Error("OMP work is still active");
    this.sessionChanging = true;
    try {
      const file = await stat(nativeSession);
      if (!file.isFile() || file.size === 0) throw new Error("OMP native session file is invalid");
      this.sessionId = "";
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
    if (frame.type === "prompt_result" && typeof frame.id === "string") {
      const active = this.active;
      if (!active || active.id !== frame.id) return;
      if (!["completed", "aborted", "error"].includes(String(frame.status)) || typeof frame.sessionSettled !== "boolean") {
        this.fail(new Error("OMP terminal result does not provide verified status and settlement"));
        return;
      }
      if (frame.sessionSettled) void this.finishPrompt(active, frame);
      else active.terminal = frame;
      return;
    }
    if (frame.type === "session_settled" && this.active?.terminal) {
      void this.finishPrompt(this.active, this.active.terminal);
      return;
    }
    if (frame.type === "message_end") this.accountUsage(frame);
    if (frame.type === "message_update") this.forwardMessage(frame);
  }

  private forwardMessage(frame: Record<string, unknown>): void {
    if (!this.sessionId || !this.active) return;
    const parsed = textMessageUpdateFrameSchema.safeParse(frame);
    if (!parsed.success) return;
    this.enqueueNotification(() =>
      this.host.update({
        sessionId: this.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: parsed.data.assistantMessageEvent.delta },
        },
      })
    );
  }

  private accountUsage(frame: Record<string, unknown>): void {
    const parsed = assistantUsageFrameSchema.safeParse(frame);
    if (!parsed.success || !this.sessionId) return;
    const { message, messageId } = parsed.data;
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
    const usage = this.usage.update(this.sessionId, messageId, {
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
      }
    });
    this.notificationTail = run.catch(() => undefined);
  }

  private async finishPrompt(active: ActivePrompt, frame: Record<string, unknown>): Promise<void> {
    await this.notificationTail;
    if (this.notificationFailure) {
      this.fail(this.notificationFailure);
      return;
    }
    if (this.active !== active) return;
    this.active = undefined;
    if (frame.status === "completed") active.resolve({ stopReason: "end_turn" });
    else if (frame.status === "aborted") active.resolve({ stopReason: "cancelled" });
    else active.reject(new Error(this.errorMessage(frame)));
  }

  private fail(error: Error): void {
    const active = this.active;
    this.active = undefined;
    active?.reject(error);
    this.host.failure(error);
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

  private errorMessage(frame: Record<string, unknown>): string {
    const parsed = z.object({ error: z.object({ message: z.string().min(1) }).optional() }).safeParse(frame);
    return parsed.success ? (parsed.data.error?.message ?? "OMP prompt failed") : "OMP prompt failed";
  }
}
