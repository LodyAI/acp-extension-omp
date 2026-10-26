# 016 — ACP 关闭原因与失败退出分类：计划

| | |
| --- | --- |
| **状态** | 已实现；仅016关闭原因修复的源码／合成验收与两轮独立实现复审闭合，真实N／Lody及Release未通过；见 [001-action.md](001-action.md) |
| **锚点日期** | 2026-10-25 |
| **规格核对** | 2026-10-25，非起草者 ModelTitleSpecReviewOne、ModelTitleSpecReviewTwo 分别完整核对全文，均 findings=[]，明确允许实现；由非作者 ModelTitleSpecReviewOne 受协调者明确委托登记，起草者未自行核对或批准。仅限 src/server.ts 既有父输入桥、SDK abort listener、parent failure／close 入口及 test/server.test.ts、test/signal.test.ts；须先主 Agent 消费者功能 RED 再改生产源码。首因按 serve 观察到的 decoded flush／显式关闭／SDK failure 登记；SDK 跳过的非法 JSON 行不等于 server readable error，不扩 decoder；正常首因不吞掉原强制回收失败升级。仅本条目规格许可，不关闭 M／T1 当前主验收、native N、R2／R3、R5／R6 或 Release。 |
| **相关** | [011 通知失败及时关闭](../011-notification-failure/000-plan.md)、[014 身份与完成屏障](../014-post-local-session-identity/000-plan.md)、[015 模型与标题](../015-model-explicit-title/000-plan.md)、[README](../../README.md)、[测试合同](../../TESTING.md) |

## 背景

M 的实际 compiled ACP smoke 在 `notification-write-failure` 场景记录到真实输出 Writable 故障标记，没有成功配置通知或响应，但 adapter 自然退出码为 0，夹具预期为 1。该次完整输出为 `artifact://924`；主 Agent 已执行的类型检查、309 项根测试与 build 通过不能否定这个运行结果。当前夹具尚缺父输入 EOF 与 SDK abort 的首因时间线，因此不据该输出断定唯一动态原因。

非作者 ModelTitleSpecReviewOne 对当前及 `7088ae5` 基线作只读调查，给出生产路径 PROD-NOTIFY-EXIT-01：SDK writeQueue 先 `Connection.close(error)`，同步触发 SDK abort signal；`serve` 的 listener 无条件先走 `close(false)`，设置 `closeRequested` 后再关闭 runtime。随后通知拒绝或 runtime failure 调用 `abortParent` 时，被已有 `closeRequested` guard 拦住，`reportParentFailure` 没有把退出码设为 1。该逻辑在基线已存在，不把它伪称 M 新增的根因。

正常父输入 EOF 也会触发 SDK close；不能只按同一个 signal 或 reason 文案猜正常／失败。本条目补关闭原因的最小边界，M 的其他翻译代码保持冻结。

## 目标

- 父输入仍开放时，真实 ACP 输出失败／非预期 SDK abort 必须先记 parent failure，再按失败关闭并回收自有 OMP；进行中的工作失败，不交付成功。
- 真实父输入正常 EOF、显式 `server.close()` 与既有信号流程继续保持正常关闭／信号退出合同。
- 关闭原因按实际观察到的来源及先后确定，不因后来某个 catch 的微任务顺序把已确认失败变成正常成功；failure 只报告一次。
- 不改变 OMP prompt、abort ACK、settlement、用量、精确会话身份或模型选择语义。

### 非目标

- 不重写 SDK、RPC transport、进程组回收／宽限期，也不增加重试、定时器式成功或生产诊断协议。
- 不借此次关闭分类授予新能力或关闭 native 兼容、R2、S／B、发布门禁。

## 方案

