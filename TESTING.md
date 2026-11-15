# Real-contract test plan

This suite is separate from synthetic frame tests. It must run with an explicitly
selected OMP executable and an isolated temporary home/profile. It must never
inherit the user's primary OMP profile or credentials and must not call a paid
provider unless the maintainer-approved test profile explicitly proves that the
endpoint is disposable and free.

## Required cases

1. `initialize`: protocol version and base agent information.
2. `new_session`: persistent native `sessionFile` is returned.
3. `prompt`: text delta conversion, completion, native error, and no fabricated
   success.
4. `cancel`: OMP acknowledges `abort`; ACP resolves only with `cancelled` after
   the native terminal result.
5. Exact `load` and `resume`: the requested native session is selected; a
   different or missing session fails.
6. Terminal ordering: every queued ACP `sessionUpdate` and usage notification is
   observed before the terminal `prompt_result` response.
7. Per-model usage: terminal assistant usage is deduplicated by message id,
   attributed to the correct provider/model, and missing cost stays unknown.
8. Restart scope: after adapter restart, accounting identity and counters are
   restored only when the native source proves they are restored; otherwise a
   new accounting scope is used.
9. Child failure: RPC EOF, malformed output, spawn failure, and unexpected child
   exit close the ACP connection unsuccessfully.

## Required test record

For each matrix row, record the OMP version, executable digest if policy permits,
Node version, operating system, adapter commit, Core version, test profile name
(non-secret), and pass/fail result. Do not record environment dumps, tokens,
headers, cookies, model prompts, or raw provider responses.

## CI 与手动 contract 门禁

- `.github/workflows/ci.yml` 在 Ubuntu、Windows、macOS × Node 22.14.0／23.6.0
  上执行 `npm ci`、`npm run check`、`npm run build`、`npm pack --dry-run`，
  以及 `node scripts/verify-package.mjs`，打包检查没有 Windows skip。
- helper 在同一 Node/npm 工具链下执行两次真实 `npm pack`；每次 `prepack` 都删除
  `dist/` 后重新编译。它比较按相对路径排序的每个 dist 文件的 SHA-256，以及完整
  `.tgz` 字节的 SHA-256，任一不同都非零退出；日志记录工具链、摘要和归档大小。
  这是同一矩阵行内的可复现性检查，不要求不同 OS／工具链的 gzip 字节一致。
- helper 将归档安装到含空格路径的独立临时项目，只安装生产依赖并禁用安装脚本；
  执行安装后 npm bin 的 `--help`，通过 ACP `initialize` 响应断言包版本，再关闭 stdin。
  当前入口不解析 CLI help/version；这里验证实际 ACP 启动和版本，不宣称实现帮助输出，
  也不需要 OMP。临时项目和两个归档在退出时清理。
- Windows 仍跳过 `test/signal.test.ts` 的 POSIX 进程／信号套件，以及
  `test/server.test.ts` 的 live-child stdout EOF 用例。其余合成测试执行；部分 Windows
  child 测试通过注入 Node runner 启动夹具，不证明真实 Windows OMP 启动或进程树回收。

真实 contract 保持 **manual/gated**，不是普通 PR job，也不以合成 CI 代替。
`scripts/contract.mjs` 的本地模型端点无需 secrets，但仓库尚无维护者批准、预装且
校验 OMP 的受控 runner；不得为填补此前置条件在 CI 下载 OMP，或让不可信 PR 使用
自托管 runner。维护者应在无用户凭据的一次性账户／环境中，先构建并安装候选 tarball，
再执行 `node scripts/contract.mjs /absolute/installed/dist/index.js /absolute/path/to/omp`。
PR #12（`test/contract-hardening`）落地后，`scripts/smoke.mjs` 与
`scripts/contract.mjs` 在 runner 内部 profile 隔离之后才执行 `omp --version`，
并使用与适配器相同的隔离 env、cwd 和 PATH。在那之前，探测发生在隔离之前并继承
调用方 env／cwd，因此外层环境也必须隔离。
每行证据按 Required test record 记录；未完成的 Required cases 和平台限制仍阻断
对应发布验收，不能因现有 runner 退出成功就视为全部通过。发布必须引用同一候选
revision 的全部六行 CI 结果及经维护者核对的真实矩阵记录；CI 不会自动发布，也不会
自动设置分支保护／required checks。正式发布工具链与公开字节回读仍按 `RELEASE.md`。

