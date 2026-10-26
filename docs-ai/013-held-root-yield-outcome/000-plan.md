# 013 — 不丢失已 yield 后 root 终态：计划

| | |
| --- | --- |
| **状态** | 已实现；仅本条目的 held current root yield outcome 聚合切片，不代表完整 B／R2／native N／Release 通过 |
| **锚点日期** | 2026-10-24 |
| **规格核对** | 2026-10-24，非起草者 NativeOutcomeProofReview 独立全文核对并允许该窄切片；非起草者 ForkImageGateReview 完成多轮全文核对及 013-SPEC-01 分类澄清复核，允许仅在 `src/connection.ts`／`test/connection.test.ts` 实现正文限定的 held current root yield 聚合，前置 error／aborted 永久 RED 已由主 Agent 分别观察。2026-10-25，ForkImageGateReview 第二轮完整修后实现复审关闭 013-IMPL-01，`findings=[]`；RootOutcomeQualityReview 独立完整质量轮同样 `findings=[]`，无已知未解 013 findings 或该片修后未审项。局部许可及实现结论不关闭完整 B、R2／U-B、idle Stop、native N、Lody、能力或 Release 门禁。 |
| **相关** | [写入纪律](../../AGENTS.md)、[legacy 终态](../006-omp-1828-terminal-contract/000-plan.md)、[V1 门禁](../012-remaining-v1-gates/000-plan.md)、[执行范围](../012-remaining-v1-gates/008-execution-contract-decisions.md) |

## 背景

B-STATE-01：当前 ACP prompt 已收到同 ID、通过 current status/settlement 校验的真实初始 `prompt_result`，其 `status=completed, sessionSettled=false`。adapter 继续持有 prompt，但后续真正 root yield 的 error/aborted outcome 目前不会进入最终结算。

**已有实测，非本条目复跑**：主 Agent 已执行 `node /tmp/acp-omp-root-yield-repro-Q4gnsm/run.mjs dist/index.js`，经真实 compiled adapter、合成 native fixture 得到 exit 1 / `B-STATE-01-observed`。输入为 native ACK → 唯一同 ID `prompt_result completed/false` → root `message_start/update/end`（assistant `stopReason=error`）→ `agent_end yielded:true`（最后 assistant 为 error）→ `session_settled`；实际 ACP 返回 `end_turn`，`notificationDrainObserved=true`。adapter 自然 exit 0，owned native group 已消失，runtime 临时目录已删除。该外部临时脚本是已有诊断，不是永久回归；源码注释里的作者“未执行”不取代主 Agent 的实际执行记录。

**证据界限**：上述只实测 error 的合成 wire 序列，没有运行真实 OMP，没有证明 native 可达时序或兼容矩阵；aborted 分支尚无实测 RED。独立源码结论来自 `NativeOutcomeProofReview` 的 B-STATE-01 与 local native ownership artifact（`release1-native-ownership-design.md`，非仓库发布文件），本计划进一步对照了当前源码及固定 OMP commit `1d5aff90b057ce7dbfe32ea557a527c1b3144b72`。

### 三个假设与 working legacy 对照

| 假设 | 源码证据／预测 | 判断 |
| --- | --- | --- |
| current `agent_end` 被忽略 | `src/connection.ts:354–362` 对 own boolean `yielded` 仅关闭 legacy 路径即返回，根本不读最后 assistant；预测后续 error/aborted 无法改变 held outcome | **主根因，源码确定**；error 假成功已有上述合成实测，aborted 是同分支推断 |
| `session_settled` 覆盖已保存的 error | `src/connection.ts:430–432` 只复制 `active.terminal` 并补 `sessionSettled=true`；`applyCurrentPromptSettlement:62–79` 已保存初始 completed。没有已保存的后续 error 可供其覆盖 | **不是另一处“error→completed 赋值”**；它忠实消费了陈旧 completed，是根因的最终出口 |
| 通知抢跑导致成功 | `finishPrompt:545–564` 循环 drain 到稳定 notification tail 后才交付；本次 `notificationDrainObserved=true` | **不是本次症状原因**；只排除本轨迹，不宣称所有时序均已验证 |

