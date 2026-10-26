# 012.008 — 执行 scope、显式标题与可分离的实现前置

| 项 | 结论 |
| --- | --- |
| 状态 | **计划中；基本 F1／I 未宣告实现已通过合成验收及三轮独立实现审核。** U-B／本地费用／T-A 仅设计核对，不授实施；本修订整体未获实现许可，整体 012 未完成。 |
| 规格核对 | 2026-10-24，非起草者 F/I 独立审查者完成两轮全文核对：允许实现基本 F1 和 I，仅该两片；主 Agent 先记录对应消费者 RED，再改 `src/`。其后基本 F1／I 完成合成验收及三轮独立实现审核；第二轮 FI-Q2-001 经修正、mutation 实测及第三轮完整复审关闭，无该切片修了未再审的问题。R3 前继续不宣告，实际 compat／Release 未通过。HostContractReview 两轮设计核对 U-B／本地费用／T-A，不授生产实施许可。 |
| 日期 | 2026-10-24 |
| 相关 | [000](000-plan.md)、[006](006-r-mcp-implementation.md)、[007](007-r-ux-contract.md)、[MIGRATION](../../MIGRATION.md) |

## 背景

007 两轮核对解除 R0-001，但 U-H1/U-H2、T-H1、S-ID、B-STATE 仍有设计缺口。本轮继续处理可由已发布合同和实际消费者决定的部分，不用缺失的目标二进制掩盖设计，也不把源码观察升级为真实运行。

本修订提出三项精确变更：usage scope 的 lifetime、标题的最低冲突保证，以及基本 fork／图片是否可先进行未宣告实现。它不关闭 R2，不把其他 UX 切片一并放行。基本 fork、图片、模型、计费、标题、子 agent、后台任务的用户底线不变。

## U-B — 每次执行 prompt 一个 accounting scope

### 选择与理由

选择送审方案 U-B：每个非重叠 ACP 执行 prompt 建立一个 `SessionUsageAccumulator`／`usageScopeId`。同一次 prompt 的多请求、多模型和 compaction 不换 scope。重新开连接、重试执行或 fork 都不能复用旧 scope。

这是对 007「每次 prepare 一个 accumulator」的明确修订，不能当作原实现天然兼容。已发布 Core 0.1.8 `usage.ts:40–45` 允许 scope 表示一个 native turn／SDK result；不新增 ACP／Core wire 字段。

不采用保留跨轮 lifetime 再仅凭宿主 checkpoint 分账：当前 payload 不含 operation identity，下一轮期间的旧 operation cost 补全与新请求贡献不能总是区分；scope 累计 cost 为未知时，也不能凭跨轮相减得到正确本轮费用。该方案可以展示累计，但不满足本轮费用合同。

### 适配器 interface

- 计费输入仍只有已确认归属的父 terminal assistant `message.usage`，通过 `SessionUsageAccumulator`；模型归属、重复 operation、未知 cost 规则不变。
- 一个 scope 只属于一个执行 prompt；若旧 operation 有合法补全，必须仍进入原 accumulator／原 scope，不能在下一轮重新绑定。没有来源证明的消息仍受 R2 阻塞；新 scope 不是 provenance。
- 活跃 prompt 的真实 usage 通知必须先于 prompt 响应完成；沿用通知排空／失败关闭，不伪发空 snapshot 注册 scope。
- 模型切换本身不重置计量；下一次独立 prompt 的 scope 变化来自执行 lifetime，而不是模型选择。
- 这次不授权改归属逻辑，也不单独实施 adapter scope 切换。宿主消费链必须先支持并正确保留 scope；不能让当前丢 scope 的消费者把每轮从零的累计当旧 lifetime。

### 宿主 interface

复用 `SessionExecutionService` 已有的 `userTurnId`、确定的 assistant entry id 和 `invocation.requesterUserId`。在调用 `AgentClient.prompt` 前冻结 host-only execution context；通知接收点同步捕获，不在异步持久化时取 latest assistant。

首次真实 scope snapshot 在 prompt 释放前绑定到该 context，并把 `(精确 sessionFile,scope,宿主轮,requester)` 持久化到真实 turn 数据。后续同 scope 更新查原绑定，不改挂当前轮。没有唯一 owner 的新 scope 不猜归属。

