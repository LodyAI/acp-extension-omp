import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
// setup-node on Windows installs npm beside node.exe; invoke its JS entry without a shell.
const npmCli = process.env.npm_execpath ?? (process.platform === "win32"
  ? join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
  : undefined);
function npm(args, cwd = root, input) {
  const result = spawnSync(npmCli ? process.execPath : "npm", [...(npmCli ? [npmCli] : []), ...args], {
    cwd, encoding: "utf8", input, timeout: 180_000,
    env: { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" },
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `npm ${args.join(" ")} failed (${result.signal ?? result.status}):\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function distManifest(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) files.push(...await distManifest(path, `${name}/`));
    else {
      assert.ok(entry.isFile(), `Unexpected non-file in dist: ${name}`);
      files.push([name, sha256(await readFile(path))]);
    }
  }
  return files.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
}

// Spaces deliberately exercise npm's tarball argument handling on all three OSes.
const scratch = await mkdtemp(join(tmpdir(), "omp package check "));
try {
  console.log(`Toolchain: Node ${process.version}, npm ${npm(["--version"]).trim()}, ${process.platform}/${process.arch}`);
  const builds = [];
  for (const round of [1, 2]) {
    const destination = join(scratch, `pack-${round}`);
    await mkdir(destination);
    // prepack deletes dist and compiles from source on each invocation; do not use --ignore-scripts.
    const [pack] = JSON.parse(npm(["pack", "--json", "--pack-destination", destination]));
    const archive = join(destination, pack.filename);
    const dist = await distManifest(join(root, "dist"));
    assert.ok(dist.length > 0, "Build produced no dist files");
    const bytes = await readFile(archive);
    const tarball = sha256(bytes);
    console.log(`Build ${round}: dist SHA-256 ${sha256(JSON.stringify(dist))}; tarball SHA-256 ${tarball}; ${bytes.length} bytes`);
    builds.push({ dist, tarball, archive });
  }
  assert.deepEqual(builds[1].dist, builds[0].dist, "Repeated builds changed dist paths or SHA-256 hashes");
  assert.equal(builds[1].tarball, builds[0].tarball, "Repeated npm pack changed archive SHA-256");
  console.log("PASS: two clean builds have identical dist manifests and tarball bytes");

  const project = join(scratch, "install project");
  await mkdir(project);
  await writeFile(join(project, "package.json"), JSON.stringify({ name: "package-install-check", private: true }));
  npm(["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", builds[0].archive], project);
  const installed = JSON.parse(await readFile(join(project, "node_modules", "acp-extension-omp", "package.json"), "utf8"));
  await access(join(project, "node_modules", ".bin", `acp-extension-omp${process.platform === "win32" ? ".cmd" : ""}`));
  // The ACP-only entry has no CLI help/version handler. Exercise the installed bin --help
  // with a real initialize exchange and verify its version, not just a successful exit on EOF.
  const request = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1, clientCapabilities: {} } };
  const stdout = npm(["exec", "--offline", "--no", "--", "acp-extension-omp", "--help"], project, `${JSON.stringify(request)}\n`);
  const frames = stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.equal(frames.length, 1, "Installed bin must emit only the initialize response");
  assert.equal(frames[0].id, request.id);
  assert.equal(frames[0].result.protocolVersion, 1);
  assert.equal(frames[0].result.agentInfo.version, installed.version);
  console.log(`PASS: tarball installed with production dependencies; bin --help / ACP initialize version ${installed.version}`);
} finally {
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
