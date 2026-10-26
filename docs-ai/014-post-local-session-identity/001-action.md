# 014 — 本地处理后的精确 sessionFile 重新核实：行动记录

## 时间线

| 日期 | 变更 | 引用 |
| --- | --- | --- |
| 2026-10-24 | 原计划以同步 `get_session_stats` 代替有额外 goal 等待的 `get_state`；固定版本公开委托与 tracker 来源闭合，随后由两位非作者核对规格并许可窄切片。 | [计划](000-plan.md) |
| 2026-10-25 | 主 Agent 先观察四入口永久 RED，再实施单次身份屏障；实现审查依次发现 014-REVIEW-001／002／003，各自补永久 RED 后修正，最后两位非作者完整修后复审均无 findings。 | `test/connection.test.ts`、`src/connection.ts`、下述证据 |

## 结果与当前状态（截至 2026-10-25）

本条目身份／完成屏障窄切片已实现。以下结论对应 015／M/T1 后续实施前的最终已审版本，不替后续代码提供审核结论。实现及永久回归仍在已有 `src/connection.ts`、`test/connection.test.ts`，`README.md` 补充该行为的身份说明。

- 明确 `agentInvoked:false` 的本地 ACK／同 ID result，以及裸 prompt command rejection，在各自原完成边界使用一次共享 `get_session_stats` probe。current false 仍等待真实 settlement；不等不欠的第二个 result，不解析命令文本，不为正常 agent true 成功增加 query。
- 只解析非空原始 `sessionFile`，精确比较请求接受时的 A。同 A 保留原结果／安全错误并允许下一同会话 prompt；不同、缺失、malformed、unsupported 或 query 拒绝则失效旧身份并拒绝，不采用 B，不 fallback `get_state`／restore／new／重发 prompt，也不以普通身份不可核实关闭 runtime。
- 同 active 共享 probe／completion，保留全部 admission、稳定通知 drain 和适用的 abort ACK；事件 reader 不等待 probe。EOF／notify failure 已清 active 后，迟到 continuation 不提交、不恢复身份。query 不变更 generation 或 usage scope；tokens／cost／credits／contextUsage 不解析、不记量，用量仍只来自原 terminal assistant `message.usage`。
- current ACK 字段仍先严格校验；已收到真实 result 后，滞后 ACK 不再回写 held、root outcome 或 settlement。
- 所有已接受合法 outcome 共用每 active 的 `error > aborted > completed` 吸收，不再仅锁 error 或采用最后帧。真实 legacy aborted 保留为 cancelled；来源只限已验证 current／root、原 legacy 结果及原有合法取消证据，不从 cancel 意图单独合成 aborted。
- current 非 boolean own yielded、非法 messages／最后 assistant stopReason 同步走既有协议失败；原 legacy 安全操作失败仍可同 A 恢复，不把普通 Error／aborted 升级成 fatal。outcome 与真实 settlement／drain／ACK 分开，后到 completed 不能洗掉已接受的失败或中止。

### 永久与 compiled before／after

运行均由主 Agent 执行，记录作者及 reviewer 没有复跑；阶段 RED 保留在计划修订记录。最终统一输出为 `artifact://786`，两位最终 reviewer 均已读取并核对完整相关输出。

| 证据 | 实际结果 |
| --- | --- |
| 初始身份问题与四入口永久 RED（`artifact://506`） | 已有 compiled before 实际 A→B rename、nativeId 不变，旧操作／旧 A 下一 prompt 假成功；legacy/current ACK、legacy/current false result 四个永久入口也均实际 end_turn、预期 Error，非 timeout。 |
| 014-REVIEW-001 RED（`artifact://597`） | 同 chunk ACK／result／settled 后 marker 均经过却仍 held；另两例已吸收 root error／aborted 被旧 completed ACK 洗成 end_turn。修后保留严格校验并明确真实 result 权威，最终全 suite 包含这些回归。 |
| 014-REVIEW-002 RED（`artifact://703`，旧 compiled `artifact://745`） | 3 条非法 yielded 时序及 5 条 legacy 安全失败后到 current completion，共 8 条永久回归均实际 end_turn、预期 Error；旧 compiled legacy error／非法 isTerminal 两例也错误成功。均不是 timeout。同步协议失败与持久操作 outcome 修正后，最新 malformed／legacy bundles 分别证明 fatal 与可恢复失败没有混用。 |
| 014-REVIEW-003 RED（`artifact://781`） | 无 cancel 意图、ACK 先、drain 先三条永久回归实际 end_turn、预期 cancelled；旧 748 dist 的 compiled aborted case 同样真实 stopReason=aborted 却给 end_turn、driver1，同 A 后续成功且自然退出／组回收。该 compiled before 为主 Agent 实测报告，不冒充本记录作者独立执行。 |
| 最终统一验证（2026-10-25，`artifact://786`） | `npm run typecheck`、`npm run test -- --exclude '**/.claude/**'`、`npm run build` 全通过；根 4 文件／261 tests：connection181、server50、preparation22、signal8，未将用户 worktrees 计入。 |

