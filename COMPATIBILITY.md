# Compatibility policy

Status: repository candidate; no production OMP version is declared supported yet.

## Version matrix

| OMP version | Role | Required evidence | Current state |
| --- | --- | --- | --- |
| 18.2.8 | Minimum real-contract baseline for Lody #930 | initialize, new, prompt, cancel, exact load/resume, terminal ordering, restart-safe per-model usage, child failure | Official release and npm source located; no verified runnable binary obtained: asset TLS/download timeout and incomplete digest; isolated npm installation timed out. Not verified |
| 18.3.1 | Installed local evidence, not a release declaration | Real adapter with a loopback-only model; source and installed package | initialize/new/prompt/cancel/exact load/resume, missing/invalid load, native error, usage attribution, restart scope and notification-before-terminal ordering passed on macOS arm64 / Node 22.22.3 |
| 18.8.4 | Installed local evidence, not a release declaration | Real adapter with a loopback-only model; independently installed npm archive | Required cases 1–8, including the exact `initialize` capability set, passed on macOS arm64 with Node 26.10.0 and 22.15.0 at adapter commit `39d745a`; see `TESTING.md` |
| Latest stable | Current compatibility target | Same V1 suite plus schema/behavior diff review | 18.8.6 as of 2026-10-09; not installed or tested |
| Previous stable | Regression target | Same V1 suite | 18.8.5 as of 2026-10-09; not installed or tested |
| Unknown/future | Probe only | Base RPC schema and each optional primitive | Do not infer compatibility from a higher version number |

## Runtime and release policy

Version strings record evidence; they do not prove protocol compatibility.
The candidate withholds optional load/resume/usage capability advertisements
until the baseline matrix and independent review pass. Explicit contract-runner
calls still exercise those implementation paths.

Terminal frames must supply a recognized status and boolean `sessionSettled`.
A yielded result with `sessionSettled: false` does not release request admission:
the adapter waits for native `session_settled`, then drains ACP notifications.
Missing status or settlement fails instead of fabricating a successful outcome.
Session changes exclude prompts; a failed native switch invalidates the previous
ACP identity. Missing/empty native files fail before any switch request.

Release requires the full matrix. A future optional-capability policy must be
based on proven RPC primitives, not a greater version number. No runtime
multi-version capability discovery is claimed by this candidate.

The adapter must not claim that a newer version is compatible solely because its
version compares greater than 18.2.8. Compatibility evidence must include the
actual OMP executable, launch arguments, profile isolation, test result, and
captured non-secret diagnostic metadata.
