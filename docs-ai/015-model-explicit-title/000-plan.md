# 015 — 模型配置 M 与显式标题 T1：计划

| | |
| --- | --- |
| **状态** | 已实现；M／T1未宣告翻译、永久消费者与当前编译合成验收及两轮独立实现复审闭合；真实N／Lody、R3与Release未通过，见 [001-action.md](001-action.md) |
| **锚点日期** | 2026-10-25 |
| **规格核对** | 2026-10-25，非起草者 ModelTitleSpecReviewOne、ModelTitleSpecReviewTwo 分别完整复核全文及 M／T1 逐片方案；015-T1-01／02／03 在规格与限定源码证据层关闭，两者均明确允许本片 N 后置为未宣告实现／合成验收之后的最终真实门禁。014 当前修正已由主 Agent 完成类型检查、261 项根测试、build 与五组合成进程验收，并由 IdentityImplementationReview1、IdentityQualityRoundTwo 分别完整修后复审，001／002／003 源码发现均关闭，满足本稿的 adapter 前置。协调者作为非起草者据此登记；不关闭历史 SDK 观察，不授 U-B／R2／S-ID／B-STATE、R3 或 R4–R6，不将上述证据升级为真实兼容或整体 Release 通过。最终实现：两位非作者各完成M／T1至少两轮完整当前source／tests复审、findings=[]，亲读主Agent当前373根tests／typecheck／build、T1全61及当前M49＋五保留compiled（1040／1046／1047／1048），明确允许仅source＋synthetic窄gate闭合；作者据授权登记实现，不自批规格或真实发布。 |
| **相关** | [007 UX-M／UX-T](../012-remaining-v1-gates/007-r-ux-contract.md)、[008 最新 U-B／T-A 选择](../012-remaining-v1-gates/008-execution-contract-decisions.md)、[014 身份屏障](../014-post-local-session-identity/000-plan.md)、[012 发布门禁](../012-remaining-v1-gates/000-plan.md)、[测试合同](../../TESTING.md)、[集成归属](../../MIGRATION.md) |

## 背景

按 `docs-ai/README.md` 的最大编号加一规则，本次目录观察最大为 014，015 可用；本文件使用其唯一 000 模板，不另建第二套计划格式。以下均为源码／发布声明观察及待核对方案，不是运行结论。