最新构建后的五份 compiled bundle 均由主 Agent 实际执行、driver exit 0：

| retained runner（不是 release 入口） | 最终 after |
| --- | --- |
| `/tmp/acp-omp-identity-move-repro-OhXUOl/run.mjs` | `expected-identity-barrier-observed`；合成真实 A→B rename、nativeId 不变，当前 local 与旧 A 后续均 Error，move 仅 prompt／单次 stats；同 A help 成功、原 command error 后文字可恢复。实际 assistant 主桶 input7/output3、cost 未知，stats 哨兵没有流入 usage/modelUsage/delta；adapter 自然0、group gone。 |
| `/tmp/acp-omp-fi-smoke-RxeccL/run.mjs` | 22 cases 全 passed、failures=[]；拒图后 stats／同 A 恢复及精确 fork 路径保留，自然 adapter0、owned groups／descendants gone。 |
| `/tmp/acp-omp-root-yield-repro-Q4gnsm/run.mjs` | `expected_root_error_propagated`、实际 ACP Error、notificationDrainObserved=true，自然 adapter0、group gone。 |
| `/tmp/acp-omp-malformed-ack-repro-eEkXTH/run.mjs` | missing messages／unknown stopReason／invalid yielded 三例均 connection-failure、timedOut=false、adapter 自发 protocol exit1、groups gone；不是父 EOF 或 emergency kill 制造失败。 |
| `/tmp/acp-omp-legacy-operation-repro-rmyjiL/run.mjs` | assistant error／非法 legacy isTerminal／真实 assistant aborted 分别 Error／Error／cancelled；各例同 A 第二个真实文字 prompt 均 end_turn，无额外 stats／重试／重开；自然 adapter0、groups gone。 |

上述 runner 均以构建后的 `dist/index.js` 为入口。临时 bundle 源文件及保留的 before 资料由原 owner 留给 M/T 整合验证，尚未宣称删除；运行时 scratch 清理不能代替脚本源文件清理。

### 实现审核结论

`IdentityImplementationReview1` 首轮完整审查提出 001；`IdentityQualityRoundTwo` 独立完整质量轮在其修后发现 002；后续完整复审又由前者发现 003。某一轮另一 reviewer 无新发现没有覆盖新反例，三项均先补实际 RED 再修源码。

最终两位 reviewer 都重新审查当前完整 diff、统一 outcome helper 全部消费者、相关 RPC／server 失败链及永久／compiled 证据，分别 `findings=[]`，001／002／003 全关闭，无其已知修后未审源码项。两者仅放行 014→M 的当前 adapter source／synthetic 前置；不把这项结论当 M/T1 自身实施许可或整体发布放行。

## 相对计划的偏差

- 目标与非目标无扩大；单次 stats 原完成边界方案保持。实现共享 completion 时暴露了 ACK 写回及旧临时终态被覆盖的回归，最终补真实 result 权威标记与统一 accepted outcome，而非保留 error-only bool 或再补 aborted bool。此修正恢复原身份／settlement／取消合同，不引入通用控制状态机。
- current 协议损坏与 legacy 可恢复错误明确分流；合法取消仍按原证据与 ACK/drain 协调。没有把无法核实身份或 idle Stop 借口改成 whole-runtime 关闭。
- 永久测试留在现有 connection suite；没有把 `/tmp` probe 纳入公开 release 验证入口，未修改真实 Required cases。

## 未验证的问题

- 没有运行真实目标 OMP 或完成 native N、版本／OS 矩阵；固定源码链及 synthetic rename 不是目标二进制可达性证明。全部 R2、U-B、完整 B、S、真实 Lody、R3、R4–R6／Release 门禁仍未关闭。
- SDK-BOOT-01（别名 014-VERIFY-001）历史 `session/new` 准备期 3 秒超时仍未归因；最终同例 462ms 通过只证明当次成功，不能称已修复或直接称 flaky。
- SDK-OBS-01 的 server harness pending 不随 ACP close reject 可观测性缺口仍独立开放，不等同于已定位生产 SDK 缺陷；没有在本片扩大 timeout、加重试或改生产失败策略。
- 本记录不提供提交／推送／发布结果；本轮仅收尾文档，代码所有权已交给后续 owner，没有据此继续编辑源码或复跑检查。