## Local evidence

- Node 22.22.3, macOS arm64, Core 0.1.8, installed OMP 18.3.1.
- `npm run smoke`: isolated initialize/new/load; no prompt.
- `npm run contract`: real OMP with a loopback-only OpenAI-compatible synthetic
  model, temporary HOME/profile and credential-free environment. Prompt text,
  completion, cancel, exact load/resume, missing/invalid session rejection,
  native HTTP error, model-specific usage, notification ordering, and distinct
  usage scopes after adapter restart passed.
- A temporary verification packed the npm archive, checked its 15 file entries,
  installed only production dependencies into an independent temporary directory,
  and ran both smoke and contract against the installed entry successfully.
- Actual executable failure smoke: missing OMP, exit, RPC EOF, and malformed
  output each produced adapter exit code 1; fixture child processes did not survive.
- Unit tests cover delayed native settlement and competing session/prompt
  requests; those boundaries are not claimed as real background-work evidence.

### Matrix record: OMP 18.8.4 (2026-10-09)

Local evidence, not a release declaration.

| Field | Value |
| --- | --- |
| OMP | 18.8.4, Homebrew `can1357/tap`, darwin-arm64 executable |
| OMP digest | SHA-256 `9d6f8b5be9d6b46562ee560a2fd90bc5b1f364da66adfc0f89ada82ee1367675`, 212453664 bytes |
| Node | 26.10.0 and 22.15.0 |
| OS | macOS (Darwin 27.0.0) arm64 |
| Adapter commit | `39d745a40de08edc7baf5d15b3048b7ecd3e2971` |
| Core | `acp-extension-core` 0.1.8 |
| Test profile | `contract` (smoke: per-run `lody-smoke-<pid>`), temporary HOME, loopback-only model |
| Entry under test | npm archive packed from a clean `git archive` export, installed with production dependencies only into an independent temporary directory |
| Result | Pass on both Node versions: `npm run smoke` and `npm run contract` |

- Required cases 1–8 ran against the real executable. Case 1 now compares the
  full `initialize` result with the reviewed capability set; a build that also
  advertised `loadSession` failed the runner.
- Case 9 (child failure) is covered by synthetic tests on Linux, macOS and
  Windows CI, not by this real-executable row.
- Two clean builds with Node 26.10.0 / npm 11.19.1 produced the same archive:
  18120 bytes, SHA-256
  `c7729e02a0394091b92b25c10d750783a01dac0f1dca014e743a759319c5f8a1`, 15 entries.
  Node 22.15.0 / npm 10.9.2 produced identical file contents and an identical
  uncompressed tar, but different gzip bytes (18111 bytes), so the release
  toolchain must be recorded with the digest.

### 矩阵记录：OMP 18.2.8 (2026-10-17)

本地证据，不是发布声明。最低真实合同基线。

| 字段 | 值 |
| --- | --- |
| OMP | 18.2.8，官方发布制品 `omp-darwin-arm64`（缓存副本；`--version` 报告 `omp/18.2.8`） |
| OMP 摘要 | SHA-256 `cf8d34a7fe6f60de1acbe74f29c82026e4c07888e9d89f7ebceeb922159e5787`，193484176 字节 |
| Node | 22.22.3 (npm 10.9.8) |
| OS | macOS (Darwin 27.2.0) arm64 |
| 适配器提交 | `4622df91ab1a97e9b0b01815f803d016d0c9edd6`（干净工作树，运行前后 `git status` 均为空） |
| Core | `acp-extension-core` 0.1.8 |
| 测试配置 | `contract`（smoke：每次运行使用 `lody-smoke-<pid>`），临时 HOME，仅限回环地址的模型 |
| 被测入口 | 在干净工作树中执行 `npm ci` 和 `npm run check`（69 项测试通过）后构建的 `dist/index.js` |
| 结果 | 通过：`npm run smoke` 和 `npm run contract` |

- 必测用例 1–8 使用真实可执行文件运行并通过。
- 用例 9（子进程失败）由 Linux、macOS 和 Windows CI 上的合成测试覆盖，
  不属于本条真实可执行文件记录的覆盖范围。
