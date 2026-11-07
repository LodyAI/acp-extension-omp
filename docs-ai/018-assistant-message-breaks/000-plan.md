# 018 — 跨助手消息的段落分隔：计划

| | |
| --- | --- |
| **状态** | 计划中 |
| **锚点日期** | 2026-11-07 |
| **规格核对** | 未核对 |
| **相关** | [009 迟到事件归属](../009-late-event-generation/000-plan.md)、[012 发布门禁](../012-remaining-v1-gates/000-plan.md) |

## 背景

在本地 Lody 桌面端用 OMP 18.12.6 跑一轮会调用工具的 prompt，回答显示为一整段不换行的长文：工具调用前后的几句说明连在一起，句号之间没有分隔。

`src/connection.ts` 的 `forwardMessage` 把每个 `message_update` 的 `text_delta` 原样转成 `agent_message_chunk`。OMP 在工具调用之间输出的是彼此独立的助手消息（不同的 `messageId`，legacy 帧为不同的 `message.responseId`），但 ACP 文本 chunk 不携带消息边界，宿主只能把它们拼接成一段。适配器当前也不转发工具调用，宿主拿不到可用来分段的中间事件。

流程偏差：实现草案已先于本计划写在同一分支 `fix/separate-assistant-messages`，违反「核对后才改 `src/`」。核对通过前该分支不得合并；核对要求改方案时，按核对结果重写实现。

## 目标

- 同一 prompt 内，来自不同助手消息的文本之间出现段落分隔（`\n\n`），宿主按 Markdown 渲染为独立段落。
- 同一条消息内的连续 delta 保持原样拼接，不插入任何字符。
- 每个 prompt 的第一段文本前不加分隔。

### 非目标

- 不转发工具调用，也不宣告任何新能力。
- 消息没有 `messageId` 或 `responseId` 时，不靠猜测插入分隔。
- 不改变用量、终态或迟到帧的归属逻辑。

## 方案

在 `ActivePrompt` 上记录最近一次输出文本的消息键：`messageId` 优先，记为 `message:<id>`；否则用 `message.responseId`，记为 `response:<id>`。键的前缀与 `acceptMessage` 的来源别名一致。新的文本 delta 若带键且与记录不同，就在该 chunk 前加 `\n\n`，再更新记录。记录挂在 `ActivePrompt` 上，新 prompt 自然从空开始。

## 备选与决策

| 备选 | 结论 |
| --- | --- |
| 宿主（Lody）按 chunk 间隔自行分段 | 否：宿主看不到 OMP 消息边界；按适配器边界规则，provider 专用翻译属于适配器 |
| 在 `message_start` 时标记边界 | 否：用户消息和工具结果也会触发，需要额外判断角色；消息键已能直接回答「是否换了一条消息」 |
| 转发工具调用，让宿主按工具行分段 | 范围更大，涉及能力与 UX 合同，留给独立条目 |
| 用单个 `\n` | 否：Markdown 里单换行会合并进同一段，看不出分段 |

## 验收

- 合成测试 `test/connection.test.ts`「separates text from consecutive assistant messages with a paragraph break」覆盖以下情况：同消息拼接、跨消息加分隔、legacy `responseId`、新 prompt 开头不加分隔。去掉实现时该测试失败，加上后通过。
- `npm run check` 通过。
- 真实验证：在本地 Lody 中用 OMP 跑一轮会调用工具的 prompt，回答应分成多个段落。

## 修订记录