1. 源码仅限现有 `src/server.ts` 的父输入桥、SDK abort listener、parent failure／close 入口；测试限 `test/server.test.ts`、`test/signal.test.ts`。如其他生产文件确实必须修改，先修订范围并重新核对。
2. 在现有父输入桥观测真实正常 source end：可用既有 TransformStream 的 `flush`，在向 SDK 交付 done 前同步登记 graceful EOF。不得等 `pipeTo.then` 才追认，也不根据 `reason.message` 或无 reason 猜 EOF。
3. 显式关闭及信号继续使用已有正常 close 入口。已登记正常关闭后的预期 reader 取消，不再反向冒充新 parent failure。
4. 未有正常关闭来源的 SDK abort，或真实父 source error，先走既有失败报告／`abortParent` 与 `close(true)`；不要先无条件 `close()` 再等待后来的 `host.update.catch` 升级，因为那时已有 guard 会屏蔽失败。
5. 关闭按首个实际观察到的原因固定；错误先被观察就不得被后来 EOF 降级。若正常 EOF／显式关闭先已启动回收，其后的预期取消不改为故障。竞态以事件 gate 与有序记录证明，不用等待若干毫秒猜顺序。
6. 保持现有幂等 close、强制终止失败、第二信号、单调宽限时钟及 stderr 失败容错。分类修正不放宽回收／退出断言，不在 stdout 输出诊断。

## 备选与决策

| 方案 | 选择与理由 |
| --- | --- |
| 让所有 SDK abort 都失败 | 不选；正常 EOF 也走 SDK close，会破坏正常关闭。 |
| 比较 SDK reason 的错误文案／是否存在 | 不选；SDK 可给正常 close 生成 Error，文案不是来源合同。 |
| 将 smoke 预期退出码改为 0 或略过故障 case | 不选；没有证明只是夹具问题，且生产源码确有失败降级路径。 |
| SDK abort 后先正常 close，再在异步 catch 补失败 | 不选；现有 closeRequested 正是这个方案丢失失败的原因。 |
| 在现有桥上记录正常 EOF，意外 abort 先失败分类 | 推荐；不改协议和回收实现，来源与幂等性在一个边界内闭合。 |

难以回头的点是退出码及宿主断连语义。不得为了本条目让所有正常 close 非零，或把输出失败当作用户取消。

## 验收

以下均待核对后由主 Agent 执行，本文不预填通过结果。

1. 先在真实 SDK／实际 `serve` 与合成子进程 seam 增加消费者 RED：父输入保持开放，真实输出 write 拒绝，要求 parent failure 一次、退出分类为失败、无成功进行中响应、OMP 组被回收。正常父 EOF 与显式 close 是独立正控制；失败前不得由夹具先发送 EOF。
2. gate 覆盖失败先于 EOF 与正常 EOF 先于其派生 reader 取消；记录实际先后，不把 timeout 当正确拒绝。新增永久测试不钉错误文案、源码或 SDK 私有默认值。
3. 主 Agent 在重编译前运行 owned compiled 夹具，记录输入 EOF、sink write/rejection、SDK abort、首次关闭分类及最终退出／进程回收；夹具故障和生产缺陷分开，不凭静态推断伪造动态首因。
4. 实现后执行 `npm run typecheck`、根测试（排除用户 `.claude` worktrees）、`npm run build`；现有 8 个 signal／EOF／强制终止场景保持断言。
5. compiled M 全部场景、identity、F/I 22、root outcome、malformed 与 legacy 三终态保留 smoke 必须在当前字节上再验。输出故障场景自然非零且组消失；正常 EOF 自然 0；原信号退出不变。
6. 至少两轮非实现者完整当前差异审核；每轮复核旧问题并把新代码当新代码。实际 smoke 后更新回答该行为问题的根文档，并写 `001-action.md`，保留历史未归因观察与未跑的 native／Release 门禁。

## 修订记录

