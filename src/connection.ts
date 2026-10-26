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

const ompModelSchema = z.object({
  provider: z.string().min(1),
  id: z.string().min(1),
  name: z.string().min(1),
});
const ompModelsSchema = z.object({ models: z.array(ompModelSchema) });

type OmpModel = z.infer<typeof ompModelSchema>;

const ompStateSchema = z.object({
  sessionFile: z.string().optional(),
  sessionId: z.string().optional(),
  model: ompModelSchema.optional(),
  sessionName: z.unknown().optional(),
  thinkingLevel: z.string().optional(),
  isStreaming: z.boolean().optional(),
  isCompacting: z.boolean().optional(),
  queuedMessageCount: z.number().optional(),
  hasPendingAsyncWork: z.boolean().optional(),
  isSettled: z.boolean().optional(),
});

const sessionIdentitySchema = z.object({ sessionFile: z.string().min(1) });
const sessionTitleSchema = z.object({ sessionName: z.string().min(1) });
const explicitRenamePrefix = /^\/rename(?=\s)/u;
const nativeTitleControlCharacters = /[\x00-\x1f\x7f-\x9f]/g;
const nativeTitleSpaces = / +/g;

type OmpState = z.infer<typeof ompStateSchema>;

type ActivePrompt = {
  id: string;
  resolve(value: acp.PromptResponse): void;
  reject(error: Error): void;
  done: Promise<acp.PromptResponse>;
  generation: number;
  sessionFile: string;
  localHandled?: boolean;
  promptResultReceived?: boolean;
  identityProbe?: Promise<boolean>;
  completion?: Promise<void>;
  terminal?: Record<string, unknown>;
  legacyTerminal: boolean;
  abortState?: "requested" | "acknowledged";
  pendingLegacyCancel?: boolean;
  commandFailure?: Error;
  outcome?: "completed" | "aborted" | "error";
};

type TitleControl = {
  generation: number;
  sessionFile: string;
  resolve(value: acp.PromptResponse): void;
  reject(error: Error): void;
  done: Promise<acp.PromptResponse>;
  identityProbe?: Promise<boolean>;
  cancelled: boolean;
  committed: boolean;
};

type MessageOrigin = {
  generation: number;
  usageId: string;
  accounted: boolean;
  ids: string[];
};

const assistantStopReasons: Record<string, true> = {
  stop: true,
  length: true,
  toolUse: true,
  aborted: true,
  error: true,
};

const currentPromptStatuses = new Set(["completed", "aborted", "error"]);

function hasOwn(frame: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(frame, key);
}

function lastAssistantMessage(messages: readonly unknown[]): Record<string, unknown> | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const value = messages[index];
    if (value === null || typeof value !== "object") continue;
    const message = value as Record<string, unknown>;
    if (message.role === "assistant") return message;
  }
  return undefined;
}

function absorbPromptOutcome(active: ActivePrompt, status: unknown): void {
  if (
    status === "error" ||
    (status === "aborted" && active.outcome !== "error") ||
    (status === "completed" && active.outcome === undefined)
  ) {
    active.outcome = status;
  }
}

