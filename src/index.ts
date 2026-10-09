#!/usr/bin/env node
import { Readable, Writable } from "node:stream";
import { ndJsonStream } from "@agentclientprotocol/sdk";

import { closeOnSignals, serve } from "./server.js";

const input = Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>;
const server = serve(ndJsonStream(Writable.toWeb(process.stdout), input), {
  onParentFailure: () => {
    process.stdin.destroy();
    process.stdout.destroy();
  },
});
closeOnSignals(server.close);
