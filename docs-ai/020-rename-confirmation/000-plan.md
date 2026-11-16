# 020 — 显式 /rename 成功后的确认文字：计划

| | |
| --- | --- |
| **状态** | 已实现，见 [001-action.md](001-action.md) |
| **锚点日期** | 2026-11-16 |
| **规格核对** | 2026-11-16，非起草者的独立复核 agent（Opus，只读）两轮复核全文。第一轮带条件允许，提出 P20-001 至 P20-006；起草者修订后第二轮确认六条全部已解决，新增建议 P20-007 已写入测试表下方，明确「允许实现」。两轮都没有运行测试或构建，Lody 侧只核对了可见性判定、静默失败和标题生成。起草者按其结论登记，没有自批。 |
| **相关** | [015 模型配置 M 与显式标题 T1](../015-model-explicit-title/000-plan.md)、[011 通知失败及时关闭](../011-notification-failure/000-plan.md)、[README](../../README.md) |

## 背景

2026-11-16 用户在真实 Lody 开发构建（Lody 检出分支 `feat/omp-adapter`，提交 `6adb42a71`，`LODY_OMP_ADAPTER_PATH` 指向本仓库 `dist/index.js`，OMP 18.20.2）里发 `/rename 测试标题`：

| 观察 | 来源 |
| --- | --- |
| 标题确实改了 | Lody 当日日志有 `Session title updated from agent: 测试标题` |
| 界面同时报错 `agent_no_output`（“The agent ended the turn without producing any output”） | 用户贴出的错误详情 |
| Lody 只把非空 `agent_message_chunk`、非空 `agent_thought_chunk`、`tool_call`／`tool_call_update`、markdown `plan_update` 和子 agent 输出算作可见输出；`session_info_update` 不算 | Lody 检出 `apps/cli/src/lib/message-handler.ts` 的 `isVisibleACPUpdate`（只读观察） |
| 适配器的显式标题成功路径只发一条 explicit `session_info_update`，然后 `end_turn` | `src/connection.ts` 的 `completeTitleControl` |
| OMP 原生在改名成功后给用户反馈：`Session renamed to "<名称>".`（TUI 状态）和 `Session renamed to <名称>.`（命令输出） | OMP 18.20.2 可执行文件内嵌源码的字符串（只读观察） |
| RPC `set_session_name` 的响应只有 `success`，不带这句反馈 | 隔离 profile 下对 OMP 18.20.2 的直接 RPC 观察 |

所以这次 turn 在 ACP 层是成功的，但没有任何宿主认为“可见”的内容。015 当时把「不合成 assistant」写进了 [README](../../README.md)，015 计划写的是 TitleControl 不拥有 assistant 输出、不产生 `agent_message_chunk`。

用户 2026-11-16 裁决：在适配器这边加确认文字，不改 Lody。本条目依这个裁决覆盖 015 和 README 的「不合成 assistant」；这不是 015 原本就允许的行为。015 对改名期间 native 消息帧的排除不变。

## 目标

- 显式 `/rename <标题>` 在 015 的全部核实通过、explicit `session_info_update` 发出之后，再发一条 `agent_message_chunk`，然后才完成 prompt。
- 文字固定为 `Session renamed to "<名称>".`，其中 `<名称>` 是 `get_state` 读回的 `sessionName`，不是用户输入的原文。
- 可见顺序固定：标题通知，确认文字，prompt 响应 `end_turn`。
- 没有改成功就没有确认文字。

### 非目标

- 不改 Lody 的静默 turn 守卫，也不为 Lody 单独开分支逻辑。
- 不本地化这句文字，不让模型生成它。
- 不转发改名期间的 native 消息帧。015 对 native 帧归属、usage 和 accumulator 的排除全部保持。
- 不改无参 `/rename`、混合内容或非 literal 形式；它们仍走普通 native prompt。
- 不把确认文字写进 OMP 的会话文件。
- 不处理同日发现的“fork 时工作目录不同，OMP 拒绝切换会话”；那是另一件事。

## 方案

改 `src/connection.ts` 的 `completeTitleControl`，只动成功提交之后的通知段：

1. `control.committed = true` 之后仍然只排一个通知任务。任务里先发 explicit `session_info_update`，等它成功返回，再发 `agent_message_chunk`，内容是 `{ type: "text", text: 'Session renamed to "<sessionName>".' }`。两条通知的 `sessionId` 都取 `control.sessionFile`，不取 `this.sessionId`。
2. 两次发送之间重新判一次 `this.failure || this.titleControl !== control`。标题通知抛错时任务直接失败，确认文字不会发出。
3. 之后沿用现有的排空循环和 `end_turn`。通知发送失败沿用 011 的路径：关闭 RPC／ACP，prompt 失败，不兑现成功。
4. 确认文字不经过 `forwardMessage`。它不登记 `messageGenerations`，不碰 `SessionUsageAccumulator`，不发 usage 通知，也不参与普通 prompt 的 assistant 消息分段。
5. 取消语义不变：提交前取消得到 `cancelled`，两条通知都不发；提交后的 late cancel 只等这两条通知排空，仍是 `end_turn`。

测试先行，先看到红再改 `src/`。要改和要加的断言：