- `scripts/smoke.mjs` 从 `PATH` 调用 `omp`，不接受可执行文件参数，
  因此运行 smoke 时使用了临时 `PATH` shim，指向缓存的 18.2.8 二进制文件。
  首次未使用 shim 的运行使用了系统 OMP 18.11.3，不计入本记录。
  `npm run contract` 显式接收了 18.2.8 的路径。
- 18.2.8 的其他 OS 目标仍未验证。

### 矩阵记录：OMP 18.12.2 (2026-10-19)

本地证据，不是发布声明。历史记录：2026-10-19 至 2026-10-25 的适配目标（Latest stable），现由 18.12.6 取代，见 Remaining gates。

| 字段 | 值 |
| --- | --- |
| OMP | 18.12.2，GitHub `can1357/oh-my-pi` 发布 `v18.12.2` 的官方制品 `omp-darwin-arm64`（非 draft、非 prerelease；`--version` 报告 `omp/18.12.2`） |
| OMP 摘要 | SHA-256 `abd9a5b0fef77f4204078e348e233faa0dd3d5d81719cf2b6a9b9478c10eee48`，196057120 字节（与 GitHub 发布资产记录的 digest 和大小一致） |
| Node | 22.22.3 (npm 10.9.8) |
| OS | macOS 27.2 (Darwin 27.2.0) arm64 |
| 适配器提交 | `3258961f97abf3eb7d8138abaf86b29171a00b68`（`git worktree` 新建的干净工作树，运行前后 `git status` 均为空） |
| Core | `acp-extension-core` 0.1.8 |
| 测试配置 | `contract`（smoke：每次运行使用 `lody-smoke-<pid>`），临时 HOME，仅限回环地址的模型 |
| 被测入口 | 在干净工作树中执行 `npm ci`、`npm run check`（158 项测试通过）和 `npm run build` 后构建的 `dist/index.js` |
| 结果 | 通过：`npm run smoke` 和 `npm run contract` |

- 制品来源：经 TommyWu 明确授权，由 agent 从官方 Release 下载；摘要与 GitHub 资产记录一致。
- 真实 OMP 可执行文件跑通了 Required case 的主路径（含用例 1 的完整 `initialize` 与已审核能力集比对，以及基本 usage、load/resume、cancel、invalid/missing identity）。
- 用例 5 中「valid 但错误 identity」的那一段，以及用例 7 中 duplicate-message / missing-cost 的断言，只由 `scripts/contract.mjs` 的 `syntheticCases()` 经 `fixture.cjs` 覆盖，不是真实 OMP provider 响应；本条矩阵行不得把这两段写成真实 OMP 证据。
- 用例 9（子进程失败：missing/exit/malformed/eof）同样只由夹具子进程合成覆盖，不属于本条真实可执行文件记录。
- `npm run smoke` 与 `npm run contract` 都以 `argv[3]` 显式接收 18.12.2 的绝对路径；
  两个 runner 在内部隔离 profile 之后才执行 `omp --version`，未使用 `PATH` shim，
  也未使用 `PATH` 上的系统 `omp`。
- 18.12.2 的其他 OS 目标、原生后台任务、自动 compaction 与真实退出路径仍未验证。

### 矩阵记录：OMP 18.12.1 (2026-10-19)

本地证据，不是发布声明。历史记录：2026-10-19 至 2026-10-25 的上一稳定版（Previous stable）回归目标，现由 18.12.5 取代，见 Remaining gates。

| 字段 | 值 |
| --- | --- |
| OMP | 18.12.1，GitHub `can1357/oh-my-pi` 发布 `v18.12.1` 的官方制品 `omp-darwin-arm64`（非 draft、非 prerelease；`--version` 报告 `omp/18.12.1`） |
| OMP 摘要 | SHA-256 `fa41b27d434380e99b713e4f9ced0f73eb1fc0c409fdf23a57c119971d24bac5`，195462176 字节（与 GitHub 发布资产记录的 digest 和大小一致） |
| Node | 22.22.3 (npm 10.9.8) |
| OS | macOS 27.2 (Darwin 27.2.0) arm64 |
| 适配器提交 | `3258961f97abf3eb7d8138abaf86b29171a00b68`（同一干净工作树，运行前后 `git status` 均为空） |
| Core | `acp-extension-core` 0.1.8 |
| 测试配置 | `contract`（smoke：每次运行使用 `lody-smoke-<pid>`），临时 HOME，仅限回环地址的模型 |
| 被测入口 | 同上，`npm ci`、`npm run check`（158 项测试通过）和 `npm run build` 后的 `dist/index.js` |
| 结果 | 通过：`npm run smoke` 和 `npm run contract` |

