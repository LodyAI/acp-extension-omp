# 012.015 — 文档事实、历史检查点与证据边界更正

## 背景

本修订更正 012 已提交记录中的时态、证据强度和归属，不回写其正文。原记录中的「当前」「已通过」只代表写成时作者的报告，不等于本次核对重新执行或独立确认。整体 012 仍为「计划中」；仅 R-MCP、基本 F1／I 获局部实施许可并已实现，013–016 的许可与实现分别以其独立条目为准。

2026-10-26 的 OMP 独立审核使用 `openai-codex/gpt-6-sol`、`--auto-approve`，首轮提出 D1-001（编号记录不得就地改写）和 D1-002（012 正式状态不应写成整体已核对）。本修订按这两项反馈迁移事实澄清；这不代表修后复审已通过，也不授权合并或发布。

## 变更

### 006／008：历史运行不等于现存重跑入口

- [006](006-r-mcp-implementation.md) 的一次性 smoke 脚本不是保留的验收入口；脚本源码与原始输出未存入仓库，本次不能从仓库复核其历史结果。现存永久回归在 `test/server.test.ts`、`test/connection.test.ts` 的 `accepts non-empty lody stdio MCP ... without forwarding it`。
- [008](008-execution-contract-decisions.md) 中 Core 0.1.8 的 `src/usage.ts` 是已安装依赖的 `node_modules/acp-extension-core/src/usage.ts`，不是本仓库的 `src/usage.ts`。双 accumulator 验证仅为原实施者报告；脚本和输出未入库，不能独立认证其历史执行。
- 008 的 compiled smoke 是 throwaway，脚本与输出未入库。2026-10-26 本次检索 `/tmp/acp-omp-*` 未找到对应脚本；这些路径不能作为现存可复跑资产。
- 008 的 `test/fi-q2-001-dropped-acp-error-ForkImageRegressionPrep.test.ts` 是历史临时 mutation 副本，不是现存测试入口。原记录报告它已删除；该次运行的退出码、耗时和失败文本未保留可从仓库复核的原始输出。现存负例在 `test/server.test.ts` 的 `rejects session/fork %s without reporting a new session`。不能把这份历史 mutation 结果写成本次实测。

### 011：矩阵记录的位置与覆盖边界

- [011](011-r1-macos-18.12.6-clean-matrix.md) 写成后，`6e970f9` 已在 `TESTING.md` 增加「矩阵记录：OMP 18.12.6 (2026-10-25)」。因此旧文「本文件就是 Required test record」不能理解为当前唯一记录；`TESTING.md` 持有矩阵记录，011 保留运行细节。
- 真实会话准备会调用 `get_available_models` 并经过 `src/connection.ts` 的响应校验。合成夹具的固定目录不是真实 OMP 证据，但不能据此说真实目录响应形状完全未经过校验。真实目录完整性及模型 A→B→A 切换仍未由该准备路径证明。
- Required cases 5 的 wrong-identity 段、7 的 duplicate-message／missing-cost、9 的失败夹具仍只有合成证据；真实 OMP、合成夹具和模型切换合同不混记。
- 其后 [013](013-omp-18.12.6-target-review.md) 将 Latest／Previous 目标改为 18.12.6／18.12.5，后者未安装、未测、阻塞。011 的「没有改目标」「diff review 未验证」是写成时的检查点，不是当前目标状态。
- 011 和 013 均已包含在 PR #19；其中「无对应 PR」已过时。矩阵仍钉在 `51e1a04`，不是本次发布候选重新运行的证明。

### 012：Lody 历史调查不升级为当前验收

- [012](012-lody-usage-handoff.md) 的 Lody 结论只对应原记录中的 2026-10-25 检查点（HEAD `557fdc0b`，分支 `feat/omp-release1-local-usage-title`）。54 项未提交改动、约 7955 行差异及 27 个格式失败文件都是原调查报告；调查输出和那份 WIP 差异未存入本仓库，本次未独立复核。
- 原 WIP 被概括为每 prompt 本地计费，与 [009](009-user-scope-decisions.md) 的 agent 每日汇总方向冲突。不能据这段概括声称已完整审核该 WIP，也不能把 Lody 差异直接合入本仓库 PR。
- 现有 adapter 提供累计 `modelUsage`、去重和缺失 cost 保持未知的语义；是否满足完整日汇总合同仍取决于 L2／L4 和收窄后的 R2，不能仅凭格式相符说已经满足。
- `${acpSessionId}:scope:${usageScopeId}` 是 L2 的 key 派生提议，需 Lody 核对编码、长度和去重合同；不是已证明的云端 API 合同。`ignore_builtin_omp` 和按 prompt 记账分支须按每日汇总方向重新审查。
- 后台终端已由 009 移出 Release 1。子 agent 是「面板不可行则移出」的有条件裁决；[017](../017-subagent-status-by-id/000-plan.md) 仍为计划中、未核对，只有源码分析和移出建议，不是真实面板验收结论。
- 012 原状态栏混入的「宿主本地用量／标题与存储已完成独立审核」「全仓 lint 有基线错误」不能作为本仓库或真实 Lody 门禁通过的依据；本次不认证这些跨仓结论。

### 013：历史审核过程与提交事实分开

前序会话 `a798e124-705c-44ee-8eff-b6cbe0b4ec95` 的 2026-10-25 交接回复报告目标版本调整经过三轮独立审核、第三轮 clean。但原始审核报告未入库，本次只取得交接摘要，不能独立确认每轮范围、发现清单和关闭证据，不能据此宣布整个 PR clean。

可直接核对的是：`c9338fa` 调整了目标版本并新增 013；`6e970f9` 增加 `TESTING.md` 的 18.12.6 矩阵记录并补全 R-W 门控。提交 diff 证明修改内容，不证明审核过程。本次不补造缺失的发现编号、严重程度或逐条关闭记录。

前序交接还转述审核者接受了合并前就地修改 013 的处理；该历史意见不替代 `docs-ai/README.md` 的生命周期规则。013 中「当前 HEAD 是 e918c01」指写成时的历史检查点，不是当前分支 HEAD。其 `dist/` 字节和 `.tgz` 摘要判断仍为未重新构建核对的推断。

## 引用

PR #19；PR #18 的历史正文改写另见 [014](014-pr18-in-place-rewrite.md)。本修订替代上述旧文的相应事实表述，不撤销已记录的局部实施许可，也不改变 Required cases。

## 当前状态

只修正文档证据与记录位置，不改 `src/`、测试、脚本、启动参数或能力宣告。历史原始输出缺失仍是证据限制；本修订不能将它补成独立实测。修后完整差异须继续由非实现者复审。