working legacy：无 own `yielded` 的 `agent_end`，会过滤 `isTerminal=false`，倒序找最后 assistant，把 error 拒绝、aborted 映 `cancelled`，并复用通知 drain。已有 `test/connection.test.ts:334–547` 覆盖这一路及“current 首次 agent_end 必须等待 prompt_result”。不能简单删除 current 分支的 return：那会把首次 yield 当 settlement，并把 legacy 的缺消息取消推断混入 current 协议。

## 目标

- 在已验证初始真实同 ID result、`sessionSettled=false` 的 held prompt 内，后续真正 root yielded outcome 不得被最早 completed 吞掉：error 最终拒绝；真实 aborted 在无 error 时最终映 ACP `cancelled`。
- 保留真实 settlement、通知排空、同一 active 身份与已有 native abort ACK 等待；只有到实际完成边界才交付一次 ACP 结果。
- 多个真实最终 yield 采用明确的 **error 吸收优先**：error > aborted > completed；后续 completed 不抹 error/aborted，后续 aborted 也不抹 error。

### 非目标

- 不解决 idle Stop 在 native 没有 aborted outcome 时的合同，不从 Stop 意图或 ACK 合成 cancelled，不变更该既有行为或宣称其门禁关闭。
- 不改首次 yield 释放策略、不要求第二个 `prompt_result`；不改 R2 消息/计费来源、U-B、job kill、子 agent 控制或通用桥。
- 不新增 cloud API、outbox、重试、计时器、debug 日志、能力宣告或宿主接口；不把独立任务失败升级为 root failure，不扩展为完整 B-STATE 实现。

## 方案

实现获独立核对并明确允许后，只在已存在的 `src/connection.ts` 和 `test/connection.test.ts` 内落实；本轮仅提议创建本 `000-plan.md` 并登记索引，不写 `001-action.md`。

### 来源与 admission

1. 沿用 current 真实 result 的同 ID、status、布尔 settlement 校验；只有该初始 result 已到且为 false 的 active prompt 可接收后续 root outcome。current 首次 `agent_end` 在 result 之前仍不释放、不替代初始 result。
2. root 只取已有父 session RPC 的顶层 `agent_end`，遵守现有 session/generation 与独占 active 约束；不解包 child/subagent 事件、不从普通 `message_end` 提取最终 outcome、不从 task/job failed 推导 root error。
3. own boolean `yielded=true` 才是本条目的 outcome 边界，即使 `isTerminal=false, awaitingAsyncWork=true` 仍可是真实 yield；`yielded=false` 的 retry/reminder/compaction 中间 error 不入账。
4. 不新增因果 prompt/run 身份保证：本方案仅定义同一独占 held root activity stretch 的结果聚合，不声称每个 wake 都由原 prompt 因果产生；R2 仍独立阻塞。

### 分类、聚合与完成

| 当前状态／输入 | 拟定行为 |
| --- | --- |
| AwaitInitial；current yielded end | 保留既有等待初始真实 result 语义；不走 legacy finish |
| 初始真实 result，settled=true | 沿用现有终态与 drain；此后排空期间的 root 事件不得改写已 settlement 的 outcome |
| 初始真实 result，settled=false | 以其已验证 status 建立 Held 的有效 outcome；初始 error/aborted 同样不能被后来 completed 洗掉 |
| Held；后续顶层 `yielded=true` | `messages` 必须存在且为数组；倒序读取最后 assistant，其合法 `stopReason` 仅 error → error、aborted → aborted、stop／length／toolUse → completed。合法空数组或合法无 assistant 数组 → completed；缺失／非数组 `messages`，或最后 assistant 的未知字符串、缺失、非字符串 `stopReason` 均走已有安全协议失败路径，不得默认为 completed。合法 outcome 按吸收优先级合并，只更新 outcome，不 finish |
| Held；`yielded=false` 或 child/task/job 包装事件 | 不参与 root outcome；不触发 prompt completion |
| Held；真实 `session_settled` | 冻结合并后的 outcome 并补真实 settled 标记，再进既有 `finishPrompt`；不是从 statusless settled 新造 completed |
| 已 settlement、通知仍慢 | 保留 active 与已冻结终态；循环 drain 到稳定 tail；晚到 cancel 不发 abort，不把 error/aborted 降级 |
| 有真实 root aborted，cancel ACK 未到 | 遵守既有 requested/acknowledged 门禁；ACK 与 settlement、drain 均满足后才交付 cancelled；无 cancel 请求不额外要求 ACK |
| 有真实 root error，后到 abort ACK／aborted／completed | 保留 error；既有 cancel 等待与 failure 传播不变，不能以 cancelled 掩盖 error |

