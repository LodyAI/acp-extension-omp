import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { constants } from "node:os";
import { Readable, Writable } from "node:stream";
import { AgentSideConnection, RequestError, type Agent, type Stream } from "@agentclientprotocol/sdk";
import { LODY_EXTENSION_METHODS } from "acp-extension-core";
import packageJson from "../package.json" with { type: "json" };

import { OmpRpcConnection } from "./connection.js";

const SHUTDOWN_GRACE_MS = 1_000;
const SHUTDOWN_POLL_MS = 25;

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

/** Signal 0 probes the OMP process group; anything but ESRCH means a member is still there. */
function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function stdioOpen(child: ChildProcess): boolean {
  return [child.stdout, child.stderr].some((stream) => stream != null && !stream.closed && !stream.destroyed);
}

/** Deadlines are on the monotonic `performance.now()` clock, so wall-clock steps cannot stretch a wait. */
async function waitUntil(done: () => boolean, deadline: number): Promise<boolean> {
  while (!done()) {
    if (performance.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, SHUTDOWN_POLL_MS));
  }
  return true;
}

async function waitForExit(child: ChildProcess): Promise<boolean> {
  if (hasExited(child)) return true;
  return new Promise<boolean>((resolve) => {
    const finish = (exited: boolean): void => {
      clearTimeout(timeout);
      child.removeListener("exit", onExit);
      resolve(exited);
    };
    const onExit = (): void => finish(true);
    const timeout = setTimeout(() => finish(hasExited(child)), SHUTDOWN_GRACE_MS);
    child.once("exit", onExit);
    if (hasExited(child)) finish(true);
  });
}

const SHUTDOWN_SIGNALS = ["SIGTERM", "SIGINT", "SIGHUP"] as const;

type SignalTarget = Pick<NodeJS.EventEmitter, "on" | "removeListener"> & {
  readonly pid: number;
  kill(pid: number, signal: NodeJS.Signals): boolean;
  exit(code: number): void;
};

/**
 * The detached OMP process group never sees signals sent to the adapter, so reap it first,
 * then re-raise the same signal. All listeners go on the first signal: a second one takes
 * Node's default exit at once, and so does the re-raise.
 *
 * Only POSIX exits by the signal itself. On Windows libuv re-raises SIGINT/SIGTERM as
 * TerminateProcess(…, 1), so the status is 1; SIGHUP is ENOSYS there and takes the 128+n fallback.
 */
export function closeOnSignals(close: () => Promise<void>, target: SignalTarget = process): void {
  const listeners = new Map<NodeJS.Signals, () => void>();
  for (const signal of SHUTDOWN_SIGNALS) {
    const listener = (): void => {
      for (const [registered, registeredListener] of listeners) target.removeListener(registered, registeredListener);
      void close()
        .catch(() => undefined)
        .finally(() => {
          try {
            target.kill(target.pid, signal);
          } catch {
            // Windows cannot raise every signal (SIGHUP is ENOSYS); keep a non-zero, signal-numbered status.
            target.exit(128 + constants.signals[signal]);
          }
        });
    };
    listeners.set(signal, listener);
    target.on(signal, listener);
  }
}

/** One OMP RPC process per ACP connection; OMP remains installed by the user. */
export type ServeOptions = {
  onParentFailure(error: Error): void;
  /** @internal Synthetic-test injection only; production launches `omp` directly. */
  spawnProcess?: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
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
  const reportParentFailure = (error: Error): void => {
    process.exitCode = 1;
    if (parentFailed) return;
    parentFailed = true;
    try {
      options.onParentFailure(error);
    } catch {
      // Preserve the original adapter failure.
    }
    void stream.writable.abort(error).catch(() => undefined);
    parentAbort.abort(error);
  };

  const abortParent = (error: Error): void => {
    if (parentFailed || closeRequested) return;
    reportParentFailure(error);
    void close(true).catch(() => undefined);
  };

  const close = (failure = false): Promise<void> => {
    if (!failure) closeRequested = true;
    if (closing) return closing;
    closing = (async () => {
      runtime?.close();
      const owned = child;
      if (!owned?.pid) return;
      const pid = owned.pid;
      const posix = process.platform !== "win32";
      // On POSIX the whole OMP process group must be gone, not only its leader.
      const settled = (): boolean => hasExited(owned) && (!posix || !groupAlive(pid));
      const graceEnds = performance.now() + SHUTDOWN_GRACE_MS;
      if (!posix) owned.stdin?.end();
      else {
        try {
          process.kill(-pid, "SIGTERM");
        } catch {
          // The owned process may have exited before the signal was delivered.
        }
      }

      if (!((await waitForExit(owned)) && (await waitUntil(settled, graceEnds)))) {
        let killError: Error | undefined;
        const recordKillError = (error: Error): void => {
          killError ??= error;
        };
        owned.on("error", recordKillError);
        try {
          const sent = posix ? process.kill(-pid, "SIGKILL") : owned.kill("SIGKILL");
          if (!sent && !hasExited(owned)) killError ??= new Error("OMP force-termination signal was not accepted");
        } catch (error) {
          killError ??= error instanceof Error ? error : new Error(String(error));
        }
        const forceEnds = performance.now() + SHUTDOWN_GRACE_MS;
        const exited = await waitForExit(owned);
        owned.removeListener("error", recordKillError);
        if (!exited || !hasExited(owned) || !(await waitUntil(settled, forceEnds))) {
          // Release what could not be terminated so its handle and pipes no longer keep the adapter alive.
          owned.unref();
          owned.stdin?.destroy();
          owned.stdout?.destroy();
          owned.stderr?.destroy();
          const what = hasExited(owned) ? "OMP process group" : "OMP child process";
          const stuck = new Error(`${what} did not exit after force termination`, { cause: killError });
          try {
            process.stderr.write(`acp-extension-omp: ${stuck.message} (pid ${pid})\n`);
          } catch {
            // The diagnostic is best effort; the rejection below still carries the original failure.
          }
          throw stuck;
        }
      }

      // A descendant that inherited OMP's stdio can hold the pipes open after OMP exits (on Windows the
      // tree is not ours to kill). Let OMP's last output drain, but stop waiting after a second grace period.
      if (!(await waitUntil(() => !stdioOpen(owned), graceEnds + SHUTDOWN_GRACE_MS))) {
        owned.stdin?.destroy();
        owned.stdout?.destroy();
        owned.stderr?.destroy();
      }
    })().catch((error: unknown) => {
      const failure = error instanceof Error ? error : new Error(String(error));
      reportParentFailure(failure);
      throw failure;
    });
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
      child = (options.spawnProcess ?? spawn)("omp", ["--mode", "rpc"], {
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
  connection.signal.addEventListener("abort", () => {
    void close().catch(() => undefined);
  }, { once: true });
  return { connection, close };
}
