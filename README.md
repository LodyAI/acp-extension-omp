# OMP ACP adapter

Standalone Apache-2.0 `acp-extension-omp` adapter for a user-installed Oh My
Pi (OMP) runtime. It translates OMP's `omp --mode rpc` process into ACP. It
does not bundle OMP, inspect credentials, or persist user session data.

## Collaboration status

This is a runnable collaboration branch, not a published Lody provider or an
OMP compatibility release. Local verification covers OMP 18.3.1 on macOS arm64
with Node 22.22.3 and a real OMP contract run against a loopback-only synthetic
model. The 27 synthetic regression tests in `npm run check` do not use OMP and
are not tied to that evidence row; one stdout-EOF case runs only on POSIX and is
skipped on Windows. No production runtime manifest is changed.

Before release, the 18.2.8/stable-version and OS matrices, independent maintainer
review, reproducible runtime archive, public checksum read-back, and Lody
end-to-end acceptance must pass. These gates are recorded in `TESTING.md` and
`RELEASE.md`; optional load/resume/usage advertisements remain disabled.

改这个仓库的 agent 先读 `AGENTS.md`。能力与发布边界仍以 `README.md`、
`COMPATIBILITY.md`、`TESTING.md`、`RELEASE.md`、`MIGRATION.md` 为准；
`docs-ai/` 不是能力合同。

For collaborators:

```sh
git clone --branch main https://github.com/LodyAI/acp-extension-omp.git
cd acp-extension-omp
npm ci --ignore-scripts
npm run check
npm run build
# Requires user-installed OMP; uses no credentials or paid model endpoint.
npm run contract
```

Review this branch before merging; do not use it to publish a runtime or update
Lody's managed-runtime manifest. No independent reviewer approval is claimed.


```text
Lody → acp-extension-omp → user-installed omp --mode rpc
```

## V1 contract

The implementation currently contains the translation paths for ACP
`newSession`, `prompt`, `cancel`, `loadSession`, and `resumeSession`, plus
exact native session identity and Core usage accumulation. MCP configuration,
images, steering, interactions, titles, and model mutation remain rejected or
unadvertised until their OMP primitives are verified.

Load, resume, and usage remain unadvertised in ACP initialize until the required
baseline matrix and independent review pass. Their implemented methods are
exercised explicitly by the contract runner; they are not a production support
promise. Future OMP versions are not assumed compatible from their version alone.

The adapter launches only `omp --mode rpc`. OMP diagnostics go to stderr; ACP
and OMP RPC traffic remain separate. Transport failure and child-process exit
fail the ACP connection rather than synthesizing a successful prompt result.

Closing the ACP connection sends SIGTERM to the OMP process group on POSIX, or
ends OMP stdin on Windows. After a one-second grace period the adapter
force-terminates the owned child, and close fails if it still has not exited.
On POSIX, SIGTERM, SIGINT, or SIGHUP sent to the adapter first runs the same
close, then the adapter exits by that signal. SIGKILL cannot be intercepted.

## Validation

Run the locked dependency graph in a clean checkout:

```sh
npm ci
npm run check
npm run build
npm run smoke
npm run contract
npm pack --dry-run
```

Synthetic regressions cover native session identity, missing files, active
session admission, native settlement, usage deduplication, cancellation, and
notification ordering. Lifecycle tests await the actual SDK connection closure
after spawn failure, unexpected exit, EOF, and malformed RPC output. They also
force-terminate a synthetic child that ignores EOF and SIGTERM, and reap OMP
before re-raising a shutdown signal.

`npm run smoke` covers initialize/new/load without sending a prompt.
`npm run contract` drives real OMP through a loopback-only synthetic model, in a
temporary HOME/profile without inheriting credentials. It verifies text, prompt
completion, cancellation, exact load/resume, missing/invalid sessions, native
error, usage attribution, terminal ordering, and a new usage scope after restart.

Both runners accept a built or installed adapter entry path. The contract runner
also accepts an explicit OMP executable:

```sh
npm run contract -- /path/to/installed/dist/index.js /path/to/verified/omp
```

Local evidence currently covers OMP 18.3.1, Node 22.22.3, macOS arm64, including
an independently installed npm tarball. It does not establish the 18.2.8 baseline,
all supported operating systems, automatic compaction, arbitrary extensions, or
real-provider quality. See `TESTING.md` for remaining gates.

Locally handled OMP prompts (`agentInvoked: false`) complete without waiting for
a terminal frame that will never arrive; `/help` completion is exercised by the
real contract runner. Native slash-command output and interactive extension UI
are not mapped to ACP by this adapter.

## Compatibility status

OMP 18.2.8 is the minimum real-contract baseline requested by Lody #930; it is
not the only intended supported version. See `COMPATIBILITY.md` and
`TESTING.md`. No OMP version is declared production-compatible until the
approved real-contract job records the required behavior.

## Release boundary

The adapter artifact must use a released fixed `acp-extension-core` version,
reproducible builds, immutable artifact bytes, and a public SHA-256/size
read-back before Lody pins it. OMP remains user-installed and is never bundled.
