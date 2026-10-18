# 008 — 已结算终态通知排空期间的取消：行动记录

## 时间线

| 日期 | 变更 | 引用 |
| --- | --- | --- |
| 2026-10-18 | 独立 Codex CLI reviewer 核对规格，明确允许实现 | `000-plan.md` |
| 2026-10-18 | 新增三种原生状态 × 两条结算路径的六个回归；旧实现均发送多余 abort，六例失败 | `test/connection.test.ts` |
| 2026-10-18 | 在 drain 前保存 settled terminal；晚到取消仅等待 active.done | `src/connection.ts` |
| 2026-10-18 | 类型检查与 94 个测试通过，构建通过 | `npm run check`、`npm run build` |
| 2026-10-18 | 构建产物的独立合成 smoke 六场景全部通过 | `dist/connection.js`（本地构建产物） |

## 结果与当前状态（截至 2026-10-18）

- `finishPrompt()` 首次 await 前复用 `active.terminal` 保存已结算事实。
- `cancel()` 继续建立并清理 cancellation gate；已知结算时不设置 abortState、不发 abort，只等待原生结果。
- 回归覆盖 completed → end_turn、aborted → cancelled、error → 拒绝。
- 每种状态分别覆盖直接 `prompt_result.sessionSettled:true`，以及未结算终态后的 `session_settled`。
- 回归同时验证通知排空前不完成 prompt/cancel，不接纳新 prompt/session；排空后连接可复用且无 host.failure。
- 原有未结算、legacy 和在途 abort 的 ACK／拒绝测试保持通过。
- `npm run check`：3 个测试文件、94/94 测试通过，含新增 6 个回归。
- server 测试中的 abort 拒绝场景产生预期的 SDK notification error stderr；该测试通过。
- `npm run build`：退出码 0。
- 无文件落地的 Node 合成脚本直接导入构建后的 `dist/connection.js`，6/6 场景验证无 abort、排空顺序、原生状态与 RPC 复用。
- `README.md` 仅补充 V1 contract 的该取消边界；`TESTING.md` Required cases 未改。
- 补充构建产物 smoke：late cancel 后 `host.update` 拒绝，未发 abort，prompt/cancel 均拒绝并向 host 报告失败；合成 smoke 共 7 个场景通过。
- 未修改 `package.json`，未暂存、提交或推送。
- 两轮独立 Codex CLI 只读审核均重新检查完整任务 diff，第二轮复核前轮结论；均未发现可报告缺陷，无未解决、延期或修复后未复审问题。审核不冒充运行验证，真实 OMP 与发布矩阵未检查。

## 相对计划的偏差

内置 reviewer agent 因缺少模型配置无法启动，显式模型参数也被工具拒绝；
改用本机 `codex exec --ephemeral --sandbox read-only` 完成独立规格核对与实现审核，未修改任何模型或凭据配置。
实现方案无已知偏差。

## 未验证的问题

未运行真实 OMP/provider、`npm run smoke`、`npm run contract` 或发布矩阵。
本轮证据为合成回归与构建产物验证，不新增真实版本兼容性声明。
