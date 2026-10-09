import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

await rm(new URL("../dist", import.meta.url), { recursive: true, force: true });

// Run the local compiler directly: npm_execpath is not a Node script under every package manager.
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
const tsconfig = fileURLToPath(new URL("../tsconfig.json", import.meta.url));
const build = spawnSync(process.execPath, [tsc, "-p", tsconfig], { stdio: "inherit" });
if (build.error) throw build.error;
if (build.signal) throw new Error(`TypeScript build terminated by ${build.signal}`);
if (build.status !== 0) throw new Error(`TypeScript build failed with exit code ${build.status ?? "unknown"}`);
