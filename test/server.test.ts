import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ndJsonStream } from "@agentclientprotocol/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { serve } from "../src/server.js";
import { installSignalShutdown } from "../src/lifecycle.js";

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

async function fakeOmp(mode: "serve" | "stubborn" | "exit" | "eof" | "malformed" | "diagnostic" | "missing") {
  const directory = await mkdtemp(join(tmpdir(), "acp-extension-omp-test-"));
  tempDirectories.push(directory);
  if (mode === "missing") return directory;
  const executable = join(directory, "omp");
  const source = `#!/usr/bin/env node
const readline = require("node:readline");
const args = process.argv.slice(2);
if (${JSON.stringify(mode)} === "exit") process.exit(23);
if (args.join(" ") !== "--mode rpc") process.exit(42);
if (${JSON.stringify(mode)} === "stubborn") {
  require("node:fs").writeFileSync(${JSON.stringify(join(directory, "pid"))}, String(process.pid));
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 60_000);
}
if (${JSON.stringify(mode)} === "eof") process.stdout.end();
if (${JSON.stringify(mode)} === "malformed") process.stdout.write("not-json\\n");
if (${JSON.stringify(mode)} === "diagnostic") process.stderr.write("provider-secret\\n");
const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  if (${JSON.stringify(mode)} !== "serve" && ${JSON.stringify(mode)} !== "stubborn" && ${JSON.stringify(mode)} !== "diagnostic") return;
  const command = JSON.parse(line);
  if (command.type === "new_session" || command.type === "switch_session") {
    process.stdout.write(JSON.stringify({ type: "response", id: command.id, command: command.type, success: true, data: {} }) + "\\n");
  } else if (command.type === "get_state") {
    process.stdout.write(JSON.stringify({ type: "response", id: command.id, command: command.type, success: true, data: { sessionFile: "/tmp/fake-omp-session.jsonl", model: { provider: "fixture", id: "model", name: "Fixture" } } }) + "\\n");
  }
});
`;
  await writeFile(executable, source, "utf8");
  await chmod(executable, 0o755);
  return directory;
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
};

function harness(): Harness {
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
    onParentFailure: () => {},
  });
  return {
    closed: server.connection.closed,
    request<T>(method: string, params: Record<string, unknown>) {
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
  };
}

afterEach(async () => {
  for (const directory of tempDirectories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("OMP ACP server lifecycle", () => {
  it("launches OMP with only the supported RPC arguments", async () => {
    const directory = await fakeOmp("serve");
    const previousPath = process.env.PATH;
    process.env.PATH = `${directory}:${previousPath ?? ""}`;
    const client = harness();
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
      process.env.PATH = previousPath;
      await client.close();
    }
  });
  it("does not forward raw OMP stderr diagnostics", async () => {
    const directory = await fakeOmp("diagnostic");
    const previousPath = process.env.PATH;
    const writes: string[] = [];
    const originalWrite = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array, encoding?: BufferEncoding | ((error?: Error) => void), callback?: (error?: Error) => void) => {
      writes.push(typeof chunk === "string" ? chunk : decoder.decode(chunk));
      if (typeof encoding === "function") encoding();
      else callback?.();
      return true;
    }) as typeof process.stderr.write;
    process.env.PATH = `${directory}:${previousPath ?? ""}`;
    const client = harness();
    try {
      await client.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
      await withTimeout(client.request("session/new", { cwd: directory, mcpServers: [] }), "session/new");
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(writes.join("")).not.toContain("provider-secret");
    } finally {
      process.stderr.write = originalWrite;
      process.env.PATH = previousPath;
      await client.close();
    }
  });
  it.skipIf(process.platform === "win32")("cleans the OMP process group on host SIGTERM", async () => {
    const directory = await fakeOmp("stubborn");
    const previousPath = process.env.PATH;
    process.env.PATH = `${directory}:${dirname(process.execPath)}`;
    const client = harness();
    const removeSignals = installSignalShutdown(() => client.close(), process, () => {});
    try {
      await client.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
      await withTimeout(client.request("session/new", { cwd: directory, mcpServers: [] }), "session/new");
      const pid = Number(await readFile(join(directory, "pid"), "utf8"));
      process.emit("SIGTERM");
      const exited = new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          try {
            process.kill(pid, 0);
          } catch {
            clearInterval(timer);
            resolve();
          }
        }, 10);
      });
      await withTimeout(exited, "host SIGTERM shutdown");
    } finally {
      process.env.PATH = previousPath;
      removeSignals();
      await client.close();
    }
  });
  it.skipIf(process.platform === "win32")("kills an unresponsive OMP process group after the grace period", async () => {
    const directory = await fakeOmp("stubborn");
    const previousPath = process.env.PATH;
    process.env.PATH = `${directory}:${dirname(process.execPath)}`;
    const client = harness();
    try {
      await client.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
      await withTimeout(client.request("session/new", { cwd: directory, mcpServers: [] }), "session/new");
      const pid = Number(await readFile(join(directory, "pid"), "utf8"));
      await withTimeout(client.close(), "unresponsive OMP shutdown");
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      process.env.PATH = previousPath;
      await client.close();
    }
  });

  it.each(["exit", "eof", "malformed", "missing"] as const)("closes the actual ACP connection after OMP %s", async (mode) => {
    const directory = await fakeOmp(mode);
    const previousPath = process.env.PATH;
    const previousExitCode = process.exitCode;
    process.env.PATH = mode === "missing" ? directory : `${directory}:${dirname(process.execPath)}`;
    const client = harness();
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
      process.env.PATH = previousPath;
      process.exitCode = previousExitCode;
      await client.close();
    }
  });
});
