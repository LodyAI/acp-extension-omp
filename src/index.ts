#!/usr/bin/env node
import { Readable, Writable } from "node:stream";
import { ndJsonStream } from "@agentclientprotocol/sdk";

import { serve } from "./server.js";
import { installSignalShutdown } from "./lifecycle.js";
const input = Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>;
const server = serve(ndJsonStream(Writable.toWeb(process.stdout), input), {
  onParentFailure: () => {
    process.stdin.destroy();
    process.stdout.destroy();
  },
});
installSignalShutdown(server.close);
