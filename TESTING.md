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

本地证据，不是发布声明。当前适配目标（Latest stable）。

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

本地证据，不是发布声明。上一稳定版（Previous stable）回归目标。

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

## Remaining gates

The OMP 18.2.8 baseline real contract passed on macOS arm64 / Node 22.22.3
with the official `omp-darwin-arm64` asset (size and SHA-256 in
`COMPATIBILITY.md`); other OS targets for 18.2.8 remain unverified.
As of 2026-10-19 the current compatibility target is OMP 18.12.2 and the
previous stable regression target is 18.12.1 (GitHub `can1357/oh-my-pi`
releases `v18.12.2` and `v18.12.1`). Both passed `npm run smoke` and
`npm run contract` on macOS arm64 / Node 22.22.3 at adapter commit `3258961`
with official `omp-darwin-arm64` assets downloaded under explicit maintainer-side
authorization (records above); other OS targets remain unverified, and the
synthetic-only portions of cases 5/7/9 noted in those rows are not real-OMP evidence.
Agents still must not download OMP without such authorization. The 2026-10-09
names 18.8.6 and 18.8.5 are not the current target. 18.8.4 above is neither
row, including when it is the `omp` found on `PATH`. Required next
evidence includes supported OS targets for that matrix, and native
background/compaction behavior.
Independent maintainer review, reproducible release packaging, and public
artifact SHA-256/size read-back are separate gates; npm package smoke is not
evidence that Lody's managed-runtime download/install pipeline has passed.
