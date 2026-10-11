# acp-extension-omp

独立的 Apache-2.0 ACP 适配器，对接用户本机已安装的 Oh My Pi。适配器只拥有 ACP 边界并启动 OMP。OMP 可执行文件和它的凭据不得进入本包，也不得进入 Lody 的配置。

- 只启动 `omp --mode rpc`。不要用 `omp acp`，也不要加未支持的参数。
- stdout 只走 ACP/RPC。OMP 诊断走 stderr。
- 原生会话身份必须是精确的 OMP `sessionFile`。缺失或被换成另一个身份时拒绝。不要创建空的回退会话。
- 终端 OMP abort 映射为 ACP 取消。EOF 或子进程退出使进行中的工作失败。不要合成成功，也不要重试 prompt。
- 用量只来自终端 assistant 的 `message.usage`，经 `SessionUsageAccumulator`。省略的 cost 仍为未知。
- 不要宣告未实现的控制。在有协议证明的 host-tool 桥和已审查的 Core 能力之前，拒绝 MCP 配置。
- 测试和 smoke 只用合成夹具，或隔离的 profile / 本地端点。不要捕获用户会话、凭据或付费提供商数据。

文档用中文写。协议名、命令、文件路径和代码标识保持原文。

## 文档地图

六个根文档各回答一个问题。不要把答案抄进另一份。

- `README.md`：这个包是什么、协作分支声称什么、V1 翻译面是什么。
- `COMPATIBILITY.md`：哪些 OMP 版本有证据、哪些能力继续不宣告、更高的版本号不等于兼容。
- `TESTING.md`：真实合同的必测用例，以及矩阵一行必须记录的证据。不要改写那些用例。
- `RELEASE.md`：制品何时可以发布，以及在改 Lody manifest 之前必须做的公开字节回读。
- `MIGRATION.md`：本仓库拥有什么、Lody 拥有什么、集成顺序。
- `AGENTS.md`：常驻适配器边界，以及 agent 如何验证、记录决策和审核。

`docs-ai/README.md` 是计划、行动和修订的规则。它不是能力合同。

## 验证

`npm run check` 是类型检查加 vitest。它不需要 OMP，也不证明真实兼容。

`npm run build` 只编译。

`npm pack --dry-run` 证明 `files` 白名单。不要把 `docs-ai/`、`.omp/skills/` 或 `.claude/skills/` 加进白名单。

`npm run smoke` 仅当 `omp --version` 的 stdout 以 `omp/` 开头时才跑。它覆盖 initialize、new、load，不发 prompt。通过不等于生产支持，也不授权宣告 load、resume 或 usage。

`npm run contract` 是真实 OMP 和发布矩阵门禁。日常文档修改不要求跑它。它也不是可以忽略的检查。不要改写 `TESTING.md` 里的 Required cases。

`omp` 不在 `PATH` 上就停止。不要下载，也不要捆绑。

CI 变绿不是矩阵通过。CI 只跑 check、build 和 `npm pack --dry-run`。

## 写入纪律

改 `src/` 之前，先写 `docs-ai/NNN-<slug>/000-plan.md`，当工作属于：实质 ACP 翻译、能力宣告、`sessionFile` 身份、启动参数、适配器与 Lody 的边界或集成顺序，或会指导以后实现的结算、用量、取消、子进程失败。Lody 的 provider 注册、runtime manifest、托管运行时解析、MCP 策略和 Lody 专用测试不在本仓库实现；详细归属只以 `MIGRATION.md` 为准。

「计划中」只是草稿。起草者不能把自己的计划标成「已核对」。人或另一个 agent 核对过目标、非目标、备选、难以回头的改动和验收证据，并明确允许实现之后，状态才能改为「已核对」。在那之前不要改 `src/`。

评审、调查、测试输出、纯措辞、只改测试，都不建条目。拿不准就不写。人明确要求为一次不合格工作建档时，可以建，但仍不能放软上面的边界。

行为变了，只改回答那个问题的根文档。

上面的边界留在本文件。条目的非目标只写该条目自己的排除项。不要把这份边界清单机械抄进每一份计划。

编号、生命周期和唯一模板在 `docs-ai/README.md`。`.omp/skills/write-ai-doc/SKILL.md` 和 `.claude/skills/write-ai-doc/SKILL.md` 是同一份触发器，不另放一套模板。

## 审核

人审规格和证据，不逐行审 diff。

规格要写明目标、非目标、备选方案及选择理由，以及用什么证据证明做对了。规格核对通过之前，计划保持「计划中」，不要开始实现。

实现之后，`001-action.md` 记录相对计划的偏差，以及尚未验证的问题。

agent 互审必须由非实现者的独立 reviewer 做。优先用和实现者不同的模型，但这不是必须。实现者处理发现。审核者默认只审查，不编辑、不提交、不推送、不改 PR，除非被明确委托去做其中一件。

每条问题要有稳定编号、严重程度、文件位置、触发条件、预期行为、实际行为，以及怎么验证。每一轮都列出已检查和未检查的范围。检查不完整不能给 `clean`。区分观察到的事实和推断。

不要在第一轮 `clean` 就停；最少两轮，因为第一轮的 clean 常常只是看得不够仔细。后面每一轮都要同时做两件事：复核上一轮留下的问题，以及把当前完整 diff 当作第一次看到那样重新审。修复时新写的代码当作新代码，进入这轮的完整审查。

拒绝、延期、验证受阻，以及最后一轮刚修但还没被再次审核的问题，要分开记录。达到轮数上限时，总结必须分开写已解决、未解决，以及修了但未再审的问题。跑完审核流程不等于改动是干净的。

在 Prowl 里开发时，可以用内置审核循环。不要把外部 workflow，或任何保留的 `prowl.*` id，复制进本仓库。
