# 012 — V1 剩余门禁：计划

| | |
| --- | --- |
| **状态** | 计划中 |
| **锚点日期** | 2026-10-19 |
| **规格核对** | 未核对。起草者不能把本计划标成「已核对」。事实核对通过也不授予实现许可；改 `src/` 之前，非起草者必须另写「允许实现」并点名阶段。 |
| **相关** | [README](../../README.md)、[兼容矩阵](../../COMPATIBILITY.md)、[测试合同](../../TESTING.md)、[发布门禁](../../RELEASE.md)、[集成归属](../../MIGRATION.md)、[009](../009-late-event-generation/000-plan.md)、[002](002-latest-omp-target.md)、[003](003-mcp-session-acceptance.md) |

## 背景

截至本次正文对齐，`origin/main` 为 `3258961`。`src/` 与 `7513a8f` 相同。PR #1、#2、#4、#6–#13、#15、#16 已合并。PR #3 与 #5 已关闭且未合并。PR #15 只增加 `assets/omp.svg` 和 `assets/README.md`。没有 tag，也没有 GitHub Release。包版本 `0.1.0`，Core `0.1.8`。

`main` 上已经有这些翻译：`newSession`、`prompt`、`cancel`；精确 `sessionFile`；`loadSession` 与 `resumeSession` 方法；终端 assistant usage。`initialize` 不宣告 load、resume、usage，也不宣告 `mcpCapabilities`。非空 `mcpServers` 仍被 `src/server.ts` 和 `src/connection.ts` 拒绝。图片与 embedded context 标为 false。POSIX 进程组回收、取消等待结算、通知失败即关闭、可证明的旧 generation 帧丢弃，都已合入。

当前适配目标是 OMP 18.12.2（`v18.12.2`，2026-10-18）。上一稳定版是 18.12.1（`v18.12.1`，2026-10-17）。两版都不是 draft 或 prerelease，都未安装、未测。本机 `PATH` 上的 Homebrew `omp` 是 18.8.4，不能代替这两行。18.2.8 仍是 Lody #930 的最低真实合同基线。它的适配器提交是 `4622df9`，该树没有 `acceptMessage`。18.8.4 的记录提交 `39d745a` 不是 `origin/main` 的祖先。18.3.1 段没有适配器提交。这些旧行不能代表当前 `src/`。

[PR #14](https://github.com/LodyAI/acp-extension-omp/pull/14) 仍是 Draft，提议只宣告 resume，与 `main` 冲突，没有审核结论。

## 目标

1. 把「已实现」「有证据」「可宣告」「可发布」「Lody 已验收」继续分成独立门禁。
2. 先让不加垫片的 Lody 会话能够建立，再按顺序补证据和发布动作。
3. 给工具桥和其余未证明的协议面留出单独入口。

### 非目标

- 不在本阶段增加图片、embedded context、steering、交互式扩展 UI、标题或模型切换。
- 不实现 MCP 工具桥。R-MCP 只收下宿主的 MCP 列表，不转发给 OMP。
- 不下载或捆绑 OMP。不改写 `TESTING.md` 的 Required cases。
- 本文件的 diff 不发布、不打 tag、不改 Lody manifest。tag、发布和 pin 只在 R6，且只在维护者另行授权之后。
- CI 变绿不等于矩阵通过。不合并 PR #14。PR #15 的图标不算能力验收。

## 方案

顺序：先核对边界，再做 R-MCP，然后跑矩阵，做本地制品，用临时 mirror 挡住发布，最后才打 tag、回读和 pin。前一阶段没过，不开始会对外承诺的后一阶段。不加垫片的 Lody 试验放在 R-MCP 之后。

### R0 — 核对边界

本文件保持「计划中」。非起草者写出「允许实现」并点名阶段之前，不把试跑记成门禁完成，也不做制品、mirror、tag、发布或 pin。

### R-MCP — 收下 MCP 列表

Lody 在会话有 workspace 和 machine 时，会给 `session/new`、`session/load`、`session/resume` 附上名为 `lody` 的 stdio MCP。现在两道拒绝让不加垫片的会话建不起来。`npm run smoke` 和 `npm run contract` 传空列表，测不到这条。

允许实现之后：`newSession`、`loadSession`、`resumeSession` 接受非空列表，空列表仍可用；列表不进入 OMP 的 `new_session`；继续不宣告 `mcpCapabilities`。`src/server.ts` 的非空拒绝和 `src/connection.ts` 的 `rejectMcp` 一起删除。同一片更新 `AGENTS.md`，写明收下不等于工具桥。合成测试先证明非空列表能建会话，且发出的 `new_session` 不含 MCP。OMP 因此仍调用不了 Lody 的工具。细节见 [003](003-mcp-session-acceptance.md)。

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
| 证据和发布门禁按上面的顺序走，协议面除 R-MCP 外维持现状 | 采用。 |
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