| 事实来源 | 当前观察与缺口 |
| --- | --- |
| `src/connection.ts:14–24,340–363` | state schema 没有 `sessionName`；`prepareSession` 只从当前 `state.model` 拼一个选项，没有查询模型目录。new／load／resume／fork 共用准备路径；准备会换 generation／usage accumulator，不能拿它刷新模型。 |
| `src/server.ts:265–292` | SDK Agent 已转发会话、prompt、cancel，但没有 `setSessionConfigOption`；initialize 仍不宣告可选能力。connection 的 event 也没有标题转发；不能把新增未调用的方法算入口完成。 |
| `test/connection.test.ts`、`test/server.test.ts`、`test/session-preparation.test.ts` | 已有 peer／batch／deferred gate、ACP 请求及合成子进程模式；前两类 fixture 只有当前模型，准备 fixture 还允许 state 无 model。新增目录请求必须更新这三处消费者夹具，保留原身份／互斥／usage 回归，不把 fixture 回写请求值当真实读回。 |
| 已安装发布包 SDK 1.3.0 | `dist/acp.d.ts:1650–1655` 有标准 Agent `setSessionConfigOption`；wire 是 `session/set_config_option`。`dist/schema/types.gen.d.ts:2656–2781,2988–2992,3909–3949,5057–5087` 规定 select、category、string value、完整 configOptions 返回／更新，以及标准 session_info_update。没有标准手动 set-title Agent 方法。 |
| 已安装发布包 Core 0.1.8 | `src/capabilities.ts:57–60` 的 `sessionTitle` 是自动生成 ownership；`src/session.ts:174` 和 README 的 Automatic session titles 已有 `titleSource:'explicit'`。不借用 workspace 新版 Core。 |
| 固定 18.12.2 公共源码 | [commands](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/modes/rpc/wire/commands.ts)、[state](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/modes/rpc/wire/state.ts) 已有 get_available_models、set_model、set_session_name、get_state.sessionName／sessionFile；[rpc-mode:2270–2291,2417–2427](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L2270-L2291) 查询目录等待 registry refresh，set_model 返回 Model；set_session_name trim、拒空、按 user 写入，成功不带 data、不主动推标题。 |
| 固定版本差异 | [18.12.1 rpc-mode](https://github.com/can1357/oh-my-pi/blob/291e055836c210f314af3f73f53244e8e9d09de8/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L2025-L2027) 同样先 await goalController.settled 再 get_state；[18.2.8 rpc-mode](https://github.com/can1357/oh-my-pi/blob/5e0fc867f8a58dfe8812b5e99b2e7b6a0313da6c/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L1284-L1315) 的 state handler 没有这条 await，但三版均有所需模型／名称 setter。不能据此推三个目标二进制通过。 |

大远程文件本次通过 `gh api repos/can1357/oh-my-pi/contents/<公开路径>?ref=<固定commit> -H 'Accept: application/vnd.github.raw+json'` 取得完整 stdout，再定位：18.12.2 rpc-mode 为 `artifact://517`、AgentSession 为 `artifact://521`；18.12.1／18.2.8 rpc-mode 为 `artifact://542`／`artifact://543`。这些是源码取证，不是 native RPC 样本，不访问用户 profile、凭据或会话。

### T1 不能掩盖的新发现

原生 [slash parser](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/slash-commands/helpers/parse.ts#L16-L34) 认起首 `/`，以最早 whitespace／冒号分隔、trim args；[builtin rename:620–668](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/slash-commands/builtin-lifecycle.ts#L620-L668) 无参可生成，有参调用 renameTitle，再持久化／notify。**有参也不保证原样名称**：[AgentSession.renameTitle:9992–10013](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/session/agent-session.ts#L9992-L10013) 在非 boring icons 且无 card 时会 generateTitle 补 card；它不是纯字符串 setter。

赋值链而非仅“调用了生成器”：[`formatCardTitle`](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/utils/title-card.ts) 返回 `` `${card.icon} ${card.code}: ${title}` ``，该文件首注释明确 card 是标题字符串的一部分，不是额外 metadata。renameTitle 的返回值经 builtin 的 `sessionManager.setSessionName(title,'user')`，进入 [SessionManager:3336–3372](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/session/session-manager.ts#L3336-L3372)：clean 后赋 `#sessionName`／`#header.title`，append title entry 并 await persistence。[AgentSession:7004–7005](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/session/agent-session.ts#L7004-L7005) 的 sessionName 委托 manager.getSessionName，再作为 get_state.sessionName 返回。因此装饰确可进入实际持久名称；不能 strip icon／code 猜用户原文。

内部 setter 同样不是任意原文恒等写入：[`SessionManager.#cleanTitle:2192–2197`](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/session/session-manager.ts#L2192-L2197) 将 U+0000–001F／007F–009F 替为空格，合并连续 ASCII 空格并 trim。本次另用 contents JSON 的 base64 decode／JSON escaping 确认原正则，而非把终端 caret 显示当源码。后文“精确标题”比较这个已证明的 native 清洗结果，保留其余 Unicode；不发明 icon 剥除／引号处理／额外规范化。清洗后为空时 setter 会拒绝，不合成标题成功。

[rpc-mode:1764–1818](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L1764-L1818) 还会先让 extension input hook 处理／改写输入；native 标题帧只有 title／sessionId，没有请求 id 或 titleSource。仅“当前 prompt 文本看起来是 rename，期间来了一帧标题”不证明该帧来自这次显式操作。不能靠解析 command_output 文案证明成功。

008 的 T-A 是本稿采用的宿主合同：explicit 保留至最终 source=user；相同名称也升级来源；晚到 generated 不覆盖 user；本地最终检查／提交共用现存每 session 持久化顺序。它明确收敛了 007 的跨写者现实时间最后点击赢保证，并不提供 WorkspaceWriter／Loro CAS。独立 Lody 分支的设计／实现不自动授权 adapter T1，也不是实际 Lody 验收。

## 目标

- **M：独立模型切片。** 通过现有标准配置入口得到真实目录、选择模型、核实 native 返回与状态，并把完整配置交给 ACP 消费者；new／load／resume／fork 一致。不新增 legacy model route。
- **T1：独立显式标题切片。** 仅现有普通 ACP prompt 中可证明的非空用户 `/rename <title>` 成功、同精确文件且 `get_state.sessionName` 读回确认，才推 tagged explicit；最低用户交付还须真实 Lody 持久化／重开证据。
- **M 的拟窄顺序**：014 当前 P1 修正后的主 Agent 验证及独立复审完成 → 两位非作者登记 M 逐片规格许可 → permanent consumer 功能 RED → 未宣告源码实现 → 主 Agent compiled synthetic ACP smoke＋至少两轮独立实现 review → 真实 M-N／Lody → R3。这只对 M 将 N 从源码前置移到最终真实验收；不提前开放当前源码，不新增 legacy route／capability／transport。M 不等 T1；两片可分别验收／分别拒绝许可。
- **T1 另行提出的同类窄顺序（待两位非作者裁决）**：014 当前修复的 main proof／独立复审完成 → 两位非作者核对本稿全部 T1 合同及 015-T1-02 source closure、登记仅 T1 许可 → consumer RED → 未宣告内部 setter＋单 stats＋真实 state 翻译 → compiled synthetic producer／取消／身份 gates＋至少两轮独立实现 review → 真实 T-N／实际 Lody T-A → R3。该提案只申请将 T1 的 N 移到最终真实验收，不取消 N，不借 M／scout 报告自动生效；裁决前 T1 原 N-before-src 及未许可状态仍有效。

### 非目标

本片不做自动标题生成、UI→OMP 双向同步、set-title ACP RPC、自定义标题 config、模型 legacy setter 或通用控制桥；不扩历史 fork、图片模型预判、计费来源／scope、子 agent 或后台任务。image／fork／model／title／usage 的对外承诺仍过统一 R3；M／T1 无权限关闭 R2、U-B、S-ID、B-STATE、N、R4–R6 或整体 Release。

## 方案

### M — 标准 config、目录快照与真实读回

1. 后续获许可时，只在已有 `src/server.ts` 给 SDK Agent 接上 `setSessionConfigOption`，转给 `src/connection.ts`。只接受当前精确 sessionId、`configId:'model'`、string value；其他 configId／boolean／未知 value 在 native mutation 前拒绝。不注册 `session/set_model`、mode 或 `_lody/*` 替身。
2. 准备期间保持原 `sessionChanging` 锁直到 state／目录／projection 完整，最后才提交 session identity。`prepareSession` 若改为异步，newSession／openExactSession／forkSession 的每个调用点都必须 await 完整准备，不能 return 未等待的 Promise 而使 finally 先释 admission；load／resume 经 openExactSession 同样等待。目录从 `get_available_models` 的 `{models}` 解析非空 provider／id／name；有实际 model 时维持 `id:'model',category:'model',type:'select'`，currentValue 必须对应真实当前 pair 且出现在目录。state 无 model 时可返回空 configOptions，不合成默认当前模型；setter 不可用。目录失败／malformed、已有 model 不在目录则准备失败并保持身份失效，不退回单模型假目录。
3. 每次准备和成功刷新维护**该精确 session／generation 的完整快照**：`value = provider + '/' + id`，Map 从 value 指向收到的原始 `{provider,id}`。禁止 split、按 name 反查或取最后一项。同名跨 provider 合法，id／provider 含斜杠合法；`('a/b','c')` 与 `('a','b/c')` 的同 value 冲突明确拒绝整个目录／本次配置，不静默去一项。重复完全相同 pair 可去重；不同 pair 绝不覆盖。旧 generation 快照不得沿用。
4. setter 同步取得与会话准备相同的互斥 admission，固定 A／generation；active、sessionChanging、cancellationInFlight 均拒绝。持锁的真实 `get_state` 先核实原样 sessionFile===A，并检查 isStreaming／isCompacting／hasPendingAsyncWork／queuedMessageCount／isSettled 的已发布状态；明确 busy 就不 set。没有新增 native 字段保证，不把缺少可选 busy 字段猜成强 quiescence 证明；目标差异需 N 记录。
5. 从已交付快照取 pair，发 `set_model{provider,modelId:id}`；其成功 data 必须解析为对应 Model，不能只凭 success 或请求 value。随后重新查询真实目录、最终 get_state，确认同 A、实际 provider／id 等于请求 pair、当前值可在无冲突目录表示；一切通过才提交完整 configOptions，向 A 入既有队列推 `config_option_update`，稳定排空后返回同一完整列表。没有自动重试、rollback 或从返回 Model 伪造 state。
6. 校验／忙碌拒绝不动当前 projection。进入 native setter 后的 reject、malformed 返回、回读失败／模型不符或目录失真都不发布请求值成功；清除不可再使用的配置并要求显式重新准备，不能让旧 UI 值授权后续 prompt。精确 file mismatch／缺失沿现有身份失效路径处理，不 adopt B；需要抽取时仅复用现有精确比较／失效语义，不维护第二套身份状态机。
7. 模型刷新不调用 `prepareSession`，不换 session generation、usage accumulator 或 scope；下轮 usage 仍看 terminal assistant 自己的 provider／model。M 继续使用**没有 native-prompt active 的 config admission**：等待目录／set／state／通知时，同nativeId或无sessionId的message／usage／root／settled帧都不能成为M的输出、计费或完成来源；其间初见messageId／responseId仍保留既有非活跃excluded-origin证据，不得随后当全新来源。`session/cancel` 只取消活跃prompt，不是config撤销协议；M不发无关abort、不伪造set被取消。原prompt的cancel／ACK／014 probe／drain期间setter一律busy。
8. setter／目录／state／通知等待的全过程保留 admission；EOF、关闭、通知失败使操作失败，沿既有安全错误和连接回收路径，不复活迟到结果。通知 failure 不返回成功配置，也不泄露原生路径／provider 诊断。

### T1 — 送审的最小入口与来源证明

**推荐送审内部 setter 翻译，而不是把任意 native 标题帧补标 explicit。** 007 已允许 `set_session_name` 作为获核对入口的内部翻译；此处仍是现有 `session/prompt` 入口，不增加 wire 方法。只识别一个 text block、从起首精确 `/rename` 加 whitespace 分隔得到的 trim 后非空 title；发送该 title 原值，按上文 native cleanTitle 计算待核对的实际名称，保留其他 Unicode，不解析引号、不认 `/renamed`、大小写别名或嵌入说明文本。多 block／图片／冒号变体／无参／空白参数继续原 prompt 翻译，不给 explicit 标签；该窄识别范围须 reviewer 明确接受。

1. 在原 prompt admission 内固定 A／generation／输入 title，建立最小可区分的 **`TitleControl` 操作种类**（与 `NativePrompt` 区分的 tagged operation 或等效明确 guard，不建通用控制框架），再发 `set_session_name{name:title}`，不同时发 native prompt，不调用 renameTitle／模型生成。占有 current active／busy 不等于拥有 native turn provenance；TitleControl 不拥有 assistant输出、usage、root outcome 或 native settlement 的消费权限。setter success只来自本次相关native请求的成功响应，不要求不存在的data；拒绝／EOF不推标题。native set可能已持久化，后续失败不假称回滚。
2. 复用 014 的**同 active 单次 stats identityProbe**核实 A，不复制身份 query／比较／失效逻辑，不用 setter success 代替身份；再发 get_state，必须原样 sessionFile===A、非空 `sessionName===nativeClean(title)` 才允许成功通知。补 state schema 的可选 sessionName。**最终 state 的 file 不同／缺失／空／malformed，或 query rejected／unsupported 导致身份不可核实时，必须先精确失效 A，再拒绝；先前 stats=A 不能覆盖后读到的不可信身份。** 若需抽取，仅让 014 stats 与本次 state 共用同一个“原样非空 file 比较＋失效”primitive，不重复 stats、不增第二套身份规则；失效清掉 sessionId／nativeSessionId 及关联可用配置，禁止旧 A 下一 prompt native dispatch，不 adopt B、不 restore／new fallback。只有显式 new／load／resume／fork 的完整准备成功可恢复，迟到同 A 回包不能恢复。
   最终 state 的原样非空 file 确为 A、但 sessionName 缺失／malformed／不等于已证明的 native 清洗结果时，名称操作失败、无 explicit 通知，身份 A 可保留；不能用请求 title 填空或 native 无来源帧补齐。只有最终验证过的实际 sessionName 进入 `{sessionId:A,update:{sessionUpdate:'session_info_update',title:verifiedSessionName,_meta:{lody:{titleSource:'explicit'}}}}`。下表固定成功／错误／取消下的身份 outcome；不是只“不发标题”却仍接受未知 A。
3. 通知只发送一次、入既有 notificationTail，原操作保持 active／admission 到稳定 drain 后才完成 ACP 控制 prompt；不换 generation／usage／session 身份。**本次 setter响应、单次stats身份结果、已发最终state结果、局部cancel及稳定通知drain，是TitleControl唯一正常完成来源**；不借普通NativePrompt的completion／terminal／abort ACK／settlement字段作成功或失败证据。旧 native session、旧 generation、重复／晚到 native title 帧、无参生成帧不触发explicit；同nativeId也不证明file相同。真实EOF／transport／notify failure仍是全连接失败，不被operation guard吞掉。
4. **以下是需明确核对的 T1 局部取消提案，不是已有能力：** 内部 setter 不启动 native agent turn，故不能复用普通 prompt 的“cancel 必发 abort”。这条控制 prompt 的取消在成功通知提交前只登记本次取消；尚未发送 setter 时阻止发送，已发送则等待原响应／同一个身份屏障，不重试、不 rollback。未发 title readback 则取消后不再发；已发则仍可消费响应，但不发 explicit 成功通知，最终给该 ACP 控制 prompt cancelled。native 错误／身份失效／连接失败优先为失败。通知提交后属于已完成成功的排空，晚 cancel 只等待原结果，不撤回已发送通知。普通 native prompt 的 abort／ACK／013／014 完成语义不变。
5. 第 4 点、绕过原生 card／extension input hook 的窄语义、015-T1-01 身份分支、015-T1-02 source closure及下文015-T1-03操作隔离均须非作者明确核对；**目前T1仍未获实施许可，不允许实现者默选普通prompt旁路或假settled**。M不因此等待T1开放；T1另请两位reviewer裁决上文窄顺序，不能借M或只读source proof自行放开。此处不新增SDK／Core协议。

#### 015-T1-03 — 最小 operation 权限隔离

在 `src/connection.ts` 现有事件消费入口点名 guard，不以“未发 native prompt”推这些帧不会到达，也不禁止全部后台／扩大abort范围：

| 既有入口 | TitleControl／M控制期间的约束 |
| --- | --- |
| `acceptMessage`／`messageGenerations` alias绑定 | 只有真正的NativePrompt才可把新消息绑定为可消费的active generation。TitleControl期间收到的message_start／message_update／message_end，即使同nativeId或无sessionId，也须作为**excluded／generation 0**的已见证据记录messageId／responseId及同组alias，然后拒绝消费，不能一开始return而完全忘记ID。保留现有oldest-origin／alias合并语义，已见group不得因control结束、同session generation后续prompt或后来单独到达alias而升格为首次可归属来源；不把这些ID绑定给TitleControl。不回滚此前合法已计费用量、不新增scope。M无active且持config锁时同样只保留excluded证据，不建立native-prompt来源。 |
| `forwardMessage`／`accountUsage` | 明确只接受NativePrompt拥有的消息；对TitleControl不得产生agent_message_chunk、usage通知、accumulator.update或accounted状态更新。不以current active、模型名或相同nativeId补归属。 |
| `event` 的 `agent_end`／`session_settled`／`prompt_result` | TitleControl全部排除，含legacy stop／error／aborted、current yielded及settled、甚至看似同control id的prompt_result：不得合并root outcome、改terminal、启动普通finishPrompt、改变本次cancel结果、提前resolve/reject或释admission。M无native-prompt active也不得消费为自身完成；只有相关RPC响应推进各自控制。有效JSON但无关的终态字段不触发本控制的malformed-terminal失败；真实transport解码失败仍global失败。 |
| identity／cancel／drain／global failure | 仅共享014单次identity probe／原样精确file比较及失效primitive；不共享普通NativePrompt的输出／计费／root／settled完成权限。TitleControl的local cancel只等待自己的setter／stats／state及通知提交分界；own command错误、最终身份失败或name失败不能被无关native成功／error／aborted／settled洗掉。EOF／transport／notify failure仍结束当前控制并走既有全连接失败回收。 |

上述最小operation kind可落在现有active类型和入口guard中，不要求第二套身份状态机、类层级或通用operation runtime。普通NativePrompt继续原013／014／cancel／usage规则。control期间已观察ID的excluded证据只隔离**已知**旧帧；下一真正native prompt中首次出现且仍无可靠provenance的活动，不因这条guard就得到原生归属证明，全部R2继续开放。

| T1 gate／输入 | 控制结果与身份状态 |
| --- | --- |
| native setter 尚未 dispatch 就收到本次 cancel | 阻止 setter／prompt／name readback，返回本次控制 cancelled；未发生 native 操作，不凭取消失效已准备 A，不发 explicit。 |
| setter success；stats 同 A；未发最终 state 就 cancel | 不再发 name readback；原 setter／stats 都完成后本次控制 cancelled，保留已核实 A，不推标题，不承诺撤回已持久化名称。 |
| setter reject／clean 后空；stats 同 A | 拒绝原安全 native 错误，保留 A；cancel 不把真实错误变成功或 cancelled；不追加 title state，不推 explicit。 |
| setter success 或 error 或已登记 cancel；stats 不同／缺失／空／malformed／query 不可核实 | 先失效 A 再失败；原安全 command error 若存在仍优先，不能因 cancel 改为普通 cancelled；只可完整显式准备恢复，不 fallback。 |
| 已 dispatch 最终 state，期间收到 cancel；state 同 A 且名称匹配 | 消费已发 query，不再发 abort；通知尚未提交则本次控制 cancelled，保留 A，无 explicit。未取消则进入单次成功通知。 |
| 最终 state 不同 B／缺 file／空 file／malformed 身份／query rejected 或 unsupported，无论是否已 cancel | **015-T1-01：失效 A，当前控制失败、无标题；下一旧 A prompt 在 native dispatch 前拒绝。** stats 曾同 A 不能恢复它，后到旧回包不能恢复它；显式完整准备才恢复。 |
| 最终 state 明确同 A，只有名称缺失／malformed／不一致 | 当前控制失败、无 explicit；身份已被最终 state 核实，保留 A；cancel 不覆盖错误，下一正常 A prompt 可用。下一次显式 rename 可重新确认标题，不合成此次成功。 |
| 同 A／同名验证完成，成功通知提交前 cancel／通知提交后 late cancel | 前者 cancelled、无新标题；后者原成功 end_turn 只等稳定 drain，不撤回已提交通知；A 均保持。通知实际发送失败或 EOF 时走下行失败，不兑现成功。 |
| setter／stats／state／notification 任一 gate 发生真实 EOF、关闭或通知失败；其后迟到成功回包 | 当前控制失败，沿现有连接关闭／回收路径，连接不可继续准入；迟到回包不得 resolve／恢复身份／补发标题。 |

### 014 屏障可以复用什么，不能复用什么

当前普通NativePrompt的 `completePrompt` 共享identityProbe／completion，stats→稳定notificationTail→原settlement／abort ACK交付；没有通用title readback hook。014 owner已确认legacy local ACK false不提供真实settled=true。T1只复用单次身份probe／精确失效primitive及通知队列，不把整个普通completion当TitleControl完成器；必须由015-T1-03的operation guard隔离message-origin、text／usage、root及settled入口。当前active本身不是native turn provenance；不能仅因这一刻“不欠ACK”就推未来不会cancel。

因此 **原样 native /rename 路由不能直接在 014 stats 后插 get_state**：[rpc-mode:2025–2027](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L2025-L2027) 会 await goalController.settled，[ordinary serial tail:575–638](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L575-L638) 还会把后来 abort 排在其后，可能形成新增等待依赖。stats 只含身份，不含 sessionName／model，不能替真实字段读回。

推荐 T1 通过明确的“没有启动 native turn、取消不再欠 native abort”局部合同，消除**本次控制新增的 get_state→本次 abort**循环，且保留 active 至验证／通知完成；必须先有 gate 回归及独立规格许可。M 同样不在已有 active 内插 get_state，使用 idle config admission。后续只读 producer 追踪已提供下表的具体 source closure，供非作者核对：在有限既有生产者、外部 I/O／callback 可返回的条件下，已知内建 await 不要求本次 abort／下一 ACP／后排 ordinary native RPC 才能解除。**这不是 scout 授权、目标 N 或任意用户代码终止证明**，也不等于全会话 quiescence。

**015-T1-02（待非作者核对的具体 source closure）：** 本稿已完整读取 `TitleReadbackProgressProof` 的只读报告，以下压缩为 producer／guard 表；primary links 固定实际目标版本，不用报告名代替接口依据。结论只针对选定的内部 setter→单 stats=A→实际 get_state、不启动本次 native turn、local cancel 不发 native abort且持锁的路径；不是把原样 native rename 的未知帧补标 explicit。

| await／边界 | 独立 producer、guard 与没有新增等待环的具体依据 |
| --- | --- |
| ordinary serial 前驱 | [rpc-mode:575–638](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L575-L638) 的普通 handler 先完成才 output ACK：旧 handler完成→setter ACK→stats响应→state开始。因此已收到setter／stats响应后，不能再假定同一旧 ordinary handler尚占前缀。ACK在afterSerialCommand之前；[后置shutdown检查](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L2668-L2672) 未请求shutdown时立即返回，请求时是drain／退出分支，不兑现标题成功。后台prompt ACK不证明turn已终止；本片不新发native prompt。 |
| get_state→controller.settled | [state:2025–2069](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L2025-L2069) 等[settled:135–140](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/modes/rpc/rpc-goal.ts#L135-L140)的exitTask／当次reconcile tail并重查tail。exit由observe直接排入promise、先清previousTools再恢复；reconcile由then当场启动，非goal分支同步返回，有goal才await恢复。独立[continuation:424–477](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/modes/rpc/rpc-goal.ts#L424-L477)的setImmediate／waitForIdle分支不被settled等待；既不等整个goal达成，也不证明state.isSettled必为true。 |
| reconcile→onThreadResumed→emit | [runtime:267–290](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/goals/runtime.ts#L267-L290)走clone／会计重置／commitState，不走accountingTail、whole-goal等待或隐藏prompt；[commit:169–178](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/goals/runtime.ts#L169-L178)同步setState／persist后await emit。AgentSession同步subscriber不await其Promise，只对存在的[goal_updated扩展mapping](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/extensibility/extensions/lifecycle-mirror.ts#L232-L233)直接启动并await[runner handler](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/extensibility/extensions/runner.ts#L1560-L1695)，不是等待未来普通RPC才启动的任务。 |
| 扩展会话变更重入 | [begin/endSessionChange:147–193](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/modes/rpc/rpc-goal.ts#L147-L193)：begin只等exit、不等本reconcile；end在reconcile pending时只排下一reconcile并返回，不自等。wrapper的[btw.close](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/modes/rpc/rpc-btw.ts#L104-L151)本地epoch／AbortController取消side question、等已启动checkpoint文件写入，不等本次新native abort。settled随后重查tail；无限第三方会话切换仍不保证终止。 |
| 工具mutation／恢复 | [SessionTools:731–742](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/session/session-tools.ts#L731-L742)的AsyncLocalStorage同mutation作用域重入直接执行，不把嵌套恢复排到自己后面；外层previousTail.then已有producer。恢复工具只改registry／presentation，不执行工具，不在此requestPermission。真实晚注册的嵌套恢复同样使用该重入guard，不能把它错当需要新普通RPC的休眠任务。 |
| write／goal注册及prompt rebuild | [guards:1027–1055](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/session/session-tools.ts#L1027-L1055)只在所需工具缺失才注册；[SDK真实注入:3626–3665](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/sdk.ts#L3626-L3665)已有项立即resolved，禁用goal立即false，否则当场构造并共享inflight。工厂只是构造WriteTool／GoalTool，不启动execute／turn。[rebuild:1139–1186](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/session/session-tools.ts#L1139-L1186)的force／signature／frozen guards后才调用[真实SDK callback:3870–4100](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/sdk.ts#L3870-L4100)，叶为当前启动的repo／context／rules文件或注册provider回调、已有memory instructions读取／render、[system-prompt:630–856](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/system-prompt.ts#L630-L856)。不是等recall／consolidation／模型turn；SkillDescriptionCatalog压缩另调度，不被rebuild await；提交工具／prompt尾无新增await。 |
| 已有side-channel回包 | [dispatchRpcControlFrame:387–411](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L387-L411)在ordinary tail前处理已有extension UI／host tool／host URI回包，不是本片新增普通RPC；这不承诺adapter实现任意extension UI，外部回包不来仍可能等待。 |

**实际版本对应而非只看版本号：** 报告用contents／tree metadata确认18.12.2 `1d5aff90b057ce7dbfe32ea557a527c1b3144b72`与18.12.1 `291e055836c210f314af3f73f53244e8e9d09de8`的rpc-mode同blob `b10ae11923d59a4db3d5a637cfc0bda10ce114ee`；rpc-goal、runtime相关目录、SDK、SessionTools／Manager、system-prompt、实际所需tools/index与write、rpc-btw等另分别核对metadata，不由rpc-mode相同推全部相同。AgentSession本身不同blob，报告分别核对18.12.1的[file/name getter](https://github.com/can1357/oh-my-pi/blob/291e055836c210f314af3f73f53244e8e9d09de8/packages/coding-agent/src/session/agent-session.ts#L6964-L6981)、[setter委托](https://github.com/can1357/oh-my-pi/blob/291e055836c210f314af3f73f53244e8e9d09de8/packages/coding-agent/src/session/agent-session.ts#L10270-L10272)及[工具恢复委托](https://github.com/can1357/oh-my-pi/blob/291e055836c210f314af3f73f53244e8e9d09de8/packages/coding-agent/src/session/agent-session.ts#L6677-L6678)，未套用新文件行号。18.2.8 `5e0fc867f8a58dfe8812b5e99b2e7b6a0313da6c`的[get_state:1284–1312](https://github.com/can1357/oh-my-pi/blob/5e0fc867f8a58dfe8812b5e99b2e7b6a0313da6c/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L1284-L1312)直接同步取file/name，没有RpcGoalController；本版[setter:1530–1539](https://github.com/can1357/oh-my-pi/blob/5e0fc867f8a58dfe8812b5e99b2e7b6a0313da6c/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L1530-L1539)、stats:1510–1512及本版getter委托另读，不把新controller硬套旧版。元数据可按固定[18.12.2](https://api.github.com/repos/can1357/oh-my-pi/contents/packages/coding-agent/src?ref=1d5aff90b057ce7dbfe32ea557a527c1b3144b72)／[18.12.1](https://api.github.com/repos/can1357/oh-my-pi/contents/packages/coding-agent/src?ref=291e055836c210f314af3f73f53244e8e9d09de8)复查。

**源码边界仍保留：** 以上不是所有用户callback／capability provider／文件系统／锁永不stall的保证。外部I/O不返回、第三方handler不返回或无限reconcile都可继续等待；原有局部deadline不覆盖全链，不新增timer造settled／cancelled。保持同active admission和reader消费，local cancel等待已发setter／stats／state而不own abort；EOF／通知失败走既有失败回收，不先释锁。主Agent仍须在consumer gates、compiled synthetic及真实T-N1分别证明适配器顺序和目标运行，不能拿无goal／mutation任务的idle smoke充数。**此source closure尚待两位非作者审核，不把只读调查者当许可者。**

setter ACK 的替代也必须区分：rpc handler await `session.setSessionName(name,'user')` 且 applied=true 后才 success；但响应没有实际 title／file／revision。manager 在赋内存名称后才 await 持久化，其 [persistTitleChangeEntry:1920–1977](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/session/session-manager.ts#L1920-L1977) 有非持久、released／epoch 等路径，不能从一个 ACK 推跨异步写者的原子“此文件现在仍是此名”或重启持久成功。**ACK＋精确 stats 是较窄候选，但不满足本稿指定的 sessionName 真实读回，不被默选来替代 get_state。** 如改走普通 native rename，则必须另证明已发布的真实 settled 边界、标题来源及晚 cancel 不再排 abort 的顺序；当前 legacy local ACK false 不具该证明，014 也不提供它。

### 文件范围与最小实施请求

本次只写本文件及 `docs-ai/README.md` 新索引，不改 012／014／src／tests。未来最小申请：**先仅 M** 的 `src/connection.ts`、`src/server.ts` 与现有三份 test；T1 只在局部取消及来源提案获点名许可后，另一个顺序切片修改 `src/connection.ts`／`test/connection.test.ts`／`test/server.test.ts`。没有 rpc-transport 泛化、SDK／Core 升级、宿主生产代码或启动参数改动。永久行为落地时按根文档职责更新 README 的翻译事实；真实证据才更新 COMPATIBILITY／TESTING，最终按生命周期写 001-action，本稿不预填实现。

## 备选与决策

| 选择 | 理由／代价 |
| --- | --- |
| M 用标准 config＋原始 pair Map | 推荐；复用实际消费者，不造 capability 或 legacy route。斜杠冲突使目录失败，不能兼容性兜底选错模型。 |
| T1 原样 native /rename＋观测标题帧 | 不推荐作为当前最小实施：input hook 可改写、frame 无请求来源、有参也可生成 card，且 local 完成后的 get_state／abort 顺序未闭合。保留现有普通路径，不给其未知输出加 explicit。 |
| T1 显式入口内部 set_session_name＋stats＋get_state | 推荐送审；native user 写入及已证明清洗后的名称精确读回，不依赖 card 生成或来源不明帧。明确偏离 007 的原样 native prompt 路径，但保留其成功／同file／真实sessionName条件。代价是绕过 card／hook 和新增局部取消合同，**不是已批准决定**。 |
| 内部 setter 成功 ACK＋精确 file stats，省略 name readback | 本稿不选；ACK 有已核对的 await 赋值链，但无原子 file＋name 快照／revision，不能代替指定 get_state。若另改验收条件，须单独裁决，不称原条件已满足。 |
| 普通 native rename 后在已证明 settled 边界读 get_state | 有真实来源及取消顺序证明时可重新比较；当前 legacy local 完成不证明 native quiescence，不能把不欠 ACK 的一瞬当未来不会 cancel，也不加 timer。 |
| 新 setter RPC／title config／sessionTitle 自动 ownership | 不选；不是用户最低入口，且已发布 SDK／Core 并不赋予这些语义。 |

难以回头的动作：扩大模型选项本身就是宿主可见承诺，即便 initialize 没有新 capability；setter 可能已改变 native 状态而通知失败，不能撤回或谎报旧值；内部 T1 选择将有意不运行原生装饰／input hook；取消不承诺回滚；已推 explicit 可覆盖旧 user 标题，不能再伪装 generated 或承诺跨写者最后点击赢。两位 reviewer 必须逐项接受或明确阻塞，不得整份 clean 一笔放行。

## 验收

以下全部**待授权后由主 Agent 执行**；本次没有运行 test／build／lint／formatter／compiled smoke／OMP／Lody。先 permanent consumer RED，记录命令、断言失败及退出码，再改 src；不得以 TypeScript 缺方法、fixture 未支持新请求或 timeout 充当功能 RED。尽量从 SDK ACP request 驱动，直接 connection 用例只验证公开消费行为，不 pin 错误文案、私有函数、sourcewiring 或源码字符串。

| 精确 RED／回归组（提议 test 名） | 最小输入和消费者可观察预期 |
| --- | --- |
| `015 model config lists native models` | native state=A、目录为 provider p／q 同名模型及 id=`family/x`；session/new 应给全部真实 select values、实际 currentValue。当前只给单项，应在列表断言 RED。new／load／resume／冷热 fork 均覆盖，新 fork 使用新精确 file 和目录；无 state.model 不伪造 selector。 |
| `015 model config selects and reads back` | SDK 请求 `session/set_config_option{sessionId:A,configId:'model',value:'q/family/x'}`；fixture 持有独立原始 pair 和当前模型，只有收到正确 native pair 才改 state；应收到完整 config_option_update 后得到同一完整响应。当前 route 不存在，应为真实 ACP 拒绝对成功预期 RED；A→B→A、name 相同和 slash pair 不错选。 |
| `015 model config rejects ambiguity and failure` | 冲突 `(a/b,c)`／`(a,b/c)`、未知 value／config、boolean、malformed／目录拒绝、native set 失败／返回另一 Model、同A读回另一模型、file B／空／缺失；应无成功投影，变更后的不确定状态只可重新准备恢复。斜杠冲突不得 native dispatch。 |
| `015 model config keeps accounting and admission` | 同A先产生 usage，再切换、再产生不同 terminal provider usage，scope 不变且各归实际消息。gate 目录／set／state／通知，逐项 prompt/new/load/resume/fork/第二setter 均不得越过；已有 cancel／ACK／014 gate 期间 setter busy。config 等待时 idle cancel 不制造 abort；通知失败／EOF 不成功、不复活。 |
| `015 explicit title commits verified user input` | SDK 普通 prompt 单 text=`/rename  用户 名称 / A  `；fixture setter 真正保存 trim 后名称，stats=A、state.sessionName 为该独立保存值；应仅一条 explicit 的标准 session_info_update，通知 gate 放行前 prompt 不完成。当前不推标题，应在可见 notification 断言 RED；相同已存字符串也发 explicit 供宿主升级 user。 |
| `015 explicit title rejects unproven source` | 无参／空白、普通文字、image／多block、`/renamed`、native title 空／未知／旧会话／重复／迟到／看似同nativeId但file变化；一概不能由该帧产生 explicit。setter reject、state缺名／不符、stats B／缺／malformed、最终state file B／缺失／空／malformed／query reject、EOF 均无成功标题。**stats曾同A而最终身份不可核实的各分支，分别在未取消及已取消时断言当前失败、旧A下一prompt不dispatch、迟到A不恢复，再显式精确完整准备并完成正常prompt才算恢复；同A仅名称错误则保留A、仍拒绝标题操作，随后正常A prompt实际成功。** 重复ASCII空格／换行／C0-C1由fixture实际native清洗后独立保存，验证精确读回名称；清洗后全空失败，不strip card猜名称。 |
| `015 explicit title cancellation stays ordered` | gate 在 setter 前／响应中、stats中、get_state中、通知提交前／排空中，cancel 与 new/load/resume/fork/M/第二prompt 交错；严格断言上表每行的结果及身份状态，不能只检查“没有标题”。错误／身份失效不被 cancel 覆盖；保持锁至同active完成，不能release后后台补probe；无get_state→本次排队abort环。015-T1-02的source closure须非作者另审，合成gate不是native推进性证明；普通014 legacy/current／ACK／settlement及013 error/aborted不回归。 |
| `015 explicit title excludes unrelated native activity` | 先正常prompt取得可见usageScopeId／累计快照；在TitleControl的setter、stats、state、notification每个gate，分别注入同nativeId／无sessionId、初见messageId和仅responseId及双alias的text_delta＋terminal assistant usage，legacy agent_end(stop/error/aborted)、current yielded agent_end＋session_settled及任意id的prompt_result。断言零本control assistant chunk／usage、累计和scope不变、原操作未提前完成／失败，第二prompt/new/load/resume/fork/M仍busy；只放行自身gate后按setter/state/cancel结果单次完成。交叉native setter error、最终file B和同A仅name错误，不能被这些帧洗成成功／取消。随后按身份规则恢复或继续正常prompt，重放control期间已见ID／单独alias须仍无text／usage，以全新ID实际正常text＋usage＋013/014终态证明普通路由仍工作；同A未重新准备路径scope仍为原值，身份失效后的显式prepare则按既有规则新lifetime，不把prepare换scope误算本control重置。M各config gate注入同类帧也无输出／提前返回。只断言consumer结果和native可观察请求，不pin私有kind字段或sourcewiring。 |
| `015 explicit title waits existing producers without new abort` | 合成native在既有exit／reconcile、mutation tail／注册／rebuild的可观察producer边界暂停，setter→stats ACK与实际state有序；仅释放原producer即可推进读回／explicit通知／响应，不借新ACP prompt或ordinary RPC解除。扩展会话变更重入夹具不自等；local cancel仍只等待，状态身份错误/EOF/通知失败按前表。永久adapter测试断言消费者结果和native请求，不pin源码函数／guard wiring；夹具不是运行真实OMP这些内部方法，实际重入／producer行为仍由源码review和T-N1补证。 |

拟用命令：先 `npm run test -- test/server.test.ts --exclude "**/.claude/**" -t "015 model config|015 explicit title"`，每片只选已获许可组记录预期功能 RED；改后主 Agent 统一 `npm run typecheck`、`npm run test -- --exclude "**/.claude/**"`、`npm run build`。现有 peer／synthetic OMP 需先正确实现目录／setter／state 独立存储与 gate，不能把“Unexpected command”当实现缺陷或跳过失败用例。

### 证据分层与真实门禁

| 层级 | 必须观察；不能声称什么 |
| --- | --- |
| 源码 S／发布声明 P | 本文固定三个commit、SDK1.3.0／Core0.1.8，以及015-T1-02 producer／guard链是待非作者核对的interface与调度证明；不代表目标运行，不关闭N。014单次stats不关闭全R2；只读proof不授实施许可。 |
| 永久合成 tests | 证明 ACP 消费结果、native 可观察请求、来源／身份／取消与 drain；不证明 OMP 真能换两模型或真实 rename 顺序。 |
| compiled synthetic smoke | 主 Agent build 后，用临时隔离 runner 从 ACP 客户端驱动真实 `dist/index.js`＋合成 OMP 子进程，分别做 M A→B→A、T1 显式成功／取消／失败，fixture独立保存模型／名称及实际会话文件；核对路由、返回／通知先后、旧身份拒绝、通知失败和 EOF、自然退出／owned group 清理。runner 为提议临时文件，不加 production flag、不纳 npm 包；执行时记录实际完整命令／输出，事后去掉临时文件。它不是 N，也不关闭真实 Lody 或 Release。 |
| M-N1／T-N1 | 在维护者已有且可核验的 18.12.2、18.12.1／要求的18.2.8 隔离 runtime、本地端点记录版本／来源摘要／adapter候选／命令响应顺序。M 必须两种真实可用的隔离模型、原生 set 返回、get_state 与下一轮实际provider/model A→B→A；仅单模型回显不算切换。T 须证明选定入口的 native user 写入、同精确file／sessionName、取消／读回／通知顺序及重启持久化；若选内部翻译，另外记录其与普通 /rename card 路径的区别，不伪称跑了后者。没有目标 runtime 就记录阻塞，不下载／安装／启动来替代本次权限。 |
| 实际 Lody／T-A | 钉住真实 revision／安装版本及 adapter候选。M refresh看到真实目录、下拉A→B→A、失败不显示未生效值、跨轮／原生续聊一致。T从既有user/generated名称出发，显式rename最终source=user、相同字符串升级、晚generated不覆盖、列表／头／tab／重开一致；本地生成竞态必须最终真实存储测试，跨写者只声称现有CRDT规则。宿主分支合成测试不是这一层通过。 |
| R1／R3／R4–R6 | 当前候选真实矩阵及Required cases、独立source/tests审核后，才由R3裁定model选项与image/fork/title/usage承诺及initialize全量／负向断言。M/T不借机宣告sessionTitle自动ownership，也不放开usage的R2/U-B。冻结制品、mirror、公开字节回读／pin和另行发布授权仍各自必需。 |

008 的 F/I 局部许可本身不覆盖 M／T。本稿现按首轮非作者 reviewer `ModelTitleSpecReviewOne` 的明确窄裁决，**仅对 M 提议替换 007 的 N-before-src** 为上文“014当前P1修正后 main 验证及独立复审完成→两位非作者M规格许可→consumer RED→未宣告实现→compiled synthetic＋至少两轮独立实现review→真实N／Lody→R3”；真实 N、R1／R3／R4–R6 最终门禁不变。该意见不代替第二 reviewer、不代替014当前修正后的验证／复审，作者只修草稿，不自授 source；M 不等待 T1 开放。

T1不随M获准。015-T1-01身份失效／恢复和015-T1-02条件性source closure已获得第二非作者规格review的接受意见，但该轮新增P1 **015-T1-03**：TitleControl不能借普通active获得native输出／usage／root／settled完成权限。本次按该finding补最小operation kind／入口guard及consumer负例，**尚待两位reviewers全文复核，不自行宣告finding关闭或T1允许实现**。T1仍只申请上文014修后main proof／复审→两位非作者完整裁决→RED→未宣告src→synthetic／两轮实现review→真实N／Lody→R3的窄顺序，裁决前原T1 N-before-src有效；M不等T1，二者均不绕过014前置、R2／N／R3或Release门禁。

## 修订记录

- 更新于 2026-10-25（首轮规格反馈后的草稿修订）：按主 Agent 转交、并直接读取的 `ModelTitleSpecReviewOne` 窄裁决，仅 M 改为待014当前P1修后主Agent验证／独立复审、两位非作者许可、consumer RED 后再未宣告实现；补异步准备所有调用点等待。此为送下一轮的草稿，不是作者核对或已允许源码。
- 更新于 2026-10-25（015-T1-01）：明确最终 state 身份不同／缺失／不可核实时失效A，错误优先于取消、旧A不准入、迟到A不恢复、只可完整显式准备恢复；按 setter／stats／state／通知各gate列成功／错误／取消结果与身份状态，等待独立复核。
- 更新于 2026-10-25（015-T1-02）：补固定目标 `settled→exit/reconcile→AgentSession工具恢复→SessionTools mutation tail／注册／prompt rebuild` 的已读源码链，列精确未闭合叶边界及serial前驱推进条件，保留T1设计阻塞、不用ACK／timer／transport重构冒充闭合。未运行任何检查或native／Lody。
- 更新于 2026-10-25（source closure补充送审）：完整读取 `TitleReadbackProgressProof`；按独立producer／guard表和三版实际源码／metadata对应，补齐已知内建await不依本次abort／下一ACP／后排ordinaryRPC才能解环的条件性源码论证，保留外部I/O／callback无全链期限、完整file/name读回、局部cancel等待及admission/失败回收。仅提出T1同类未宣告source→synthetic gates／两轮实现review→真实N／Lody→R3的窄顺序，待两位非作者裁决；不自批、不改src/tests、不运行检查。
- 更新于 2026-10-25（015-T1-03修稿送审）：直接读取第二非作者 `ModelTitleSpecReviewTwo/findings/0`，补NativePrompt／TitleControl最小operation权限边界；仅共享014身份primitive，不共享text／usage／root／settled完成权限，保留control期间已见ID／alias的excluded证据。补四类gate的同native／无native身份自主帧、旧ID重放及普通prompt恢复消费者验收；未自行关闭finding，待两位全文复核，不改src/tests或运行检查。
- 更新于 2026-10-25（M 永久消费者功能 RED，源码实施前）：主 Agent 实际执行 `npm run test -- test/server.test.ts --exclude '**/.claude/**' -t 'lists the exact native catalog across providers and slashes on session/new' --reporter=dot`，真实合成 ACP session/new 保持精确 `native-session.jsonl`／当前 `fixture/model`，但 configOptions 仅当前一项，完整目录对象断言期望 `fixture/model`、`other/family/x`、`org/branch/leaf`、`fixture/fork-model` 四项而失败，退出 1，原始输出 `artifact://872`；不是缺方法、unknown fixture query 或 timeout。主 Agent 据此另行允许仅 M 源码，T1 当前阶段仍不实施；本作者未重跑、未记录 GREEN。
- 更新于 2026-10-25（仅 M 源码交接，待统一验证／独立实现 review）：已接标准 `setSessionConfigOption`，目录 Map 保留原始 provider/id、冲突整表拒绝，native Model 返回＋最终同 file/model state 双核对后按既有通知队列稳定排空再响应。new／openExact／fork 均 await 异步完整准备；为避免新增目录 await 期间 A→B／模型变化使用旧快照，成功准备明确 first state→catalog→final state，补 catalog pending 实际 file/model 变化消费者断言，成功 native ledger 只增加这两个真实查询、失败首 state 路径不变。M 无 prompt active、不换 generation／accumulator／scope，控制期已见 alias 保留 excluded 证据；不确定变更清身份／配置，仅完整显式准备恢复，通知等待的 EOF 可直接失败。主 Agent 已确认该 freshness 闭合在已审范围；本作者未运行任何检查，不标已实现，不改 README、不实施 T1；后续主 Agent 验证源码／合成制品与两轮非作者 review，真实 N／Lody／R3／Release 门禁保留。
- 更新于 2026-10-25：M未宣告实现／315根tests、M49及五保留compiled合成验收与两位非作者完整修后复审均已通过；按分片生命周期记录，T1仍未实现，015整体不提前写001或标全部已实现 — 见 [002-model-config.md](002-model-config.md)
- 更新于 2026-10-25（T1永久消费者功能RED，T1源码前）：主Agent实际执行 `npm run test -- test/server.test.ts --exclude '**/.claude/**' -t 'publishes only a verified explicit title from a literal rename prompt' --reporter=dot`，`artifact://1012`：真实SDK `session/prompt` 已正常返回 end_turn，但可见标准 session_info_update 数组actual[]，与精确session/title/titleSource=explicit完整对象期望不符，server1848断言失败；707ms test／1.97s driver退出1，非缺方法、unknown query或timeout。两位非作者已核对T1-01／02／03后，主Agent据此明确授权T1窄源码；作者不重跑、不预填GREEN，015整体仍未实现。
- 更新于 2026-10-25（T1窄源码交接，未验证）：仅connection内新增独立TitleControl owner及单text literal识别；现有prompt入口内部走setter→单stats→最终原样file/name读回，提交标准explicit通知后稳定drain，未发native prompt/card/hook或新wire。只共享014身份probe／精确失效primitive，TitleControl不占NativePrompt active，已见message/response alias维持excluded；局部cancel等待本producer、最终身份错误优先，sameA仅name错误保留A，EOF／通知失败唤醒本控制并沿016全连接失败路径。状态schema将name留作unknown并在独立title读取时验证，避免malformed name连带改变M身份合同；M算法、013/014 accepted outcome、server016分类与initialize集合不改。作者未运行检查，不写015001／标题README或标整体已实现；等待主Agent全量、T1实际compiled及M49＋五保留证据和两非作者完整复审。
- 更新于 2026-10-25：最后T1片经主Agent373根tests／typecheck／build、实际compiled全61及当前字节M49＋五保留bundle通过，两位非作者各完成第二轮完整当前实现复审、findings=[]；完成一次整体001与标题翻译README，历史M002／before及未验证门禁不回写 — 见 [001-action.md](001-action.md)
