# 008 — 已结算终态通知排空期间的取消：计划

| | |
| --- | --- |
| **状态** | 已实现 |
| **锚点日期** | 2026-10-18 |
| **规格核对** | 独立 Codex CLI reviewer（gpt-6-astra，read-only）核对目标、非目标、备选、不可逆风险与验收，无阻塞，允许实现。 |
| **PR** | #9 |
| **相关** | `README.md`；`docs-ai/007-review-findings/000-plan.md` |

## 背景

Codex 指出：当前协议的 `prompt_result` 已验证 `sessionSettled:true` 后，
`finishPrompt()` 仍可能等待慢 `host.update`，此时 `this.active` 仍存在。
`cancel()` 会发送多余的 `abort`；若 OMP 拒绝，现有失败路径关闭 RPC，丢失已经验证的原生结果。
源码中 `finishPrompt()` 先排空通知、后清除 active，符合该触发条件。

## 目标

- 收到已验证的 settled terminal 后、排空通知之前，保存已结算事实。
- 该窗口中的取消不发 abort，仍等待通知排空，并保留 completed / aborted / error 原生结果。
- 排空前不允许新工作；排空后 RPC 仍可服务新工作。

### 非目标

- 不改变 legacy、未结算终态、已经发送 abort 的 ACK 和失败处理。
- 不修改 `package.json`、启动参数、能力宣告或发布兼容性结论。

## 方案

- 在 `src/connection.ts` 的 `finishPrompt()` 首次 await 之前，将
  `sessionSettled === true` 的 frame 记录为 `active.terminal`。
  复用现有状态，也覆盖已验证未结算终态随后收到 `session_settled` 的路径。
- `cancel()` 保留 cancellation admission gate；在设置 abortState 与发送命令之前，
  若 `active.terminal?.sessionSettled === true`，只等待 `active.done` 然后返回。
  不覆盖原生状态，不吞原生错误或 host 通知错误。
- 在 `test/connection.test.ts` 使用现有合成 RPC peer 和 deferred gate，
  参数化 completed / aborted / error 与直接结算 / 后续 session_settled。
  host.update 阻塞时发起取消；合成 OMP 拒绝任何多余 abort。
  检查 drain 前无 prompt/cancel 结果、无 abort、新工作被拒，drain 后状态准确、无 host.failure、连接可复用。
- 验证后只在 `README.md` 的 V1 contract 增加这一取消边界的中文说明。
- 提议新建同目录 `001-action.md`，记录证据与验证边界；更新 `docs-ai/README.md` 索引。

## 备选与决策

- 新增 settled 布尔字段：与现有 terminal 重复，存在两份状态漂移风险；不选。
- 结算时提前清除 active：会允许新 prompt 或会话切换越过通知排空；不选。
- 忽略 abort 拒绝：无法区分真实命令失败，改变未结算与在途取消语义；不选。
- 选择复用 terminal 并只在已知结算时跳过发送；无公开 API 变更、无不可逆迁移。

## 验收

- 先增加回归测试，运行 `npm test -- test/connection.test.ts -t 'skips abort after native settlement'`，预期旧代码因多余 abort 导致失败。
- 最小实现后运行 `npm run check` 和 `npm run build`。
- 用构建后的 `dist/connection.js` 和合成 Web Streams 单独运行慢 host.update 的取消 smoke，观察无 abort、排空顺序和原生状态。
- 独立 reviewer 先核对规格并明确允许实现；完成后至少两轮审核完整任务 diff，复核前轮问题。
- 不使用真实 OMP/provider；合成证据不等于真实版本兼容性验证。
