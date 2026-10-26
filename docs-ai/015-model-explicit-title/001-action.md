# 015 — 模型配置 M 与显式标题 T1：行动记录

## 时间线

| 日期 | 变更 | 引用 |
| --- | --- | --- |
| 2026-10-25 | 非作者核对 M／T1，逐片许可先消费者 RED、未宣告实现，再真实 N／Lody／R3；014 adapter 前置独立完成 | [000-plan.md](000-plan.md) |
| 2026-10-25 | M 永久目录 RED 后实施原始 pair Map、标准 setter、完整异步准备；M 未宣告分片验收和文档完成 | `artifact://872`；[002-model-config.md](002-model-config.md) |
| 2026-10-25 | M 合成发现既存通知故障被正常关闭降级为 exit0，独立 016 修复后通过，不回写其 before | `artifact://924`／`939`／`955`／`963`；[016行动记录](../016-acp-close-cause/001-action.md) |
| 2026-10-25 | T1 永久消费者 RED 已真实返回 end_turn，却没有精确 tagged explicit 标题，随后获 T1 源码许可 | `artifact://1012` |
| 2026-10-25 | pre-T1 编译字节再次到达同一实质消费者，标题 0 vs 1，intendedBeforeConsumerReached=true、driver1 | `artifact://1046` |
| 2026-10-25 | T1 独立控制／身份／名称／取消／通知实现；主 Agent 全根检查、当前 compiled T1 与回归全部通过 | `artifact://1040`／`1047`／`1048` |
| 2026-10-25 | 两位非作者各完成 T1 两轮完整当前组合源码／tests复审，最终 findings=[]，允许仅本未宣告实现／合成窄 gate 闭合 | `ModelTitleSpecReviewOne`、`ModelTitleSpecReviewTwo` 最终报告 |

## 结果与当前状态（截至 2026-10-25）

M、T1 最后一片均落地，因此按本目录生命周期现在写一次整体001；M历史分片仍由002记录，不回写315／963为新的373／1047／1048。015已实现的含义限 adapter 翻译、永久消费者、受测编译合成与独立实现复审，不等于真实兼容、Lody用户验收或Release。

### M 概括

`src/server.ts` 接标准 `session/set_config_option`；`src/connection.ts` 维护当次 value→原始provider/id Map、不split斜杠、冲突整表拒绝。new／load／resume／fork等待 first state→catalog→final state，拒绝目录等待期间身份漂移，并采用最终真实模型。setter核对原生Model返回与最终同file/model后，完整配置通知稳定排空再响应；不确定变更失效旧身份／choices，显式完整prepare恢复，不换scope／generation／accumulator。细节与历史证据见002。

### T1 最终行为

- 既有 `session/prompt` 只拦截单text、起首精确 `/rename` 后接whitespace、trim后非空的字面标题，内部调用原生 `set_session_name`；不重复native prompt、不调用原生renameTitle的card生成／input hook，不解析引号或strip icon。
- setter成功后复用014的单次stats身份probe，再读真实 `get_state`；仅最终原样file仍为A、实际sessionName与已证明native C0/C1→space／连续ASCII空格合并／trim结果相同，才推标准 `session_info_update`，`_meta.lody.titleSource='explicit'`。通知值来自真实读回，不由ACK／请求值填回；同名也推explicit，供宿主升级用户来源。
- 最终file不同、缺失、空、malformed或query不可核实时失效A／choices，优先于cancel；不adopt B、不迟到恢复，只有完整显式prepare能恢复。明确同A而仅name坏则操作失败但保留A。
- 独立TitleControl拥有admission，不占NativePrompt active；无关text／usage／root／settled／prompt_result不能替控制输出、计费或完成。已见ID与alias留excluded证据，后续不能升格；不重置财务scope，不宣称解决未知首次帧的完整R2。
- 取消只登记并等本setter／stats／已发state；没有新native abort或等待无关agent_end。未发state时取消不追加query；已发state仍先判身份／名称错误。通知提交后的late cancel只等原drain／end_turn，取消不承诺撤回已经持久化的原生名称。
- EOF／真实输出失败拒绝控制并唤醒通知等待，沿016失败分类回收，迟到包不复活。普通NativePrompt的013／014 outcome、settlement／ACK、M、F/I、MCP丢弃与initialize未宣告集合保持。

