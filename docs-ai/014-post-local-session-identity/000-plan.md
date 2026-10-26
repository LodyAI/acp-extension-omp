# 014 — 本地处理后的精确 sessionFile 重新核实：计划

| | |
| --- | --- |
| **状态** | 已实现；仅本条目身份／完成屏障切片，已通过当前 014→M 的 adapter source／synthetic 前置，不代表其它阶段放行 |
| **锚点日期** | 2026-10-24 |
| **规格核对** | 非起草者 `PostLocalIdentitySpecReview` 首轮及 `PostLocalIdentityRoundTwo` 第二轮完整独立核对通过，允许在原完成边界实施单次 `get_session_stats` 身份屏障；前置永久 RED 已由主 Agent 观察。2026-10-25，非起草者 `IdentityImplementationReview1` 与 `IdentityQualityRoundTwo` 均完整复审最终当前 diff、生产链及证据，`findings=[]`，014-REVIEW-001／002／003 全关闭，无已知修后未审源码项。两者明确通过当前 014→M 的 source／synthetic 前置；不是 M/T1 自身实施许可，不关闭 SDK-BOOT／SDK-OBS 历史观察、全部 R2／U-B、native N、完整 B／S、R3／R4–R6 或 Release。 |
| **相关** | [身份边界](../../AGENTS.md)、[失败切换](../005-session-switch-failure/000-plan.md)、[迟到来源](../009-late-event-generation/000-plan.md)、[V1/R2](../012-remaining-v1-gates/000-plan.md)、[独立 root outcome 修复](../013-held-root-yield-outcome/000-plan.md)、[真实验收](../../TESTING.md) |

## 背景

R2-SOURCE-MOVE-01：普通 ACP 文字 prompt 可被 OMP 本地处理。固定 18.12.2 的 `/move` 有 text-mode `handle`，可改变持久 `sessionFile` 而不改变 native session ID；RPC inputGate 仅比较后者。当前 adapter 本地完成后不重新核实身份，随后无身份父 assistant usage 仍使用缓存的旧 ACP 文件名。固定 builtin `/new`、`/resume`、`/fork` 只有 handleTui，不把它们误写成已证明的 ACP 本地切换。

**主 Agent 已执行的诊断，不在本条目重跑**：`node /tmp/acp-omp-identity-move-repro-OhXUOl/run.mjs dist/index.js` 得到 exit 1 / `R2-SOURCE-MOVE-01-observed`。compiled adapter 加合成 native fixture 实际执行 A→B 文件 rename，nativeId 不变；本地 ACP 操作及旧 A 后续 prompt 都返回 end_turn，B 上无身份 assistant usage 被发为 sessionId=A。native types 为 `new_session,get_state,prompt,prompt`，未重读 state；自然 exit 0、owned group gone、runtime scratch removed。这不是运行真实 OMP `/move` 的证据，本条目没有复跑或执行任何检查。

### 既有同步身份 primitive 与版本源码证据

