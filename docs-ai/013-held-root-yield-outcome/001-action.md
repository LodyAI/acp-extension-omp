# 013 — 不丢失已 yield 后 root 终态：行动记录

## 时间线

| 日期 | 变更 | 引用 |
| --- | --- | --- |
| 2026-10-24 | 独立核对窄规格后，先建立 error／aborted 永久 RED，再实现 held outcome 吸收；第一轮实现审查发现 malformed＋pending abort ACK＋settled 仍可假成功，编号 013-IMPL-01。 | [计划与阶段记录](000-plan.md)、`test/connection.test.ts` |
| 2026-10-25 | 补充两条交错 RED，以同步协议失败修正；主 Agent 完成最终 synthetic 验证，ForkImageGateReview 第二轮完整修后复审及 RootOutcomeQualityReview 独立质量轮均无新增发现，013-IMPL-01 关闭。 | `src/connection.ts`、`src/rpc-transport.ts`、本记录下述证据 |

## 结果与当前状态（截至 2026-10-25）

013 窄切片已实现并经修后复审，不再处于「修了但未再审」。实现位于已有 `src/connection.ts`，永久回归位于已有 `test/connection.test.ts`；`README.md` 的 V1 行为说明已纳入完整源码审核。

- 只有初始真实同 ID current result 通过 status／布尔 settlement 校验且 `sessionSettled=false` 的 held prompt，才吸收后续顶层 own `yielded=true` 的 root outcome；首次 yield 不替代 result。current result 确认后不再回落 legacy。
- 倒序读取最后 assistant，以有界合法 StopReason 分类，按 `error > aborted > completed` 吸收；非 yielded retry error、child 包装与独立任务失败不参与。合法空数组／无 assistant 数组仍贡献 completed。
- 合法 root error／aborted 不升级成 runtime fatal；仍等真实 settlement、稳定通知 drain 和适用的原 abort ACK。settled 后冻结，不因晚到 root 或 late cancel 改写结果。
- 缺失／非数组 messages、最后 assistant 的未知／缺失／非字符串 stopReason 是协议损坏：同步 throw 进入既有 RPC read catch／transport failure，先拒绝 pending abort 与 active prompt，停止同批后续 settled 的消费。该路径与普通合法 root error、idle Stop 没有共用关闭兜底。

### 实际验证与 before／after

执行者均为主 Agent；本记录作者与两位最终 reviewer 没有复跑。最终 after 原始输出由两个 reviewer 读取并复核（`artifact://428`）；以下都是 synthetic 证据，不是实际 OMP 运行。

| 证据 | 已观察的结果 |
| --- | --- |
| 原 compiled root repro，`node /tmp/acp-omp-root-yield-repro-Q4gnsm/run.mjs dist/index.js` | 旧实现 exit 1／`B-STATE-01-observed`，后续真实 root yielded error 被旧 completed 吞掉，ACP 假 `end_turn`；最终重建后脚本 exit 0／`expected_root_error_propagated`，`actualAcpReply.error` 存在、`notificationDrainObserved=true`，adapter 自然 exit 0、owned native group 消失。 |
| error／aborted 永久 RED | 实现前分别明确出现 resolved／end_turn 对比预期 rejected／Error，以及 end_turn 对比预期 cancelled；不是 timeout。命令与阶段结果保留在计划修订记录。 |
| 013-IMPL-01 两条永久 RED | `npm run test -- test/connection.test.ts --exclude '**/.claude/**' -t 'retains malformed.*settlement precedes abort ACK' --reporter=dot` 实际命中 missing messages／unknown stopReason，两项均为 resolved／end_turn 对比预期 rejected／Error，退出 1；此前零命中的过滤不算 RED。 |
| 013-IMPL-01 compiled 双 case，`node /tmp/acp-omp-malformed-ack-repro-eEkXTH/run.mjs dist/index.js` | 旧 compiled 两例均穿过真实 ACP marker／abort ACK 握手后错误成功；同步 throw 修正后，脚本 exit 0／`both-protocol-failures-observed`。每例均 connection-failure、`timedOut=false`、无成功响应，adapter 自发 protocol exit 1、owned groups gone；不是靠父 EOF 或 emergency kill 制造失败。 |
| 最终统一验证，2026-10-25 | `npm run typecheck`、`npm run test -- --exclude '**/.claude/**'`（根 4 文件／221 tests）、`npm run build` 均通过；不计入用户未跟踪 worktrees。以上 root 与 malformed compiled after 均对最终重建执行。 |
| F/I 交叉证据 | 较早一次统一构建后的 compiled F/I 22 场景全部 passed，已记入计划；不把这项历史结果冒充两个 throw 修正后的重新运行。 |

ForkImageGateReview 第二轮重新审查当前完整 diff 与生产失败链，明确 013-IMPL-01 已解决，`findings=[]`、未解 013 findings 与修后未审项均为空。RootOutcomeQualityReview 另行完整审查当前 diff、相关生产链、新永久回归及已有 after 输出，同样 `findings=[]`；不是只检查两个 throw，也不是再一次运行验证。

## 相对计划的偏差

- 目标与非目标无已知扩大。第一版 malformed 实现只异步传入临时 error，未满足计划的安全协议失败合同；013-IMPL-01 通过追加永久交错回归与 compiled 双 case 暴露，随后改为同步进入既有 transport failure。该修正恢复原计划，不增加新控制策略。
- 最终验证使用根 workspace 排除 `.claude` 的测试命令，避免纳入用户 worktrees；干净候选 checkout 的 CI／发布 `npm run check` 门禁未被替换。永久测试仍在现有 connection suite，没有把临时 probe 变成 release 入口。
- 临时 probe 源文件由原 owner 保留，供后续整合验证并最终清理；此处没有宣称它们已删除。输出中的 runtime scratch 清理与脚本源文件清理是两回事。

## 未验证的问题

- 没有运行真实 OMP，未证明目标 native 二进制的后续 root yield 可达时序、版本／OS 矩阵或 native N；synthetic GREEN 与源码审查不替代这些门禁。
- 完整 B、R2 来源、idle Stop 无 aborted、S-ID／子 agent 完整状态、真实 Lody 与 Release 仍未关闭；没有因 013 通过而新增能力宣告或扩展实施许可。
- 本行动记录不记录发布、提交或推送结果；本片实现没有据此完成这些操作。
