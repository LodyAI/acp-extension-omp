# 017 — 按原生子 agent ID 统计子 agent 状态：计划

| | |
| --- | --- |
| **状态** | 计划中 |
| **锚点日期** | 2026-10-25 |
| **规格核对** | 未核对 |
| **相关** | [012](../012-remaining-v1-gates/000-plan.md)、[012.007](../012-remaining-v1-gates/007-r-ux-contract.md)、[012.009](../012-remaining-v1-gates/009-user-scope-decisions.md)、[MIGRATION.md](../../MIGRATION.md) |

## 背景

[012.009](../012-remaining-v1-gates/009-user-scope-decisions.md) 的用户裁决：子 agent 状态按原生子 agent ID 统计，同一 child 的 follow-up 复用同一 taskId；若 Lody 现有任务面板按此无法正确显示，子 agent 不进入 Release 1，不在适配器里另造执行编号。本条目先核实这个前提，再写出可核对的实现合同。

**前提核实结论（只读源码，2026-10-25）：按 ID 复用 taskId 时，Lody 面板不能正确显示 follow-up。** 证据（Lody 工作树 `557fdc0b`，另有未提交改动，下列片段不在改动内）：

| 事实 | 位置 |
| --- | --- |
| 同一 taskId 合并时终态单调：prev 为 completed／failed、incoming 非终态时保留旧 status／event；incoming 终态仍覆盖 | `Lody:packages/shared/src/acp/claude-subagent-task.ts:139-151` |
| `_meta.lody.task` 只在 `tool_call`／`tool_call_update` 上解析为 `subagent_task` | `Lody:packages/shared/src/acp/history-apply.ts:1105-1123` |
| 已有 taskId 从历史末尾向前找首次出现的 entry 并合并进去，不落到当前 turn | `history-apply.ts:1470-1486`、`1608-1613`、`1764-1780` |
| tool／subagent 更新不 entryBound，可路由到旧 turn | `Lody:apps/cli/src/lib/acp/history.ts:186-206` |
| 面板 Running／取消按钮只看 `in_progress`／`pending` 且 `taskKind==='subagent'` | `Lody:packages/components/src/components/ai-gui/subagent-task-panel.tsx:23-24`、`148` |
| 取消以任务所在 entry 的 `message.id` 为 turnId，并要求 machine `subagentCancellation>=1` | `Lody:packages/components/src/components/ai-gui/view.tsx:4081-4109`、`Lody:packages/shared/src/machine-protocol-capabilities.ts:47-55` |
| CLI 拒绝非当前 turn 的子取消；`AgentClient.cancelSubagent` 要求 `_meta.lody.subagents.cancel===true` | `Lody:apps/cli/src/session/session-execution-service.ts:5592-5608`、`Lody:apps/cli/src/agent/agent-client.ts:1496-1505` |

OMP 18.12.6（Homebrew 二进制 SHA-256 `cfbb5e38…bccfe58`，内嵌 `task/executor.ts`）的 follow-up 路径对同一 `id`、同一子 `sessionFile` 再发 `status:"started"`，结束时经共享收尾再发终态 lifecycle；`RpcSubagentRegistry` 在终态时删除 roster。推断：follow-up 总在上一次执行的终态之后。

合起来：follow-up 的 `in_progress` 被终态单调吞掉，面板继续显示 Completed，无 Running、无取消按钮；落在新父 turn 时，行仍在旧 turn，新 turn 看不到；即使状态能变，取消也带旧 turn id，被 CLI 以 `The parent turn is no longer active.` 拒绝。follow-up 若失败，旧 turn 的行会由 Completed 改成 Failed。

**建议：按 012.009 把子 agent 状态移出 Release 1。** 本计划其余部分只为以后 Lody 侧放宽合并或宿主另有决定时保留合同，不构成 Release 1 实施请求。

## 目标

1. 记录上面的前提结论，作为 012.009「面板不可行则移出」的判断依据。
2. 若以后获准实施，按下方方案翻译子 agent 状态，不宣告未通过真实验收的能力。

### 非目标

- 不另造本地执行编号、不按「再见一次 started」拆 taskId（012.009 已排除）。
- 不实现 `list`／`output`／`steer_subagent`／`get_subagent_messages`，不订阅 `events` 级 raw 子事件。
- 不在本仓库改 Lody 的合并、路由或面板；那属于 Lody，归属以 `MIGRATION.md` 为准。

