# 015.003 — 历史证据与当前事实澄清

## 背景

本修订迁移对已发布 000／001／002 的未提交事实更正。按 `docs-ai/README.md` 保留原文及原修订行作为历史，不再就地改写正文；下列澄清取代旧文中可被误读为当前可复核证据或当前状态的说法，不改变原实施记录所报告的时间线。

## 变更

### 历史结果不是本轮验证

000 的规格／实现审核登记、001 的「实际执行与独立审核」、002 的「实际验收与独立审核」均是原实施记录的历史报告，不是本次重新执行或独立确认的结果。旧表中的「当前可复查结果」「可复查事实」应读作「原实施记录报告的结果」；其中「当前」仅指原实施检查点。原记录称由主 Agent 执行，作者与 reviewer 未复跑；分别执行 typecheck、test、build 不表示另跑过 `npm run check`。

旧 `artifact://NNN`、简写编号及 `NNN:行号` 仅标识当时的输出，不是仓库内可读取的证据链接。872（M RED）、924／939（通知失败与首因 trace）、940（后续单独运行）、955／956／963（016 RED 与 M after）、1012（T1 RED）、1040／1046／1047／1048（T1 根检查、pre-T1 对照、compiled 与回归）的原输出、compiled runner 和完整独立审核报告未存入仓库，无法从仓库复核；不因保留原始引用而声称它们仍可读取。315／373 根测试、M49／T1 61 case、driver 0、自然退出／组回收和 findings=[] 都只是原报告的历史结果，不是本轮验证。

现存永久测试可供源码复查，例如 `test/server.test.ts` 的 `lists the exact native catalog across providers and slashes on session/new` 与 `publishes only a verified explicit title from a literal rename prompt`；测试存在不等于本轮执行通过。

002 所述早期 309 根 tests／build 后通知故障自然 exit 0，以及随后 939 trace、当时 `&&` 短路未执行五份旧 bundle、后来 940 与最终 963，仍是不同历史检查点，不能用后来的通过回写之前的失败或未执行。

### 计划与分片的时间语义

002 的「T1 尚未实现」「015 整体保持已核对」「不提前写整体001」及末尾 T1 另走 tests-first，是该 M 分片写成时的状态，不是今天的未实现结论；其后整体实现的历史记录见 [001-action.md](001-action.md)。000 中各轮送审、未许可和源码交接也须按原修订时间理解。

保留此前更正要表达的草稿时间线：ModelTitleSpecReviewOne 首轮窄裁决仅 M 在 014 前置验证、两位非作者许可及 consumer RED 后未宣告实现；015-T1-01 补最终 state 身份失效／恢复，015-T1-02 补 settled→exit/reconcile→工具恢复链与条件性 source closure，ModelTitleSpecReviewTwo 提出 015-T1-03 的 TitleControl／NativePrompt 权限边界。这些核对前草稿修订由原 000 修订行保留，不迁写进已发布001，也不据此新增审核证据。

### 准备请求与依赖路径

M 成功准备的顺序为 first state→catalog→final state；相对于旧准备路径，native 请求只多出 catalog 与 final state 两个查询，首次 state 失败的路径不变。目录 await 后必须再核实同一精确文件，并采用最终真实模型，不能沿用旧快照。

000 的「已安装发布包 Core 0.1.8」一行指依赖包，而非本仓库 `src/`：准确位置为 `node_modules/acp-extension-core/src/capabilities.ts:57–60`、`node_modules/acp-extension-core/src/session.ts:174` 以及该包 README 的 Automatic session titles。原文关于自动标题 ownership／`titleSource:'explicit'` 的说明不借用 workspace 新版 Core。

000 记录通过 `gh api repos/can1357/oh-my-pi/contents/<公开路径>?ref=<固定commit> -H 'Accept: application/vnd.github.raw+json'` 获取的 stdout（517／521／542／543）也未存入仓库；可按原计划固定 commit 的公开源码链接复查源码，不把这些 stdout 当现存附件。它们是历史源码取证，不是 native RPC 样本，也不是用户 profile、凭据或会话取证。

### 目标版本边界

001 的 18.12.2／18.12.1／18.2.8 是本片核对时的资格目标，不是当前 Latest／Previous。其后 [012.013](../012-remaining-v1-gates/013-omp-18.12.6-target-review.md) 将 Latest／Previous 改为 18.12.6／18.12.5，当前矩阵见 `COMPATIBILITY.md`；本片历史上未修改矩阵或 Required cases，不代表 M／T1 在任何版本上实跑过。

## 未验证的问题

本修订没有运行构建、测试、lint、formatter、compiled smoke、真实 OMP 或 Lody，也未取得新的审核报告。真实 producer／模型端点、M 两模型切换、实际 Lody 标题持久化与重开、N／R2／R3／发布门禁不由文档迁移关闭。SDK-BOOT-01／SDK-OBS-01 等历史未归因问题不因旧报告成功而变成已修复或 flaky。未提交、推送、合并或发布。