- 更新于 2026-10-25：按真实 M 通知故障退出偏差与独立静态生产因果起草；未改本条目生产源码，待非作者核对。
- 更新于 2026-10-25（主 Agent before 单次 trace，非本作者执行）：API owner 读取 `artifact://939` 回收顺序为 adapter seq6 真实输出 write 故障→7 SDK close(error)→8 SDK signal abort（exitCode 尚未设）→9 serve 正常 close caller→10–14 transport.fail／host.failure 确有调用但 exitCode 仍未设→22 stdin.destroy 由 WebStreams SDK cancel 触发→55／56 beforeExit／exit0。parent 完整 seq1–11 无 stdin.end，parent.destroy 晚于 adapter.exit；紧急清理前 native leader／group 均已消失。因此该次不是 runner 先 EOF 遮蔽，动态顺序与既存生产失败降级链一致。closeRequested 没有直接采样，其值仅由 stack 和同步赋值源码推断，不伪称读取过该布尔；不是修复后证据，也不关闭 M／N／Release。
- 更新于 2026-10-25（016 test-only 交接）：仅 `test/server.test.ts` 加真实 SDK／serve＋合成 OMP 消费者用例：保持父输入开放的真实 Writable 拒绝要求 exitCode=1／一次 parent failure／无 pending 成功／owned group 消失；decoded EOF 不先 server.close、显式 close、Error 或 undefined 源 error，以及 EOF 已关闭后才释放既入场 write 的 rejection 分别验证分类。harness 只增加受控 endInput／errorInput／输入事件与实际可等待输出 sink；非法 JSON 被 SDK logskip 不被误写成 decoded source error。全部 gate finally 释放，cleanup 结果不覆盖主断言；未改 src／signal 或运行检查，生产源码仍等主 Agent 实际 permanent RED。
- 更新于 2026-10-25（主 Agent permanent 消费者功能 RED，生产源码修改前）：主 Agent 实际执行 `npm run test -- test/server.test.ts --exclude '**/.claude/**' -t 'reports one parent failure and exit 1 when a real output write rejects with parent input open' --reporter=dot`，输出 `artifact://955`，1 failed／83 skipped、退出 1。父输入未 EOF，真实 Writable 故障后 SDK closed／无 pending 成功／native PID 与 owned group 消失断言已经过，随后 `process.exitCode` actual 0 vs expected 1 数值断言失败；不是 timeout 或 teardown 兜底。结合 before trace939及两位非作者已核对规格，主 Agent 另行明确授权仅 `src/server.ts` 的016窄生命周期源码；本作者不重跑、不记录 GREEN，M算法／connection／RPC／SDK／parser／T1保持冻结。
- 更新于 2026-10-25（016 窄源码交接，未验证）：仅 `src/server.ts` 改为在 decoded 父桥 flush 向 SDK 交付 done 前同步登记既有 `closeRequested` 正常来源；显式 close／信号仍先登记正常，`parentFailed` 已先成立时 flush 不覆盖失败。真实 readable pipe 错误与未登记正常来源的 SDK abort 先走既有 `abortParent`／失败报告，再 `close(true)`；reason 只用于构造诊断 Error，不参与 EOF 分类。后到派生取消由原正常／失败 guard 幂等处理，强制回收失败的原 catch 仍直接报告升级；回收、宽限期、第二信号、stderr容错代码未改。作者未运行 checks／build／smoke，不写001或README、不标已实现；等待主 Agent 全根检查、M全场景与五保留compiled及至少两轮独立实现review。
- 更新于 2026-10-25：主Agent当前typecheck／315根tests／build、M49及五保留compiled全部通过，两位非作者各完成第二轮完整当前diff复审且findings=[]，PROD-NOTIFY-EXIT-01仅在已界定源码／受测合成合同层关闭；README所属行为及行动记录同步，历史before／SDK-BOOT-01未归因与真实门禁保留 — 见 [001-action.md](001-action.md)
- 更新于 2026-10-26：澄清历史证据、事实与分片状态，保留原发布记录 — 见 [002-factual-corrections.md](002-factual-corrections.md)