本轮计量是该轮各 scope 的最新累计 snapshot 之和，不累加 successive snapshot，也不重复加 delta。缺失 model 不是删除；任一实际贡献 cost 未知时，本轮总费用仍未知。合法 late correction 替换原 scope checkpoint、修正原轮，不修改下一轮。

拟新增的 typed turn usage 字段必须同步进入现有 domain／schema／HistoryWriter、`buildChatStreamItems` 投影与缓存，以及 `AssistantTurnFooter`。具体字段名由 Lody owning slice 的规格点名；不能只改 React 或用日志证明界面完成。

### 本地报告费用与云端边界

原 000 的体验是「看到本轮 token 和费用」。本地必须在 `CloudUsagePort=null` 时也持久化并展示正确的本轮报告用量、已报告费用或「费用未知」，取消保留已发生用量。Core 费用是报告值／声明的估计，不是权威 invoice。

本地展示 eligibility 与现有 builtin-only cloud gate 分开；这不把最终 provider 改成 custom，也不冒充其他 builtin。真正 builtin OMP 的 launch／catalog／managed-runtime 接入仍属于 Lody 的独立集成前置。

若复用既有 cloud accounting side channel，必须保留精确 sessionFile 和 scope，并派生稳定、无歧义的 accounting identity；不得覆盖真实 ACP session ID。编码格式、公开 endpoint 可接受的身份／长度必须在该宿主切片点名核对，当前不假定私有云端语义。

本轮不新增云 API、durable cloud outbox、重试或 ack-crash 恢复系统作为本地费用的门槛。未获公开合同证明的云账单、去重和投递完整性不宣告支持，不能以 mock mutation 证明真实账单。host 落盘前崩溃造成的未知用量也不声称已恢复。

### 已执行证据与未验证

主 Agent 实际导入本仓库安装的 Core 0.1.8 `src/usage.ts`，用合成 sessionFile／两独立 accumulator 验证：A 的未知 cost 不污染 B 的已知 0.03；A 后补 0.02 保留旧 scope，B 不变。全部断言通过。此证据只证明已发布 Core 的现有行为，不证明 adapter、宿主、OMP 或云端。

U-B 仍须独立规格许可、宿主所属规则与文档门禁、R2、真实 scope 首次通知／结算顺序、当前候选矩阵和真实 Lody 费用界面验收。当前不允许实施或宣告 usage。

## T-A — 显式用户标题与现有存储语义

### 选择与差异

选择送审 T-A：成功的显式 `/rename <title>` 按 007 T1 验证原生结果及读回，再通过已有 Core `titleSource:'explicit'` 传递；Lody 从 AgentClient、Session、SessionManager 到最终写入保留来源，使用现存 `setTitle(...,'user')`，不降成 generated。

这明确替代 007 由主 Agent 加入的更强保证「rename 提交后另一次 UI 改名必然优先于旧 rename 的晚到成功」。当前 WorkspaceWriter 是 dual-author direct，upsert 无已证明的 title revision／CAS，不能用本地通知队列冒充跨写者全局排序。

基本用户需求是能改标题并持久化，不是新建跨端标题排序系统。并发或传播中不可相互观察的用户写遵守现有 WorkspaceWriter／Loro 冲突规则，不承诺现实时间最后点击赢。此范围收敛须经独立核对，不静默删除 007 更强的承诺。

### 最低实现与验收

