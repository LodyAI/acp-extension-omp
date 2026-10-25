# 012 — V1 剩余门禁：计划

| | |
| --- | --- |
| **状态** | 计划中；R-MCP、基本F1／I、013、014、M、016、T1已完成各自窄实现、合成验收、独立实现审核及所属文档事实核对，能力仍受原门禁限制；宿主本地用量／标题与存储的源码、合成消费链及所属文档已完成独立审核，但全仓lint仍有未改基线错误；另只读复核18.12.6完整相关源码，仍未取得可解除S-ID／B-STATE／R2的合同，不自动变更获审资格目标；真实OMP／Lody及整体012未完成 |
| **锚点日期** | 2026-10-19 |
| **规格核对** | 2026-10-24，非起草者 SpecGateReview 两轮独立核对：允许实现 R-MCP，仅限 003 的接受后丢弃；先更新 `AGENTS.md` 再改 `src/`。见 [006](006-r-mcp-implementation.md)。UxSpecRoundOne 两轮核对 [007](007-r-ux-contract.md) 后确认 R0-001 已解除；R0-002 未整体关闭。非起草者 F/I 独立审查者两轮全文核对 [008](008-execution-contract-decisions.md)：仅基本 F1／I 已核对，允许 R-UX-A 未宣告实现；主 Agent 先记录对应消费者 RED，再改 `src/`。基本 F1／I 其后通过合成验收及三轮独立实现审核，FI-Q2-001 已经修正、mutation 实测和第三轮全文复审关闭。2026-10-25 当前局部状态：013、014 独立窄切片已实现并完成各自修后审核；014 的 001／002／003 源码发现经两位非作者最终完整复核关闭，满足 M／T1 的 adapter 前置，历史 SDK 观察仍开放。ModelTitleSpecReviewOne、ModelTitleSpecReviewTwo 已分别全文核对 [015](../015-model-explicit-title/000-plan.md)，明确允许仅 M／T1 未宣告分片实施与各片 N 后置，先 M 后 T1、每片先消费者 RED；N／真实 Lody／R3 最终门禁不删除。M 分片及 [016](../016-acp-close-cause/000-plan.md) 其后完成源码、永久消费者、真实编译合成进程及所属文档验收，两位非作者各完成至少两轮完整实现复核；T1经永久RED1012／compiled before1046后，也已完成当前373根tests／typecheck／build、compiled T1全61及当前M49＋五保留bundle，两位非作者各两轮完整复审findings=[]，仅其未宣告source＋synthetic及所属文档收口，不是真实用户验收。适配器 U-B 切换未获实施许可；宿主本地费用／T-A 与存储完成各自源码、合成消费链、UI 表面及所属文档的独立验收，CLI 的五项 P1 均经当前完整差异复审关闭；全仓 lint 仍有未改基线错误，不记全仓或真实宿主门禁通过。S-ID／B-STATE、R2／N／R1／R3、真实 Lody、R4–R6 均未通过，整个计划仍为「计划中」。 |
| **相关** | [README](../../README.md)、[兼容矩阵](../../COMPATIBILITY.md)、[测试合同](../../TESTING.md)、[发布门禁](../../RELEASE.md)、[集成归属](../../MIGRATION.md)、[009](../009-late-event-generation/000-plan.md)、[002](002-latest-omp-target.md)、[003](003-mcp-session-acceptance.md) |

## 背景

截至本次正文对齐，`origin/main` 为 `3258961`。`src/` 与 `7513a8f` 相同。PR #1、#2、#4、#6–#13、#15、#16 已合并。PR #3 与 #5 已关闭且未合并。PR #15 只增加 `assets/omp.svg` 和 `assets/README.md`。没有 tag，也没有 GitHub Release。包版本 `0.1.0`，Core `0.1.8`。

`main` 上已经有这些翻译：`newSession`、`prompt`、`cancel`；精确 `sessionFile`；`loadSession` 与 `resumeSession` 方法；终端 assistant usage。`initialize` 不宣告 load、resume、usage，也不宣告 `mcpCapabilities`。非空 `mcpServers` 仍被 `src/server.ts` 和 `src/connection.ts` 拒绝。图片与 embedded context 标为 false。POSIX 进程组回收、取消等待结算、通知失败即关闭、可证明的旧 generation 帧丢弃，都已合入。

