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
| 18.12.6 | Historical evidence, former Latest stable target (2026-10-25) | Same V1 suite plus schema/behavior diff review | GitHub release `v18.12.6`, published 2026-10-21, not draft or prerelease. Homebrew binary matched official asset `omp-darwin-arm64` (197,245,984 bytes, SHA-256 `cfbb5e38cd8f8a3be55e710700be587d287deaacdc58c9b0a661c5086bccfe58`). Smoke and contract passed on macOS arm64 / Node 26.10.0 and 22.15.0 at `51e1a04` through an independently installed npm archive; cases 5/7/9 are partly synthetic-only. See the 18.12.6 record in `TESTING.md` and `docs-ai/012-remaining-v1-gates/013-omp-18.12.6-target-review.md` for the static 18.12.2→18.12.6 review. Not the current target; other OS targets remain unverified |
| 18.12.5 | Historical, former Previous stable target (2026-10-25) | Same V1 suite | Official `omp-darwin-arm64` asset 197,113,888 bytes, SHA-256 `5e50df9879de9165d5c6df5e48bb5d038737270013cd849e189da7774fb7368b`. Not installed or tested; the historical regression row remains incomplete |
| 18.18.1 | 历史证据，原 Latest stable 目标（2026-11-09） | 同一 V1 套件及 schema/behavior 差异核对 | [官方发布](https://github.com/can1357/oh-my-pi/releases/tag/v18.18.1)，2026-11-08T00:25:06Z 发布，非 draft/prerelease。Homebrew 字节与官方 `omp-darwin-arm64` 一致：220,595,344 字节，SHA-256 `ce80099f10c5ea4367523767230cb5b920f30cc139b9cf8758c1cc4b2f1f9409`。当时的候选工作树在 macOS arm64 / Node 26.13.0 上通过 smoke/contract 和真实启动模型选择；源码身份、静态核对及证据边界见 `TESTING.md` 与 `docs-ai/018-startup-session-config/001-action.md`。不是干净 tag 或完整平台矩阵。已不是当前目标 |
| 18.18.0 | 历史，原 Previous stable 目标（2026-11-09） | 同一 V1 套件 | [官方发布](https://github.com/can1357/oh-my-pi/releases/tag/v18.18.0)，2026-11-07T01:49:16Z 发布，非 draft/prerelease。官方 `omp-darwin-arm64` 资产：220,479,632 字节，SHA-256 `0adae2a341a1e6840b00c96ce0b1c9d2e0257b1ea6782e4302e17b717a6ffb0a`。未安装、未测试；该历史回归行保持不完整 |
| Latest stable | 当前适配目标 | 同一 V1 套件及 schema/behavior 差异核对 | 截至 2026-11-15 为 18.20.2（[官方发布](https://github.com/can1357/oh-my-pi/releases/tag/v18.20.2)，2026-11-14T20:08:51Z 发布，非 draft/prerelease）。Homebrew 字节与官方 `omp-darwin-arm64` 一致：224,277,648 字节，SHA-256 `e2de0974ce581bfcf2044ea795c712fa240fdf8304f7bdb4b3d81b154d2b57fc`。提交 `d6362de` 的干净导出经独立安装的 npm 归档在 macOS arm64 / Node 26.13.0 上通过 smoke、contract 和 `scripts/capability-probe.mjs`；18.18.1→18.20.2 只做了 RPC 合同文件子集的静态比对，尚无独立 reviewer 核对。源码身份和证据边界见 `TESTING.md` 的 18.20.2 记录。不是干净 tag 或完整平台矩阵 |
| Previous stable | 上一稳定版回归目标 | 同一 V1 套件 | 截至 2026-11-15 为 18.20.1（[官方发布](https://github.com/can1357/oh-my-pi/releases/tag/v18.20.1)，2026-11-14T17:29:17Z 发布，非 draft/prerelease）。官方 `omp-darwin-arm64` 资产：224,046,224 字节，SHA-256 `2a080bfd790309001ea001140382a5850be284e984c2f8678a81a41a37e77490`。官方资产下载到隔离目录并核对摘要后，同一提交 `d6362de` 的归档在 macOS arm64 / Node 26.13.0 上通过 smoke、contract 和能力探针；见 `TESTING.md`。其他平台未验证 |
| Unknown/future | Probe only | Base RPC schema and each optional primitive | Do not infer compatibility from a higher version number |

## Runtime and release policy

Version strings record evidence; they do not prove protocol compatibility.
The candidate advertises Lody usage, `sessionCapabilities.resume`,
`sessionCapabilities.fork` and `promptCapabilities.image`. It withholds
`loadSession` because the adapter does not replay history; explicit
contract-runner calls still exercise that implementation path.

`scripts/contract.mjs` does not cover fork, images or `resource_link`. Every new
OMP target row must also run `scripts/capability-probe.mjs` against that
executable; without it, the resume, fork and image advertisements have no real
evidence for that version. The current evidence for these advertisements is a single
toolchain on macOS arm64 (see `TESTING.md`); whether that is enough to release
is a maintainer decision at the release gate.

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