- 制品来源：经 TommyWu 明确授权，由 agent 从官方 Release 下载；摘要与 GitHub 资产记录一致。
- 真实 OMP 可执行文件跑通了 Required case 的主路径（范围同 18.12.2 条）。
- 用例 5 的 wrong-identity 段、用例 7 的 duplicate-message / missing-cost，以及用例 9，仍只由 `syntheticCases()` / 夹具覆盖，不是真实 OMP 证据。
- smoke 与 contract 均以 `argv[3]` 显式接收 18.12.1 的绝对路径，未使用 `PATH` shim。
- 18.12.1 的其他 OS 目标、原生后台任务、自动 compaction 与真实退出路径仍未验证。

### 矩阵记录：OMP 18.12.6 (2026-10-25)

本地证据，不是发布声明。历史适配目标（2026-10-25 的 Latest stable），现由 18.18.1 取代。运行细节见 `docs-ai/012-remaining-v1-gates/011-r1-macos-18.12.6-clean-matrix.md`，schema/behavior diff review 见 `docs-ai/012-remaining-v1-gates/013-omp-18.12.6-target-review.md`。

上述历史记录的后续更正见 [012.015](docs-ai/012-remaining-v1-gates/015-factual-corrections.md)：运行细节、静态审查与历史审核摘要分别保留，不能由提交 diff 补证缺失的审核过程。

| 字段 | 值 |
| --- | --- |
| OMP | 18.12.6，`/opt/homebrew/Cellar/omp/18.12.6/bin/omp`（Homebrew `can1357/tap/omp`，Mach-O arm64；`--version` 报告 `omp/18.12.6`） |
| OMP 摘要 | SHA-256 `cfbb5e38cd8f8a3be55e710700be587d287deaacdc58c9b0a661c5086bccfe58`，197245984 字节（与 GitHub `can1357/oh-my-pi` 发布 `v18.12.6` 的资产 `omp-darwin-arm64` 记录的 digest 和大小一致） |
| 发布核对 | `gh release view v18.12.6`：非 draft、非 prerelease，发布于 2026-10-21T21:02:53Z；`gh api .../releases/latest` 返回 `v18.12.6`（截至 2026-10-25） |
| Node | 26.10.0 (npm 11.19.1) 与 22.15.0 (npm 10.9.2) |
| OS | macOS 27.0.1 (26A434)，Darwin 27.0.0 arm64 |
| 适配器提交 | `51e1a04124617491c2b6c7b1b919a56037a36bb4`，由 `git archive 51e1a04` 导出到两个空临时目录（每个工具链一份，`diff -r` 一致；无 `.git`、`node_modules`、`dist` 和未跟踪文件） |
| Core | `acp-extension-core` 0.1.8 |
| 测试配置 | `contract`（smoke：每次运行使用 `lody-smoke-<pid>`），runner 自建临时 HOME/USERPROFILE/XDG_*/TMPDIR，仅限回环地址的模型，`auth: none` |
| 被测入口 | 每份导出各自执行 `npm pack` 生成归档，再用 `npm install --omit=dev --ignore-scripts` 装进路径含空格的独立目录；入口为 `<install dir>/node_modules/acp-extension-omp/dist/index.js` |
| 结果 | 两个工具链均通过：`npm run smoke` 和 `npm run contract` |

- 每个工具链执行的命令和结果：
  - `npm ci`：退出 0。
  - `npm run check`：退出 0，4 个测试文件 373 项通过。
  - `npm run build`：退出 0。
  - 两次 `npm pack`：Node 26 两次均为 32161 字节，SHA-256 `ffc06fe551b28b322e19cf60b29f41d9fca7749a60bd090d4ba0ceaf919fc4e5`，15 项；Node 22 两次均为 32543 字节，SHA-256 `a962b1a968796fe2d51d1d6dbee81ac24305e2a49197681f8e4baa9a8ba4b13f`，15 项。两个工具链解包后的 tar 的 SHA-256 一致（`6beb13a8…22e7`），差异只在 gzip 字节。
  - 安装归档：退出 0。
  - `node scripts/verify-package.mjs`：退出 0。
  - `npm run smoke -- "$E" "$OMP"`：退出 0。
  - `npm run contract -- "$E" "$OMP"`：退出 0。
