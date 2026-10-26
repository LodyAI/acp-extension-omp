# Compatibility policy

Status: repository candidate; no production OMP version is declared supported yet.

历史运行与静态审查记录的时态、引用位置及证据限制更正，见 [012.015](docs-ai/012-remaining-v1-gates/015-factual-corrections.md)；该修订不新增兼容性或发布声明。

## Version matrix

| OMP version | Role | Required evidence | Current state |
| --- | --- | --- | --- |
| 18.2.8 | Minimum real-contract baseline for Lody #930 | initialize, new, prompt, cancel, exact load/resume, terminal ordering, restart-safe per-model usage, child failure | Real adapter with a loopback-only model; official release asset `omp-darwin-arm64` (193,484,176 bytes, SHA-256 `cf8d34a7fe6f60de1acbe74f29c82026e4c07888e9d89f7ebceeb922159e5787`). Real contract passed on macOS arm64 / Node 22.22.3; other OS targets not verified |
| 18.3.1 | Installed local evidence, not a release declaration | Real adapter with a loopback-only model; source and installed package | initialize/new/prompt/cancel/exact load/resume, missing/invalid load, native error, usage attribution, restart scope and notification-before-terminal ordering passed on macOS arm64 / Node 22.22.3 |
| 18.8.4 | Installed local evidence, not a release declaration | Real adapter with a loopback-only model; independently installed npm archive | Required cases 1–8, including the exact `initialize` capability set, passed on macOS arm64 with Node 26.10.0 and 22.15.0 at adapter commit `39d745a`; see `TESTING.md` |
| 18.12.2 | Historical evidence, former Latest stable target (2026-10-19) | Same V1 suite | GitHub release `v18.12.2` (published 2026-10-18, not draft or prerelease). Official asset `omp-darwin-arm64` (196,057,120 bytes, SHA-256 `abd9a5b0fef77f4204078e348e233faa0dd3d5d81719cf2b6a9b9478c10eee48`): smoke and contract passed on macOS arm64 / Node 22.22.3 at adapter commit `3258961`; see `TESTING.md`. Not the current target; other OS targets not verified |
| 18.12.1 | Historical evidence, former Previous stable target (2026-10-19) | Same V1 suite | GitHub release `v18.12.1` (published 2026-10-17, not draft or prerelease). Official asset `omp-darwin-arm64` (195,462,176 bytes, SHA-256 `fa41b27d434380e99b713e4f9ced0f73eb1fc0c409fdf23a57c119971d24bac5`): smoke and contract passed on macOS arm64 / Node 22.22.3 at adapter commit `3258961`; see `TESTING.md`. Not the current regression target; other OS targets not verified |
| Latest stable | Current compatibility target | Same V1 suite plus schema/behavior diff review | 18.12.6（目标沿用 2026-10-25 的上游 Latest 核对，非 draft、非 prerelease）。历史证据：Homebrew `can1357/tap` 二进制与官方 `omp-darwin-arm64` 字节一致，197245984 bytes，SHA-256 `cfbb5e38cd8f8a3be55e710700be587d287deaacdc58c9b0a661c5086bccfe58`；`51e1a04` 干净导出、安装后 npm 归档入口在 Node 26.10.0／22.15.0 上 smoke + contract 通过，见 [011](docs-ai/012-remaining-v1-gates/011-r1-macos-18.12.6-clean-matrix.md)。tip 重跑：`f0572cd904b88f9d80101d9b32ec7d5bffe1b6d1`，macOS Darwin 27.2.0 arm64 / Node 22.22.3 / npm 10.9.8，`~/.local/bin/omp` 同摘要与大小，安装后入口 smoke + contract 通过，见 [016](docs-ai/012-remaining-v1-gates/016-r1-macos-f0572cd-tip-matrix.md)。18.12.2→18.12.6 的静态 schema/behavior diff review 未发现适配器 RPC 翻译面的破坏性变化，见 [013](docs-ai/012-remaining-v1-gates/013-omp-18.12.6-target-review.md)。仅本地单平台证据；用例 5/7/9 的合成边界不变，其他 OS 未验证；本轮未重跑 Node 26。同 tip 另有真实 `openai-codex/gpt-6.1-sol` ACP 旁证，见 [017](docs-ai/012-remaining-v1-gates/017-r1-macos-real-openai-codex-gpt-6.1-sol.md)（含 H′ SIGKILL／合作式 abort_ack／native tool-cancel 续跑），不关闭 R2／R3–R6、不替换 loopback 行 |
| Previous stable | Regression target | Same V1 suite | 18.12.5，官方 Release 资产 `omp-darwin-arm64`，197113888 bytes，SHA-256 `5e50df9879de9165d5c6df5e48bb5d038737270013cd849e189da7774fb7368b`（与 `SHA256SUMS` 一致）。在 tip `f0572cd904b88f9d80101d9b32ec7d5bffe1b6d1`、macOS Darwin 27.2.0 arm64 / Node 22.22.3 / npm 10.9.8 上，经安装后 npm 归档入口、isolated profile、loopback-only model，smoke + contract 通过，见 [016](docs-ai/012-remaining-v1-gates/016-r1-macos-f0572cd-tip-matrix.md)。此前「未安装、未测」阻塞仅就此本机矩阵行解除；其他 OS 未验证，用例 5/7/9 的合成边界不变，不是发布声明 |
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

## 进程回收限制

这些是当前关闭路径的已知边界，不是尚未实现的回收能力。不把进程树回收或 Job Object 算作支持。

- POSIX：`groupAlive()` 对进程组发信号 0（`process.kill(-pgid, 0)`），除 `ESRCH` 外都视为仍有成员。尚未 reap 的僵尸仍属于该组，`kill(pid, 0)` 对僵尸成功，因此会被误判为存活。孤儿无人及时回收时（例如容器的 PID 1 不是 init），已经死亡的组仍可能让 `close` 失败。该容器场景没有在本仓库复现。
- POSIX：组清空后，若在一次轮询间隔（25 ms）内同一 PGID 被新进程组占用，`groupAlive` 会把无关组当成仍有成员，截止时的 `SIGKILL` 可能打到该组。这是未验证的风险，不是已复现的缺陷。
- Windows：只终止已拥有的直接子进程（结束 stdin，宽限期后 `ChildProcess.kill("SIGKILL")`；第二个关闭信号同样只杀该子进程）。不终止进程树，也不回收子孙。
