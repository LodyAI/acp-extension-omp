# 015.004 — 显式改名成功后的确认文字由 020 决定

## 背景

015 的 T1 规定 TitleControl 不拥有 assistant 输出、不产生 `agent_message_chunk`，`README.md` 当时写的是「不合成 assistant」。2026-11-16 真实 Lody 验收里，只发 `session_info_update` 的改名 turn 被宿主判成没有输出，报 `agent_no_output`。用户同日裁决在适配器这边加一句确认文字。

## 变更

- 显式 `/rename <标题>` 核实成功、explicit 标题通知发出之后，适配器再发一条固定的确认 `agent_message_chunk`。目标、备选和验收见 [020 计划](../020-rename-confirmation/000-plan.md)。
- 这一条覆盖 015 和 README 里的「不合成 assistant」。它不是 015 原本允许的行为。
- 015 的其余规定不变：改名期间到达的 native 消息帧不归这次控制，不转发、不计用量；身份核实、读回、取消顺序和失败处置照旧。

## 当前状态

实现和证据记在 [020 的行动记录](../020-rename-confirmation/001-action.md) 里。`README.md` 的显式标题段落已按 020 改写。