- 显式成功标题可以替换此前旧 user／generated 名称；相同字符串也必须能将来源升级为 user。
- generated／fallback 不提升为 explicit；已存 user 后到达的 generated 仍走现有来源 guard，不覆盖 user。
- 本地 explicit、ACP generated 及隔离标题生成器的**最终来源检查与写入**共用现有每 session 通知持久化顺序；`maybeGenerateAndStoreSessionTitle` 不能继续绕过这条链直接做分离的来源读取／upsert。模型生成本身不占据该写入链，仅将最终重查和提交放入其中；不增加全局队列或云 API，该链不提供跨 renderer CAS。
- 取消、原生失败、旧连接／旧 session 通知不写本次成功标题；不能借 latestTurn 补上下文。
- 无竞争路径验收覆盖已有 user 名称、显式 rename、最终 source=user、列表／头部／tab／重开一致。本地生成竞态用显式 Promise gate 验证真实最终存储：生成已完成但最终检查／提交尚未进入顺序链时，先完成 explicit→user，再放行生成提交，最终不得回退 generated；反向顺序也须通过。不能仅 mock 条件写或数调用次数。跨写者竞争测试如实断言现存 CRDT 规则，不假称提交时间排序。
- 直接 UI→OMP 双向同步和自动标题所有权仍不是基本门槛，不宣告 Core `sessionTitle` 自动生成能力。

备选 T-B 是新增 host-only title intent／receipt interface，保留更强因果保证。它需要新的持久模型、合并与投影证明，当前不是现存 interface；不把它强加给普通改标题。

T-A 仍需 Lody 所属规格／权限／分支规则、独立实施许可、最终消费者测试及目标 OMP／实际 Lody 验收；本修订不允许直接改用户已有的 Lody main/ahead5 工作区。

## F/I — 可分离的未宣告实现前置（待独立裁决）

007 将所有新 UX 的目标运行样本设为改 translation 前置。本节提出只对**基本 full fork 与内联图片**做更窄分阶段：固定目标源码及已发布宿主 interface 核对、消费者测试 RED 后，可由非起草者单独许可未宣告实现；目标二进制仍是实际兼容、宣告、Lody 体验与发布的硬门禁。

理由：F1 的标准 SDK `unstable_forkSession`、精确源／新 `sessionFile`、OMP `fork`＋`get_state`，以及 I 的 ACP 内联 `data/mimeType`→OMP `images` 字段已有固定 18.12.2 源码与 SDK 1.3.0 证据；它们不依赖未选定的 usage／task／后台结果合同。不新增 production 开关、旧新双路径或假 fallback。

- F1：通过 SDK `Agent.unstable_forkSession` 真实路由，遵守同 cwd、active／sessionChanging／cancellationInFlight 互斥；冷／热连接都校验并精确打开请求 source，再 fork。native 请求只发 `fork`，不带 `entryId`；随后读取不同且为非空持久文件的新 `sessionFile`，返回该原样身份与真实新状态，建立新 generation 和现有 prepare 级 accumulator，不回放复制历史计费。取消／busy／请求或 state 失败／缺失或相同新文件／新文件非法均不成功；原生准备或变更后的失败按现有规则使 adapter 身份失效，重新准备后才可继续。MCP 接受但不转发。
- F1 的历史切点控制是 `request._meta.lody.forkAtTurn.turnId`，携带具体切点时明确拒绝；通用 `_meta.lody.turnId` 是普通关联元数据，不因此误拒。SDK 1.3.0 的额外目录字段是顶层 `additionalDirectories`，非空无映射时明确拒绝，不猜造 Core `additionalRoots` 字段。不实现或宣告历史 `forkAtTurn`。
- I：纯文字保持现有顺序和双换行拼接；内联图片 data／mimeType 原样保序转发，image-only 的 message 为空且 images 非空。完整检查所有块后才发 native prompt；任一不支持块整请求失败，不先发部分文字／图片。原生拒图或普通端点错误沿现有失败合同传播，不重试纯文字；普通 prompt 错误后可继续会话，EOF／传输失败仍关闭连接。不新增 MIME 白名单／自设限额／编码 validator／URI 抓取／落盘。
- `initialize` 的 fork 能力保持缺省、`promptCapabilities.image` 保持 false。完整新增请求处理器和翻译可由直接 ACP 合同调用验证，不将未宣告方法声称为普通宿主已可用。
- 本片不新增 `Model.input` 预判：当前 schema 没保留 input，不将缺字段解释为支持。固定 OMP 目标还可能执行其自身 vision companion；adapter 只原样翻译并正确传播实际拒绝，不以 text-only 元数据阻断原生可用路径。模型 admission 与实际图片处理仍须 I-N1／R1／R3 真实验收；若以后引入模型预判，须另核对完整字段与未知分支。
- 合成测试先覆盖成功与身份／内容错误边界，再用编译后的真实 adapter 进程＋合成 OMP 做 ACP smoke，核对 native 请求、通知顺序和回收。永久测试只捕获消费者行为。
- 标准源码范围是现有 `src/server.ts`／`src/connection.ts` 与拥有的 `test/server.test.ts`／`test/connection.test.ts`／`test/session-preparation.test.ts`；不改 attribution／usage lifetime／background settlement，不引入通用工具桥。导出 interface 的改动按 LSP references 纪律。
- 模型配置的对外选项本身是可见承诺，不在此无运行前置的 F/I 许可中。U/T/S/B 同样不随此放行。