| 固定来源 | 已核对内容 |
| --- | --- |
| 18.12.2 / `1d5aff90b057ce7dbfe32ea557a527c1b3144b72` | [rpc-mode:2397–2399](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L2397-L2399)的 get_session_stats 直接调用 session.getSessionStats 并 success返回，没有 await goalController.settled；[wire/state:220–222](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/modes/rpc/wire/state.ts#L220-L222)声明 sessionFile?/sessionId |
| 同上 / session 委托与返回来源 | [AgentSession:2005–2013](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/session/agent-session.ts#L2005-L2013)把当前 sessionManager 注入 SessionStatsTracker；[公开getSessionStats:12941–12943](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/session/agent-session.ts#L12941-L12943)直接同步return this.#stats.getSessionStats()；[session-stats:184–274](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/session/session-stats.ts#L184-L274)同步计算后直接取该 manager.getSessionFile；getContextUsage也是同步调用，无 goal/reconcile await |
| 18.12.1 / `291e055836c210f314af3f73f53244e8e9d09de8` | 已用tag ref固定commit；同路径 rpc-mode:2397–2399、wire/state:220–222、session-stats:184–274已有相同命令及当前文件来源，未从版本号推支持 |
| 最低18.2.8 / `5e0fc867f8a58dfe8812b5e99b2e7b6a0313da6c` | 已用tag ref固定commit；[rpc-mode:1510–1512](https://github.com/can1357/oh-my-pi/blob/5e0fc867f8a58dfe8812b5e99b2e7b6a0313da6c/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L1510-L1512)已有同步handler；[agent-session-types:442–444](https://github.com/can1357/oh-my-pi/blob/5e0fc867f8a58dfe8812b5e99b2e7b6a0313da6c/packages/coding-agent/src/session/agent-session-types.ts#L442-L444)已有sessionFile/string-or-undefined和sessionId；[session-stats](https://github.com/can1357/oh-my-pi/blob/5e0fc867f8a58dfe8812b5e99b2e7b6a0313da6c/packages/coding-agent/src/session/session-stats.ts)同步返回当前host manager的文件 |

本作者先前远程reader只拿到大文件前缀；现已用gh CLI contents API、Accept: application/vnd.github.raw+json及固定commit取得完整公开源码stdout（artifact://413），再用专用grep/read定位公开getSessionStats:12941–12943，实际方法体为直接同步return this.#stats.getSessionStats()。由此闭合serial dispatch→rpc handler→公开delegate→当前manager host→tracker返回sessionFile的来源链；getContextUsage:12962–12964同样直接同步委托。handler、delegate和tracker均未加入goal/reconcile await，原特定证据缺口已补齐；不是根据reader前缀或类型推断。源码闭合不等于目标二进制通过，三版兼容仍待N。

`get_session_stats`会计算其他统计，但本片**只解析sessionFile身份字段**，不读取/转换/转发tokens、cost、credits、contextUsage或task累计，绝不新增stats→usage路径。用量来源仍仅终端父assistant的message.usage。

## 目标

- 原生明确本地处理的prompt在完成响应交付前，发送一次get_session_stats身份probe核实请求接受时的精确A；相同文件才可交付原成功/取消结果。
- 不同、缺失、malformed、unsupported或无法核实则操作失败并失效旧身份；不采用B、不restore/new fallback。probe期间保持同一active/admission，旧身份不得接受下一prompt。
- 普通拒图/命令错误且probe同A时，保留原错误并保留身份，下一同会话文字prompt仍可用；原错误不会被身份相同变成success。

### 非目标

- 不支持/move、cwd迁移或新身份通知协议；不分析命令文本、不列黑名单、不自动迁移ACP身份。
- 不做每prompt preflight，不新增native prompt发送前的取消状态机，不混改013。
- 不改计费来源、U-B或usage宣告，不关闭R2其它来源/活动伸展、idle Stop、完整B或Release。

## 方案

获独立许可后只改已有 `src/connection.ts` 与 `test/connection.test.ts`。在原完成路径增加单次身份probe，只对get_session_stats响应校验非空sessionFile；现有prepare的get_state/readState不改，不能用stats替代会话准备/settlement查询。

### local证据、错误与原完成边界

| 已有输入 | 处理 |
| --- | --- |
| 同请求成功ACK data明确agentInvoked:false，无current字段 | 沿既有local/legacy完成合同进入probe，不等不欠的第二result，不新增settled=true |
| 同请求ACK或同IDprompt_result明确false，含current status/settlement | 先校验现有status/布尔settlement；true到完成probe，false保持Held，到真实settled才probe |
| 同IDlegacy false result，无current字段 | 沿现有local完成合同probe；其他ID、缺失标记或truthy字符串不能被当成本地证据 |
| 正常agentInvoked:true或无local证据的正常agent结果 | 不因本片增加probe；原终态、013聚合与settlement不变 |
| 已确认local的error | 原完成边界probe；同A仍拒绝原安全错误，不同/无法核实才额外失效旧身份 |
| prompt command rejection先到、分类未知或无第二result | 冻结原commandFailure，在原active内做一次条件stats probe；同A拒绝原错误但身份可继续，不同/缺失/无法核实才失效；不等待未知result，不重试、不将错误改成功 |

native current #report先删ticket、下一macrotask输出result；local builtin可只有ACK。reportPromptResult.catch也可能先onError再安排false错误result。adapter transport先同步onError记commandFailure再reject request Promise；条件probe应在原active的catch/共享完成屏障内启动，不能先finish/release后后台核实。裸rejection以自身既有失败边界处理；若已有有效current false terminal，仍保留真实settlement等待，query不替代settled。

### 单次屏障、取消与失败

1. 接受请求时固定原A及active generation；到达上表边界后只发一次get_session_stats。每active共享completion/probe promise；ACK/result同批、重复finish、cancel ACK重入不能绕过或重复probe。adapter事件reader不await probe本身，仍能消费响应/通知/ACK/EOF。
2. probe期间active不释放，new/load/resume/fork及下一prompt仍busy；只允许原active的continuation提交结果。EOF/notify failure已结束active后，迟到probe不可resolve旧请求、重建身份或采用B。
3. 只验证原始非空sessionFile === A；不trim/normalize/basename，不调用prepareSession，不换generation/usage accumulator，不消费统计计费字段。missing/unsupported/error/malformed按身份不可核实失败；**不fallback/retry到get_state或重发prompt**。
4. 同A的普通拒图/command error保留原安全commandFailure且身份仍可用；不同/缺失/无法核实时失效A再拒绝，但原安全错误仍优先，不泄露路径/provider诊断。不用host.failure/connection.close扩大控制范围；真实传输/通知失败继续既有连接失败路径。
5. 真实current settlement先冻结terminal，probe完成后仍循环drain稳定notificationTail；late cancel不因probe等待而重发abort。已requested的cancel继续等待真实ACK；probe/原settlement/ACK各自满足后才单次交付。legacy local不凭无status字段造settled/aborted，保留既有ACK协调。

已有入队通知仍按原固定sessionId排空，不回标B；本片保证local完成与下一ACP提交之间重新核实，不声称覆盖probe/通知期间任意自主root活动的R2计费归属。

### 014-WAIT-01的针对性替代与边界

旧草稿的get_state先await goalController.settled，其exit/reconcile可等待goal事件/工具恢复；get_state与abort都在RpcInputDispatcher ordinary serial tail，因而主动probe可能让后续abort排在该await之后。现改用同步stats handler及同步tracker，没有主动新增该goal awaited tail；既有普通serial排队、统计计算/序列化开销、前置其它命令及真正无响应native不因此消失。不能声称所有命令零延迟或开放连接上的任意不响应已有有限失败保证，也不加timer假定完成。

[serial dispatch:575–638](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L575-L638)仍按原队列执行；stats handler本体没有goal/agent/job等待。身份字段缺失或query被拒绝可立即走可证明失败；完全不响应仍是RPC存活边界，不能用假ACK/假终态填补。014-WAIT-01的原特定get_state依赖不再是推荐路径，公开delegate方法体现已直接取得并定位；取消交错和全规格仍须非作者独立核对后才许可实施。

## 备选与决策

- **推荐post-local单次get_session_stats身份probe**：发布面已有当前sessionFile；不猜命令，不引入get_state的goal等待；其它stats完全忽略，不形成计费输入。
- **post-local get_state**：身份字段真实但有额外goal awaited tail，已定位014-WAIT-01；被上述较小primitive替代，不作fallback。
- **每prompt preflight**：新增active已建立而native prompt未发送的取消窗口，需另规格定义Stop如何阻止后续dispatch；不默选。
- **黑名单/move、title/config猜身份、采用B或restore/new**：不能证明精确身份或掩盖变化；关闭runtime又扩大到独立jobs，均不选。

难以回头的影响：原假成功local变更将失败且A需重新准备；普通同A错误仍可恢复。probe增加一次native query和统计计算，必须测试并发、取消与通知顺序。ACP响应不可撤回，不允许先success再核实；supported字段不能凭更高版本号推断，旧目标不支持时安全失败而非偷偷换查询。

## 验收

以下均为获许可后待执行，不是本轮结果。先沿已有peer/emitBatch/deferred写RED再修源码；及时观察rejection，gate finally释放，不把超时当通过。

| 输入/时序 | 要证明的consumer结果 |
| --- | --- |
| local ACK false；A→B且nativeId不变；stats返回B | 当前RED为原操作/旧A仍success；修后仅一次post-local stats，原操作失败，旧A下一prompt发送前拒绝 |
| legacy false result；current false结果的true/false settlement；ACK data形状 | 各入口单次probe；false仍等真实settled；只有ACK而无第二result不挂起 |
| /help同A；普通拒图/未分类error同A；error后false result晚到/不出现 | help成功，错误仍原错误且同会话下一文字prompt成功；没有fallback/重试/usage scope变化 |
| stats缺file、空file、malformed、unsupported/query reject；local error加这些输入 | 身份不可核实才失效；保留原错误优先级，安全消息不泄露A/B；显式成功会话准备可恢复 |
| stats携带任意token/cost/credits/contextUsage；普通agent结果 | 前者仅取身份、不新增任何usage事件/累计，后者不新增probe；原assistant usage来源不变 |
| gate住stats，尝试prompt/new/load/resume/fork；ACK/result同批；慢通知/取消ACK前后 | 保留admission及单次完成；保持原settled/稳定drain/ACK，不造cancelled；显式放行gate验证交错，不伪造native可抢占前置其它serial命令 |
| EOF/notify失败、迟到stats、legacy终态、013 root error/aborted | failure优先不复活，legacy/013原语义不回归；不以本片关闭idle Stop |

全部落地后由主Agent统一执行 `npm run typecheck`、`npm run test -- --exclude "**/.claude/**"`、`npm run build`；单文件可用 `npm run test -- test/connection.test.ts --exclude "**/.claude/**"`。原compiled identity-move诊断的修后版本须能响应get_session_stats，并显式断言原操作失败、旧A不再dispatch、单次stats/无post-local get_state、通知顺序及自然退出/owned group清理；只扩展fixture以实现已核对query，不改失败预期来容忍旧success。

真实18.12.2/18.12.1/18.2.8字段/顺序与现有Required cases仍待N，源码存在不等于矩阵通过。本计划/013/compiled synthetic通过均不关闭全部R2、usage宣告、Release或R6；实现后才写001-action.md。

## 修订记录

- 更新于2026-10-24：撤回裸command rejection无条件失效；改为条件query，同A保留原错误与会话恢复，不同/无法核实才失效。
- 更新于2026-10-24：主Agent指出并经固定版本handler/tracker/wire源码核对已有get_session_stats身份字段，推荐post-local身份probe由get_state改为get_session_stats，不fallback、不读任何计费字段；014-WAIT-01的特定goal await依赖不再主动引入。当时公开AgentSession薄delegate方法体尚待补读，全规格未核对，作者未自批。

- 更新于2026-10-24：改用gh contents API固定commit取得完整AgentSession公开源码，直接核对12941–12943的同步getSessionStats薄委托及12962–12964的getContextUsage委托，闭合身份来源与无新增goal await链；仅补草稿证据，不自批、不改src/test、不运行native或repro。
- 更新于2026-10-25（永久回归 RED，源码实施前）：主 Agent 实际执行 `npm run test -- test/connection.test.ts --exclude '**/.claude/**' -t 'rejects moved native file.*old A' --reporter=dot`，四种 legacy/current ACK 或同 ID false result 入口均在真实 A→B rename、nativeId 不变后错误返回 resolved／end_turn，预期 rejected／Error，退出 1，非 timeout（原始输出 `artifact://506`）。本永久 RED 不以既有 compiled before 代替；此后才开始已核对身份切片源码实施，未记录 GREEN 或真实 native 通过。
- 更新于2026-10-25（014-REVIEW-001，修正前永久 RED）：首轮非作者完整实现审查指出，延迟成功 ACK continuation 可重写已收到的真实 result／root 吸收终态／settlement。主 Agent 实际观察三条新增 RED（`artifact://597`）：同批 false ACK／result／settled 用例的 settled-read 与 probe-reply-read marker 均到达，但 completed 仍为 false；旧 completed ACK 用例分别把已吸收 root error／aborted 洗成 end_turn，而非预期 Error／cancelled。均为明确断言失败，非 timeout；据此先保留字段严格校验，再修正 ACK 与真实 result 的权威顺序，未宣称本发现已复审解决或整体 GREEN。
- 更新于2026-10-25（014-REVIEW-002，修正前永久 RED）：第二独立完整质量轮发现，共享 completion 可让 active.terminal 的旧 completed 覆盖临时操作 error。主 Agent 执行 `fails for invalid yielded.*settlement` 与 `retains legacy.*later current completion` 两组过滤（均为根 connection suite、排除 `.claude`，`artifact://703`），3 条非法 own yielded 的同批／分批／pending abort ACK 交错及 5 条 legacy 失败后到 current completion 的用例，共 8 条均明确 actual resolved／end_turn、expected Error，退出 1，非 timeout。修正将区分 current discriminator 协议损坏与原有 legacy 安全操作失败：前者同步协议失败，后者在 active 上锁存，均不能被后续 completed 洗掉；合法结果的 settlement／drain／ACK 及 legacy 禁用后的字段忽略不变。此处只记录 RED 与修正方向，发现尚待统一 GREEN 和两位非作者完整修后再审关闭。
- 更新于2026-10-25（014-REVIEW-003，修正前永久／compiled RED）：001／002 原问题已获两位非作者修后复核关闭，但另一完整复审指出真实 legacy aborted 仍被后到 completed 洗掉。主 Agent 的 `preserves native legacy abort` 永久过滤三例（无 cancel 意图、ACK 先、drain 先）均 actual end_turn、expected cancelled，非 timeout（`artifact://781`）；旧 748 dist 的 compiled aborted case 也实际收到 stopReason=aborted 却给 ACP end_turn，driver exit 1，同 A 后续 prompt 成功、adapter 自然 0／owned groups gone。此后修正以统一的已接受 outcome `error > aborted > completed` 代替仅 error 布尔锁存；只来自真实合法 terminal／原有 legacy 取消证据，不从 Stop 意图造 aborted、不将普通取消 fatal。003 仍待主 Agent 统一复验与两位独立完整修后再审关闭，不能据另一份 clean 放行 M 或其它门禁。
- 更新于2026-10-25：统一 accepted outcome 修正后，主 Agent 的 typecheck／根 4 文件 261 tests／build 与 identity、FI22、root、malformed3、legacy3 五份 compiled bundles 全通过（`artifact://786`）；两位非作者完整最终修后复审均无 findings，001／002／003 全关闭，仅 014→M 的当前源码／synthetic 前置通过。SDK-BOOT／SDK-OBS 仍独立开放，真实 OMP／N 及其它门禁未关闭，临时 bundles 保留供后续整合 — 见 [001-action.md](001-action.md)。
- 更新于 2026-10-26：澄清历史证据、临时脚本不可用、永久回归位置与非布尔 own yielded 的连接失败偏差 — 见 [002-factual-corrections.md](002-factual-corrections.md)
