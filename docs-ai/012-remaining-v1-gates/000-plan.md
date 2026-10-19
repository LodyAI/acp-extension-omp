# 012 — V1 剩余门禁：计划

| | |
| --- | --- |
| **状态** | 计划中 |
| **锚点日期** | 2026-10-19 |
| **规格核对** | 未核对。起草者不能把本计划标成「已核对」。事实核对通过也不授予实现许可；改 `src/` 之前，非起草者必须另写「允许实现」并点名阶段。 |
| **相关** | [README](../../README.md)、[兼容矩阵](../../COMPATIBILITY.md)、[测试合同](../../TESTING.md)、[发布门禁](../../RELEASE.md)、[集成归属](../../MIGRATION.md)、[009](../009-late-event-generation/000-plan.md) |

## 背景

截至本计划起草时，`origin/main` 为 `7513a8f`。PR #1、#2、#4、#6–#13 已合并。PR #3 与 #5 已关闭且未合并。没有 tag，也没有 GitHub Release。包版本 `0.1.0`，Core `0.1.8`。

`main` 上已经有这些翻译：`newSession`、`prompt`、`cancel`；精确 `sessionFile`；`loadSession` 与 `resumeSession` 方法；终端 assistant usage。`initialize` 不宣告 load、resume、usage。非空 `mcpServers` 在 `src/server.ts` 被拒绝。图片与 embedded context 标为 false。POSIX 进程组回收、取消等待结算、通知失败即关闭、可证明的旧 generation 帧丢弃，都已合入。

已有真实合同都钉在旧树上，不能代表 `7513a8f` 的 `src/`。18.2.8 的适配器提交是 `4622df9`（记录在 `c909b43`）：该树的 `src/connection.ts` 没有 `acceptMessage`，其后的结算、通知失败和迟到帧改动不在这次合同里。18.8.4 的记录提交 `39d745a` 不是 `origin/main` 的祖先。18.3.1 段没有适配器提交。`COMPATIBILITY.md` 把 2026-10-09 的最新稳定版写成 18.8.6、上一稳定版写成 18.8.5，并标明未安装。那一行是文档日期，不是执行时的版本事实。集成记录里另有容器上 OMP 18.8.6（npm 分发、Bun 1.4.2）的 smoke 与 contract，没有 Required test record，不能升成矩阵行。