备选是维持 007 的全体 N-before-src：更保守，但即使字段和标准消费者已核对，也不能推进这两个独立翻译。推荐只对 F/I 采用上述窄分阶段；**起草者不能批准，审查未明确允许前不改 src**。

## 核对与难以回头的动作

需独立核对目标、非目标、备选、scope 持久身份、标题保证收敛及 F/I 前置变化。核对结论必须逐片列允许／仍受阻，不能仅写本文件已核对就放开所有 src。

R1／R2／R3、真实 Lody、R4／R5／R6 的证据与授权不因本修订减少。源码或字节变化仍使受影响证据失效。没有目标二进制时，最终兼容／Release 验收保持受阻。


## 两轮独立核对与局部许可记录

2026-10-24，非起草者 F/I 独立审查者完成首轮全文核对，并在澄清稿上完成第二轮全文复核；无新增规格问题，首轮 F/I 条件均已明确。**允许实现 R-UX-A 的基本 F1 和 I，仅该两片；R3 前继续不宣告，实际 compat／Release 未通过。** 主 Agent 须先记录局部许可与修正后消费者测试的 RED，再改 `src/`；本记录不是测试 GREEN、功能实现完成或整份 008／012 的实现批准。

- **已查（源码／声明观察）**：008 全文及 007／000 原目标、字段核对与门禁；发布 SDK 1.3.0／Core 0.1.8；固定 `1d5aff90b057ce7dbfe32ea557a527c1b3144b72` 的原生 fork／图片生产和消费路径；当前 server／connection、会话准备和合成 ACP 测试模式。冷／热精确源、cwd／互斥、无 entryId、新文件持久性及失败失效、实际切点 metadata 与普通 turnId、`additionalDirectories`、图片原样保序／纯图／原子拒绝及文字路径均已复核。
- **已查（设计边界）**：不新增 `Model.input` 预判，不把缺字段当支持，不替 OMP 原生 vision companion 作运行保证；T-A 本地生成者最终来源检查与提交共用每 session 顺序链，不冒充跨写者 CAS。按 HostContractReview 报告，U-B／本地费用／T-A 已完成两轮设计核对，仍无生产实施许可。
- **未查／未通过**：本审查者未运行 tests／typecheck／build／lint／formatter／compiled smoke／真实 contract，未亲自确认并行测试的 RED；未运行目标 OMP 或真实 Lody，未审核未来 F/I 实现与发布字节。固定源码与已发布声明只支持本次窄实现许可，不是实际兼容证据。
- **仍受阻／未放行**：R2 来源归属、U-B lifetime、模型公开选项、S-ID、B-STATE 及 U/T/S/B 实施均不随 F/I 放行。目标 N、当前候选 R1、R3 宣告、真实 Lody、R4／R5 及另行授权的 R6 仍须各自证据与许可；不修改用户 Lody main/ahead5，不新增 production 开关、桥或启动 flags。

007 的 N-before-src 仅对基本 F1／I 由本修订作窄替代；007 其余合同及真实验收门禁继续有效。后续源码／字节改变仍使受影响证据失效。

## F/I 消费者 RED（实现前）

2026-10-24，主 Agent 实际执行修正后的消费者回归：

```sh
npm run test -- --exclude '**/.claude/**' test/connection.test.ts test/server.test.ts -t 'fork|image|mixed.*atomically|existing text-only payload|supported RPC arguments' --reporter=dot
```

