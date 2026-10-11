import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { installSignalShutdown, type SignalHost } from "../src/lifecycle.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("host signal shutdown", () => {
  it("awaits one idempotent close before exiting on SIGTERM or SIGINT", async () => {
    const host = new EventEmitter() as unknown as SignalHost & EventEmitter;
    const closeStarted = deferred<void>();
    const closeGate = deferred<void>();
    const exitDone = deferred<void>();
    let closeCount = 0;
    let exitCode: number | undefined;
    const remove = installSignalShutdown(
      async () => {
        closeCount += 1;
        closeStarted.resolve(undefined);
        await closeGate.promise;
      },
      host,
      (code) => {
        exitCode = code;
        exitDone.resolve(undefined);
      },
    );
    host.emit("SIGTERM");
    host.emit("SIGINT");
    await closeStarted.promise;
    expect(closeCount).toBe(1);
    expect(exitCode).toBeUndefined();
    closeGate.resolve(undefined);
    await exitDone.promise;
    expect(exitCode).toBe(0);
    remove();
  });
});