### 实际执行与独立审核

下表由主 Agent执行；作者与reviewer未自行复跑。没有把分别执行的命令写成另跑过 `npm run check`。

| 项目 | 当前可复查结果 |
| --- | --- |
| 永久 T1 RED | `npm run test -- test/server.test.ts --exclude '**/.claude/**' -t 'publishes only a verified explicit title from a literal rename prompt' --reporter=dot`；1012中标题通知数组actual[]≠完整explicit对象，退出1，非timeout／unknown query／缺方法。 |
| 当前根检查／build | `npm run typecheck`、`npm run test -- --exclude '**/.claude/**'` 通过，1040记录4files／373tests（23 preparation、252 connection、8 signal、90 server）；随后主 Agent执行 `npm run build` 完成，1047／1048均使用当前 `dist/index.js`。 |
| compiled T1 | 1047 manifest／逐case结果共61 planned、61 exercised、61 passed、failures=[]；末尾73394–73398为scratch removed、driver0、all-selected-consumers-passed。literal、同名、清洗、引号、非literal、错误×cancel、四gate权限／admission、prepare／EOF／通知等待均在实际清单中。 |
| 可见顺序与故障 | 1047:749–763实际explicit通知先于对应id4的end_turn。8项EOF／write故障自然adapter1、parentEOF=false；包括72542起title-output-write-failure与72969起EOF-notification-await，native在紧急cleanup前leaderAlive／groupAlive均false。全部61case没有靠紧急清理冒充自然回收。 |
| 当前字节回归 | 1048六份report为M49、014 barrier、F/I22、root error、malformed3、legacy3全部成功；总driver0／临时清理，保留普通legacy可恢复错误／取消与损坏current协议失败的区别，不复用pre-T1的963代替当前结果。 |
| 两轮独立实现复审 | ModelTitleSpecReviewOne、ModelTitleSpecReviewTwo各重新审完整当前source／tests及共享M／016／013／014，均亲读1040／1046／1047／1048，最终findings=[]，明确允许T1未宣告source＋synthetic gate闭合，无其已知修后未审源码项。 |

## 相对计划的偏差

- 无未获许可的范围扩大。N-before-src对M／T1的窄顺序调整经两位非作者明确许可；真实N／Lody／R3只是后置，未被删除。T1选内部setter而非原样native rename，是核对过的card／hook绕过取舍，不把未知native标题帧伪标explicit。
- M新增目录await带来的freshness窗口以最后同file state闭合；所有prepare caller等待完整准备。T1共享的是精确身份primitive而非普通completion；通用state把sessionName保留unknown，标题分支独立验证，避免name malformed改变M合同。
- 生命周期exit0缺陷由独立016处理，不把其全套改动记为T1算法。初次315／963与本次373／1047／1048是不同历史检查点；原before失败、被&&短路未跑及后续补跑都保留。
- compiled driver不能制造setter同步内部语句间不可从ACP观察的微小间隙；提交前没有外部可插入await的分界由独立源码复核，不把61case或gate名称冒充该间隙的运行证明。未加timer式完成、通用dispatcher、生产开关或新wire。

## 未验证的问题

- 没有本片真实OMP producer／模型端点／目标二进制运行证明。获审资格目标仍固定18.12.2／18.12.1／18.2.8，不声称它们是今天上游最新，也不以新版本metadata更新资格或暗示兼容。COMPATIBILITY矩阵、Required cases没有修改。
- 实际Lody显式来源落到user、列表／头部／tab／重开与持久化仍待真实验收；宿主另分支源码／合成片通过不替代它。没有自动标题ownership、双向UI setter、legacy fallback或新增能力位。
- 全部R2、adapter U-B、S-ID／B-STATE、R1／R3、R4–R6及Release保持独立门禁，整体012仍计划中；外部I/O／第三方callback不响应不获得全链期限保证。
- SDK-BOOT-01（014-VERIFY-001）历史准备期超时仍未归因；SDK-OBS-01 raw harness pending可观测性限制仍开放。373与新smoke成功不证明修复或flaky，见 [014行动记录](../014-post-local-session-identity/001-action.md)。
- 没有本记录的打包、提交／推送、发布、公开字节回读或pin结果。
