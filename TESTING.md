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

## Remaining gates

The OMP 18.2.8 baseline real contract passed on macOS arm64 / Node 22.22.3
with the official `omp-darwin-arm64` asset (size and SHA-256 in
`COMPATIBILITY.md`); other OS targets for 18.2.8 remain unverified. The
stable-version matrix remains unverified. As of 2026-10-09 the latest stable OMP
release is 18.8.6 and the previous stable is 18.8.5; neither is installed here,
and agents must not download OMP. 18.8.4 above is neither row. Required next
evidence includes that matrix, supported OS targets, and native
background/compaction behavior.
Independent maintainer review, reproducible release packaging, and public
artifact SHA-256/size read-back are separate gates; npm package smoke is not
evidence that Lody's managed-runtime download/install pipeline has passed.