[PR #14](https://github.com/LodyAI/acp-extension-omp/pull/14) 是 Draft，提议只宣告 resume，与当前 `main` 冲突，没有审核结论。[PR #15](https://github.com/LodyAI/acp-extension-omp/pull/15) 增加 `assets/omp.svg` 和 `assets/README.md`，不是协议功能。

另一本地分支有一份未推送、编号同为 012 的旧草稿，基线停在更早的 `main`。本分支没有那份目录，不继承它的勾选或许可。以后两份都要留下时，先改编号再合并。

## 目标

1. 把「已实现」「有证据」「可宣告」「可发布」「Lody 已验收」继续分成独立门禁。
2. 按下面的顺序补齐剩余证据和发布动作。每阶段未完成的项保持未完成。
3. 给尚不能做的协议面留出单独入口，不放进本阶段。

### 非目标

- 不在本阶段增加图片、embedded context、steering、交互式扩展 UI、标题或模型切换。
- 不实现 MCP 桥，也不把非空 `mcpServers` 改成收下再丢弃。
- 不下载或捆绑 OMP。不改写 `TESTING.md` 的 Required cases。
- 本文件的 diff 不发布、不打 tag、不改 Lody manifest。tag、发布和 pin 只在 R6，且只在维护者另行授权之后；存档本计划不构成该授权。
- CI 变绿不等于矩阵通过。不合并 PR #14，也不把 PR #15 算进能力验收。

## 方案

顺序遵循 `MIGRATION.md`：先独立审边界和能力主张，再跑合成检查与批准的真实矩阵，再做本地制品，再用临时 mirror 证明 Lody 的 refresh／install，然后才发布、回读公开字节，最后才 pin。临时 mirror 挡住发布。前一阶段没过，不开始会对外承诺的后一阶段。

### R0 — 核对边界

本文件保持「计划中」。非起草者写出「允许实现」并点名阶段之前，不把后面的试跑记成门禁完成，也不做制品、mirror、tag、发布或 pin。

### R1 — 在候选提交上重跑矩阵

执行时重新确认当前稳定版和上一稳定版，不沿用 2026-10-09 的 18.8.6／18.8.5 名称。只对维护者已经提供、可核验的 `omp` 跑隔离 `npm run smoke` 和 `npm run contract`。缺二进制就记阻塞。

旧的 18.2.8／18.3.1／18.8.4 macOS 记录只作历史线索。候选提交上必须重跑，通过后才算该候选的行。仍缺的范围：18.2.8 的非 macOS；执行时的当前稳定版和上一稳定版；原生后台任务；自动 compaction；各目标 OS 的退出路径。用例 9 目前只有合成测试。结果按 `TESTING.md` 的 Required test record 写入 `COMPATIBILITY.md` 与 `TESTING.md`。后续行为修复使对应行失效。

### R2 — 无身份迟到用量

`src/connection.ts` 的 `acceptMessage` 在没有活跃 prompt、正在切换会话，或还没有 `sessionId` 时，把 generation 记为 0 并不转发；这些首次看到的 ID 留在 generation 0。它也丢弃已经见过且 generation 不同的 messageId／responseId，以及明确不匹配的 sessionId。当前 prompt 里第一次出现、又没有可靠 session identity 的帧，仍记入当前 generation。只有 `message_end` 会进入 `accountUsage`。这是 `COMPATIBILITY.md` 已经写明的剩余缺口。009 和 PR #13 没有关闭它。

下一步若要改代码，必须先有原生来源关联的证据，或一份单独核对过的合同变更。黑名单、延迟排空、按模型名过滤，都不采用。在那之前不宣告 usage，也不把正常 contract 通过写成此缺口已关闭。本计划不授权改 `src/connection.ts`。

### R3 — 能力宣告

load、resume、usage 继续不宣告，直到 R1 的目标行和独立审核都通过，并且 R2 对 usage 另有结论。宣告前先加 `initialize` 全量断言和不支持项的负向测试，再做最小声明修改。PR #14 的 resume-only 方案留待那时重做差异；当前冲突稿不作为实现。

### R4 — 本地制品

在冻结的候选提交上做发布前检查：干净导出、两次构建、记录 Node／npm、大小和 SHA-256，再独立安装。此时不打 tag，也不发布。`RELEASE.md` 仍开着的三项要在进入 R6 前有着落：合成测试加批准的 OMP 矩阵；每项已宣告能力对照真实合同；独立审核者检查 source、tests 和 release bytes。

### R5 — 临时 mirror

用临时 manifest 证明 Lody 的 refresh／install。这一步没通过，就不能进入 R6。归属以 `MIGRATION.md` 为准。

`reports/2026-10-11-lody-integration-findings.md` 的 LI-001 仍由 Lody 停止注入内置 MCP。本仓库不放宽拒绝，也不加入垫片。无垫片会话建立之前，不做正式 pin。

LI-002 的根因是 load 和 resume 都未宣告，Lody 报 `agent_did_not_advertise_resume_or_loadSession`。它随 R3 对这两项的决定一起收，不单靠 resume。LI-003 先在 Lody 界面对照其他 agent：其他 agent 也没有时归 Lody 云同步；只有本适配器没有时，下一步仍是 Lody 侧加日志，确认是否收到 `_lody/session/usage_update`。本计划不因此另开适配器实现。LI-004 已记录空闲 stdin EOF 后 OMP 18.8.4 在 27 ms 内以 code 0 退出；未验证的是进行中的 SIGKILL，以及工具孙进程是否残留。LI-005 已观察到会话文件堆积（9 个文件里 3 个对应真实轮次）。能力探测是否必须调用 `session/new` 归 Lody，并与 R3 的 load／resume 一起考虑。这些都不用合成测试写成已关闭。

### R6 — 发布、回读、pin

只在 R5 通过且维护者另行授权之后，才在该候选提交上打 tag，并从该 tag 按 `RELEASE.md` 发布、回读公开字节、大小和 SHA-256。公开字节与 mirror 验收过的字节不一致，则不能 pin。最后才更新 Lody 的 tracked runtime manifest。字节或源码变化时，重跑受影响的 R1、R4、R5。

## 备选与决策

| 方案 | 结论 |
| --- | --- |
| 先补证据和发布门禁，协议面维持现状 | 采用。复用已合入的翻译，避免把未证明的能力写进首版承诺。 |
| 现在合并 PR #14，提前宣告 resume | 不采用。与 `main` 冲突，且早于矩阵和独立审核。 |
| 适配器收下 MCP 再丢弃，绕过 LI-001 | 不采用。改变拒绝边界，归属也不在本仓库。 |
| 把旧 macOS 合同记成当前 `main` 已覆盖、可以发布 | 不采用。那些行钉在旧提交上，其余 OS、稳定版、mirror 和公开回读仍是门禁。 |

难以回头的动作是能力宣告、tag、不可变制品发布和 Lody 正式 pin。它们留在 R3 与 R6，前置不足时不执行。

## 验收

本文件的验收只检查计划是否可核对：目标、非目标、顺序、归属和不可逆动作都写明；状态保持「计划中」；本轮 diff 不含 `src/`、`test/`、`scripts/`。

后续每一阶段用当时实际跑过的命令记录证据。未跑的 `npm run check`、`npm run build`、smoke、contract 或公开回读，不能写成已通过。全部阶段完成后，再提议新建本目录的 `001-action.md`。

## 修订记录

- 更新于 2026-10-19：当前适配目标定为 OMP 18.12.2，上一稳定版定为 18.12.1；未安装、未测 — 见 [002-latest-omp-target.md](002-latest-omp-target.md)
