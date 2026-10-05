import { spawn, type ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { AgentSideConnection, RequestError, type Agent, type Stream } from "@agentclientprotocol/sdk";
import { LODY_EXTENSION_METHODS } from "acp-extension-core";
import packageJson from "../package.json" with { type: "json" };

import { OmpRpcConnection } from "./connection.js";

const SHUTDOWN_GRACE_MS = 1_000;

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, SHUTDOWN_GRACE_MS);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

/** One OMP RPC process per ACP connection; OMP remains installed by the user. */
export type ServeOptions = {
  onParentFailure(error: Error): void;
};

export function serve(stream: Stream, options: ServeOptions) {
  let child: ChildProcess | undefined;
  let runtime: OmpRpcConnection | undefined;
  let cwd: string | undefined;
  let closing: Promise<void> | undefined;
  let parentFailed = false;
  let closeRequested = false;
  const parentAbort = new AbortController();
  const parentInput = new TransformStream();
  void stream.readable.pipeTo(parentInput.writable, { signal: parentAbort.signal }).catch(() => undefined);

  const abortParent = (error: Error): void => {
    if (parentFailed || closeRequested) return;
    parentFailed = true;
    process.exitCode = 1;
    options.onParentFailure(error);
    void stream.writable.abort(error).catch(() => undefined);
    parentAbort.abort(error);
    void close(true);
  };

  const close = (failure = false): Promise<void> => {
    if (!failure) closeRequested = true;
    if (closing) return closing;
    closing = (async () => {
      runtime?.close();
      const owned = child;
      if (!owned?.pid) return;
      if (process.platform === "win32") owned.stdin?.end();
      else {
        try {
          process.kill(-owned.pid, "SIGTERM");
        } catch {
          // The owned process already exited.
        }
      }
      await waitForExit(owned);
      if (owned.exitCode === null && owned.signalCode === null && process.platform !== "win32") {
        try {
          process.kill(-owned.pid, "SIGKILL");
        } catch {
          // The process exited during the grace period.
        }
        await waitForExit(owned);
      }
    })();
    return closing;
  };

  const connection = new AgentSideConnection((client): Agent => {
    const get = async (directory?: string) => {
      if (closing) throw new Error("ACP connection closed");
      if (runtime) {
        if (directory && directory !== cwd) {
          throw RequestError.invalidRequest(undefined, "Use another ACP connection for a different working directory");
        }
        return runtime;
      }
      if (!directory) throw RequestError.invalidRequest(undefined, "Create or resume a session first");
      cwd = directory;
      child = spawn("omp", ["--mode", "rpc"], {
        cwd,
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
      child.stderr!.pipe(process.stderr, { end: false });
      child.once("error", (error) => {
        abortParent(error instanceof Error ? error : new Error(String(error)));
      });
      child.once("exit", (code, signal) => {
        if (!closeRequested) {
          abortParent(new Error(`OMP RPC process exited (${signal ?? code ?? "unknown"})`));
        }
      });
      runtime = new OmpRpcConnection(
        {
          writable: Writable.toWeb(child.stdin!) as unknown as WritableStream<Uint8Array>,
          readable: Readable.toWeb(child.stdout!) as unknown as ReadableStream<Uint8Array>,
        },
        {
          update: (notification) => client.sessionUpdate(notification),
          usage: (usage) => client.extNotification(LODY_EXTENSION_METHODS.sessionUsageUpdate, usage),
          failure: abortParent,
        }
      );
      return runtime;
    };
    const validate = (request: { mcpServers?: unknown[] }) => {
      if (request.mcpServers?.length) {
        throw RequestError.invalidRequest(undefined, "OMP ACP adapter V1 does not support MCP servers");
      }
    };
    return {
      initialize: async () => ({
        protocolVersion: 1,
        agentInfo: { name: "omp-rpc", version: packageJson.version },
        agentCapabilities: {
          promptCapabilities: { image: false, embeddedContext: false },
          // Optional capabilities stay unadvertised until the baseline matrix and review pass.
        },
        authMethods: [],
      }),
      authenticate: async () => {
        throw RequestError.invalidRequest(undefined, "Authenticate through OMP on the execution machine");
      },
      newSession: async (request) => {
        validate(request);
        return (await get(request.cwd)).newSession(request);
      },
      resumeSession: async (request) => {
        validate(request);
        return (await get(request.cwd)).resumeSession(request);
      },
      loadSession: async (request) => {
        validate(request);
        return (await get(request.cwd)).loadSession(request);
      },
      prompt: async (request) => (await get()).prompt(request),
      cancel: async (request) => (await get()).cancel(request),
    };
  }, { readable: parentInput.readable, writable: stream.writable });
  connection.signal.addEventListener("abort", () => void close(), { once: true });
  return { connection, close };
}
