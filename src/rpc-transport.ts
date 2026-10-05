export type OmpStream = {
  writable: WritableStream<Uint8Array>;
  readable: ReadableStream<Uint8Array>;
};

type Pending = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

/** Ordered JSONL transport for OMP's RPC mode. */
export class OmpRpcTransport {
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>;
  private readonly pending = new Map<string, Pending>();
  private sequence = 0;
  private failure: Error | undefined;

  constructor(
    stream: OmpStream,
    private readonly onEvent: (frame: Record<string, unknown>) => void,
    private readonly onFailure: (error: Error) => void
  ) {
    this.writer = stream.writable.getWriter();
    void this.read(stream.readable);
  }

  request(type: string, fields: Record<string, unknown> = {}): Promise<unknown> {
    const id = `omp-${++this.sequence}`;
    return this.requestWithId(id, type, fields);
  }

  requestWithId(id: string, type: string, fields: Record<string, unknown> = {}): Promise<unknown> {
    this.assertOpen();
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      void this.send({ id, type, ...fields }).catch((error: unknown) => this.fail(error));
    });
  }

  async send(frame: Record<string, unknown>): Promise<void> {
    this.assertOpen();
    await this.writer.write(new TextEncoder().encode(`${JSON.stringify(frame)}\n`));
  }

  close(): void {
    this.fail(new Error("OMP RPC connection closed"));
    void this.writer.close().catch(() => undefined);
  }

  private assertOpen(): void {
    if (this.failure) throw this.failure;
  }

  private fail(error: unknown): void {
    if (this.failure) return;
    this.failure = error instanceof Error ? error : new Error(String(error));
    for (const pending of this.pending.values()) pending.reject(this.failure);
    this.pending.clear();
    this.onFailure(this.failure);
  }

  private async read(readable: ReadableStream<Uint8Array>): Promise<void> {
    const reader = readable.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        for (;;) {
          const separator = buffered.indexOf("\n");
          if (separator < 0) break;
          const line = buffered.slice(0, separator);
          buffered = buffered.slice(separator + 1);
          if (!line) continue;
          this.handle(JSON.parse(line) as Record<string, unknown>);
        }
      }
      if (buffered.trim()) this.handle(JSON.parse(buffered) as Record<string, unknown>);
      this.fail(new Error("OMP RPC stream closed"));
    } catch (error) {
      this.fail(error);
    } finally {
      reader.releaseLock();
    }
  }

  private handle(frame: Record<string, unknown>): void {
    if (frame.type === "response" && typeof frame.id === "string") {
      const pending = this.pending.get(frame.id);
      if (!pending) return;
      this.pending.delete(frame.id);
      if (frame.success === true) pending.resolve(frame.data);
      else pending.reject(new Error(typeof frame.error === "string" ? frame.error : "OMP RPC command failed"));
      return;
    }
    this.onEvent(frame);
  }
}