- smoke 和 contract 每个工具链只跑一次，都是首次通过，没有重试 prompt。两个 runner 都以 `argv[3]` 显式接收 OMP 的绝对路径，没有使用 `PATH` shim。`npm run contract` 前后 `pgrep -fl "omp --mode rpc"` 都没有结果。
- 真实 OMP 可执行文件跑通了 Required case 1–8 的主路径（范围同 18.12.2 条）。用例 5 的 wrong-identity 段、用例 7 的 duplicate-message / missing-cost、用例 9，以及合成夹具的固定模型目录回复，仍只由 `syntheticCases()` / 夹具覆盖。真实会话准备也会调用 `get_available_models` 并校验响应，但这不等于验证完整目录内容或模型切换合同。
- 未验证：其他 OS 与 x64 目标、Windows 下的真实 OMP；原生后台任务；自动 compaction；真实退出路径（进行中的 SIGKILL、工具孙进程）；真实模型目录完整性及模型 A→B→A 切换；`51e1a04` 上的 CI 六行结果；独立审核与公开字节回读。上一稳定版 18.12.5 未安装、未测试。

### 矩阵记录：OMP 18.18.1 (2026-11-08—09)

仅限本地候选工作树证据，不是干净提交、发布声明或完整平台矩阵。历史适配目标（2026-11-09 的 Latest stable），现由 18.20.2 取代。

| 字段 | 值 |
| --- | --- |
| OMP | 18.18.1，Homebrew `can1357/tap/omp`；显式入口 `/opt/homebrew/Cellar/omp/18.18.1/bin/omp` |
| OMP 摘要 | 220595344 字节，SHA-256 `ce80099f10c5ea4367523767230cb5b920f30cc139b9cf8758c1cc4b2f1f9409`；与官方 `v18.18.1` 的 `omp-darwin-arm64` 资产一致 |
| Node / npm | 26.13.0 / 11.20.0 |
| OS | macOS 27.0.1，Darwin arm64 |
| 源码身份 | 基于 `f3dd62a8424711a3ed1065482ddc09c27f172c73` 的未提交候选，包含原有消息分段改动及 018；`src/connection.ts` SHA-256 `9cde3fc815bc4166010f4a610f1ae41240418543785abcfd9194d56be704b807` |
| Core | 固定 npm `acp-extension-core` 0.1.8；未切换到相邻 Core checkout |
| 被测入口 | 当前候选 `npm run build` 生成的 `dist/index.js`；不是已发布制品 |
| 测试配置 | runner 自建临时 HOME/profile；contract 和 startup 探针只用无凭据的本地回环模型 |
| 结果 | `npm run check` 414 项通过；build、smoke、contract 均退出 0 |

- 实际命令为 `node scripts/smoke.mjs dist/index.js /opt/homebrew/Cellar/omp/18.18.1/bin/omp`
  和同参数的 `node scripts/contract.mjs`。smoke 不发 prompt；contract 的真实主路径覆盖
  prompt、取消 ACK/终态/流关闭、精确 load/resume、usage、新重启 scope、逐事件顺序及原生错误。
- 用例 5 的 valid-but-wrong identity、用例 7 的 dedup/correction/missing-cost 和用例 9 的
  missing/exit/malformed/eof 仍是 `syntheticCases()` 的合成 RPC 证据，不能算真实 OMP 行为。
- 独立临时 startup 探针通过真实 Lody 启动 resolver 调用同一入口，在 new/load/resume/fork
  交付前传入两个本地模型的显式选择；四次首个实际 HTTP 模型请求依次为 B/A/B/A，建立响应配置一致，
  load/resume 保留原文件、fork 产生不同文件。真实 usage 经 Lody parser 得到独立 scope；
  未知模型拒绝且不发推理请求。相同 startup 探针也在保留的 OMP 18.12.6 上通过。
- 初始化仍只宣告 usage，load/resume/fork/images 不因这些直接调用成功而开放。
  两轮独立源码审查的范围与静态新版合同证据见
  [018 行动记录](docs-ai/018-startup-session-config/001-action.md)。
- 未验证：OMP 18.18.0 回归、当前候选的其他平台/架构及 Node 工具链、原生后台任务、
  自动 compaction、真实进行中进程失败、付费 provider 账单完整性及 Lody GUI 操作。
  本记录不替代干净候选 CI、能力宣告审核或公开制品回读。

