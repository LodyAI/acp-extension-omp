# 012.007 — R-UX 宿主翻译合同与宣告顺序

## 背景与状态

| 项 | 结论 |
| --- | --- |
| 状态 | **计划中；两轮独立文档核对已完成，不授权 UX 实现。** 修订可作为部分选定合同与阻塞台账；尚不是可直接实施的完整 UX 设计。 |
| 日期 | 2026-10-24 |
| 修订对象 | [000](000-plan.md) 的 R-UX／R1／R2／R3 顺序与 [004](004-user-visible-floor.md) 的逐项合同；不回写已发布正文。 |
| 评审输入 | SpecGateReview 的 R0-001（usage 顺序循环）、R0-002（宿主合同不足）；UxSpecRoundOne 两轮完整复核后确认 R0-001 已解除，R0-002 保持未关闭。 |
| 用户底线 | 仍是连续文字、取消、本轮计费、fork、图片、模型、标题、子 agent、后台终端，缺一项不关闭 R-UX／V1。不用“原生命令存在”代替 Lody 可用。 |

本修订只决定现有方向下的翻译、前置与验收；不授权 R2 归属逻辑变更，不授权 R6，不把 MCP 接受视为桥。Lody 侧修补遵守 [MIGRATION.md](../../MIGRATION.md)，不在本仓库实现。

## 证据账本：观察不等于运行许可

- **S（目标源码观察）**：GitHub `v18.12.2` tree 对应 commit `1d5aff90b057ce7dbfe32ea557a527c1b3144b72`。下文所有 OMP 链接固定到该 commit，不使用 main 推导目标行为。源码只能支持待验证合同，不能证明用户安装的二进制确实具有这些字段。
- **P（已发布声明观察）**：本仓库 `package.json` 固定 SDK `1.3.0`／Core `0.1.8`，已读本地安装包 `node_modules/@agentclientprotocol/sdk/dist/acp.d.ts`、`dist/schema/types.gen.d.ts`，以及 `node_modules/acp-extension-core/src/{capabilities,session,methods,usage}.ts`。不把相邻 Lody workspace 内更新的 Core 声明冒充发布版。
- **H（实际宿主源码观察）**：相邻 Lody checkout 的 HEAD 为 `557fdc0bc639a11f1750312ba310d2e9816a4d90`；下文 `Lody:` 路径均相对该仓库，读取工作区消费者，未证明工作区干净或桌面安装等于该 revision，也没有运行 Lody。正式验收必须钉住实际 Lody revision／安装版本。
- **N（目标运行证据，未取得）**：本轮未运行 OMP。本机已定位的是 18.8.4，未定位到可用于本次切片的 18.12.2／18.12.1；这不是“别的机器也没有”的结论。主 Agent 可继续查维护者已提供的其他机器／路径，但不得新下载、访问用户 profile 或付费端点。
- [005](005-r1-macos-18.12-contract.md)／PR #17 是旧候选 `3258961` 上的历史 macOS 合同证据，不是本修订任何新实现的证据，不关闭本修订或 R2。

### 固定源码索引

