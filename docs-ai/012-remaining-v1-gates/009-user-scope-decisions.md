# 012.009 — 用户对子 agent、后台终端和计费的范围裁决

## 背景

[007](007-r-ux-contract.md) 和 [008](008-execution-contract-decisions.md) 把子 agent 状态卡在 S-ID（同一 child 的多次执行没有可证明的执行身份），把后台终端卡在 B-STATE（首次 yield 后没有后续 outcome，Stop 是否真正终止 job 未证明），把计费卡在 U-B 的每 prompt scope、R2 的迟到帧归属和 Lody 丢弃 `usageScopeId`（LI-003）。2026-10-25 已用 Homebrew 把本机 `omp` 升到 18.12.6，`npm run smoke` 在隔离 profile 下通过 initialize／new／load，未发 prompt；18.12.6 尚无 `npm run contract` 记录。

## 裁决（用户，2026-10-25）

| 项 | 裁决 | 对 004 底线的影响 |
| --- | --- | --- |
| 子 agent 状态 | 直接按原生子 agent ID（`payload.id`／`payload.progress.id`）统计状态，不要求区分同一 child 的不同执行 | 保留，但放宽 S-ID |
| 子 agent 显示面 | 用 Lody 现有任务面板；按子 agent ID 无法在面板正确显示时，不加入 Release 1 | 有条件保留 |
| 后台终端 | Release 1 不加入 | 移出底线 |
| 计费 | 跟随 Lody 其他内核，按 agent 每日用量额度汇总显示；不做每会话、每轮费用显示 | 「看到本轮计费」改为「计入 agent 每日用量」 |

## 变更

**S（子 agent）。** S-ID 不再要求可证明的本次执行身份。适配器以「精确父 `sessionFile` + 会话 generation + 原生子 agent ID」作为 taskId 的来源；同一 child 的 follow-up 复用同一 taskId，状态取最新原生帧。仍保留：owner 校验、切换／fork 后的隔代、子 `message_end` 不计入父 usage、不凭 ACK 合成终态。取消按子 agent ID 路由到 `cancel_subagent`，可能命中该 child 当前正在跑的那次执行，这是本裁决接受的语义。

已知代价：Lody 对同一 taskId 的终态单调合并，同一 child completed 之后的 follow-up 可能无法在面板再显示 Running。实施前必须先对照 `Lody:packages/shared/src/acp/claude-subagent-task.ts`、`history-apply.ts` 和 `subagent-task-panel.tsx` 确认；若面板因此显示错误，按上表移出 Release 1，不在适配器里另造执行编号绕过。

**B（后台终端）。** B-H1／B-STATE 不再是 Release 1 门禁，`_meta.lody.tasks` 不宣告。013 已实现的 held root yield outcome 保留，不回退。

**U（计费）。** U-B 的每 prompt scope 和每轮 UI 不再是 Release 1 目标，适配器不切换 U-B。用量仍只来自终端 assistant `message.usage`，经 `SessionUsageAccumulator`，cost 缺省仍为未知。R2 收窄为：迟到帧在 agent 日汇总里不重复、不丢失、不跨会话计入，不再要求归属到具体轮。Lody 如何把其他内核的用量汇总为每日额度，以及 LI-003 是否影响日汇总，属于 Lody 侧，归属以 `MIGRATION.md` 为准，需先查清再定 `usage` 宣告条件。

## 不变

本文件不授权改 `src/`。S 的实现合同、U 的宣告条件仍要另写、并由非起草者核对后才能实施。R1 在 18.12.6 上的合同记录、真实 Lody 验收、R3–R6 的门禁不变。fork、图片、模型、标题的底线不变。

## 引用

基准正文是同目录的 `000-plan.md`；被修订的合同见 [004](004-user-visible-floor.md)、[007](007-r-ux-contract.md)、[008](008-execution-contract-decisions.md)。

## 当前状态

计划仍是「计划中」。上表是用户的方向裁决，尚无 S／U 的可实施合同。
