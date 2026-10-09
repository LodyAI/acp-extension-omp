import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { constants, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { ndJsonStream } from "@agentclientprotocol/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeOnSignals, serve } from "../src/server.js";

type SyntheticSpawn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const tempDirectories: string[] = [];

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  // Integration boundary: protect against a real ACP/child-process deadlock.
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), 3_000);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

function restorePath(value: string | undefined): void {
  if (value === undefined) delete process.env.PATH;
  else process.env.PATH = value;
}


async function fakeOmp(mode: "serve" | "exit" | "eof" | "malformed" | "missing" | "ignore-eof") {
  const directory = await mkdtemp(join(tmpdir(), "acp-extension-omp-test-"));
  tempDirectories.push(directory);
  if (mode === "missing") return directory;
  const executable = join(directory, "omp");
  const source = `#!/usr/bin/env node
const readline = require("node:readline");
const args = process.argv.slice(2);
if (${JSON.stringify(mode)} === "exit") process.exit(23);
if (${JSON.stringify(mode)} === "ignore-eof") {
  process.on("SIGTERM", () => {});
  require("node:fs").writeFileSync(require("node:path").join(__dirname, "child.pid"), String(process.pid));
  const holdOpen = require("node:net").createServer();
  holdOpen.listen(0, "127.0.0.1");
}
if (args.join(" ") !== "--mode rpc") process.exit(42);
if (${JSON.stringify(mode)} === "eof") process.stdout.end();
if (${JSON.stringify(mode)} === "malformed") process.stdout.write("not-json\\n");
const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  if (${JSON.stringify(mode)} !== "serve" && ${JSON.stringify(mode)} !== "ignore-eof") return;
  const command = JSON.parse(line);
  if (command.type === "new_session" || command.type === "switch_session") {
    process.stdout.write(JSON.stringify({ type: "response", id: command.id, command: command.type, success: true, data: {} }) + "\\n");
  } else if (command.type === "get_state") {
    process.stdout.write(JSON.stringify({ type: "response", id: command.id, command: command.type, success: true, data: { sessionFile: "/tmp/fake-omp-session.jsonl", model: { provider: "fixture", id: "model", name: "Fixture" } } }) + "\\n");
  }
});
`;
  await Promise.all([
    writeFile(executable, source, "utf8"),
    writeFile(join(directory, "omp-runner.cjs"), source, "utf8"),
  ]);
  await chmod(executable, 0o755);
  return directory;
}

// Windows fixtures launch Node directly so serve owns the runner PID without a .cmd shell.
function syntheticSpawn(directory: string, onSpawn?: (child: ChildProcess) => void): SyntheticSpawn {
  return (command, args, options) => {
    if (command !== "omp") throw new Error(`Expected synthetic OMP command, got ${command}`);
    const child = process.platform === "win32"
      ? spawn(process.execPath, [join(directory, "omp-runner.cjs"), ...args], options)
      : spawn(command, args, options);
    onSpawn?.(child);
    return child;
  };
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
};

type PendingRequest = Deferred<unknown>;

type Harness = {
  request<T>(method: string, params: Record<string, unknown>): Promise<T>;
  closed: Promise<void>;
  isClosed(): boolean;
  close(): Promise<void>;
  serverClose(): Promise<void>;
};

