# Compatibility policy

Status: repository candidate; no production OMP version is declared supported yet.

## Version matrix

| OMP version | Role | Required evidence | Current state |
| --- | --- | --- | --- |
| 18.2.8 | Minimum real-contract baseline for Lody #930 | Official macOS arm64 release asset, size/SHA-256 verified; isolated real adapter contract with loopback-only synthetic model | Verified on macOS arm64 / Node 22.22.3: initialize/new/prompt/cancel/exact load/resume/native error/legacy `agent_end` settlement/`responseId` usage/restart ordering passed. Not a production release declaration |
| 18.3.1 | Installed local evidence, not a release declaration | Real adapter with a loopback-only model; source and installed package | initialize/new/prompt/cancel/exact load/resume, missing/invalid load, native error, usage attribution, restart scope and notification-before-terminal ordering passed on macOS arm64 / Node 22.22.3 |
| 18.8.7 (latest stable on 2026-10-10) | Current compatibility target | Official macOS arm64 asset id `625097604`, 200,152,352 bytes, SHA-256 `cf0227bdefca0c486bd2aed1771de3ab98930266883eb69d341caf5665caee14`; isolated real adapter contract | V1 real contract passed on macOS arm64 / Node 22.22.3 / Core 0.1.8 with loopback-only synthetic model; not a production or cross-OS declaration |
| 18.8.6 (previous stable on 2026-10-10) | Regression target | Official macOS arm64 asset id `622733471`, 212,684,064 bytes, SHA-256 `31faa0ee8420a13a783f4ca56d98f974e4a9f9081d269057a099f7eb618d113`; same isolated real adapter contract | V1 real contract passed on macOS arm64 / Node 22.22.3 / Core 0.1.8 with loopback-only synthetic model; not a production or cross-OS declaration |
| Unknown/future | Probe only | Base RPC schema and each optional primitive | Do not infer compatibility from a higher version number |

## Runtime and release policy

Version strings record evidence; they do not prove protocol compatibility.
The candidate withholds optional load/resume/usage capability advertisements
until the baseline matrix and independent review pass. Explicit contract-runner
calls still exercise those implementation paths.

Terminal handling follows observed RPC frame semantics, not a version threshold. On
18.3.1, `agent_end.yielded` is not prompt completion; the adapter waits for
`prompt_result.status` and boolean `sessionSettled`, then waits for native
`session_settled` when required. On 18.2.8, terminal `agent_end.isTerminal` ends
agent work; an assistant `stopReason: "error"` rejects the prompt, and usage
deduplication uses `message.responseId`. Local-only prompts use
`prompt_result.agentInvoked: false`. Unknown terminal semantics fail closed.

Session changes exclude prompts; a failed native switch invalidates the previous
ACP identity. Missing/empty native files fail before any switch request.

Release requires the full matrix. A future optional-capability policy must be
based on proven RPC primitives, not a greater version number. No runtime
multi-version capability discovery is claimed by this candidate.

The adapter must not claim that a newer version is compatible solely because its
version compares greater than 18.2.8. Compatibility evidence must include the
actual OMP executable, launch arguments, profile isolation, test result, and
captured non-secret diagnostic metadata.