当前适配目标是 OMP 18.12.2（`v18.12.2`，2026-10-18）。上一稳定版是 18.12.1（`v18.12.1`，2026-10-17）。两版都不是 draft 或 prerelease，都未安装、未测。本机 `PATH` 上的 Homebrew `omp` 是 18.8.4，不能代替这两行。18.2.8 仍是 Lody #930 的最低真实合同基线。它的适配器提交是 `4622df9`，该树没有 `acceptMessage`。18.8.4 的记录提交 `39d745a` 不是 `origin/main` 的祖先。18.3.1 段没有适配器提交。这些旧行不能代表当前 `src/`。

[PR #14](https://github.com/LodyAI/acp-extension-omp/pull/14) 仍是 Draft，提议只宣告 resume，与 `main` 冲突，没有审核结论。

## 目标

1. 用户在 Lody 里能直接开对话，并完成下面的基本体验。缺一项，V1 就不能当可用。
2. 基本体验是：连续文字对话、中途取消、看到本轮计费、fork 出新会话、提交图片、切换模型和标题、看到子 agent 状态、看到仍在后台跑的终端。
3. 这些能力都要在 OMP 18.12.2 上用真实会话核对。文档里的 RPC 命令名只作线索，不能代替这次核对。

### 用户现在能碰到的

会话一旦建立，文字 prompt 和取消已经能用。OMP 自己的工具输出会跟着消息走。计费数字已经从终端 assistant 用量送到 `_lody/session/usage_update`，但没有宣告 `usage`，Lody 界面上看不到。

在 Lody 里直接新建对话会失败：宿主附带的 MCP 列表被拒绝。`promptText` 遇到非文字块会抛出 `OMP ACP adapter V1 supports text prompts only`，`initialize` 把图片标成 false。模型选项只有当前这一个，没有切换。没有 fork、标题、子 agent 状态，也没有后台终端视图。

### 非目标

- 不实现 MCP 工具桥。开对话只要求收下宿主的 MCP 列表，不把 Lody 工具交给 OMP。
- 不做 steering、embedded context、交互式扩展 UI。
- 不下载或捆绑 OMP。不改写 `TESTING.md` 的 Required cases。
- 本文件的 diff 不发布、不打 tag、不改 Lody manifest。tag、发布和 pin 只在 R6，且只在维护者另行授权之后。
- CI 变绿不等于矩阵通过。不合并 PR #14。PR #15 的图标不算能力验收。

## 方案

顺序：先核对边界，再让 Lody 能开对话，然后补齐上表里的用户体验，再跑 18.12.2 矩阵。制品、mirror、tag 和 pin 仍在这些体验能用之后。前一阶段没过，不开始会对外承诺的后一阶段。

### R0 — 核对边界

本文件保持「计划中」。非起草者写出「允许实现」并点名阶段之前，不把试跑记成门禁完成，也不做制品、mirror、tag、发布或 pin。

### R-MCP — 收下 MCP 列表

Lody 在会话有 workspace 和 machine 时，会给 `session/new`、`session/load`、`session/resume` 附上名为 `lody` 的 stdio MCP。现在两道拒绝让不加垫片的会话建不起来。`npm run smoke` 和 `npm run contract` 传空列表，测不到这条。

允许实现之后：`newSession`、`loadSession`、`resumeSession` 接受非空列表，空列表仍可用；列表不进入 OMP 的 `new_session`；继续不宣告 `mcpCapabilities`。`src/server.ts` 的非空拒绝和 `src/connection.ts` 的 `rejectMcp` 一起删除。同一片更新 `AGENTS.md`，写明收下不等于工具桥。合成测试先证明非空列表能建会话，且发出的 `new_session` 不含 MCP。OMP 因此仍调用不了 Lody 的工具。细节见 [003](003-mcp-session-acceptance.md)。没有这一步，后面的计费、fork、图片、模型和标题都无法在 Lody 里体验。

### R-UX — 基本体验

允许实现之后，用户能做这些事。每一项都要宣告对应能力，并在 18.12.2 上留下真实会话记录。当前上游 RPC 文档里的对应命令是线索，落地前要在该版本上核对字段：

| 体验 | 要接到的 OMP 命令 | 现在 |
| --- | --- | --- |
| 看到本轮 token 和费用 | 已有的终端 `message_end` 用量 | 已上报，未宣告，界面不可见 |
| fork 成新会话 | `fork` | 没有 |
| 提交图片 | `prompt` 的 `images` | 非文字直接拒绝 |
| 换模型 | `get_available_models`、`set_model` | 只显示当前一个 |
| 改标题 | `set_session_name` | 没有。RPC 默认关闭自动标题 |
| 子 agent 状态 | `set_subagent_subscription` 与 `subagent_lifecycle`／`subagent_progress`／`subagent_event` | 没有 |
| 后台仍在跑的终端 | 后台 bash／async task 在 turn 让出后继续，直到 `session_settled` | 没有独立视图 |

计费还要守住 R2：没有身份的迟到帧不能算进当前这轮。fork、图片、模型、标题、子 agent 和后台终端在核对通过前保持不宣告。

### R1 — 在候选提交上重跑矩阵

当前稳定版用 18.12.2，上一稳定版用 18.12.1。缺可核验二进制就记阻塞，不用 18.8.4 充数。只对维护者已经提供的 `omp` 跑隔离 `npm run smoke` 和 `npm run contract`。

旧的 18.2.8／18.3.1／18.8.4 macOS 记录只作历史线索，必须在候选提交上重跑。仍缺：18.2.8 的非 macOS、原生后台任务、自动 compaction、各目标 OS 的退出路径。用例 9 目前只有合成测试。`TESTING.md` 里 18.3.1 另有一段真实可执行文件的失败 smoke，没有适配器提交，也不是矩阵行。结果按 Required test record 写入 `COMPATIBILITY.md` 与 `TESTING.md`。后续行为修复使对应行失效。

### R2 — 无身份迟到用量

`acceptMessage` 在没有活跃 prompt、正在切换会话，或还没有 `sessionId` 时，把 generation 记为 0 并不转发。已经见过且 generation 不同的 messageId／responseId，以及明确不匹配的 sessionId，会被丢弃。当前 prompt 里第一次出现、又没有可靠 session identity 的帧，仍记入当前 generation。只有 `message_end` 进入 `accountUsage`。009 和 PR #13 没有关闭这个缺口。

改代码之前，必须先有原生来源关联的证据，或一份单独核对过的合同变更。黑名单、延迟排空、按模型名过滤，都不采用。在那之前不宣告 usage。本计划不授权改 `src/connection.ts` 的归属逻辑。

### R3 — 能力宣告

load、resume、usage 继续不宣告，直到 R1 的目标行和独立审核都通过，并且 R2 对 usage 另有结论。宣告前先加 `initialize` 全量断言和负向测试。PR #14 的 resume-only 稿不作为实现。

### R4 — 本地制品

在冻结的候选提交上做发布前检查：干净导出、两次构建、记录 Node／npm、大小和 SHA-256，再独立安装。此时不打 tag，也不发布。进入 R6 前，`RELEASE.md` 仍开着的三项要有着落：合成测试加批准的 OMP 矩阵；每项已宣告能力对照真实合同；独立审核者检查 source、tests 和 release bytes。

### R5 — 临时 mirror

用临时 manifest 证明 Lody 的 refresh／install。这一步没通过，就不能进入 R6。归属以 `MIGRATION.md` 为准。Lody 仍决定注入什么 MCP。R-MCP 只让本适配器不再把该列表当成致命错误。正式 pin 之前，要有一次不加垫片就建立的会话。

LI-002 随 R3 对 load 和 resume 的决定一起收。LI-003 先在 Lody 界面对照其他 agent；只有本适配器没有用量时，下一步仍是 Lody 侧加日志。LI-004 已记录空闲 stdin EOF 后 OMP 18.8.4 在 27 ms 内以 code 0 退出；进行中的 SIGKILL 和工具孙进程仍未验证。LI-005 的会话文件堆积已观察到。这些都不用合成测试写成已关闭。

### R6 — 发布、回读、pin

只在 R5 通过且维护者另行授权之后，才在该候选提交上打 tag，并从该 tag 发布、回读公开字节、大小和 SHA-256。公开字节与 mirror 验收过的字节不一致，则不能 pin。最后才更新 Lody 的 tracked runtime manifest。字节或源码变化时，重跑受影响的 R1、R4、R5。

## 备选与决策

| 方案 | 结论 |
| --- | --- |
| 先让 Lody 能开对话，再补 R-UX 的用户体验，然后才做矩阵和发布 | 采用。 |
| 现在合并 PR #14，提前宣告 resume | 不采用。与 `main` 冲突，且早于矩阵和独立审核。 |
| 会话建立时收下 MCP 列表，但不转发、不宣告、不做工具桥 | 采用。否则不加垫片的 Lody 试验无法开始。见 R-MCP。 |
| 在本阶段实现 MCP 工具桥 | 不采用。没有宿主工具协议，也没有已审查的 Core 能力。 |
| 把旧 macOS 合同记成当前 `main` 已覆盖、可以发布 | 不采用。那些行钉在旧提交上。 |

难以回头的动作是 R-MCP 的边界变更、能力宣告、tag、不可变制品发布和 Lody 正式 pin。前置不足时不执行。

## 验收

本文件要能单独读完：目标、非目标、顺序和当前版本都写在正文里。状态保持「计划中」。对齐正文的这一轮 diff 不含 `src/`、`test/`、`scripts/`。

后续每一阶段用当时实际跑过的命令记录证据。未跑的检查不能写成已通过。全部阶段完成后，再提议新建本目录的 `001-action.md`。

## 修订记录

- 更新于 2026-10-19：当前适配目标定为 OMP 18.12.2，上一稳定版定为 18.12.1；未安装、未测 — 见 [002-latest-omp-target.md](002-latest-omp-target.md)
- 更新于 2026-10-19：正文对齐 002 与 R-MCP。会话建立改为收下 MCP 列表；工具桥仍不做 — 见 [003-mcp-session-acceptance.md](003-mcp-session-acceptance.md)
- 更新于 2026-10-19：V1 用户底线改为能开对话，并包含计费、fork、图片、换模型、改标题、子 agent 状态和后台终端 — 见 [004-user-visible-floor.md](004-user-visible-floor.md)
- 更新于 2026-10-19：R1 在候选提交上补齐 18.12.2／18.12.1 macOS arm64 合同记录（含合成边界说明）— 见 [005-r1-macos-18.12-contract.md](005-r1-macos-18.12-contract.md)
- 更新于 2026-10-24：记录 SpecGateReview 两轮 R-MCP 局部许可及消费者回归；不批准其他阶段、不关闭未满足门禁 — 见 [006-r-mcp-implementation.md](006-r-mcp-implementation.md)
- 更新于 2026-10-24：R-MCP 通过合成验收及两轮独立实现审核，仅关闭该切片的实现审核门禁；真实 Lody 仍待验收 — 见 [006-r-mcp-implementation.md](006-r-mcp-implementation.md)
- 更新于 2026-10-24：补 R-UX 宿主翻译合同与宣告顺序草案，仍为计划中、未核对，不授权实现 — 见 [007-r-ux-contract.md](007-r-ux-contract.md)
- 更新于 2026-10-24：007 完成两轮独立文档核对，解除 R0-001 顺序循环；R0-002 设计与目标运行前置仍受阻，不授权 UX 实现 — 见 [007-r-ux-contract.md](007-r-ux-contract.md)

- 更新于 2026-10-24：008 经非起草者两轮全文核对，仅允许基本 F1／I 的 R-UX-A 未宣告实现，先由主 Agent 记录消费者 RED 再改 src；仅窄修订 007 对该两片的 N-before-src。U-B／本地费用／T-A 仅设计核对，不授实施；其余合同、实际兼容、宣告、Lody 与 Release 门禁不变 — 见 [008-execution-contract-decisions.md](008-execution-contract-decisions.md)
- 更新于 2026-10-24：基本 F1／I 完成未宣告实现、合成验收及三轮独立实现审核；第二轮 FI-Q2-001 已修正并经第三轮完整复审关闭。U/T 仅设计、013 独立计划未实施，其他合同和真实兼容／Lody／宣告／Release 门禁不变，整体 012 仍计划中 — 见 [008-execution-contract-decisions.md](008-execution-contract-decisions.md)
