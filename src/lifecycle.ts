export type SignalName = "SIGTERM" | "SIGINT";

export type SignalHost = {
  once(signal: SignalName, listener: () => void): void;
  removeListener(signal: SignalName, listener: () => void): void;
};

export function installSignalShutdown(
  close: () => Promise<void>,
  host: SignalHost = process,
  exit: (code: number) => void = (code) => process.exit(code),
): () => void {
  let closing: Promise<void> | undefined;
  const onSignal = (): void => {
    if (closing) return;
    closing = Promise.resolve()
      .then(close)
      .catch(() => undefined)
      .then(() => exit(0));
  };
  host.once("SIGTERM", onSignal);
  host.once("SIGINT", onSignal);
  return () => {
    host.removeListener("SIGTERM", onSignal);
    host.removeListener("SIGINT", onSignal);
  };
}