/** Apply current-protocol status/settlement rules; returns true when the prompt is still waiting. */
function applyCurrentPromptSettlement(
  active: ActivePrompt,
  frame: Record<string, unknown>,
  source: "ack" | "result",
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
  // A delayed ACK continuation must not undo a real result, root yield or settlement.
  if (source === "ack" && active.promptResultReceived) return active.terminal?.sessionSettled !== true;
  if (source === "result") active.promptResultReceived = true;
  active.legacyTerminal = false;
  if (frame.sessionSettled) finish(active, frame);
  else {
    absorbPromptOutcome(active, frame.status);
    active.terminal = frame;
  }
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

function promptContent(blocks: acp.ContentBlock[]) {
  const text: string[] = [];
  let images: { type: "image"; data: string; mimeType: string }[] | undefined;
  for (const block of blocks) {
    if (block.type === "text") text.push(block.text);
    else if (block.type === "image") (images ??= []).push({ type: "image", data: block.data, mimeType: block.mimeType });
    else throw new Error("OMP ACP adapter does not support this prompt content");
  }
  const message = text.join("\n\n");
  return images ? { message, images } : { message };
}

/** ACP translation for one OMP RPC session process. */
export class OmpRpcConnection {
  private readonly rpc: OmpRpcTransport;
  private sessionId = "";
  private nativeSessionId = "";
  private sessionGeneration = 0;
  private readonly messageGenerations = new Map<string, MessageOrigin>();
  private active: ActivePrompt | undefined;
  private cancellationInFlight: ActivePrompt | undefined;
  private titleControl: TitleControl | undefined;
  private sessionChanging = false;
  private modelChoices = new Map<string, OmpModel>();
  private modelChangeFailure: { reject(error: Error): void } | undefined;
  private failure: Error | undefined;
  private usage = new SessionUsageAccumulator();
  private notificationTail = Promise.resolve();
  private notificationFailure: Error | undefined;

  constructor(stream: OmpStream, private readonly host: OmpHost) {
    this.rpc = new OmpRpcTransport(stream, (frame) => this.event(frame), (error) => this.fail(error));
  }


  async newSession(request: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    if (this.active || this.sessionChanging || this.cancellationInFlight) throw new Error("OMP work is still active");
    this.sessionChanging = true;
    try {
      this.invalidateSession();
      const result = await this.rpc.request("new_session");
      if (this.cancelled(result)) throw new Error("OMP cancelled session creation");
      return await this.prepareSession(await this.readState());
    } finally {
      this.sessionChanging = false;
    }
  }

  async resumeSession(request: acp.ResumeSessionRequest): Promise<acp.NewSessionResponse> {
    return this.openExactSession(request.sessionId);
  }

  async loadSession(request: acp.LoadSessionRequest): Promise<acp.LoadSessionResponse> {
    const result = await this.openExactSession(request.sessionId);
    return { configOptions: result.configOptions };
  }

  async forkSession(request: acp.ForkSessionRequest): Promise<acp.ForkSessionResponse> {
    if (request.additionalDirectories?.length) throw new Error("OMP additional workspace roots are not supported");
    const lody = request._meta?.lody;
    if (lody && typeof lody === "object" && "forkAtTurn" in lody) {
      const cut = lody.forkAtTurn;
      if (cut && typeof cut === "object" && "turnId" in cut && cut.turnId != null && cut.turnId !== "") {
        throw new Error("OMP historical forkAtTurn is not supported");
      }
    }
    if (!request.sessionId) throw new Error("OMP native session id is required");
    if (this.active || this.sessionChanging || this.cancellationInFlight) throw new Error("OMP work is still active");
    this.sessionChanging = true;
    try {
      this.invalidateSession();
      const source = await this.switchSession(request.sessionId);
      if (
        source.isStreaming || source.isCompacting || source.hasPendingAsyncWork ||
        (source.queuedMessageCount ?? 0) > 0 || source.isSettled === false
      ) throw new Error("OMP work is still active");
      const result = z.object({ cancelled: z.boolean() }).safeParse(await this.rpc.request("fork"));
      if (!result.success) throw new Error("OMP returned an invalid fork response");
      if (result.data.cancelled) throw new Error("OMP cancelled session fork");
      const state = await this.readState();
      if (!state.sessionFile) throw new Error("OMP did not provide a persistent native session");
      if (state.sessionFile === request.sessionId) throw new Error("OMP fork did not select a different session");
      await this.requireSessionFile(state.sessionFile);
      return await this.prepareSession(state);
    } finally {
      this.sessionChanging = false;
    }
  }

  async setSessionConfigOption(request: acp.SetSessionConfigOptionRequest): Promise<acp.SetSessionConfigOptionResponse> {
    if (this.active || this.sessionChanging || this.cancellationInFlight) throw new Error("OMP work is still active");
    this.assertSession(request.sessionId);
    const selected = request.configId === "model" && typeof request.value === "string"
      ? this.modelChoices.get(request.value)
      : undefined;
    if (!selected) throw new Error("OMP configuration option is not available");
    this.sessionChanging = true;
    const failed = deferred<never>();
    this.modelChangeFailure = failed;
    void failed.promise.catch(() => undefined);
    let identityVerified = false;
    let mutationStarted = false;
    try {
      const before = await this.readState();
      if (before.sessionFile !== request.sessionId) throw new Error("OMP selected a different session");
      identityVerified = true;
      if (
        before.isStreaming || before.isCompacting || before.hasPendingAsyncWork ||
        (before.queuedMessageCount ?? 0) > 0 || before.isSettled === false
      ) throw new Error("OMP work is still active");
      mutationStarted = true;
      const applied = ompModelSchema.parse(await this.rpc.request("set_model", {
        provider: selected.provider, modelId: selected.id,
      }));
      if (applied.provider !== selected.provider || applied.id !== selected.id) {
        throw new Error("OMP selected a different model");
      }
      const models = await this.readModels();
      const state = await this.readState();
      if (state.sessionFile !== request.sessionId) throw new Error("OMP selected a different session");
      if (!state.model || state.model.provider !== selected.provider || state.model.id !== selected.id) {
        throw new Error("OMP selected a different model");
      }
      const configuration = this.modelConfiguration(state, models);
      if (this.failure) throw this.failure;
      this.modelChoices = configuration.modelChoices;
      this.enqueueNotification(() => {
        if (this.failure) return;
        return this.host.update({
          sessionId: request.sessionId,
          update: { sessionUpdate: "config_option_update", configOptions: configuration.configOptions },
        });
      });
      for (;;) {
        const observed = this.notificationTail;
        await Promise.race([observed, failed.promise]);
        if (this.failure) throw this.failure;
        if (this.notificationTail === observed) break;
      }
      return { configOptions: configuration.configOptions };
    } catch (error) {
      if (mutationStarted || !identityVerified || this.failure) this.invalidateSession();
      throw this.promptError(error);
    } finally {
      if (this.modelChangeFailure === failed) this.modelChangeFailure = undefined;
      this.sessionChanging = false;
    }
  }

  async prompt(request: acp.PromptRequest): Promise<acp.PromptResponse> {
    if (this.active || this.sessionChanging || this.cancellationInFlight) throw new Error("OMP work is still active");
    this.assertSession(request.sessionId);
    const block = request.prompt.length === 1 ? request.prompt[0] : undefined;
    if (block?.type === "text" && explicitRenamePrefix.test(block.text)) {
      const title = block.text.slice("/rename".length).trim();
      if (title) return this.beginTitleControl(request.sessionId, title);
    }
    const content = promptContent(request.prompt);
    const requestId = `prompt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const pending = deferred<acp.PromptResponse>();
    const active: ActivePrompt = {
      id: requestId,
      ...pending,
      done: pending.promise,
      generation: this.sessionGeneration,
      sessionFile: request.sessionId,
      legacyTerminal: true,
    };
    this.active = active;
    try {
      const result = await this.rpc.requestWithId(
        requestId,
        "prompt",
        content,
        (error) => {
          if (this.active === active) active.commandFailure = error;
        },
      );
      const invoked = z.object({ agentInvoked: z.boolean() }).safeParse(result);
      if (invoked.success && this.active === active && !invoked.data.agentInvoked) {
        active.localHandled = true;
        const record =
          result !== null && typeof result === "object"
            ? (result as Record<string, unknown>)
            : {};
        if (!hasOwn(record, "status") && !hasOwn(record, "sessionSettled")) {
          if (!active.promptResultReceived) await this.finishPrompt(active, { status: "completed" });
        } else {
          applyCurrentPromptSettlement(
            active,
            record,
            "ack",
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
        if (active.terminal?.sessionSettled !== false) {
          void this.finishPrompt(active, {
            status: "error",
            error: { message: active.commandFailure.message },
          });
        }
      }
    }
    return pending.promise;
  }

  async cancel(request: acp.CancelNotification): Promise<void> {
    this.assertSession(request.sessionId);
    if (this.cancellationInFlight) throw new Error("OMP cancellation is still active");
    const title = this.titleControl;
    if (title) {
      if (!title.committed) title.cancelled = true;
      await title.done;
      return;
    }
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

  private beginTitleControl(sessionFile: string, title: string): Promise<acp.PromptResponse> {
    const pending = deferred<acp.PromptResponse>();
    const control: TitleControl = {
      resolve: pending.resolve,
      reject: pending.reject,
      done: pending.promise,
      sessionFile,
      generation: this.sessionGeneration,
      cancelled: false,
      committed: false,
    };
    this.titleControl = control;
    this.sessionChanging = true;
    void this.completeTitleControl(control, title);
    return control.done;
  }

  private async completeTitleControl(control: TitleControl, title: string): Promise<void> {
    let commandFailure: Error | undefined;
    try {
      if (this.failure) throw this.failure;
      if (control.cancelled) {
        control.resolve({ stopReason: "cancelled" });
        return;
      }
      try {
        await this.rpc.request("set_session_name", { name: title });
      } catch (error) {
        if (this.failure) throw error;
        commandFailure = this.promptError(error);
      }
      if (this.failure) throw this.failure;
      control.identityProbe ??= this.verifyLocalIdentity(control);
      const verified = await control.identityProbe;
      if (this.failure) throw this.failure;
      if (!verified || commandFailure) throw commandFailure ?? new Error("OMP prompt failed");
      if (control.cancelled) {
        control.resolve({ stopReason: "cancelled" });
        return;
      }
      let state: unknown;
      try {
        state = await this.rpc.request("get_state");
      } catch (error) {
        this.verifySessionIdentity(control, undefined);
        throw error;
      }
      if (!this.verifySessionIdentity(control, state)) throw new Error("OMP prompt failed");
      const expectedTitle = title.replace(nativeTitleControlCharacters, " ").replace(nativeTitleSpaces, " ").trim();
      const actual = sessionTitleSchema.safeParse(state);
      if (!actual.success || !expectedTitle || actual.data.sessionName !== expectedTitle) throw new Error("OMP prompt failed");
      if (this.failure) throw this.failure;
      if (control.cancelled) {
        control.resolve({ stopReason: "cancelled" });
        return;
      }
      control.committed = true;
      this.enqueueNotification(() => {
        if (this.failure || this.titleControl !== control) return;
        return this.host.update({
          sessionId: control.sessionFile,
          update: {
            sessionUpdate: "session_info_update",
            title: actual.data.sessionName,
            _meta: { lody: { titleSource: "explicit" } },
          },
        });
      });
      for (;;) {
        const observed = this.notificationTail;
        await Promise.race([observed, control.done]);
        if (this.failure) throw this.failure;
        if (this.notificationTail === observed) break;
      }
      control.resolve({ stopReason: "end_turn" });
    } catch (error) {
      if (this.failure && this.titleControl === control) this.invalidateSession();
      control.reject(commandFailure ?? this.promptError(error));
    } finally {
      if (this.titleControl === control) {
        this.titleControl = undefined;
        this.sessionChanging = false;
      }
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
      this.invalidateSession();
      return await this.prepareSession(await this.switchSession(nativeSession));
    } finally {
      this.sessionChanging = false;
    }
  }

  private async requireSessionFile(sessionFile: string): Promise<void> {
    const file = await stat(sessionFile);
    if (!file.isFile() || file.size === 0) throw new Error("OMP native session file is invalid");
  }

  private async switchSession(nativeSession: string): Promise<OmpState> {
    await this.requireSessionFile(nativeSession);
    const result = await this.rpc.request("switch_session", { sessionPath: nativeSession });
    if (this.cancelled(result)) throw new Error("OMP cancelled session resume");
    const state = await this.readState();
    if (state.sessionFile !== nativeSession) throw new Error("OMP selected a different session");
    return state;
  }

  private async prepareSession(state: OmpState): Promise<acp.NewSessionResponse> {
    if (!state.sessionFile) throw new Error("OMP did not provide a persistent native session");
    const models = await this.readModels();
    const current = await this.readState();
    if (current.sessionFile !== state.sessionFile) throw new Error("OMP selected a different session");
    const configuration = this.modelConfiguration(current, models);
    if (this.failure) throw this.failure;
    this.sessionId = current.sessionFile;
    this.nativeSessionId = current.sessionId ?? "";
    this.sessionGeneration += 1;
    this.usage = new SessionUsageAccumulator();
    this.modelChoices = configuration.modelChoices;
    return { sessionId: this.sessionId, configOptions: configuration.configOptions };
  }

  private async readModels(): Promise<OmpModel[]> {
    const result = ompModelsSchema.safeParse(await this.rpc.request("get_available_models"));
    if (!result.success) throw new Error("OMP did not return an available model catalog");
    return result.data.models;
  }

  private modelConfiguration(state: OmpState, models: OmpModel[]) {
    const modelChoices = new Map<string, OmpModel>();
    for (const model of models) {
      const value = `${model.provider}/${model.id}`;
      const previous = modelChoices.get(value);
      if (previous && (previous.provider !== model.provider || previous.id !== model.id)) {
        throw new Error("OMP model catalog contains ambiguous values");
      }
      if (!previous) modelChoices.set(value, model);
    }
    if (!state.model) {
      modelChoices.clear();
      return { configOptions: [], modelChoices };
    }
    const currentValue = `${state.model.provider}/${state.model.id}`;
    const current = modelChoices.get(currentValue);
    if (!current || current.provider !== state.model.provider || current.id !== state.model.id) {
      throw new Error("OMP current model is not available in the catalog");
    }
    const configOptions: acp.SessionConfigOption[] = [{
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue,
      options: Array.from(modelChoices, ([value, model]) => ({ value, name: model.name })),
    }];
    return { configOptions, modelChoices };
  }

  private invalidateSession(): void {
    this.sessionId = "";
    this.nativeSessionId = "";
    this.modelChoices.clear();
  }

  private async readState(): Promise<OmpState> {
    return asState(await this.rpc.request("get_state"));
  }

  private event(frame: Record<string, unknown>): void {
    const wrongSession =
      typeof frame.sessionId === "string" &&
      !!this.nativeSessionId &&
      frame.sessionId !== this.nativeSessionId &&
      frame.sessionId !== this.sessionId;
    if (frame.type === "message_start" || frame.type === "message_update" || frame.type === "message_end") {
      if (!this.acceptMessage(frame, wrongSession)) return;
    } else if (wrongSession) return;
    const active = this.active;
    if (frame.type === "agent_end" && active) {
      if (active.commandFailure || active.terminal?.sessionSettled === true) return;
      if (hasOwn(frame, "yielded")) {
        if (typeof frame.yielded !== "boolean") {
          throw new Error("OMP root yield does not provide a verified yield marker");
        }
        active.legacyTerminal = false;
        const terminal = active.terminal;
        if (!frame.yielded || terminal?.sessionSettled !== false) return;
        if (!hasOwn(frame, "messages") || !Array.isArray(frame.messages)) {
          throw new Error("OMP root yield does not provide verified messages");
        }
        const assistantMessage = lastAssistantMessage(frame.messages);
        const stopReason = assistantMessage?.stopReason;
        if (assistantMessage && (typeof stopReason !== "string" || !hasOwn(assistantStopReasons, stopReason))) {
          throw new Error("OMP root yield does not provide a verified stop reason");
        }
        // Only a true yield contributes; retry errors have yielded:false.
        absorbPromptOutcome(active, stopReason === "error" || stopReason === "aborted" ? stopReason : "completed");
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
      const assistantMessage = lastAssistantMessage(messages);
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
      if (typeof assistantStopReason !== "string" || !hasOwn(assistantStopReasons, assistantStopReason)) {
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
      if (!active || active.id !== frame.id) return;
      if (frame.agentInvoked === false) active.localHandled = true;
      const hasCurrentSettlement = hasOwn(frame, "status") || hasOwn(frame, "sessionSettled");
      if (frame.agentInvoked === false && !hasCurrentSettlement) {
        active.promptResultReceived = true;
        void this.finishPrompt(active, { status: "completed" });
        return;
      }
      applyCurrentPromptSettlement(
        active,
        frame,
        "result",
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
    if (frame.type === "message_end" && active) this.accountUsage(frame);
    if (frame.type === "message_update") this.forwardMessage(frame);
  }

  private acceptMessage(frame: Record<string, unknown>, wrongSession: boolean): boolean {
    const active = this.active;
    const generation =
      active && this.sessionId && !this.sessionChanging && !wrongSession
        ? active.generation
        : 0;
    const message = frame.message;
    const responseIdValue =
      message !== null && typeof message === "object"
        ? (message as Record<string, unknown>).responseId
        : undefined;
    const responseId = typeof responseIdValue === "string" && responseIdValue ? `response:${responseIdValue}` : undefined;
    const messageId = typeof frame.messageId === "string" && frame.messageId ? `message:${frame.messageId}` : undefined;
    const messageOrigin = messageId ? this.messageGenerations.get(messageId) : undefined;
    const responseOrigin = responseId ? this.messageGenerations.get(responseId) : undefined;
    if (messageId || responseId) {
      // Co-observed aliases carry the oldest evidence, even if both were seen separately.
      let origin = messageOrigin ?? responseOrigin;
      if (messageOrigin && responseOrigin && messageOrigin !== responseOrigin) {
        const keepResponse =
          responseOrigin.generation < messageOrigin.generation ||
          (responseOrigin.generation === messageOrigin.generation && responseOrigin.accounted && !messageOrigin.accounted);
        origin = keepResponse ? responseOrigin : messageOrigin;
        const other = keepResponse ? messageOrigin : responseOrigin;
        for (const id of other.ids) {
          this.messageGenerations.set(id, origin);
          origin.ids.push(id);
        }
      }
      origin ??= { generation, usageId: messageId ?? responseId!, accounted: false, ids: [] };
      if (this.modelChangeFailure || this.titleControl) origin.generation = 0;
      if (messageId && !messageOrigin) {
        this.messageGenerations.set(messageId, origin);
        origin.ids.push(messageId);
      }
      if (responseId && !responseOrigin && responseId !== messageId) {
        this.messageGenerations.set(responseId, origin);
        origin.ids.push(responseId);
      }
      if (origin.generation !== generation) return false;
    }
    return generation !== 0;
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

  private accountUsage(frame: Record<string, unknown>): void {
    const sessionId = this.sessionId;
    const parsed = assistantUsageFrameSchema.safeParse(frame);
    let message: z.infer<typeof assistantMessageSchema>;
    let messageId: string;
    if (parsed.success) {
      message = parsed.data.message;
      messageId = `message:${parsed.data.messageId}`;
    } else {
      const legacyParsed = legacyAssistantUsageFrameSchema.safeParse(frame);
      if (!legacyParsed.success) return;
      message = legacyParsed.data.message;
      messageId = `response:${legacyParsed.data.message.responseId}`;
    }
    const origin = this.messageGenerations.get(messageId);
    if (origin) {
      origin.accounted = true;
      messageId = origin.usageId;
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

  private finishPrompt(active: ActivePrompt, frame: Record<string, unknown>): Promise<void> {
    if (this.active !== active) return Promise.resolve();
    absorbPromptOutcome(active, frame.status);
    if (frame.sessionSettled === true) active.terminal = frame;
    if (active.completion) return active.completion;
    const completion: Promise<void> = this.completePrompt(active, frame).finally(() => {
      if (active.completion !== completion) return;
      active.completion = undefined;
      // Settlement or abort ACK can arrive while the shared completion is returning.
      if (this.active === active && active.terminal &&
        active.terminal.sessionSettled !== false && active.abortState !== "requested") {
        void this.finishPrompt(active, active.terminal);
      }
    });
    active.completion = completion;
    return completion;
  }

  private async verifyLocalIdentity(operation: ActivePrompt | TitleControl): Promise<boolean> {
    try {
      return this.verifySessionIdentity(operation, await this.rpc.request("get_session_stats"));
    } catch {
      // An unsupported/rejected query cannot prove the original file identity.
      return this.verifySessionIdentity(operation, undefined);
    }
  }

  private verifySessionIdentity(operation: ActivePrompt | TitleControl, value: unknown): boolean {
    if (this.active !== operation && this.titleControl !== operation) return false;
    const result = sessionIdentitySchema.safeParse(value);
    if (result.success && result.data.sessionFile === operation.sessionFile) return true;
    if (operation.generation === this.sessionGeneration) this.invalidateSession();
    return false;
  }

  private async completePrompt(active: ActivePrompt, frame: Record<string, unknown>): Promise<void> {
    let identityVerified = true;
    for (;;) {
      if (active.localHandled || active.commandFailure) {
        active.identityProbe ??= this.verifyLocalIdentity(active);
        identityVerified = await active.identityProbe;
      }
      if (this.active !== active) return;
      const observed = this.notificationTail;
      await observed;
      if (this.active !== active) return;
      if (this.notificationTail !== observed) continue;
      // A local ACK or rejection may have arrived during notification drain.
      if ((active.localHandled || active.commandFailure) && !active.identityProbe) continue;
      break;
    }
    if (active.terminal?.sessionSettled === false) return;
    const terminal = active.terminal ?? frame;
    const status = active.commandFailure || !identityVerified ? "error" : active.outcome;
    if (this.cancellationInFlight === active && active.abortState === "requested") {
      active.terminal = terminal;
      return;
    }
    this.active = undefined;
    if (this.cancellationInFlight === active) this.cancellationInFlight = undefined;
    if (status === "completed") active.resolve({ stopReason: "end_turn" });
    else if (status === "aborted") active.resolve({ stopReason: "cancelled" });
    else active.reject(active.commandFailure ?? new Error(this.errorMessage(terminal)));
  }

  private fail(error: Error): void {
    const safe = this.safeError(error);
    this.failure = safe;
    this.modelChangeFailure?.reject(safe);
    this.titleControl?.reject(safe);
    const active = this.active;
    this.active = undefined;
    this.cancellationInFlight = undefined;
    active?.reject(safe);
    this.host.failure(safe);
  }

  private assertSession(sessionId: string): void {
    if (!this.sessionId || sessionId !== this.sessionId) throw new Error("OMP session identity does not match");
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