聚合可直接保留 active 上的有效终态，不要求新增通用 ledger、保留整份 messages 或复制原生错误分类器。有效 root error 继续以现有安全消息 `OMP prompt failed` 拒绝，不输出 provider 原始内容。本条目明确采用有界的已知 `StopReason` 合同，而非照搬 native `runOutcome` 在运行时对其他值一律 completed 的 catch-all：缺失／非数组 `messages`，以及最后 assistant 的未知字符串（如 `future_reason`）、缺失或非字符串 `stopReason` 均是 malformed，沿已有安全协议失败路径处理，不能转换为空数组或 completed。合法空数组／合法无 assistant 数组仍按 native completed；仅 current held 的分类边界在此澄清，own-property discriminator、command failure、传输/通知失败优先级与 legacy 分支保持原约束。

### 固定源码依据

- [native ticket / runOutcome](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/modes/rpc/rpc-prompt-results.ts#L133-L182)：报告时删除 ticket，只有一个 result；每个真实 yield 从最后 assistant 分类，不会为后续 wake 再发同 ticket result。
- [retry/error routing](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/session/agent-session.ts#L4690-L4815) 与 [yield flags](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/session/agent-session.ts#L5315-L5340)：内部重试用 willContinue，真正 yield 与 async pause 有明确标记。
- [parent dispatch](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L1667-L1675) 与 [settle watcher](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/modes/rpc/rpc-session-settle.ts)：先转发父事件，再观察 result/settlement；settled 只报告 quiescence，不补 outcome。

## 备选与决策

- **推荐：真实 yield 的 error/aborted 吸收聚合**。原生内部 retry 在非 yielded 边界被排除，真正 yield error 是该 run 已失败的源证据；同一 held ACP 操作不能随后静默成功。代价是后续独立 root wake 即使成功，也不会恢复该 ACP 操作；这是本计划待核对的聚合合同，不冒充 OMP 对整个 stretch 自带的 outcome。
- **last-yield-wins，允许恢复**：可表达最后一次活动成功，但会把已确认错误洗掉；现有发布面未给此 ACP stretch 显式“撤销错误／恢复成功”primitive，故不推荐。若改选必须另有源证据并修改永久验收，不能藏进赋值顺序。
- **所有 current agent_end 都按 legacy finish／在 message_end error 时失败**：会提前释放或误判能恢复的内部 retry，排除。**首次 yield 即释放**改变现有 settlement/Stop 合同，明确不在本条目选择；**只改 settled**则仍无后续 outcome 来源，不能解决根因。

### 难以回头的影响与风险

ACP 响应一旦交付无法撤回；必须在真实 settlement 前完成聚合，并冻结 drain 期间结果。吸收规则会将此前假成功改为可见失败/取消，也可能让“错误后另一次成功”仍失败，需要 reviewer 明确接受。无 ID 的 root/settled 只在现有独占 held scope 消费，不补足 R2；真正 native 永久 busy 也不靠新 timeout 合成完成。idle Stop 无 aborted、独立任务控制仍未解决，不得用本修复宣告 B 或 Release1 完成。

## 验收

以下均为**获许可后的待执行项**，本条目未写/运行永久测试、build、lint、formatter、smoke 或 OMP。使用已有 `peer/emitBatch/deferred/setUpdate/setUsage` 模式，阻塞与释放采用显式 gate；及时挂 rejection observer，设进度断言并在 finally 释放 gate，不能把测试超时当预期失败。

| 永久回归输入／时序 | before/after 应捕获的观察 |
| --- | --- |
| 同 ID 唯一 completed/false → 后续 root yielded error → settled | 当前应实际 RED 为 end_turn 而非预期 reject；修后 error 到达仍 held，settled 且 drain 后恰好 reject 一次；不存在第二 result |
| 同上但最后 assistant aborted | **须先实际 RED**（本轮仅源码推断）；修后 settled/drain 后 cancelled；不要声称已有 error repro 验证了它 |
| error 已 settled；通知仍被 gate 阻塞；此时 late cancel | 不发新 abort，不提前 reject；释放通知后仍 error。覆盖初始 error/true 与 held 后 error→settled 两入口 |
| completed/false；慢通知；root yielded completed；后到 settled | 没有 error 时仍正常成功；yield 与通知启动均不能提前完成；排空中追加 text/usage 仍先于 end_turn |
| 非 yielded retry error → 后续 yielded completed → settled | 中间 error 不入账，不 reject；最终成功；最后 assistant 前面的旧 error 也不能替代真正最后 assistant |
| 独立 task/job failed 或 child 包装的 yielded error/aborted → root completed → settled | 不影响 root 成功；不解包 child，不改任务处理合同 |
| 多 final yield：error→completed、error→aborted、aborted→completed | 前两者最终 error，后者 cancelled；初始 result error/false 或 aborted/false 后 completed 也保持原终态 |
| root aborted/error 与 abort ACK、settled 先后交错 | 复用已有 before/after ACK、settled-before-ACK 矩阵；等待 ACK/settlement/drain，error 优先，ACK 不造 outcome |
| 初始 result 前 current yielded；错误 ID/result；wrong session；空闲 settled；新 prompt | 保持既有 admission/隔离与首次 result 权威；不借无关帧完成，不将前一操作已吸收 outcome 泄漏给下一操作 |
| current 合法分类：最后 assistant 的 stop／length／toolUse；合法空数组；合法无 assistant 数组 | 每项均可贡献 completed；仍须真实 settlement/drain，且不得覆盖已有 error/aborted；不能因收紧非法输入而错误拒绝合法无 assistant 情况 |
| current malformed：缺失／非数组 `messages`；最后 assistant 的 `stopReason=future_reason`、缺失、非字符串 | 各项分别回归，均沿现有安全协议失败路径，不能默认空数组／completed；与上一行合法情况明确分开，legacy 未知 stopReason 仍拒绝、不改原合同 |
| legacy / malformed / command reject / EOF / notify failure | 保留已有 legacy 终态、own-property 校验、真实 abort 映射及安全失败路径；不能被新聚合降级为成功 |

获许可的实现者先只加回归，记录上述 error/aborted 的真实 RED 原因，再修源码；主 Agent 在改动全部落地后统一执行 `npm run typecheck`、`npm run test -- --exclude '**/.claude/**'`、`npm run build`（单文件回归也加 exclude：`npm run test -- test/connection.test.ts --exclude '**/.claude/**'`），避免当前 workspace 收集用户未跟踪 worktrees 中的测试。干净候选 checkout 的 `npm run check` 仍是 CI／发布门禁。再以原已存在的 compiled repro 命令确认 exit 0 / `expected_root_error_propagated`、notification drain 与自然退出/owned group 清理均成立（这是后续验证，不在本轮重跑）。

**actual native N 仍是门禁**：本计划不提供或宣称已跑 native 样本。使用已批准版本、隔离环境/本地端点、真实 root 后续 yield，保留非敏感 result/yield/settlement/ACK 顺序并按 `npm run contract` 的既有发布矩阵要求验收；不能把 synthetic 通过代替 native N、R2、idle Stop 或 Release1 门禁，也不据此下载、读取用户 profile、调用付费端点或发布。

## 修订记录

- 更新于 2026-10-24：针对 013-SPEC-01，主 Agent 选择 current held 的有界已知 StopReason／malformed fail-closed 合同，明确合法无 assistant 与未知／缺失／非字符串 stopReason 的区别；只修订未核对计划，等待独立 reviewer 完整再核对，未开始实现。
- 更新于 2026-10-24（永久回归 RED，源码修改前）：主 Agent 实际执行 `npm run test -- test/connection.test.ts --exclude '**/.claude/**' -t '013 held root yield propagates later root (error|aborted) after settlement' --reporter=dot`，退出 1。error 用例实际为 resolved／end_turn、预期 rejected／Error；aborted 用例实际为 end_turn、预期 cancelled。两项均在明确结果断言处失败，不是 timeout；这两项永久回归实测独立于此前仅覆盖 error 的 compiled synthetic repro。尚未记录 GREEN、真实 OMP 或 native N 通过。
- 更新于 2026-10-24（实现后统一 synthetic GREEN，主 Agent 实测）：`npm run typecheck`、排除 `**/.claude/**` 的根测试（`npm run test -- --exclude '**/.claude/**'`，4 个测试文件、219 tests）及 `npm run build` 通过；未将用户 worktrees 中的测试计入。执行 `node /tmp/acp-omp-root-yield-repro-Q4gnsm/run.mjs dist/index.js` 得 exit 0／`expected_root_error_propagated`，完整 JSON 中 `actualAcpReply.error` 存在、`notificationDrainObserved=true`，adapter 自然 exit 0、owned native group 消失。随后 compiled F/I runner（`node /tmp/acp-omp-fi-smoke-RxeccL/run.mjs dist/index.js`）22 场景全部 passed；主 Agent 已解析两份完整 JSON 确认。以上由主 Agent 执行，记录者未复跑。
- 同次证据边界：全部为 synthetic adapter 回归／compiled fixture；没有运行真实 OMP 或关闭 native N，没有证明 native 可达时序、R2／idle Stop／完整 B／Lody／Release。实现仍待至少两轮独立完整 review；本次仅追加实测记录，不回写已核对方案，不写 `001-action.md`。
- 更新于 2026-10-24（013-IMPL-01，第一轮实现审查待修）：新增 missing messages／unknown stopReason 与 abort ACK 待定、同批 settled 交错的永久回归。主 Agent 首次精确 label 过滤未命中测试，不计作 RED；随后实际执行 `npm run test -- test/connection.test.ts --exclude '**/.claude/**' -t 'retains malformed.*settlement precedes abort ACK' --reporter=dot`，退出 1、两项 failed，均在 outcome 断言中实际 resolved／end_turn、预期 rejected／Error，非 timeout。根因是新 malformed 仅传临时 error 给异步 finish，后到 settled 仍可复制旧 completed；此记录先于修正，不以此前 GREEN 覆盖该发现。待同步进入不可覆盖的协议失败路径后，由主 Agent 统一复验与独立 reviewer 完整再审；尚未宣称本发现解决或两轮审核完成。
- 更新于 2026-10-25：同步协议失败修正后，主 Agent 的 typecheck／根 4 文件 221 tests／build、原 root compiled repro 与 malformed 双 case compiled probe 均达到各自预期；ForkImageGateReview 第二轮完整修后复审及 RootOutcomeQualityReview 独立质量轮均无发现，013-IMPL-01 已关闭，状态记为本窄切片已实现。真实 OMP／native N 等仍未验证，临时 probe 源文件仍由 owner 保留 — 见 [001-action.md](001-action.md)。
- 更新于 2026-10-26：澄清历史证据限制、临时脚本不可用与非布尔 own yielded 的连接失败行为偏差 — 见 [002-factual-corrections.md](002-factual-corrections.md)