| 位置 | 断言 |
| --- | --- |
| `test/server.test.ts`「publishes only a verified explicit title from a literal rename prompt」 | 真实 SDK 路径上，`agent_message_chunk` 从“没有”改为恰好一条，文字是 `Session renamed to "用户 标题 / A".`；它排在标题通知之后、prompt 响应之前；usage 仍为空；发给 OMP 的命令序列不变 |
| `test/server.test.ts`「uses the native persisted readback」 | 确认文字用清洗后的读回值，包括同名改名 |
| `test/connection.test.ts`「isolates every unrelated native output and completion while title %s is held」 | 新增一个挂在确认 `agent_message_chunk` 上的阶段 `confirmation`。各阶段结束后，这次控制产生的更新恰好是标题通知加确认文字，两条的 `sessionId` 相同、顺序固定；挂起期间注入的无关 native 文本仍不被转发。末尾对全部文本块的断言从两条普通回复改为中间多一条确认文字 |
| `test/connection.test.ts` local cancel 参数化测试（prompt 文本 `/rename Local cancel boundary`） | 新增 `confirmation` 阶段：确认文字挂起时取消，结果仍是 `end_turn`，两条通知都送达。`notification` 阶段同样要等确认文字排空。提交前取消的三个阶段没有任何通知 |
| `test/connection.test.ts`「fails globally on EOF while title %s is held」 | 新增 `confirmation` 阶段：确认文字挂起时 EOF，prompt 失败，`failures` 恰好一条 |
| `test/connection.test.ts` 失败路径（`titleFailures` 表） | setter 失败、名称不一致、身份失败：仍然没有任何通知，包括确认文字。现有 `expect(p.updates).toEqual([])` 保持 |
| `test/connection.test.ts` 新用例：标题已送达、确认未发出时失败 | 标题通知返回后立刻关闭连接：更新里只有标题，没有确认文字，prompt 失败，`failures` 恰好一条 |
| `test/connection.test.ts` 新用例：通知发送抛错 | 标题通知抛错时不尝试发确认文字；确认文字抛错时 prompt 失败并关闭，不返回 `end_turn` |
| `test/server.test.ts` 新用例，仿照「fails and reaps … when the explicit title output write rejects」 | 真实 SDK 路径上只让确认 `agent_message_chunk` 写入失败：ACP 关闭，没有成功的 prompt 响应，OMP 进程组被回收 |

`confirmation` 阶段的 gate 按确认文字的内容匹配，不只看 `agent_message_chunk` 类型，免得挂住普通回复。「标题已送达、确认未发出时失败」用例在标题通知的 handler 内同步关闭连接，保证关闭排在第二次守卫之前。

文档：

- `README.md` 的显式标题段落把「不合成 assistant」换成对确认文字的描述。
- 提议新建 `docs-ai/015-model-explicit-title/004-rename-confirmation.md`，说明 015 里“TitleControl 不产生 `agent_message_chunk`”继续约束 native 帧，适配器自己的确认文字由本条目决定；并在 015 的 `000-plan.md` 修订记录追加一行指向它。
- `docs-ai/README.md` 的索引在建本条目时就加一行。
- 实现后写本目录的 `001-action.md`（提议）。

## 备选与决策

| 备选 | 结论 |
| --- | --- |
| A. 适配器在核实成功后发一条确认 `agent_message_chunk` | 选。OMP 原生本来就给这句反馈，只是 RPC 响应不带；任何 ACP 宿主都能看到结果；改动只在成功提交之后 |
| B. Lody 对“只有标题更新的 turn”放行 | 用户裁决不走。别的宿主仍然看不到反馈 |
| C. 改发 `agent_thought_chunk` | 不选。这不是思考内容，宿主可能折叠或隐藏 |
| D. 合成一组 `tool_call` 表示改名 | 不选。没有对应的 native 工具调用，等于伪造工具生命周期 |
| E. 让 `/rename` 走 native prompt 拿原生输出 | 不选。015 已否决：会触发原生 card 生成和 input hook，也拿不到精确读回 |
| 文字沿用 OMP 原生 TUI 文案，英文固定 | 选。适配器不做本地化；沿用原生文案就不用另造措辞 |
| 文字里带标题 | 选。让用户看到清洗后的实际名称。标题含 Markdown 记号时宿主可能按 Markdown 渲染这一条，只影响这句确认的显示，接受 |
| 标题通知和确认文字放在同一个排队任务里 | 选。顺序固定，标题通知失败时确认不会发出；拆成两个任务也能做到，但多一个需要分别守卫的排队点 |

难以回头的地方：

- 确认文字会进入宿主保存的会话记录。以后改文案不会改旧记录。
- 这句文字只存在于宿主记录里，OMP 的会话文件和模型上下文里没有。resume 之后宿主看得到它，模型看不到。它不是模型输出，这个差异可以接受，但以后做 `session/load` 历史重放时要记得它不在 native 文件里。
- 这是对 015 已审查行为的修改，README 的翻译面描述随之改变。
- 部分投递：标题通知已经送达宿主之后，确认文字发送失败，或两次发送之间连接失败，宿主可能已经应用了 explicit 标题，而这次 prompt 以失败结束。OMP 里的名称也已经改了。这和 011 接受的“部分成功后失败”是同一类结果，不回滚。

## 验收

- `npm run check`：新增和修改的断言先在未改 `src/` 时失败，实现后全部通过。
- `npm run build`。
- 隔离 profile 加本地回环模型，对真实 OMP 发 `/rename`（临时脚本，不进仓库）：观察到标题通知、确认文字、`end_turn` 的顺序；回环端点收到 0 个模型请求；会话文件路径不变。
- 用户在 Lody 开发构建里重发 `/rename <标题>`：标题更新，看到确认文字，不再出现 `agent_no_output`。这一步只有用户能做。
- 非实现者独立审核至少两轮。

本改动会改变发布字节。`COMPATIBILITY.md` 里通过的矩阵行是在 `d6362de` 上取得的，发布提交上要重跑；那属于发布门禁，本条目不声称它通过。

## 修订记录
