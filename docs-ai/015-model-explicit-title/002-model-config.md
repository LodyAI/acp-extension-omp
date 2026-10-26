# 015.002 — 模型 M 未宣告实现与合成验收

## 背景

本记录只交付 [000-plan.md](000-plan.md) 的 M 分片。T1 尚未实现，015 整体保持「已核对」，不提前写整体 `001-action.md` 或标成全部已实现。

014 修后前置及 M／T1 逐片规格经非作者许可后，主 Agent 先取得 M 永久消费者功能 RED：真实 ACP `session/new` 的精确文件与 `fixture/model` 当前值正确，但完整目录对象断言只有当前一项，缺少三项真实夹具目录，退出 1（`artifact://872`）。这不是缺方法、未知 native query 或 timeout。

## 变更

- `src/server.ts` 接 SDK 标准 `setSessionConfigOption`，wire 为 `session/set_config_option`；不新增 legacy model route 或能力 bit。
- `src/connection.ts` 从真实 `get_available_models` 建立当次 value → 原始 provider/id Map，不 split；provider／id 含 `/` 时仍按原 pair 发送，拼接冲突整表拒绝。
- new／load／resume／fork 全部等待完整异步准备：first state → catalog → final state；最终文件必须原样等于首次文件，模型投影采用最终真实 state。目录等待期间实际 A→B 不能提交旧 A；同 A 模型改变不能继续用旧 Model 快照。
- setter 保留 admission，校验当前精确 session/config/value、native busy 状态、原生 `set_model` 返回的 Model、刷新目录及最终同 file/model state。完整 `config_option_update` 入现有队列，稳定排空后才返回完整 configOptions。
- 变更后的不确定错误清除身份／配置，仅显式完整准备可恢复；不重试、不 rollback、不建空会话。原 state 无 model 且目录为空时不发明 selector。
- M 没有 NativePrompt active，不消费无关 text／usage／root／settled 为控制结果；已见 messageId／responseId／alias 保留 excluded 证据。切模型不换 generation、accumulator 或 usageScopeId，计费仍取真实 terminal assistant 的 provider/model。
- `test/connection.test.ts`、`test/server.test.ts`、`test/session-preparation.test.ts` 覆盖公开消费者及 gate；`test/signal.test.ts` 的旧 fixture 仅补固定真实 catalog，以到达原信号目标，原断言未放宽。

### 实际验收与独立审核

以下由主 Agent 执行，本作者只读证据，没有重复运行。

| 阶段 | 可复查事实 |
| --- | --- |
| 永久 RED | `npm run test -- test/server.test.ts --exclude '**/.claude/**' -t 'lists the exact native catalog across providers and slashes on session/new' --reporter=dot`；上述完整目录断言失败，退出 1，`artifact://872`。 |
| 当前根检查 | `npm run typecheck`、`npm run test -- --exclude '**/.claude/**'`、`npm run build` 分别完成；根 4 文件 315 tests passed。不是声称另跑过 `npm run check`。完整 after `artifact://956`／`artifact://963`，检查汇总见后者 1–175。 |
| 当前 compiled M | 实际 `dist/index.js`＋隔离合成 OMP，49 planned case 全部 passed；目录／两 provider slash pair A→B→A、冷暖准备、catalog freshness、碰撞／busy／native 错误、各 admission／EOF／通知 gate 均在清单中。`artifact://963:34931-34934` 为 driver 0、scratch removed、all-selected-cases-passed。 |
| 通知故障出口 | `artifact://963:34326-34334`：notification-write-failure passed、adapter 自然退出 1、owned group 消失，没有成功 config 通知／setter response。该结果依赖独立 [016 修复](../016-acp-close-cause/001-action.md)，不能写成 M 首次合成便一直通过。 |
| 五保留 compiled | 同一 after 字节上 identity、F/I 22、root outcome、malformed 3、legacy 3 全部完成；`artifact://963:34939-41653`。保留 root error／通知 drain、损坏 current 协议失败与 legacy 普通错误／取消可恢复的区别，owned groups 消失、临时数据清理。 |
| 实现审核 | 非作者 `ModelTitleSpecReviewOne`、`ModelTitleSpecReviewTwo` 各完成至少两轮完整当前组合源码／tests 复核，最终 findings=[]；两者亲读 963，明确同意仅 M 未宣告实现／合成片通过。包含 M 与 016／013／014 并存路径，不继承旧一轮 clean。 |

### 历史失败不回写

早期 M after 在 309 根 tests／build 已通过后，compiled 通知故障仍出现自然 exit 0；`artifact://924` 的失败及随后 `artifact://939` 的首因 trace 保留。当时 `&&` 后的五份旧 bundle 未执行，不能补写为当时通过；以后单独通过的 `artifact://940` 与最终完整 963 也分别保留。

## 当前状态

- M 的源码／永久消费者与 compiled synthetic 窄片已完成，根 README 仅更新翻译事实；`initialize` 的未宣告集合不变，configOptions 不是独立 capability bit。
- 目标 OMP 两种真实隔离模型 A→B→A、实际下一轮 provider/model、真实 Lody 消费及统一 R3 仍未通过。源码／合成证明不关闭 native N、完整 R2、U-B、S／B 或 Release。
- SDK-BOOT-01（014-VERIFY-001）历史准备期超时仍未归因；SDK-OBS-01 的 raw server harness pending 不随 close reject 可观测性缺口仍独立开放。新的顺利运行不是它们已修复或 flaky 的证明，见 [014 行动记录](../014-post-local-session-identity/001-action.md)。
- 本片不提供打包、提交／推送、发布或 pin 结果；T1 另走 tests-first 和主 Agent 功能 RED／源码许可。