## 方案（仅在获准后实施）

- **taskId。** 来源 = 精确父 `sessionFile` + 会话 generation + 原生子 agent ID（lifecycle `payload.id`、progress `payload.progress.id`），编码为 opaque 字符串；不用人类名 `agent`、不用子 `sessionFile` 代替 ID。同一 child 的 follow-up 复用同一 taskId，状态取最新原生帧。
- **订阅。** 会话准备完成后发 `set_subagent_subscription{level:'progress'}`；失败不宣告能力。18.12.6 只接受 `off|progress|events`。
- **owner 与隔代。** 只接受当前 generation、当前精确父 `sessionFile` 的帧；new／load／resume／fork 成功后旧反向表整体失效，迟到帧丢弃。OMP 自身 `hasSameOwner` 在双方缺 parentToolCallId 与 sessionFile 时放行，不当完整 provenance。
- **状态映射。** lifecycle `started`→`in_progress`；`completed`→`completed`；`failed`／`aborted`→`failed`（aborted 写入 error 说明）。progress 的 `progress.status` 同表映射（含 `running`→`in_progress`）。carrier 为稳定 `toolCallId` 的首帧 `tool_call`、后续 `tool_call_update`，`_meta.lody.task={version:1,taskId,kind:'subagent',status,...}`；description／parentToolCallId 只在原生帧有值时填写。不凭 ACK 合成终态。
- **取消。** `_lody/subagents/cancel{sessionId,taskId,reason?}` 先校验 sessionId、generation 与反向表，再发 `cancel_subagent{subagentId}`。原生 `{cancelled:true|false}` 都只回 `{}`；未知或旧代 taskId 拒绝；原生错误向调用方失败，不中止父 prompt。可能命中该 child 当前那次执行，这是 012.009 接受的语义。
- **能力宣告。** `_meta.lody.subagents={version:1,lifecycle:true,cancel:true}` 只在合成验收、真实 N、真实 Lody 面板全部通过并经 R3 审核后宣告；任一不过则整键不宣告。
- **用量。** 子 agent 的 `message_end`、progress 里的 `tokens`／`cost` 都不进父 `SessionUsageAccumulator`。
- 预计改动 `src/connection.ts`、`src/server.ts`，测试在 `test/connection.test.ts`、`test/server.test.ts`。

## 备选与决策

| 方案 | 结论 |
| --- | --- |
| 按原生 ID 复用 taskId，面板不可行则移出 Release 1 | 采用（012.009）。前提核实为不可行，故建议移出。 |
| 适配器为每次 started 生成新 taskId | 不采用。012.009 明确排除；本地计数也不是原生执行身份。 |
| 只在首次执行显示，follow-up 静默丢弃 | 不采用。面板会把仍在跑的工作显示成 Completed，属于错误显示。 |
| Lody 放宽 `subagent` 的终态单调并按当前 turn 路由 | 不在本仓库决定。需 Lody 侧另行设计，且仍要解决取消 turn 绑定。 |

难以回头的改动：宣告 `_meta.lody.subagents`。宣告后 Lody 会显示取消按钮并路由取消；前置不足时不宣告。

## 验收（获准实施时）

- 合成 RED（先失败再实现）：started→progress→completed；同 child completed→follow-up started 复用同一 taskId；重复 started；旧代迟到 progress／终态被丢弃；跨会话同名 ID 不串；owner 字段缺失；aborted→failed 带说明；cancel 的未知／旧代 taskId 被拒、`cancelled:false` 回 `{}`、原生错误失败且父 prompt 不受影响；子 `message_end` 不计入父 usage；订阅失败不宣告；`initialize` 全量断言。
- 真实 N（隔离 profile）：两个子 agent，只取消一个，另一个与父继续；同 child 再执行一次；切换会话后旧帧不串。记录实际帧字段。
- 真实 Lody 面板：follow-up 显示 Running、单子取消不触发父 Stop。按当前 Lody 源码预期不通过；不通过即维持「移出 Release 1」。

## 未验证的问题

- OMP 结论来自二进制内嵌源码阅读，未跑真实子 agent，未确认 `progress.status` 的全部取值。
- Lody 结论来自源码阅读，未在真实面板复现；Lody 工作树有未提交改动。
- 「follow-up 总在终态之后」是推断。

## 修订记录