主 Agent 报告退出码 1、21 个失败；实际缺口为 `session/fork` 未注册、图片被现有 text-only admission 拒绝，以及预期 native fork／prompt 请求和失败身份失效后果缺失。断言已移除错误文案锁定；普通 `_meta.lody.turnId` 随成功路径传入，具体历史切点只由 `forkAtTurn.turnId` 负例覆盖。

该 RED 只作为上述已核对基本 F1／I 的实现前消费者证据，不证明目标 OMP／Lody 运行，不扩大局部许可。实现后的 GREEN、类型检查、构建、compiled smoke 和至少两轮独立完整实现审核仍待主 Agent 执行并记录；不据此宣告能力或关闭整体 012。

## F/I 实现后合成 GREEN（实现待独立复审）

2026-10-24，基本 F1／I 翻译实现交付后，主 Agent 在 Node 26.10.0／npm 11.19.1 实际统一执行：

```sh
npm run typecheck && npm run test -- --exclude '**/.claude/**' && npm run build && node /tmp/acp-omp-fi-smoke-RxeccL/run.mjs dist/index.js
```

主 Agent 报告整条命令退出码 0：类型检查、根目录 4 个测试文件／196 个测试、构建均通过。编译后的真实 adapter 进程经 ACP 接入合成 native fixture；主 Agent 另外解析 smoke 输出 JSON，确认 22 个 case 全部 `passed`，每个 case 的 `failures=[]`、adapter 自然退出码 0，且 `runtimeScratchRemoved=true`。已观察到所属 native 进程组和忽略 SIGTERM 的后代被回收。

这是前节 RED **之后、实现交付之后**的合成 compiled ACP 证据，只证明本批受测翻译、失败边界和回收行为；不证明真实 OMP、图片理解、真实 Lody、R3 宣告或 Release。第一轮独立实现审核仍在进行，至少两轮完整实现审核尚未完成；源码后续若有修正，受影响验证须重做。基本 F1／I 仍不宣告，008 的局部许可和整体 012 的「计划中」状态不变。

上述 `/tmp` smoke 是 throwaway 验证脚本，不是生产入口；由其 owner 在两轮实现审核结束后清理，本记录不将临时路径当作长期验收资产。

## 第二轮实现审核：测试可靠性问题待复核

2026-10-24，第二轮独立质量审核提出 **FI-Q2-001（P2）**：fork 负例将 `withTimeout` 的本地超时也当作正确 ACP 拒绝，且取消／busy 等分支缺少重新准备后的成功 prompt，可能漏掉请求未完成或 `sessionChanging` 未释放。审核未报告当前生产挂起；这是永久测试判定漏洞，不是新的生产缺陷证据。

对应修正只涉及 `test/server.test.ts`：先将真实 ACP 请求完成／拒绝映射为判别结果，再直接 await 外层超时；原生准备或变更后的失败均要求明确 release fixture、重新精确 resume 和实际 prompt 成功。测试使用可观察的合成 release 信号结束源忙碌／错误选择状态，不要求 adapter 新增生产策略。

已准备独立 throwaway mutation 副本，唯一注入为 ACP client 丢弃错误响应、不完成 pending 请求；仅选 cancelled 负例，待主 Agent 执行，确认外层超时确实使测试失败。正常全量回归及第三轮独立完整重审也待执行，FI-Q2-001 未由作者关闭。本节之后不将此前合成 GREEN 当作测试修正后的验证结果，不宣称两轮实现审核 clean 或 Release 完成。

2026-10-24，主 Agent 随后实际执行该 mutation：

```sh
npm run test -- --exclude '**/.claude/**' test/fi-q2-001-dropped-acp-error-ForkImageRegressionPrep.test.ts -t 'rejects session/fork cancelled without reporting a new session' --reporter=dot
```

主 Agent 报告退出码 1、仅选中用例失败、耗时 4.24 秒，失败为外层 `Error: fork cancelled timed out`（临时副本第 49 行），未被当作正确 ACP 拒绝接受。这证明修正后的负例能检出 ACP 请求不完成；未修改生产代码，也不是生产挂起结果。

