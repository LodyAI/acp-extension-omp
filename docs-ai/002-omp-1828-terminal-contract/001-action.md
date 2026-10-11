# 002 — OMP 18.2.8 legacy RPC 终态：行动记录

## 时间线

| 日期 | 变更 | 引用 |
| --- | --- | --- |
| 2026-10-07 | 取得并校验官方 OMP 18.2.8 macOS arm64 binary；确认 release asset、大小与 SHA-256 | `/tmp/omp-18.2.8-darwin-arm64`；`omp/18.2.8` |
| 2026-10-07 | 先运行 legacy 终态回归，确认普通 prompt、取消、local prompt 与新版终态存在协议差异 | [`test/connection.test.ts`](../../test/connection.test.ts) |
| 2026-10-07 | 在 `src/connection.ts` 增加 legacy `agent_end` 终态、取消和 assistant provider error 映射 | [`src/connection.ts`](../../src/connection.ts) |
| 2026-10-07 | 增加 18.2.8 `message.responseId` usage 解析，同时保留 18.3.1 顶层 `messageId` 解析 | [`src/connection.ts`](../../src/connection.ts) |
| 2026-10-07 | 移除临时 frame 诊断输出，保留 stderr 静默 drain，避免污染 ACP/RPC stdout | [`src/rpc-transport.ts`](../../src/rpc-transport.ts)、[`scripts/contract.mjs`](../../scripts/contract.mjs) |
| 2026-10-08 | 在隔离 profile、loopback-only synthetic model 下运行 OMP 18.2.8 与 18.3.1 real contract | [`TESTING.md`](../../TESTING.md) |
| 2026-10-08 | 更新兼容矩阵、真实合同记录和 docs-ai 索引 | [`COMPATIBILITY.md`](../../COMPATIBILITY.md)、[`TESTING.md`](../../TESTING.md)、[`docs-ai/README.md`](../README.md) |
| 2026-10-10 | 将官方 18.2.8 asset 按 API byte range 分块持久化到用户缓存，重新校验 size/SHA-256，并以 Node 22.22.3 fresh-repeat 18.2.8 contract | `/Users/tommywu/.cache/acp-extension-omp/omp-18.2.8-darwin-arm64` |

## 结果与当前状态（截至 2026-10-10）

OMP 18.2.8 最低真实合同基线已经取得可运行 binary 并通过 adapter real contract。普通异步 prompt 使用 terminal `agent_end` 完成；`agent_end.isTerminal: false` 不提前完成；legacy cancel 等待 native terminal 后映射为 ACP `cancelled`；assistant `stopReason: "error"` 映射为 ACP rejection。18.2.8 local-only prompt 仍通过 `prompt_result.agentInvoked: false` 完成。

OMP 18.3.1 继续使用带 `yielded` 的 agent event、terminal `prompt_result` 和 `sessionSettled` 合同；provider error 继续映射为 ACP rejection。两个版本的 usage 解析分别覆盖 `message.responseId` 与顶层 `messageId`，并保持去重、restart scope 和 notification ordering。

真实合同使用以下非敏感矩阵字段：

- OMP：`18.2.8`，官方 release asset `omp-darwin-arm64`；`193,484,176` bytes；SHA-256 `cf8d34a7fe6f60de1acbe74f29c82026e4c07888e9d89f7ebceeb922159e5787`。
- 环境：Node `22.22.3`、macOS arm64、Core `0.1.8`。
- 运行方式：隔离临时 HOME/profile `contract`、loopback-only synthetic model、credential-free environment。
- adapter：工作树基于 `4fd87e3135631bef634230bf2e1c155910e831ee`，测试时包含未提交修改；该 SHA 不是本次精确 tested source 的最终 commit。
- 结果：`npm run contract -- dist/index.js /Users/tommywu/.cache/acp-extension-omp/omp-18.2.8-darwin-arm64` fresh-repeat 通过 prompt、cancel、exact load/resume、usage、restart、ordering 和 error cases；对应的 18.3.1 命令也通过。

本轮重新运行门禁：Node `22.22.3` 下 `npm run check` 通过，28/28 tests；`npm run build`、`npm run smoke`（OMP 18.3.1 initialize/new/load）、18.3.1 real contract、`npm pack --dry-run`（15 files）和 `git diff --check` 均通过。首次以 Node `20.19.6` 跑 check 时，server tests 因 `Promise.withResolvers` 不可用失败；切换到项目要求的 Node 22 后完整通过。

18.2.8 asset 首次从 `/tmp` 清理后，官方 API 直连曾分别出现 HTTP/2 `PROTOCOL_ERROR` 和 HTTP/1.1 transfer closed。随后通过官方 asset API 的 byte-range 分块下载到持久缓存，重新取得完整文件并得到与 release digest 一致的 SHA-256；本次 fresh-repeat 合同通过。

此前 `npm run check` 已通过类型检查及 2 个测试文件共 28 项测试；当前工作树的最终 artifact 和独立 review 仍是后续门禁。

## 相对计划的偏差

无已知实现偏差。计划中的 legacy `agent_end` 方案已覆盖 18.2.8，并保留 18.3.1 的显式 terminal settlement 路径。计划之外补充了 legacy assistant provider error 回归和 `message.responseId` usage 回归，因为真实合同暴露了这两个差异。

完整 binary 已取得并在持久缓存中复核；18.2.8 fresh real contract 已通过，不再存在本条目的下载阻塞。

## 未验证的问题

- 18.2.8 当前只在 macOS arm64 验证；其他 OS 未验证。
- latest/previous stable 版本矩阵尚未完成；未来版本不能仅凭版本号宣称兼容。
- native background/compaction 行为尚未完成真实验证。
- 独立维护者 review 尚未完成；此前 reviewer 委派因 `403 No active subscription found for this group` 失败。
- immutable artifact 构建、最终 package 的公开 size/SHA-256 read-back 和 Lody managed-runtime 下载/安装链路尚未验证。
- 当前尚未创建 commit、PR、tag、release，也未修改 Lody 工作树。
