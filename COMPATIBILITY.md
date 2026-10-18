# Compatibility policy

Status: repository candidate; no production OMP version is declared supported yet.

## Version matrix

| OMP version | Role | Required evidence | Current state |
| --- | --- | --- | --- |
| 18.2.8 | Minimum real-contract baseline for Lody #930 | initialize, new, prompt, cancel, exact load/resume, terminal ordering, restart-safe per-model usage, child failure | Real adapter with a loopback-only model; official release asset `omp-darwin-arm64` (193,484,176 bytes, SHA-256 `cf8d34a7fe6f60de1acbe74f29c82026e4c07888e9d89f7ebceeb922159e5787`). Real contract passed on macOS arm64 / Node 22.22.3; other OS targets not verified |
| 18.3.1 | Installed local evidence, not a release declaration | Real adapter with a loopback-only model; source and installed package | initialize/new/prompt/cancel/exact load/resume, missing/invalid load, native error, usage attribution, restart scope and notification-before-terminal ordering passed on macOS arm64 / Node 22.22.3 |
| 18.8.4 | Installed local evidence, not a release declaration | Real adapter with a loopback-only model; independently installed npm archive | Required cases 1–8, including the exact `initialize` capability set, passed on macOS arm64 with Node 26.10.0 and 22.15.0 at adapter commit `39d745a`; see `TESTING.md` |
| Latest stable | Current compatibility target | Same V1 suite plus schema/behavior diff review | 18.8.6 as of 2026-10-09; not installed or tested |
| Previous stable | Regression target | Same V1 suite | 18.8.5 as of 2026-10-09; not installed or tested |
| Unknown/future | Probe only | Base RPC schema and each optional primitive | Do not infer compatibility from a higher version number |

## Runtime and release policy

Version strings record evidence; they do not prove protocol compatibility.
`session/resume` is advertised from the exact native switch and does not replay
history. Load and usage remain unadvertised. This is not a production version
declaration. Explicit contract-runner calls still exercise those unadvertised
implementation paths.

Current terminal `prompt_result` frames must supply a recognized status and
boolean `sessionSettled`. A yielded result with `sessionSettled: false` does not
release request admission: the adapter waits for native `session_settled`, then
drains ACP notifications. When either field is present, a missing or invalid
status or settlement fails instead of fabricating a successful outcome.
Legacy OMP 18.2.8 frames carry neither field: a terminal `agent_end` without
`yielded` completes the prompt (`isTerminal: false` does not), and
`prompt_result.agentInvoked: false` completes a local-only prompt. An
`agent_end` with boolean `yielded` is treated as current and still waits for
the terminal `prompt_result`.
Session changes exclude prompts; a failed native switch invalidates the previous
ACP identity. Missing/empty native files fail before any switch request.

Release requires the full matrix. A future optional-capability policy must be
based on proven RPC primitives, not a greater version number. No runtime
multi-version capability discovery is claimed by this candidate.

The adapter must not claim that a newer version is compatible solely because its
version compares greater than 18.2.8. Compatibility evidence must include the
actual OMP executable, launch arguments, profile isolation, test result, and
captured non-secret diagnostic metadata.