### 矩阵记录：OMP 18.20.2 (2026-11-15)

仅限本地候选工作树证据，不是干净提交、发布声明或完整平台矩阵。

| 字段 | 值 |
| --- | --- |
| OMP | 18.20.2，Homebrew `can1357/tap/omp`；显式入口 `/opt/homebrew/Cellar/omp/18.20.2/bin/omp` |
| OMP 摘要 | 224277648 字节，SHA-256 `e2de0974ce581bfcf2044ea795c712fa240fdf8304f7bdb4b3d81b154d2b57fc`；与官方 `v18.20.2` 的 `omp-darwin-arm64` 资产一致 |
| Node / npm | 26.13.0 / 11.20.0 |
| OS | macOS 27.0.1，Darwin arm64 |
| 源码身份 | 与 18.18.1 记录相同的未提交候选（基于 `f3dd62a8424711a3ed1065482ddc09c27f172c73`）；`src/connection.ts` SHA-256 `9cde3fc815bc4166010f4a610f1ae41240418543785abcfd9194d56be704b807` |
| Core | 固定 npm `acp-extension-core` 0.1.8 |
| 被测入口 | 当前候选 `npm run build` 生成的 `dist/index.js`；不是已发布制品 |
| 测试配置 | runner 自建临时 HOME/profile；contract 只用无凭据的本地回环模型 |
| 结果 | `npm run check` 414 项通过；build、smoke、contract 均退出 0 |

- 实际命令为 `node scripts/smoke.mjs dist/index.js /opt/homebrew/Cellar/omp/18.20.2/bin/omp`
  和同参数的 `node scripts/contract.mjs`，各跑一次，首次通过。contract 结束后
  `pgrep -fl "omp --mode rpc"` 没有结果。真实主路径和合成部分的划分与 18.18.1 记录相同：
  用例 5 的 wrong identity、用例 7 的 dedup/correction/missing-cost 和用例 9 仍是合成 RPC 证据。
- 18.18.1→18.20.2 的静态比对只看了五个 RPC 文件。`rpc-session-settle.ts` 与
  `rpc-session-events.ts` 的 blob 未变。`wire/frames.ts`、`wire/rpc-wire.schema.json` 和
  `rpc-mode.ts` 有变化：扩展 UI select 的可选字段、steer 的 `parentIrc`、todo 任务状态去掉
  `blocked`，以及模型目录刷新调用。这些都不在适配器当前使用面内。这是主 agent 的子集比对，
  不是全面审计，也没有经过独立 reviewer。
- 未验证：018 的 startup 双模型探针没有在 18.20.2 上重跑；OMP 18.20.1 回归、其他平台/架构及
  Node 工具链、原生后台任务、自动 compaction、真实进行中进程失败、付费 provider 账单完整性及
  Lody GUI 操作。本记录不替代干净候选 CI、能力宣告审核或公开制品回读。

## Remaining gates

The OMP 18.2.8 baseline real contract passed on macOS arm64 / Node 22.22.3
with the official `omp-darwin-arm64` asset (size and SHA-256 in
`COMPATIBILITY.md`); other OS targets for 18.2.8 remain unverified.
截至 2026-11-15，当前适配目标为 OMP 18.20.2，上一稳定版回归目标为 18.20.1。
上面的 18.20.2 记录来自 macOS arm64 / Node 26.13.0 的本地候选工作树，不是干净 tag 的矩阵行。
18.20.1 尚未安装、未测试。18.18.x 与 18.12.x 记录保留原提交、工具链和限制，只作历史证据。
这些历史记录及直接 load/resume 成功均不关闭当前 baseline、平台或能力宣告门禁。
用例 5/7/9 的合成部分继续与真实 OMP 证据分开。
Agents still must not download OMP without such authorization. The 2026-10-09
names 18.8.6 and 18.8.5 are not the current target. 18.8.4 above is neither
row, including when it is the `omp` found on `PATH`. Required next
evidence includes supported OS targets for that matrix, and native
background/compaction behavior.
Independent maintainer review, reproducible release packaging, and public
artifact SHA-256/size read-back are separate gates; npm package smoke is not
evidence that Lody's managed-runtime download/install pipeline has passed.
