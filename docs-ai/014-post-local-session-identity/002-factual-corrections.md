# 014.002 — 身份屏障历史证据与行为偏差的事实更正

## 背景

2026-10-26，按 `docs-ai/README.md` 将此前未提交、直接回写已发布编号文档的事实澄清迁到本修订。原计划正文、原修订行和原行动记录保留历史；它们描述当时检查点，不是本轮重跑、重新审核或对后续版本的放行。工作日志缩写与表格整理不再回写，关键事实更正由本文件承接。

## 变更

### 历史输出、源码材料与临时入口

- 原实施记录称主 Agent 执行测试与 compiled before／after，作者及 reviewer 没有复跑。原始输出（包括原记录的 `artifact://506`、`597`、`703`、`745`、`781`、`786`）和完整审核报告没有存入仓库，无法从仓库独立复核运行结果或审核结论。本修订不把历史 `findings=[]` 和 014-REVIEW-001／002／003 关闭记录冒充本轮确认。
- 初始 identity-move repro 和后续 identity、F/I、root、malformed、legacy 五份 compiled bundle 均未入库。前序事实核对记录称截至 2026-10-26 本机 `/tmp` 已没有这些 `acp-omp-*` 脚本；这里保留该观察，没有再次检索。原文“owner 保留供 M/T 整合”的入口可用性说法已失效，不能把 `/tmp` 路径当现存 runner，无法复跑或复核。runtime scratch 清理不能证明脚本源文件清理。
- 这些历史 runner 以构建后的 `dist/index.js` 为入口，都是 synthetic fixture，不是实际 OMP `/move` 或真实目标版本矩阵通过。A→B 实际文件 rename、nativeId 不变也不等于 native 二进制时序可达性证明。
- 原计划称通过 gh contents API 取得完整 AgentSession stdout（原 `artifact://413`）；该输出未存入仓库。可按原计划所列固定 commit 链接重新核对公开源码，包括 `1d5aff90b057ce7dbfe32ea557a527c1b3144b72` 的公开 `getSessionStats` 同步薄委托及 tracker 文件来源。这里不宣称本轮已重新取得或验证该源码；源码闭合也不等于三版目标二进制通过。

### 永久回归和历史阶段的对应

可复查的永久测试在 `test/connection.test.ts`：

| 对应阶段 | 永久位置／保留的历史报告语义 |
| --- | --- |
| 初始四入口身份 RED | `rejects moved native file after $label without dispatching old A`；原命令 `npm run test -- test/connection.test.ts --exclude '**/.claude/**' -t 'rejects moved native file.*old A' --reporter=dot`，legacy/current ACK、legacy/current false result 四入口均实际 end_turn、预期 Error、退出 1，非 timeout。 |
| 014-REVIEW-001 | 同 chunk ACK／result／settled 的 marker 已经过却仍 held，以及滞后 completed ACK 把已吸收 root error／aborted 洗成 end_turn 的三项回归；修正保留字段严格校验及真实 result 权威。 |
| 014-REVIEW-002 | `fails for invalid yielded.*settlement` 与 `retains legacy.*later current completion` 两组过滤，对应 3 条非法 own yielded 时序及 5 条 legacy 安全失败后到 current completion；原报告共 8 条实际 end_turn、预期 Error、退出 1，非 timeout。旧 compiled legacy error／非法 isTerminal 的错误成功也是历史报告。 |
| 014-REVIEW-003 | `preserves native legacy abort` 的无 cancel 意图、ACK 先、drain 先三项；原报告实际 end_turn、预期 cancelled，非 timeout。旧 748 dist 的 compiled aborted case 报告真实 stopReason=aborted 却返回 end_turn、driver exit 1，同 A 下一 prompt 成功且自然退出／组回收；不冒充本修订作者实测。 |
| 最终统一验证，2026-10-25 | 原报告 typecheck、根测试、build 全通过，根 4 文件／261 tests（connection181、server50、preparation22、signal8），未计用户 worktrees；五份 compiled bundles 的 driver exit 0 及各自 after 仍只是原报告，不是本轮结果。 |

原计划中的阶段记录继续保留：核对前撤回“裸 command rejection 无条件失效”，改成条件 query，同 A 保留原错误和会话恢复，不同或无法核实才失效；身份 probe 从 `get_state` 改为 `get_session_stats`，再补读固定源码 delegate。这些是历史草稿决策，不是本轮新增代码行为。

### 非布尔 own `yielded` 从 prompt 失败升级为连接失败

静态核对当前实现：未被 `wrongSession` 守卫排除的 `agent_end` 仍有 active prompt，且尚无 `active.commandFailure`、`active.terminal?.sessionSettled !== true` 时，非布尔 own `yielded` 同步进入协议失败并调用 `host.failure`。已有 command failure、终态已 settled 或会话不匹配时会在该校验前返回。固定 PR #19 基线 `6496d0f` 的对应分支只让该 prompt 失败；不使用浮动 `origin/main` 比较。该校验不限于 held prompt，但不能泛化为所有 active。计划没有写出这项行为变化，原行动记录“目标与非目标无扩大／恢复原合同”的笼统结论需受此更正限定。

父退出分类不能仅由上述协议失败推出：`src/server.ts` 的 `abortParent` 在 `parentFailed` 或 `closeRequested` 已登记时直接返回；仅两者均未登记时调用 `reportParentFailure` 设置退出码 1 并启动失败关闭。因此不承诺正常关闭已先登记的交错路径会被本次失败重新分类，也不把尚未动态验证的最终退出码写成实测结果。

完整失败链及对应永久断言见 [013 的事实修订](../013-held-root-yield-outcome/002-factual-corrections.md)。这不把普通同 A legacy Error、合法 aborted、普通身份不可核实或 idle Stop 一概升级成 runtime fatal；这些边界仍须分别阅读。

## 引用

- [原计划与阶段检查点](000-plan.md)
- [原行动记录](001-action.md)
- 固定 PR #19 基线 `6496d0f`；本次迁移既有更正，不提供新审核或执行证据。

## 当前状态与未验证的问题

本次只改文档，不改源码、测试、脚本，不执行构建、测试、lint、formatter、compiled runner 或真实 OMP。历史原始输出、完整审核报告、临时脚本的不可复核性仍存在；永久回归的存在与历史通过报告不是同一种证据。

原行动记录的真实 OMP／native N、版本／OS 矩阵、全部 R2、U-B、完整 B／S、Lody、R3、R4–R6／Release 限制继续有效。SDK-BOOT-01（014-VERIFY-001）准备期 3 秒超时未归因，后续 462ms 成功不能称修复或直接称 flaky；SDK-OBS-01 harness pending 可观测性缺口仍独立开放，不等同于已定位生产 SDK 缺陷。本修订不关闭这些问题或放行后续 M/T1。