| 引用 | 已观察内容 |
| --- | --- |
| [OMP commands](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/modes/rpc/wire/commands.ts)、[state](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/modes/rpc/wire/state.ts)、[content](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/modes/rpc/wire/content.ts) | `fork` 只回 `{cancelled}`；`get_state.sessionFile/sessionId/sessionName`；图片与模型描述字段。 |
| [OMP rpc-mode](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/modes/rpc/rpc-mode.ts) | `handleRpcSessionChange`、`dispatchOrderedUserInput`、`set_model`、`get_available_models`、`set_session_name`、`notifyTitleChanged`。 |
| [OMP fork](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/session/agent-session.ts#L10304-L10420) | `fork(entryId?, {requireIdle})`；entry cut 包含必要的已记录 tool results，非任意数组截断。 |
| [OMP message stamping](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/modes/rpc/rpc-session-events.ts) | `#stamp` 仅加进程内 `msg-N`；未知 message end 可现场 mint；没有新增 session／prompt／run 身份。 |
| [OMP subagent registry](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/modes/rpc/rpc-subagents.ts)、[CLI wiring](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/main.ts) | 顶层 CLI 创建并传递事件总线；roster、owner 比较、订阅、切换清理、取消 owner 校验。 |
| [OMP bash](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/tools/bash.ts)、[jobs](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/async/job-manager.ts)、[agent loop](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/agent/src/agent-loop.ts) | `details.async.{state,jobId,type}`；detached updates 可在工具退场及 turn yield 后继续到达。 |
| [OMP rename](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/slash-commands/builtin-lifecycle.ts#L620-L668)、[SDK title option](https://github.com/can1357/oh-my-pi/blob/1d5aff90b057ce7dbfe32ea557a527c1b3144b72/packages/coding-agent/src/sdk.ts#L883-L900) | `/rename <title>` 是已有显式输入；省略 title 会请求生成。`autoTitle` 默认 false，只有交互 TUI 设置。 |

## 变更一：拆开实现、证据、宣告，修复 R0-001

依赖图改为：`R-MCP → 本修订独立核对 → 各切片 N 前置 → R-UX-A 未宣告实现与证据 → R1/R2 → R3 → R-UX-B 用户可见验收 → R4/R5 → 维护者另行授权的 R6`。

1. **R-UX-A 不是完成 R-UX**：只在切片规格获独立许可且拿到该切片的 N 字段／顺序证据后，写合成测试、实现真实入口／翻译并采集候选证据；生产 `initialize` 仍不增加未经 R3 批准的能力。未宣告入口可由直接协议请求／合成连接测试，不要求先让普通 Lody UI 绕过能力门禁。不得加临时 production 开关、伪能力或垫片来制造通过。
2. **先有原生样本，再动对应翻译**：可用隔离 OMP 原生 RPC 收集最小样本；样本须含版本、二进制来源／摘要、命令及响应顺序、适配器与宿主 revision、合成／真实分界。源码与 18.8.4 不授予该许可。缺 N 时可完成本规格与合成夹具设计，但不实现该切片。
3. **R1** 在包含 R-UX-A 的候选提交上跑 18.12.2、18.12.1 及原计划要求的其他行；保持 `TESTING.md` Required cases，不删减它们。新增 UX 合同是补充用例，不替换矩阵。实现或宣告改变后重跑受影响行。
4. **R2 独立关闭**：先取得可证明父 `message_end` 来源关联的原生证据，或独立核对通过的合同变更；再另行允许修改归属实现。普通 contract、`session_settled`、单调 `msg-N`、模型名、延时、去重、合成夹具、子 agent 的 `sessionFile` 都不关闭 R2。当前源码未发现关联链，故 usage 宣告仍阻塞。
5. **R3 是统一宣告关口**：R1 目标行、切片真实证据与独立审核通过后，才按下文能力表更新 `initialize`。usage 还必须有 R2 结论及宿主 scope 条件。同步更新 `test/server.test.ts` 和 `scripts/contract.mjs` 的 **initialize 全量断言及负向断言**；不能让旧的全量能力断言永久挡住新宣告，也不能删断言。宣告提交再跑受影响矩阵并独立审查 source／tests。
6. **R-UX-B** 才用真实 Lody 表面验收已宣告的候选，所有底线项目通过才关闭 R-UX。R-UX-A／R1／R2／R3 的阶段完成不冒充最终用户可见验收。源码或字节变动使受影响证据失效；R4／R5 仍用冻结候选，R6 许可没有变化。

## 变更二：共同 interface 与文件范围

适配器外部 seam 沿用 SDK Agent 的标准方法及已发布 Core 的 `_meta.lody`／扩展方法；native translation 留在 `OmpRpcConnection`，不另造通用桥。以下是**后续获许可后的文件范围**，不是本轮改动清单：

| 切片 | 适配器既有文件范围 | 不可漏的消费／根文档 |
| --- | --- | --- |
| UX-U usage | `src/connection.ts`；`test/connection.test.ts`、`test/server.test.ts`；`scripts/contract.mjs` | 归属修复仍须 R2 单独许可；宣告才改 `src/server.ts`、`README.md`；真实结果进 `COMPATIBILITY.md`／`TESTING.md`。 |
| UX-F fork | `src/server.ts`、`src/connection.ts`；`test/server.test.ts`、`test/connection.test.ts`、`test/session-preparation.test.ts`；`scripts/contract.mjs` | Lody fork 消费见下文；后续能力／支持边界更新 `README.md`，结果更新矩阵文档。 |
| UX-I 图片 | `src/connection.ts`、`src/server.ts`；`test/connection.test.ts`、`test/server.test.ts`；`scripts/contract.mjs` | 只有真实 prompt image 支持才改 `README.md`／矩阵文档。 |
| UX-M 模型 | `src/connection.ts`、`src/server.ts`；`test/connection.test.ts`、`test/server.test.ts`、`test/session-preparation.test.ts`；`scripts/contract.mjs` | 用标准 config setter，不加第二套 legacy model route。 |
| UX-T 标题 | `src/connection.ts`、`src/server.ts`；`test/connection.test.ts`、`test/server.test.ts`；`scripts/contract.mjs` | 宿主标题合同不足的分支先阻塞；不能靠声明 `sessionTitle` 填洞。 |
| UX-S 子 agent／UX-B 后台 | `src/connection.ts`、`src/server.ts`；`test/connection.test.ts`、`test/server.test.ts`、`test/session-preparation.test.ts`；`scripts/contract.mjs` | 复用通知队列／关闭路径；若核对后确需改传输，只能另点名 `src/rpc-transport.ts` 的具体合同与测试，不能以此授权泛化重构。 |

共同规则：会话变更、模型／标题控制与 prompt／取消不能交叉污染；准备／切换失败保留现有身份失效规则，不假装成功或另建空会话。通知入既有 `notificationTail`，发送失败走既有关闭／失败路径。所有 task cache 在精确父 session／会话 generation 下隔离；adapter 生成的关联 ID 不是原生 provenance。缺字段不拿显示名、当前模型或“最后一个任务”补身份。

## UX-U — 本轮用量与 accounting scope

**P／S 观察。** Core `usage.ts` 的 `usage` 是最新 operation／turn snapshot，`modelUsage` 是当前 accounting lifetime 累计，`delta` 不是另一份累计；`SessionUsageAccumulator` 每实例生成不复用的 `_meta.lody.usageScopeId`。现有 `prepareSession` 在 new／load／resume 时新建 accumulator；模型切换不能重置。原生 terminal assistant `message.usage` 是唯一计费输入，保持 missing cost 为未知；子消息、task usage、session stats、UI 模型都不是替代来源。

**适配器合同。** `_lody/session/usage_update` 的 `sessionId` 必须等于精确父 `sessionFile`；保留 accumulator 的 scope、单 operation 去重与模型归属。fork 新文件／重新打开同文件都开始新 lifetime、使用新 scope，不重算复制／回放的旧消息。每个 operation 的 `usage` 不声称是整轮费用。以下宿主 eligibility、scope 消费与本轮展示是三个独立合同，不能只补其中一个便宣告可用。

**H 阻塞 U-H1：真实身份及 scope。** `Lody:apps/cli/src/lib/message-handler.ts:handleUsageUpdate` 先要求 `meta.cliType==='builtin' && isBuiltinAgentType(meta.agentType)`，不满足就 return；当前 builtin 身份表 `Lody:packages/shared/src/ai.ts` 没有 OMP，`usage-tracking-service.ts:RecordSessionUsageInput` 也绑定 `BuiltinAgentType`。因此当前 custom／registry OMP 身份即使收到 usage，也不能穿过此入口。Lody 必须先选定实际 OMP 接入身份与计费 eligibility，测试以该真实身份到达 `recordSessionUsageUpdate`；adapter 不冒充 Claude／Codex 等已有 builtin，本仓库不实现 provider 注册或宿主分支。

`Lody:apps/cli/src/agent/lody-acp-extension.ts` 的 `SessionUsageUpdateSchema` 未声明 `_meta`，Zod parse 会剥离 `usageScopeId`；仅为 Codex 的旧私有 turn marker 生成 `accountingId`。`Lody:apps/cli/src/lib/usage/usage-tracking-service.ts` 的 `cloneUsageUpdate` 也不保留 scope，`toPendingKey` 仅用 workspace／Lody session／ACP session／user。`Lody:apps/cli/src/lib/message-handler.ts` 将 `accountingId ?? acpSessionId` 送计费。接收通知本身不按 usage capability gate，所以“加 bit 就能显示”不是已证事实。

最低 scope 合同必须让精确 `(native sessionFile,Core usageScopeId)` 在同一 Lody session 下保持独立 accounting lifetime，不让同文件重开后的新累计覆盖旧累计；fork 新文件不继承旧账，模型切换不换 scope，重复 snapshot 不重复加账。复用现有 `accountingId` 承接该组合是**待独立核对的实现选项**，不是已选实现、更不是新云 API 或 OMP 扩展；其传递、队列克隆、持久化及重启对账必须由 Lody 审核。只保留 `_meta` 而不改变实际 accounting identity 不满足合同。

**U-H2：本轮展示合同未选定，不能许可实现。** 现有 Core `usage` 是 operation snapshot、`modelUsage` 跨轮累计、`delta` 不是 exactly-once 账本；`usage-tracking-service.ts:drainPending` 只提交累计 modelUsage，并未形成本文要展示的本轮数。需由 Lody 在现有稳定执行 turn 上下文中选定：① prompt 接受时绑定哪个持久轮身份／用户，不能在迟到通知时随手取最新 assistant；② 每个参与 scope 的轮开始累计基线、轮内多请求和模型切换如何合并；③ prompt 最终结算／失败／取消何时封账及保存哪个累计 checkpoint；④ 同 operation 的晚到 cost 补全／重复通知如何对账到原轮，未知 cost 仍未知；⑤ 回收／重连跨 scope 如何累加；⑥ 真实费用 UI 的具体文件／字段、轮归属及云同步不可用时展示什么。当前 `handleUsageUpdate` 取 `readLatestTurn(...,'assistant')` 找用户，不能证明其就是通知原轮；本修订未找到完整轮消费／持久化／UI 关联，**这些是尚未选定的宿主设计，不是只欠目标 N**。不得自造 turn wire 字段、云端接口或以末次 usage／累计总数冒充本轮。

U-H1／U-H2 的解除记录须钉住真实 OMP 接入身份、accounting identity、稳定轮上下文、上述聚合／封账／修正规则和具体 UI 落点，覆盖同文件两次连接、多请求一轮、fork、模型切换、重复／迟到 snapshot 与未知 cost。它们与 **R2 是独立阻塞**；宿主聚合不能证明原生来源，R2 通过也不能补齐宿主消费。

**能力／验收。** 仅 R2、U-H1／U-H2、R1／R3 均关闭后，宣告 `agentCapabilities._meta.lody.usage={version:1}`。合成测试覆盖别会话、已知旧 ID、首次无来源迟到帧、重复／缺 cost、跨 scope／模型不重算；首次无来源迟到帧必须有 R2 批准方案，不能改窄测试掩盖它。N 必须重现来源边界并核对费用与 token 桶。真实 Lody 以实际接入身份连续两轮、多请求一轮、回收后续聊、fork 后新一轮，均可在已选定 UI 看到正确本轮费用且原会话不增旧账；轮封账后迟到 correction 应修正原轮而非下一轮。与其他 agent 对照云同步状态，LI-003 不靠 adapter 合成测试关闭。

## UX-F — 精确 fork 与 forkAtTurn

**S／P 观察。** SDK `Agent.unstable_forkSession` 对应 `session/fork`，入参 `{sessionId,cwd,mcpServers?,_meta?}`，返回 `{sessionId,configOptions?}`；标准能力键为 `agentCapabilities.sessionCapabilities.fork={}`。OMP `fork{entryId?}` 只回 `{cancelled:boolean}`，必须随后 `get_state` 得到新身份；RPC 强制 idle snapshot，原文件不受后续新会话写入影响。持久化 `entryId` 既不是 `msg-N`、provider responseId，也不是 Lody history item ID。

**拟合同 F1（全会话）。** 冷连接先验证并精确 `switch_session{sessionPath:request.sessionId}`／`get_state` 打开源文件，再发 `fork`；已有 runtime 必须遵守同 cwd／空闲约束。成功必须取得与源不同、非空且可验证为持久文件的 `sessionFile`；该**原样字符串**为新 ACP `sessionId`，新 native ID 另存。不得用 basename／随机 UUID／旧 ID／响应里臆造的路径。`cancelled:true`、busy、缺失／相同新身份、state 失败均不能返回成功；失败后的 runtime 身份按现有会话准备规则失效，不能悄悄恢复为另一个会话。fork 的 MCP 列表沿用已核对“接受但不转发”，不得进入原生请求；非空 additional roots 无获批映射前拒绝，不能静默承诺支持。

**拟合同 F2（指定轮）。** Core `forkAtTurn={version:1}` 与 `_meta.lody.forkAtTurn={version:1,turnId}` 是独立 interface，不由 F1 自动获得。`Lody:apps/cli/src/agent/agent-client.ts` 的 `getSessionStartMeta`／fork 分支消费此字段；`Lody:apps/cli/src/session/session-fork-service.ts:cloneHistoryThroughTurn` 复制可见历史至所选轮，有 durable `acpTurnId` 才允许历史轮，否则仅最后完成轮。`Lody:packages/shared/src/acp/history-apply.ts` 从 update `_meta.lody.turnId` 写入 `acpTurnId`。

**F-N2（非基本 F1 前置）。** 任意历史切点 fork 是未授权扩展，不是原计划“fork 出新会话”的额外强制门禁。若请求携带 turnId，必须取得“Lody 所选完成轮 → 稳定 turnId → OMP 持久 message entryId → 最后保留 entry”的真实关联后才支持；当前 stamping 没有这条关联，不能把 prompt command ID／`msg-N` 当 entryId，也不能忽略 turnId 而做 full fork。当前对该请求明确拒绝，不实现／不宣告 `forkAtTurn`。busy source 的活动轮 fork 同样不在基本 F1 许可内，不因宿主 `supportsActiveTurnFork` 推断原生允许。

**基本验收选为真实 Lody 的最新完成轮 F1。** `cloneHistoryThroughTurn` 在没有 acpTurnId 时仍允许最新完成轮，`AgentClient` 仅在实际带 forkSessionTurnId 时要求 forkAtTurn。F1 合成覆盖冷／热源、精确身份失败、取消／busy、前后台未结算、MCP、新旧 usage scope 和子任务清理；N 核对新旧持久文件、完整上下文及原文件不变。真实 Lody 在无 turnId 的最新完成轮 fork，在新旧会话继续追问，宿主可见历史须与原生完整快照一致。若实际分支带 turnId，必须如实拒绝／阻塞该入口，不能清除字段骗走 F1 分支；有／无 turnId 分别留证。正确通过这些证据的基本 F1 可满足原用户 fork 底线，不以任意历史轮能力缺失继续阻塞；扩展 F2 以后另行核对。

## UX-I — 图片编码与失败

**S／P／H 观察。** SDK `ContentBlock{type:'image',data,mimeType,uri?}` 的 data 是 base64；OMP `prompt{message:string,images?:[{type:'image',data,mimeType}]}` 接收相同内联数据，image-only 可被原生 admission 接受。`Lody:apps/cli/src/lib/session-image-download.ts` 实际从下载字节生成 `data:bytes.toString('base64')`，不需要适配器凭 uri 再下载。

**拟合同。** 文字沿用现有拼接语义；图片保持输入图片顺序，直接映射 `{type:'image',data,mimeType}`，data／mimeType 原样转发，不把 base64 当文字、不重复编码、不读 `uri` 路径或抓 URL、不落盘。保留 image-only prompt；含 audio／resource／embedded context 等未支持块时整请求拒绝，不先发送纯文字部分。已发布声明没有 MIME 白名单、自设图片上限或额外编码 validator 的要求，本片不增加这些前置。明确不支持 image 的原生模型不能静默丢图；按真实模型／端点错误失败，不回退文字重试。

**I-N1。** 目标 N 只核对实际 admission、模型能力／端点拒绝、文本加多图／纯图、已有传输硬边界与取消／EOF 顺序。`rpc-frame.ts` 的 v1 输出限额不能推导输入图片上限，`rpc-input.ts` 本身只是 JSONL parser。当前 `src/rpc-transport.ts` 没有 v2 reassembly，不未经合同核对切换协议版本；若实际存在明确的协议／传输硬限制，依据该证据处理错误，不凭常见 MIME 或自设容量制造规格门槛。

**能力／验收。** R3 后仅宣告 `promptCapabilities.image=true`，embeddedContext 仍 false，无新 Core image 能力。合成测试覆盖精确原生 JSON、保序、不重复编码、混合未支持块原子拒绝、纯图／多图及原生失败不降级；只对有证据的传输硬边界增测试。N 使用合成小图及受控本地端点核对原始字节、admission／拒绝／取消及结算，再真实 Lody 上传单图／多图／纯图并看到回复，错误不挂起、不假成功。目标运行仍是前置，但不要求先发明额外 validator／白名单／限额策略。

## UX-M — 模型列表、选择与读回

**S／P／H 观察。** `get_available_models` 等 registry refresh 后返回 `{models}`；Model 有 `provider,id,name,input`，`set_model{provider,modelId}` 返回所选 Model。标准 `setSessionConfigOption{sessionId,configId,value}` 返回完整 `configOptions`；通知为 `session/update.update.sessionUpdate='config_option_update'`。`Lody:apps/cli/src/agent/acp-capability-normalization.ts` 从 category=`model` 选项提取真实模型列表；`AgentClient.setSessionConfigOption` 消费返回列表并更新状态，不需要一个不存在的“modelSwitch”能力。

**拟合同。** new／load／resume／fork 的配置来自真实状态及模型列表。保持现有 `id:'model',category:'model',type:'select'`；value 可沿用现有 `provider/id` 表示，但必须用当次列表的 **value → 原始 provider/id 对** 映射，不 `split('/')` 猜边界；若拼接冲突不能选错模型，应拒绝该歧义并阻塞该列表合同。接受当前 session 的 `configId:'model'` 和已列 value；未知 value／其他 configId／忙碌或切换中请求明确失败。`set_model` 成功后 `get_state` 核实同一 sessionFile 与实际模型，更新完整选项、入队 `config_option_update`，排空后响应；回读失败／模型不同不返回请求值伪装成功，要求重新准备明确状态。失败不提前改 UI 投影。模型切换不重置 usage accumulator／scope，后续 usage 按 terminal message 自己的 provider/model 归属。

**验收。** 合成覆盖两 provider 同名模型、含 `/` 的 id、未知／冲突值、取消及 session identity mismatch、native set 失败、回读不一致、连续 A→B→A。M-N1 实跑两种隔离配置的可用模型，核对选项、原生返回及下一轮实际 provider/model；无真实第二模型不能把单模型回显算切换通过。真实 Lody capability refresh 可见列表，下拉 A→B→A 后跨轮与原生续聊保持一致，失败不显示未生效值。没有独立模型 capability 键；R3 审核同时覆盖 configOptions 的对外承诺。

## UX-T — 标题入口与能力语义，不偷换自动生成

**S／P 观察。** `set_session_name{name}` trim／拒空、以 source=`user` 写入，成功无 data，handler 不主动推标题。已有 `/rename <title>` 可经普通 prompt 处理并调用 `notifyTitleChanged`，发原生 `{type:'session_info_update',title,sessionId}`；无参 `/rename` 可能生成标题，帧本身不标来源。SDK 1.3.0 没有标准手动 set-title Agent 方法，Core 0.1.8 `sessionTitle` 表示**适配器拥有自动生成并主动推送**，不是手动改名按钮能力；RPC 默认 autoTitle=false。

**选定的已有入口 T1。** 显式 `/rename <title>` 是可研究的现有普通 prompt 入口，不造 `_lody/set_title`／自定义 config 字段。只在确知是用户给定非空标题、同一精确父会话、原生成功且 `get_state.sessionName` 读回确认后，推 ACP `session_info_update`，在 `update._meta.lody.titleSource` 标 `explicit`；不得把任意 native title 帧／无参生成／fallback 标成 explicit。取消／失败／切换后迟到标题不推成功；通知排空后才完成这条控制 prompt。原生 `set_session_name` 只可作为获核对入口的内部翻译，不能仅注册一个没人调用的函数算完成。

**基本入口就是 T1，不要求新增双向 UI RPC。** 原计划改标题可由显式 `/rename <title>` 在真实 Lody 正确显示并持久化满足；直接 UI→OMP 双向同步和 adapter 自动标题均为未授权可选扩展，不是本片门禁。`Lody:apps/cli/src/agent/lody-acp-extension.ts` 没消费 `sessionTitle`，`Lody:packages/shared/src/ai.ts:acpOwnsSessionTitleGeneration` 依身份表；本片不宣告自动生成 ownership，也不把 generated／无参 rename 偷标 explicit。

**T-H1：显式来源在最终消费链丢失，需 Lody 修补。** `AgentClient.handleAgentSessionTitleUpdate` 虽接受 explicit，但随后 `onSessionTitleUpdate(title)` 仅回调字符串；`Lody:apps/cli/src/session/session.ts`／`session-manager.ts` 的 callback／事件也只传 title。`Lody:apps/cli/src/lib/message-handler.ts:maybeStoreAgentSessionTitle` 最终统一 `setTitleIfSourceIn(title,'generated',['draft','generated'])`；`Lody:apps/cli/src/lib/loro/doc.ts:setTitleIfSourceIn` 因而拒绝覆盖已有 user 标题，接受的 explicit 也被存成 generated。OMP RPC 改名成功不等于这条链已持久化显式用户名。

主 Agent 已选语义：**最新显式用户改名覆盖此前旧 user／generated 标题；晚到 generated 不覆盖它；用户在该 rename 提交之后又直接改名，以后一次用户操作为准。** 最低宿主交付是把已发布 `_meta.lody.titleSource:'explicit'` 从 AgentClient 保留到最终写入、按用户来源存储，并保护操作顺序；不新增 wire 字段。当前所读 callback 没有携带稳定操作／标题 revision，`setTitleIfSourceIn` 只按来源保护，不能区分两个 user 操作的先后。本修订尚未证明现有 Lody 稳定 turn 上下文或标题 revision 能关联 rename 的提交与异步写入，**该竞态关联是具体宿主前置／设计阻塞**；不能借用 OMP 内部 `sessionManager.titleRevision` 当作已发布的宿主字段，也不能仅把 allowedSources 加 user 就声称解决。

**验收。** 合成 T1 的显式输入／回读／来源标记／通知顺序，空参生成不得伪装显式，覆盖空白／失败／旧会话。Lody 侧补先有 UI user 标题再显式 rename、晚到 generated、rename 提交后用户再次改名、事件重复／重排及最终 source=user 的持久化测试，使用真正存在并已核对的顺序保护。T-N1 再核对 `/rename` admission、原生 state 持久化／重启及通知先后；真实 Lody 的列表／会话头／重开都保持正确最新显式名称。T-H1 是实际消费缺口，不是缺二进制，也不要求双向 UI RPC；仅 RPC ACK 或仅 AgentClient 接收不算通过。

## UX-S — 子 agent ID、状态、通知与单子树取消

**S 观察及限制。** CLI 的 per-root 事件总线传给 RPC registry，不是每帧都有 rootSessionId。帧是 `{type,payload}`：lifecycle 用 `payload.id`，progress 用 `payload.progress.id`，不是人类名 `agent`。`handleLifecycle` 先校 owner；无 roster 仅 `started` 可建立，terminal 删除 roster；`handleProgress` 先拒 stale、要求 roster，再校 owner。`hasSameOwner` 优先比较双方都有的 parentToolCallId，其次双方都有的子 sessionFile，两者都无法比较会放行，不是完整 provenance。raw `handleEvent` 不具同等 roster／owner 校验，选 `set_subagent_subscription{level:'progress'}` 即足够状态，不依赖 raw 子事件。子 `message_end` 永不计入父 usage。

`clear()` 的实际行为是先把 roster／retained transcript IDs 加入 stale，再清空 **两张表**；new／switch／branch／fork 成功才 clear。这里纠正研究摘要中“retained references 不全部擦除”的错误，以固定源码 `RpcSubagentRegistry.clear` 为准。新 started 可复用原生 id，适配器仍必须隔代。

**一次可证明执行一个 taskId／carrier。** 反向表概念键为 `(runtime-instance,精确父sessionFile,会话generation,nativeSubagentId,可证明的本次执行身份)`，不只按 child id／子 sessionFile。固定源码 `task/executor.ts:3664-3704` 对既有 child 的 follow-up 重新建 monitor 并发 started，child id／文件可不变；同一 taskId 在 Lody 的终态单调合并及 history dispatch 会被留在旧轮，不能复用来表示新执行。每次**可证明的新执行**建新 taskId／carrier，旧实例保持终态；取消反向表还必须确认 task 对应当前执行，旧 task cancel 不得杀新执行。adapter 可生成 opaque 关联 ID，但本地 counter 不提供原生执行 provenance。

**S-ID：执行身份合同未选定，阻塞整片许可。** 优先研究真实 `started` 的 parentToolCallId／父 tool admission／同 child 执行关联，必须能区分重复 started、新 follow-up、旧执行迟到 progress／terminal；当前 payload 没有已核对的独立 execution ID，不能只按“再见一次 started”递增本地号。缺可证明关联时既不把新执行吞进旧终态，也不让旧 terminal 结掉新实例；需要单独核对来源／顺序合同，而非仅记“等 N”。无可证明父 tool 映射时 `parentToolCallId` 可省略，不要求新建全量工具桥；无法证明 task 属于哪个父执行轮时仍阻塞。

获许可后的状态／carrier 合同：`kind:'subagent'`；started／running → `in_progress`，pending → `pending`，completed → `completed`，failed／aborted → `failed`（aborted 保留取消说明，不编 cancelled enum）。每执行首次 ACP `tool_call`，后续 `tool_call_update`，稳定 carrier `toolCallId` 与 `update._meta.lody.task={version:1,taskId,kind,status,...}` 一起保持不变；终态不被迟到非终态复活。description／actor／modelId／parentTaskId／usage／timestamps 只在来源明确时填，缺 started 时间不取 lastUpdate 冒充。S-N1 在 S-ID 合同选定后验证真实 owner／开始先于进度／终态／切换顺序，不以名称猜任务。

**取消。** 已发布 `_lody/subagents/cancel{sessionId,taskId,reason?}` 经 SDK `Agent.extMethod` 按 Core 方法名规范化路由；先精确校父 session、反向表及**当前执行实例**，再 `cancel_subagent{subagentId}`。原生要求 roster running/pending、registry live sub ref 及相同子 sessionFile，但这些不足以区分同 child 的不同执行；S-ID 未解不许可该路由。原生 `cancelled:true` 仅返回 Core `{}`，不自行推成功终态；已知同执行的 `cancelled:false` 映射幂等 `{}`，表示没有发起取消，不伪造 cancelled=true／任务终态。未知／旧 scope 或旧执行 task 明确拒绝，不能操作新实例；原生错误向调用者失败，不改父 prompt 或执行 whole-session abort。UI 等真实 lifecycle／progress，缺终态不能凭 ACK 合成。

**能力／H。** 最低能力为 `_meta.lody.subagents={version:1,lifecycle:true,cancel:true}`，仅在相应 N／R3 通过后宣告；本片不因看见上游命令就宣告 `list/output`。Core list 的必填时间／扩展 status 与 native snapshot 不同，output 还涉及 child transcript 读取权限，缺独立映射保持不宣告。真实消费者 `Lody:packages/shared/src/acp/claude-subagent-task.ts:parseLodyTaskMeta` 与 `history-apply.ts` 只在 tool carrier 上落为 `subagent_task`，按 taskId 合并。`Lody:packages/components/src/components/ai-gui/subagent-task-panel.tsx` 展示 pending／in_progress／completed／failed；`view.tsx` 以精确父 turn 和 machine subagentCancellation v1 发取消，`Lody:apps/cli/src/session/session-execution-service.ts` 拒绝旧 turn，`AgentClient.cancelSubagent` 再检查 cancel capability。机器侧 capability 不是 adapter 可宣告的新键。

**验收。** 合成 started→progress→terminal、completed→同 child follow-up→新 task、重复 started／旧实例迟到 terminal、旧 task cancel、跨 scope 同名 ID、owner 缺失、取消竞态与通知失败；不能把身份不明确样例改成易通过的不同 child。N 真实产生两个子 agent，只取消一棵、另一棵及父继续；复用同 child 再执行，核对新 task 与父轮、旧取消不命中新执行，切换后旧帧不串会话。真实 Lody 面板新执行正常显示 Running，旧终态不复活／不吞新执行，单子取消不触发父 Stop；缺 machine capability／attribution 仍精准阻塞，不用终端日志替代。

## UX-B — 后台 bash／async task 与 settlement

**S 观察。** bash 起后台时 `result.details.async={state:'running',jobId,type:'bash'}`；后续 `partialResult.details.async`／更新可给 completed／failed／cancelled。`#startManagedBashJob.report` 在 tool_execution_end 后仍可发更新，agent loop 的 `onDetachedToolUpdate` 经 external event 继续传出。`AsyncJob` 另有 ownerId／agentId，但不是每个 RPC 帧都提供，不得凭内部 manager 接口假装远程可查询。`session_settled` 是全会话无 wakeup，不代表某个 job 的 terminal。

**拟合同。** 从已核对的 `tool_execution_start/update/end` 与 `partialResult/result.details.async` 提取真正 jobId／state／type，Core taskId 反向表按 runtime／父 session／generation／native jobId 隔离，和子 agent ID 空间区分。只有 type=bash 的后台执行映为 `kind:'background'`；async task 的执行主体若已有子 agent 任务，必须用 S/B-N1 证明 jobId↔agentId 关联后去重，不按名称把两个 ID 合成一个任务。无关联时不能把一份实际工作显示成两个相互矛盾的状态来关闭底线。

后台状态只按该 job 的原生 `async.state` 映射：running → Core `in_progress`，completed → `completed`，failed／cancelled → `failed`，取消原因保留在 error；不能编 Core 不存在的 cancelled 状态。tool_execution_end 里仍是 running 时 task 继续运行，`session_settled` 本身不替任何 job 写终态。首次 carrier 为 `tool_call`，后续为同一稳定 `toolCallId` 的 `tool_call_update`；终态后的迟到 running 不复活该 task。

**选定的真实输出消费路线。** Core task carrier 的普通 `content` 不作为输出通道：`Lody:packages/shared/src/acp/history-apply.ts:1106-1123` 识别 task 就返回 `subagent_task`，`claude-subagent-task.ts:parseLodyTaskMeta` 不提取 carrier content。将原生这次 `partialResult/result.content` 中 text 块按顺序以换行连接，作为 `_meta.lody.task.summary` 的**最新文本 snapshot**，不是待追加 delta；每次替换本执行上一个 snapshot，不重复拼接旧输出。来源只有 delta 而没有可核对 snapshot 时不能按猜测累加。无新文本字段的状态更新省略 summary、保留上一真实 snapshot；有明确空文本 snapshot 才按源语义更新，终态保留最后实际文本，失败／取消原因另入 error。此处只传原生已输出的文本，不承诺未提供的全量进程日志。

`Lody:packages/components/src/components/ai-gui/subagent-task-panel.tsx` 把 summary 经 meaningfulSummary 送入 row 与详情 result，但目前只要 summary **包含 description** 就整段隐藏。命令回显等真实输出可能因此消失，不能靠 adapter 改写／删掉真实文本或换空 description 躲避。**B-H1 已选最低宿主修补**：对 Core `kind:'background'` 的真实 summary snapshot 保留显示，不使用“包含 description”规则吞输出；仍可单独去掉确证的宿主合成冗余文案。详情与运行行均需更新，终态保留最后 snapshot，验证输出含完整命令／description 时不丢。保留 Core carrier 与串行通知；`parentToolCallId` 只有存在可证明映射时填写，否则省略，不以此要求全量普通工具翻译。

**B-STATE：首次 yield 后 outcome／Stop／归属合同尚未安全选定，设计阻塞。** 固定源码 `rpc-prompt-results.ts:observe/#report` 在第一次 yield 报一次 `prompt_result` 并删除 ticket，不能期待第二个同 ID result。`rpc-session-settle.ts` 最后只发无 prompt ID／status 的 `session_settled`；`agent-session.ts:#hasPendingAsyncWake` 排除 delivery-suppressed running jobs，所以 settled 不是全部 job terminal。当前 adapter 将旧 completed 加 settled=true 后返回 end_turn 的行为，不能据此证明后续失败／Stop 结果正确。

后续必须独立核对并选定：① 首次 completed/false、后续 error、用户 Stop 的最终 outcome 证据及优先级；② 最终无 ID settled 如何归属仍被持有的 ACP prompt；③ quiescence 时仍运行的 suppressed job 如何保留 task／输出归属，若释放 prompt，后续更新怎样回到原父轮而不是当前轮；④ cancel 请求怎样证明真正停止本次所拥有的工作及何时可完成。**未选定前不许可 UX-B settlement 翻译**；不暗改 000 的既定终态合同，不规定凭时间到期成功、凭 ACK 生成 cancelled、无依据覆盖已知错误，或无限等不存在的第二 result／所有 job terminal。

**abort 的观察边界。** managed bash 使用自己的 `runSignal`，显式 async 分支不传父 signal；所读 `agent-session.ts:abort` 调用链未见调用 owner job 的 `#cancelOwnAsyncJobs`。这只说明**已读链尚未证明 Stop 能终止该 job**，不是已实跑残留或绝对不存在其他路径。不能把 `abort` ACK 当 native job stopped，也不能为了通过私自用 client terminal/create 重执行命令、发不存在的单 job kill 或扩大成全会话关闭策略。需先取得可核对的原生控制／处置及失败合同；若现有发布面不足，明确保持 B-STATE 阻塞，真实 N 只能验证获核对合同，不能替代设计。

**能力／基本范围。** `_meta.lody.tasks={version:1,background:true}` 只在 B-H1、B-STATE、对应 N／R1／R3 成立后宣告。基本体验选择现有任务面板的真实 Running＋持续文本 snapshot＋真实终态，不要求独立 PTY／交互终端／单 job kill。SDK terminal/create 是让宿主新执行命令，不是 attach OMP 进程，禁止再执行一次造终端。Core 无 background 独立 kill，面板只对子 agent 提供单子取消；这些可选扩展缺失不额外阻塞本项，但父 Stop 的真实效果及限制必须按 B-STATE 解决并验收。

**验收。** 合成及 N 分别覆盖 tool end(running)→yield→多次输出 snapshot→真实终态、输出含 description、同 ID 不重复追加、多 job 与 async child 去重；另覆盖 completed/false→Stop→无 status settled、后续执行 error、suppressed running job、prompt 完成后旧 task 更新、下一轮同名 task、通知失败／EOF。用真实隔离本地命令核对 Stop 实际终止范围，不以 ACK／settled 合成 job 成功或取消。真实 Lody yield 后仍看到 Running／实际输出，终态不丢最后输出；若释放 prompt，旧 task 的迟到更新不能挂新轮。未解决 B-STATE 就不写“只待运行验证”，也不以截图或 synthetic settlement 关闭。

## 备选与决策

| 方案 | 决策 |
| --- | --- |
| 先打开全部能力，让 Lody 能调用，再补真实证据 | 不采用：绕过 R2／R3，把能力 bit 当测试开关。 |
| 保持已选用户底线，拆未宣告实现／矩阵／宣告／真实 UI；缺 interface 精确阻塞 | 采用：消除 R0-001 循环；R0-002 的未选定合同单列设计阻塞，不让实施者猜，也不把它们统一改名为“待 N”。 |
| 借未来 SDK／workspace Core、OMP 私有字段或新 `_lody/*` 方法补齐标题／后台 | 不采用：不是已发布消费合同，且未经跨仓库审核。 |
| 只交原生 fork／标题 RPC ACK、子任务日志或 synthetic usage 后宣布 V1 | 不采用：基本 F1、显式 rename 与后台任务面板可以满足原范围，但必须真实 Lody 可用；不增加历史轮、双向标题 UI 或 PTY 的新门禁。 |

难以回头的决策：精确 fork 身份／轮切点、usage accounting lifetime、task ID 的跨重连归属、标题生成 ownership、能力宣告。它们分别有独立前置，不允许一个切片的许可外溢。

## 允许独立核对的结论与未解除前置

| 前置 | 目前结论 | 解除所需证据 |
| --- | --- | --- |
| 本修订独立核对 | UxSpecRoundOne 两轮完整复核已完成；文档修订无新增发现，不等于 UX 实现许可 | 基本 F1／I／M 仍须目标运行前置及点名许可；其余切片先解除下列设计阻塞。 |
| N：目标二进制／隔离运行 | 限定盘点两台在线机器：本机仅定位 18.8.4；另一 Mac（Darwin 25.6.0／arm64）仅定位 18.11.0／18.10.0，未定位 18.12.2／18.12.1／18.2.8，且无本仓库／Lody checkout。不是全盘绝对不存在；未下载。 | 维护者已有的可核验目标 runtime 和隔离本地端点；历史 PR #17 不替代新切片证据。阻塞目标运行及原定实现前置，不阻塞纯规格研究；同样不能用 N 掩盖以下设计缺口。 |
| R2 父 usage provenance | 源码观察未证明；没有新合同许可 | 原生来源关联证据或单独独立核对的合同变更。 |
| U-H1／U-H2 | eligibility／scope 消费／本轮起点、封账、迟到修正、UI 合同未选定，不许可实现 | Lody 真实身份通过入口、稳定 accounting／轮消费与 UI 合同及测试；现有 accountingId 仅待审选项，不新造云 API。 |
| S-ID | 同 child 后续执行与旧帧隔离身份合同未选定，不许可实现 | 可证明 execution identity／顺序及当前实例取消校验；本地 counter 不当原生 provenance。 |
| T-H1 | 显式来源到最终持久化丢失；最新用户操作的顺序保护尚无实现证据 | Lody 保留 explicit、按 user 写入并选定现存可用的竞态保护；无需双向 UI RPC／自动生成。 |
| B-H1／B-STATE | 已选 summary snapshot 消费修补；首次 yield 后 outcome／Stop／旧 task 跨 prompt 归属仍未选定 | Lody 不吞真实输出；独立核对 native 结果／控制／最终结算与旧轮路由，不能只加待 N。 |
| I-N1／M-N1／T-N1／S-N1／B-N1 | 尚无目标运行证据；I/M 与修订后的基本 F1 主要欠运行前置，其他片还须先解除设计阻塞 | 各节真实字段、失败与顺序记录；不要求自设图片 validator。F-N2 只对另行授权的历史切点扩展适用，不阻塞正确验收的基本 F1。 |
| R1／R3／R-UX-B | 新候选尚未完成 | 当前候选受影响矩阵、全量 initialize 断言、独立 source/tests 审核、逐项 Lody 表面证据。 |

## 首轮修订交接：不把修文等同关闭 R0-002

**已修文字／范围（已由第二轮完整复核）**：R0-002-F 去除历史切点对基本 F1 的强制门槛，带 turnId 仍拒绝而非忽略；R0-002-I 去除图片白名单／自设限额／validator 前置；R0-002-T1 采用显式 rename 基本入口，双向 UI／自动生成不必做。B1 明确 summary snapshot→真实 panel result，父 tool 映射可省略，不扩成普通工具桥／PTY／单 job kill。

**已补事实但仍未决的设计**：R0-002-U1 的实际 OMP identity eligibility、U2 的本轮聚合／封账／迟到修正／UI；R0-002-T2 的 explicit 持久化与已选最新用户操作语义的竞态保护；R0-002-S 的 child execution identity；R0-002-B1 的宿主去隐藏修补尚未实现，B2 的结果／Stop／后续错误／跨 prompt 任务归属尚未选定。这些均不自称已解决，不授予实现／宣告许可。

**未验证**：所有新 UX 的目标 OMP／实际 Lody 运行、宿主修补、R2、当前候选矩阵与能力宣告均未通过本轮证明。九项文档修订已完成第二轮独立复核，没有修文后未复核的条目；R0-001 的顺序循环两轮确认解除，R0-002 保持未关闭。

起草者的本次规格修订只改本文件，未改 `src/`／tests／根文档／原计划正文，未下载 OMP，未运行 build／lint／tests／formatter／smoke／contract。主 Agent 随后仅回填核对结论和总计划允许变更的核对栏／修订记录。运行验证仍逐项标真实／合成／设计未决／未验证；最终行动记录按原计划时点编写。

## 第二轮独立核对结论

2026-10-24，非起草者 UxSpecRoundOne 重新完整审查修订稿及首轮九项发现，无新增文档问题。已查包括固定目标源码、已发布 SDK／Core，以及 Lody 实际计费、标题、任务消费链；未运行目标 OMP／Lody，未验证云端私有对账、其他 OS 或发布字节。源码观察不等于运行证明。

基本 F1、图片和模型的合同方向可以进入后续采证，但当前仍无 UX `src/` 实现许可。U-H1／U-H2、T-H1 顺序保护、S-ID、B-STATE 保留设计阻塞；B-H1 已选方向但未实现。没有授予 R2／R3、Lody 跨仓代码、R4／R5 或 R6 许可，不能据本次文档审核宣称 Release 完成。