实测后作者已仅删除自己创建的 `test/fi-q2-001-dropped-acp-error-ForkImageRegressionPrep.test.ts`，没有保留 mutation 开关或副本。正常 full suite 回归及第三轮独立完整重审仍待主 Agent 安排；FI-Q2-001 继续待独立复核，不由作者关闭。

## 实现审核核对记录：基本 F1／I 切片完成

2026-10-24，主 Agent 报告修正后的正常完整类型检查及根目录 4 个测试文件／196 个测试均通过，退出码 0。随后非实现者 ForkImageQualityRoundTwo 完成第三轮完整独立实现审核：重新检查完整 F1／I 切片和 FI-Q2-001 修正，关闭该发现，`findings=[]`，无该切片修了未再审的问题。三轮实现审核已经完成；第二轮曾发现测试可靠性问题，不能将其描述成连续两轮无发现。

第二轮之后仅修改永久测试及合成 fixture，生产源码未改变；前述 22-case compiled smoke 仍对应当前生产源码，但仍只属于合成 compiled ACP 证据。实际目标 OMP、图片理解和真实 Lody 未因此获得证明；本次核对关闭的是基本 F1／I 未宣告实现、合成验收及实现审核切片，不是整个 R-UX／012 或 Release。

- **已完成**：基本 full fork 与内联图片的未宣告翻译、消费者合成回归、compiled ACP smoke、三轮独立实现审核；FI-Q2-001 已修正并经第三轮独立全文复审关闭，临时 mutation 副本已清理。
- **仅设计核对、未实施**：U-B／本地费用／T-A；[013 独立计划](../013-held-root-yield-outcome/000-plan.md) 仍是未核对提议，未开始实现，不借本片许可推进。
- **仍未通过／未放行**：S-ID／B-STATE、R2、目标 N、当前候选 R1、R3 宣告、真实 Lody、R4–R6。fork 能力继续缺省，`promptCapabilities.image=false`；真实 Lody 待验收，整体 012 保持「计划中」，不写整体 `001-action.md`。

## 2026-10-25 局部状态补记

上节及其“当前生产源码”“未实施”描述对应 2026-10-24 当时的 F1／I 检查点，不作为后续改动的状态结论。历史正文不回写。

- [013](../013-held-root-yield-outcome/000-plan.md) 已按独立核对完成 held root outcome 的窄实现、合成验收与修后独立审核；它不是完整 B／R2 的结论。
- [014](../014-post-local-session-identity/000-plan.md) 已获本地完成后单次 `get_session_stats` 身份核实的窄许可并实施。后续完整实现审核仍发现共享完成路径问题，正在补消费者 RED 和修复，不能把较早 GREEN 当作当前组合已验收。
- 宿主本地费用与显式标题消费已在独立 Lody 分支按其合同实施，尚在审核修复；存储边界修订仍未实施。适配器 U-B 切换未获实施许可。
- [015](../015-model-explicit-title/000-plan.md) 仍是 M／T1 草稿。M 的顺序修订尚须登记独立核对并满足 014 前置；T1 的原生读回可推进性仍未闭合，不借宿主标题消费实现放行。
- S-ID／B-STATE、R2、目标 N、R1、R3、真实 Lody、R4–R6 继续未通过。整体 012 仍为「计划中」，不写整体 `001-action.md`。

## 2026-10-25 后续核对登记

前一补记中的 014、015 状态保留为当时检查点；当前权威状态见各自计划。

- [014 行动记录](../014-post-local-session-identity/001-action.md) 已记录全部 RED、261 项根测试与五组合成进程验收，以及两位非作者对当前完整差异的最终复审。014 的 001／002／003 源码发现关闭；历史 SDK 准备超时与 harness 可观测性观察未关闭。
- [015](../015-model-explicit-title/000-plan.md) 已由协调者作为非起草者登记两位非作者的完整规格核对：仅 M、T1 可先消费者 RED、再未宣告实施，先 M 后 T1；N 后置不等于删除真实 N、Lody 或 R3，许可不外溢到适配器 U-B、R2、S／B 或发布。
- 宿主已执行的用量／标题、存储与 UI 分层检查不等于整合完成；新审核发现仍须实际回归、修复及再次全文审核。整体 012、R-UX、R1、R3、真实 Lody 与 R4–R6 继续未通过。