function harness(spawnProcess?: SyntheticSpawn, onParentFailure: (error: Error) => void = () => {}): Harness {
  let input!: ReadableStreamDefaultController<Uint8Array>;
  const pending = new Map<number, PendingRequest>();
  let nextId = 0;
  let buffered = "";
  const output = new WritableStream<Uint8Array>({
    write(bytes) {
      buffered += decoder.decode(bytes, { stream: true });
      for (;;) {
        const separator = buffered.indexOf("\n");
        if (separator < 0) return;
        const line = buffered.slice(0, separator);
        buffered = buffered.slice(separator + 1);
        if (!line) continue;
        const message = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } };
        if (message.id === undefined) continue;
        const request = pending.get(message.id);
        if (!request) continue;
        pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message ?? "ACP request failed"));
        else request.resolve(message.result);
      }
    },
  });
  const inputStream = new ReadableStream<Uint8Array>({
    start(controller) {
      input = controller;
    },
  });
  const server = serve(ndJsonStream(output, inputStream), {
    onParentFailure,
    ...(spawnProcess ? { spawnProcess } : {}),
  });
  return {
    closed: server.connection.closed,
    request<T>(method, params) {
      const id = ++nextId;
      const result = Promise.withResolvers<unknown>();
      pending.set(id, result);
      input.enqueue(encoder.encode(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`));
      return result.promise as Promise<T>;
    },
    isClosed() {
      return server.connection.signal.aborted;
    },
    async close() {
      try {
        input.close();
      } catch {
        // The ACP input may already be closed after a child failure.
      }
      await server.close();
    },
    serverClose: server.close,
  };
}

afterEach(async () => {
  for (const directory of tempDirectories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("OMP ACP server lifecycle", () => {
  it("launches OMP with only the supported RPC arguments", async () => {
    const directory = await fakeOmp("serve");
    const previousPath = process.env.PATH;
    process.env.PATH = [directory, previousPath ?? ""].join(delimiter);
    const client = harness(process.platform === "win32" ? syntheticSpawn(directory) : undefined);
    try {
      const initialized = await client.request<{ agentInfo: { name: string } }>("initialize", {
        protocolVersion: 1,
        clientCapabilities: {},
      });
      expect(initialized.agentInfo.name).toBe("omp-rpc");
      const session = await withTimeout(
        client.request<{ sessionId: string }>("session/new", { cwd: directory, mcpServers: [] }),
        "session/new"
      );
      expect(session.sessionId).toBe("/tmp/fake-omp-session.jsonl");
    } finally {
      restorePath(previousPath);
      await client.close();
    }
  });

  it.for(["exit", "eof", "malformed", "missing"] as const)("closes the actual ACP connection after OMP %s", async (mode, { skip }) => {
    // A live Node process cannot EOF its stdout on Windows: libuv duplicates the stdio pipe handle and never closes fds 0-2.
    if (mode === "eof" && process.platform === "win32") skip();
    const directory = await fakeOmp(mode);
    const previousPath = process.env.PATH;
    const previousExitCode = process.exitCode;
    process.env.PATH = [directory, dirname(process.execPath)].join(delimiter);
    const client = harness(mode === "missing" || process.platform !== "win32" ? undefined : syntheticSpawn(directory));
    try {
      await client.request<{ agentInfo: { name: string } }>("initialize", {
        protocolVersion: 1,
        clientCapabilities: {},
      });
      void client
        .request("session/new", { cwd: directory, mcpServers: [] })
        .catch(() => undefined);
      await withTimeout(client.closed, "ACP connection.closed");
      expect(client.isClosed()).toBe(true);
      expect(process.exitCode).toBe(1);
    } finally {
      restorePath(previousPath);
      process.exitCode = previousExitCode;
      await client.close();
    }
  });
  // Real child-process exit and the production grace period require the OS clock; fake timers cannot terminate this process.
  it("force-terminates an OMP child that ignores stdin EOF", async () => {
    const previousExitCode = process.exitCode;
    const directory = await fakeOmp("ignore-eof");
    const previousPath = process.env.PATH;
    let fixturePid: number | undefined;
    let ownedChild: ChildProcess | undefined;
    const spawnProcess = syntheticSpawn(directory, (child) => { ownedChild = child; });
    process.env.PATH = [directory, dirname(process.execPath), previousPath ?? ""].join(delimiter);
    const client = harness(spawnProcess);
    try {
      await client.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
      await withTimeout(
        client.request("session/new", { cwd: directory, mcpServers: [] }),
        "session/new"
      );
      fixturePid = Number(await readFile(join(directory, "child.pid"), "utf8"));
      expect(fixturePid).toBeGreaterThan(0);
      const child = ownedChild;
      if (!child) throw new Error("serve did not spawn its OMP child");
      expect(fixturePid).toBe(child.pid);
      await withTimeout(client.close(), "ACP server close");
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
      expect(processExists(fixturePid)).toBe(false);
    } finally {
      restorePath(previousPath);
      try {
        await client.close();
      } finally {
        try {
          if (ownedChild && ownedChild.exitCode === null && ownedChild.signalCode === null) {
            const exited = Promise.withResolvers<void>();
            ownedChild.once("exit", () => exited.resolve());
            ownedChild.kill("SIGKILL");
            await withTimeout(exited.promise, "synthetic OMP cleanup");
          } else if (fixturePid !== undefined && processExists(fixturePid)) {
            process.kill(fixturePid, "SIGKILL");
          }
        } finally {
          process.exitCode = previousExitCode;
        }
      }
    }
  });
  it.each(["false", "async-error"] as const)("handles forced-kill failure races (%s)", async (failureMode) => {
    const previousExitCode = process.exitCode;

    async function runScenario(exitAfterForce: boolean): Promise<void> {
      const killCalls: NodeJS.Signals[] = [];
      const child = Object.assign(new EventEmitter(), {
        pid: process.platform === "win32" ? 123_456_789 : Number.MAX_SAFE_INTEGER,
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        exitCode: null as number | null,
        signalCode: null as NodeJS.Signals | null,
        kill(signal: NodeJS.Signals) {
          killCalls.push(signal);
          if (signal === "SIGKILL") {
            if (failureMode === "false") {
              if (exitAfterForce) queueMicrotask(exitChild);
              return false;
            }
            queueMicrotask(() => {
              child.emit("error", new Error("synthetic child kill failure"));
              if (exitAfterForce) exitChild();
            });
            return true;
          }
          return false;
        },
      }) as unknown as ChildProcess & { killCalls: NodeJS.Signals[] };
      child.killCalls = killCalls;

      function exitChild(): void {
        child.exitCode = 0;
        child.emit("exit", 0, null);
      }

      let buffered = "";
      child.stdin.on("data", (bytes: Buffer) => {
        buffered += bytes.toString();
        for (;;) {
          const separator = buffered.indexOf("\n");
          if (separator < 0) break;
          const command = JSON.parse(buffered.slice(0, separator)) as { id: string; type: string };
          buffered = buffered.slice(separator + 1);
          const data = command.type === "get_state"
            ? { sessionFile: "/tmp/fake-omp-session.jsonl", model: { provider: "fixture", id: "model", name: "Fixture" } }
            : {};
          child.stdout.write(`${JSON.stringify({ type: "response", id: command.id, success: true, data })}\n`);
        }
      });

      const killSpy = process.platform === "win32"
        ? undefined
        : vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: NodeJS.Signals | number) => {
            if (signal === "SIGTERM") return true;
            if (signal === "SIGKILL") {
              if (failureMode === "false") {
                if (exitAfterForce) queueMicrotask(exitChild);
                const error = new Error("No such process") as NodeJS.ErrnoException;
                error.code = "ESRCH";
                throw error;
              }
              queueMicrotask(() => {
                child.emit("error", new Error("synthetic child kill failure"));
                if (exitAfterForce) exitChild();
              });
              return true;
            }
            return true;
          }) as typeof process.kill);
      const failures: Error[] = [];
      const client = harness(
        () => child,
        (error) => failures.push(error)
      );
      try {
        await client.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
        await client.request("session/new", { cwd: tmpdir(), mcpServers: [] });
        if (exitAfterForce) {
          await withTimeout(client.close(), "ACP server close");
          expect(child.exitCode).toBe(0);
          expect(process.exitCode).toBe(previousExitCode);
          expect(failures).toEqual([]);
        } else {
          await expect(withTimeout(client.close(), "ACP server close")).rejects.toThrow(/terminat|kill/i);
          expect(process.exitCode).toBe(1);
          expect(failures).toHaveLength(1);
          expect(failures[0]?.message).toMatch(/terminat|kill/i);
        }
        if (process.platform === "win32") expect(killCalls).toEqual(["SIGKILL"]);
      } finally {
        killSpy?.mockRestore();
        child.stdout.destroy();
        child.stdin.destroy();
        child.stderr.destroy();
        process.exitCode = previousExitCode;
      }
    }

    await runScenario(false);
    await runScenario(true);
  });
  it.each(["SIGTERM", "SIGINT", "SIGHUP"] as const)("reaps OMP before re-raising %s", async (signal) => {
    const directory = await fakeOmp("serve");
    const previousPath = process.env.PATH;
    let ownedChild: ChildProcess | undefined;
    process.env.PATH = [directory, dirname(process.execPath), previousPath ?? ""].join(delimiter);
    const client = harness(syntheticSpawn(directory, (child) => { ownedChild = child; }));
    const target = Object.assign(new EventEmitter(), { pid: 4242, kill: vi.fn(() => true), exit: vi.fn() });
    try {
      closeOnSignals(client.serverClose, target);
      await client.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
      await withTimeout(client.request("session/new", { cwd: directory, mcpServers: [] }), "session/new");
      const child = ownedChild;
      if (!child) throw new Error("serve did not spawn its OMP child");
      const reraised = Promise.withResolvers<void>();
      target.kill.mockImplementation(() => {
        reraised.resolve();
        return true;
      });
      target.emit(signal);
      await withTimeout(reraised.promise, "signal re-raise");
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
      expect(target.kill).toHaveBeenCalledExactlyOnceWith(4242, signal);
      expect(target.listenerCount(signal)).toBe(0);
    } finally {
      restorePath(previousPath);
      await client.close();
      if (ownedChild && ownedChild.exitCode === null && ownedChild.signalCode === null) ownedChild.kill("SIGKILL");
    }
  });
  it("re-raises the signal when closing OMP fails", async () => {
    const target = Object.assign(new EventEmitter(), { pid: 4242, kill: vi.fn(() => true), exit: vi.fn() });
    const reraised = Promise.withResolvers<void>();
    target.kill.mockImplementation(() => {
      reraised.resolve();
      return true;
    });
    closeOnSignals(() => Promise.reject(new Error("OMP child process did not exit after force termination")), target);
    target.emit("SIGTERM");
    await withTimeout(reraised.promise, "signal re-raise");
    expect(target.kill).toHaveBeenCalledExactlyOnceWith(4242, "SIGTERM");
  });
  it("exits with the signal status when re-raising is unsupported", async () => {
    const exited = Promise.withResolvers<void>();
    const target = Object.assign(new EventEmitter(), {
      pid: 4242,
      kill: vi.fn(() => {
        const error = new Error("function not implemented") as NodeJS.ErrnoException;
        error.code = "ENOSYS";
        throw error;
      }),
      exit: vi.fn(() => exited.resolve()),
    });
    closeOnSignals(() => Promise.resolve(), target);
    target.emit("SIGHUP");
    await withTimeout(exited.promise, "signal exit fallback");
    expect(target.kill).toHaveBeenCalledExactlyOnceWith(4242, "SIGHUP");
    expect(target.exit).toHaveBeenCalledExactlyOnceWith(128 + constants.signals.SIGHUP);
  });
  it("stops intercepting every shutdown signal after the first", async () => {
    const closing = Promise.withResolvers<void>();
    const reraised = Promise.withResolvers<void>();
    const target = Object.assign(new EventEmitter(), {
      pid: 4242,
      kill: vi.fn(() => {
        reraised.resolve();
        return true;
      }),
      exit: vi.fn(),
    });
    closeOnSignals(() => closing.promise, target);
    target.emit("SIGTERM");
    for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) expect(target.listenerCount(signal)).toBe(0);
    target.emit("SIGINT");
    closing.resolve();
    await withTimeout(reraised.promise, "signal re-raise");
    expect(target.kill).toHaveBeenCalledExactlyOnceWith(4242, "SIGTERM");
    expect(target.exit).not.toHaveBeenCalled();
  });
});
