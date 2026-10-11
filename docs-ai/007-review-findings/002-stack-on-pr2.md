# 007.002 — 叠在 PR #2 上的瘦身移植

## 背景

#3 基于 `main`，与 #2 在 12 个文件上冲突，并重复了 #2 的生命周期与信号工作。协商的拆分是：生命周期、信号、`src/server.ts`、`src/index.ts`、`scripts/` 以 #2 为准；prompt 结算与通知排空以 #3 为准。本分支 `fix/prompt-settlement-drain` 从 `fix/pr2-signal-reap`（#4，叠在 #2 上）切出，只移植后者。

本目录的 `000-plan.md`、`001-action.md`，以及 [005](../005-session-switch-failure/000-plan.md)、[006](../006-omp-1828-terminal-contract/000-plan.md) 两个条目，原是 #3 里的 `docs-ai/003-review-findings`、`001-session-switch-failure`、`002-omp-1828-terminal-contract`。按 #2 的编号规则顺延为 007、005、006。移植时只改了标题编号、一处 `003 计划` 自指，以及把不存在于本分支的 `src/lifecycle.ts` 链接改为纯文本；正文证据未改写。

## 变更

移植自 #3 提交 `11349cd`：

- `src/connection.ts` 整体取 #3 版本。#2 未修改该文件。内容包括：drain-until-stable 的 `finishPrompt`；`prompt_result` 与 RPC `agentInvoked:false` 的严格结算（`applyCurrentPromptSettlement`、`hasOwn`、`Set.has` allowlist、`typeof status === "string"`）；cancel 的 requested / acknowledged 区分与 `cancellationInFlight` busy gate；usage 的 session generation 隔离；通知闭包捕获 session identity；`commandFailure` 优先；legacy `agent_end` 终态与 `message.responseId` usage（006）；exact 切换前先失效旧 identity（005）；安全错误类别。
- `src/rpc-transport.ts` 取 #3 版本：`requestWithId` 的 `onError` 回调（`commandFailure` 排序所需）与失败消息归类。#2 未修改该文件。
- `test/connection.test.ts` 取 #3 版本。#2 对该文件的唯一改动（usage 回调写成块体以通过 `typecheck:test`）已被 #3 的 `onUsage` 写法覆盖。

未移植，以 #2 为准：

- `src/lifecycle.ts` / `installSignalShutdown`、`src/index.ts` 的接线、`test/lifecycle.test.ts`：#2 在 `src/server.ts` 中实现信号关闭，见 [002-signal-shutdown](../002-signal-shutdown/000-plan.md)。
- `src/server.ts` 的 Windows 宽限期后 `child.kill` 与 `waitForExit` 返回值、`test/server.test.ts` 改动：#2 已有对应收尾，见 [001-runtime-lifecycle](../001-runtime-lifecycle/000-plan.md)、[003-forced-close-failure](../003-forced-close-failure/000-plan.md)。
- `src/server.ts` 的 stderr `resume()`：#2 保留把 OMP stderr 转发到适配器 stderr。
- `scripts/contract.mjs`、`scripts/smoke.mjs`、`package.json`、`tsconfig.test.json`：#2 版本。#3 收紧的 contract 断言（逐条通知先于终端响应、可观察 abort acknowledgement、版本探测隔离）未移植。
- `COMPATIBILITY.md`、`TESTING.md`、`README.md`、`RELEASE.md`、`MIGRATION.md` 中 #3 的 18.2.8/18.8.6/18.8.7 矩阵行与 artifact 记录未移植。这些证据只出现在本目录与 006 的历史记录里，根文档仍以 #2 为准。

没有为适配 #2 的结构改动移植代码：移植部分不依赖 #3 的 server/lifecycle。

## 引用

#2、#3、#4。

## 当前状态

2026-10-11 在 Linux / Node 22.22.3 下对本分支实际运行：

- `npm ci --ignore-scripts`、`npm run check` 通过：3 个测试文件共 69 项（`test/connection.test.ts` 43、`test/server.test.ts` 18、`test/signal.test.ts` 8）。
- `npm run build` 通过。
- `node scripts/smoke.mjs` 使用 OMP `18.8.8` 通过 initialize/new/load。
- `node scripts/contract.mjs dist/index.js` 使用 OMP `18.8.8`、loopback-only model 通过（#2 版本的 contract runner）。

未在本分支重跑：OMP 18.2.8、18.3.1、18.8.6、18.8.7 real contract；`npm pack --dry-run`；Windows 与 macOS。独立 reviewer 复审仍未完成，不能标为 clean。
