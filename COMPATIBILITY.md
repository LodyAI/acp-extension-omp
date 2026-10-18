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
The candidate withholds optional load/resume/usage capability advertisements
until the baseline matrix and independent review pass. Explicit contract-runner
calls still exercise those implementation paths.

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

消息归属只按可观察证据隔离：在连接生命周期内保留 `message_start`、
`message_update`、`message_end` 的首次 messageId / message.responseId
所属 generation；同帧共现的两种 ID 保留相同归属和计费身份。已属旧 generation、
无当前 prompt 时已观察的 ID，以及明确
不匹配已知 native sessionId/sessionFile 的帧，不转发为当前 text/usage。
任意次 new/load/resume 后，当前 prompt 首次出现的 ID 仍正常入账，不要求先有
message_start，也不会因此关闭 RPC。若旧帧首次出现于新 prompt 中且没有可靠
session identity，其来源与正常新消息无法区别，仍按当前 prompt 处理；别名关系
尚未证实时已接收的歧义通知不回溯撤销。无关联的 legacy agent_end/session_settled
仍依赖上游顺序。本防护不证明真实 OMP
background/settlement 后绝无旧帧。归属记录随连接内不同消息 ID 数量增长，不做
会丢失旧归属证据的淘汰。

Release requires the full matrix. A future optional-capability policy must be
based on proven RPC primitives, not a greater version number. No runtime
multi-version capability discovery is claimed by this candidate.

The adapter must not claim that a newer version is compatible solely because its
version compares greater than 18.2.8. Compatibility evidence must include the
actual OMP executable, launch arguments, profile isolation, test result, and
captured non-secret diagnostic metadata.
