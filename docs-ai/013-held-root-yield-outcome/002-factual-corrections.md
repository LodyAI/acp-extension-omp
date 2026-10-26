# 013.002 — 历史证据与协议失败行为的事实更正

## 背景

2026-10-26，按 `docs-ai/README.md` 的编号文档发布纪律，把此前未提交、直接写入计划和行动记录的事实澄清迁到本修订。原 `000-plan.md` 的正文、原修订行及 `001-action.md` 保留发布时内容；旧记录是当时的历史检查点，不是本轮重新执行或重新审核的结论。原工作日志的缩写、表格整理不再回写，关键事实更正以本文件为准。

## 变更

### 历史报告的证据边界

- 原实施记录称主 Agent 执行 before／after，作者及最终 reviewer 没有复跑；原始输出（包括原记录的 `artifact://428`）和完整审核报告未存入仓库，不能从仓库独立复核其通过结果或 `findings=[]`。NativeOutcomeProofReview 所用的 `release1-native-ownership-design.md` 也不在本仓库。旧文中的“已执行”“已复核”“关闭”均按历史报告读取，不作为本轮独立确认。
- root repro、malformed ACK probe 和 F/I runner 都是未入库的临时脚本。前序事实核对记录称，截至 2026-10-26 检索本机 `/tmp/acp-omp-*` 未找到；本修订保留该观察，不冒充本轮再次检索。原文“由 owner 保留，供后续整合”的可用性说法已失效，不能再把临时路径当现存重跑入口；无法凭仓库复跑或复核。runtime scratch 清理不等于脚本源文件清理。
- 历史 root 诊断只覆盖 error 的 synthetic wire 序列，不能代替 aborted 永久回归，也不证明真实 OMP、native 可达时序、版本／OS 矩阵或 native N。原记录对完整 B、R2、idle Stop、Lody、Release 等未关闭门禁的限制继续有效。

### 永久回归与阶段结果的位置

可重新检查的永久用例在 `test/connection.test.ts`，不是上述临时 runner：

| 对应历史记录 | 永久回归位置／历史结果的限定 |
| --- | --- |
| error／aborted 永久 RED | `013 held root yield` 下 `propagates later root %s after settlement`；原报告命令为 `npm run test -- test/connection.test.ts --exclude '**/.claude/**' -t '013 held root yield propagates later root (error\|aborted) after settlement' --reporter=dot`，退出 1，分别实际 resolved／end_turn 对比预期 rejected／Error、实际 end_turn 对比预期 cancelled，属于结果断言失败而非 timeout。 |
| 首次 synthetic GREEN，2026-10-24 | 原报告为 typecheck、根 4 文件／219 tests、build 通过，root repro 得 `expected_root_error_propagated`，F/I 22 场景 passed；之后 013-IMPL-01 修正改了源码，不能把这组结果当作最终字节或两个 throw 修正后的复跑。 |
| 013-IMPL-01 | `retains malformed.*settlement precedes abort ACK` 对应 missing messages／unknown stopReason 交错回归；原报告两项 resolved／end_turn 对比预期 rejected／Error、退出 1；此前零命中的过滤不算 RED。最终根 4 文件／221 tests 与 compiled after 仍只是原记录报告，不是本轮运行。 |

核对前针对 013-SPEC-01 选择 current held 的有界已知 StopReason／malformed fail-closed 合同、区分合法无 assistant 和未知／缺失／非字符串 stopReason 的草稿决策，仍保留在原计划修订记录中；这里不把阶段整理误写成新决策。

### 非布尔 own `yielded` 的实际行为偏差

静态核对当前 `src/connection.ts`：对于未被 `wrongSession` 守卫排除的 `agent_end`，仍有 active prompt、尚无 `active.commandFailure` 且 `active.terminal?.sessionSettled !== true` 时，非布尔 own `yielded` 会使 `event` 同步 throw。异常经 `src/rpc-transport.ts` 的 read catch 进入 transport `fail`，再由 connection `fail` 调用 `host.failure`。该校验不限于 held prompt，但不能写成对任何 active prompt 都生效：已有 command failure 或已 settled 的终态会在校验前直接返回，会话不匹配帧也会被提前忽略。

父进程退出分类另受 `src/server.ts` 的首因守卫约束：`abortParent` 仅在 `parentFailed`、`closeRequested` 均未登记时调用 `reportParentFailure`（设置 `process.exitCode = 1`）并启动失败关闭；任一已登记时直接返回，不因这次 `host.failure` 再报告失败。连接失败传播不能泛化为所有时序下最终退出码必为 1。本修订只核对源码，不主张已复现正常关闭与 native 事件交错的运行结果。

对比固定 PR #19 基线 `6496d0f`，同一情况原先只调用 `finishPrompt(active, { status: "error" })`，只让该 prompt 失败。这是从操作失败升级为整条连接失败的行为变化；原实施记录把它归于 014-REVIEW-002。因此原计划“own-property discriminator……保持原约束”和行动记录笼统的“目标与非目标无已知扩大／恢复原计划”不足以描述这项偏差，以本修订及 [014 的对应修订](../014-post-local-session-identity/002-factual-corrections.md) 为准；不使用浮动 `origin/main` 比较。

`test/connection.test.ts` 的 `fails for invalid yielded with %s settlement` 和 `fails for invalid yielded while abort ACK follows settlement` 按整条连接失败的新行为断言。普通合法 root error／aborted 与 legacy 可恢复错误不能因此被一并描述为 fatal。

## 引用

- [原计划及历史阶段日志](000-plan.md)
- [原行动记录](001-action.md)
- 固定 PR #19 基线 `6496d0f`；本次只迁移已有事实更正，未重新执行源码行为验证。

## 当前状态与未验证的问题

本次仅迁移文档事实更正，不改源码、测试或脚本，不执行构建、测试、lint、formatter、compiled runner 或真实 OMP，不新增审核结论。历史输出、审核报告和临时脚本缺失仍是证据限制；不能根据本修订宣称旧报告重新通过或任何发布门禁关闭。
