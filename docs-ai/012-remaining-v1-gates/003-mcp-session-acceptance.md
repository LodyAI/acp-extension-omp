# 012.003 — 为 Lody 测试收下 MCP 列表

## 背景

不加垫片时，Lody 会话建不起来。`main` 上的 `buildBuiltinMcpServers` 在会话同时有 workspace 和 machine 时，给 `session/new`、`session/load`、`session/resume` 附上名为 `lody` 的 MCP。本适配器不宣告 `mcpCapabilities.http`，所以走 stdio。

适配器有两道拒绝。`src/server.ts` 的 `validate` 在列表非空时抛出 `OMP ACP adapter V1 does not support MCP servers`。`src/connection.ts` 的 `rejectMcp` 对 `newSession`、`loadSession`、`resumeSession` 再抛出 `OMP ACP adapter V1 does not support MCP server configuration`。2026-10-11 的桌面端试验停在第一道。`npm run smoke` 和 `npm run contract` 传的是空列表，所以它们测不到这条。

`000-plan.md` 把「实现 MCP 桥」和「收下再丢弃」都写成非目标，并把后者列为不采用的备选。本文件取代这两处里关于会话能否建立的决定。工具桥仍然不做。

## 变更

增加阶段 **R-MCP**，放在 R0 之后、任何不加垫片的 Lody 试验之前。它只让会话能建立。

允许实现并核对之后，行为是：

- `newSession`、`loadSession`、`resumeSession` 接受非空 `mcpServers`，包括名为 `lody` 的 stdio 服务器。空列表保持可用。
- 列表不写入 OMP RPC。`new_session` 仍然不带 MCP 字段，也不把这些服务器交给 OMP。
- `initialize` 继续不宣告 `mcpCapabilities`，也不宣告 load、resume、usage。
- 删掉 `src/server.ts` 的非空拒绝和 `src/connection.ts` 的 `rejectMcp`。两处一起改，避免请求穿过第一道后在第二道失败。
- 同一片更新 `AGENTS.md`：ACP 边界可以收下宿主给的 MCP 列表，但不转发、不把它当成工具桥。没有宿主工具协议和已审查的 Core 能力之前，仍然不做桥。
- 合成测试先写失败用例：非空列表能建会话；发出的 `new_session` 不含 MCP。现有空列表用例保持通过。

这不把 MCP 策略从 Lody 搬进本仓库。Lody 仍决定注入什么。本仓库只停止把这份列表当成致命错误。OMP 因此用不了 Lody 的工具。读文件、取消、用量和进程回收要等会话能建立之后再看，不能把 R-MCP 通过写成那些场景已通过。

完整的 MCP 工具桥仍是以后的独立条目。本阶段不设计 OMP 侧的工具映射，也不改 `MIGRATION.md` 的归属。

实现仍要等非起草者把本阶段标成「已核对」并写出「允许实现」。本文件不授权改 `src/`。

## 引用

[PR #16](https://github.com/LodyAI/acp-extension-omp/pull/16)。

## 当前状态

计划仍是「计划中」。`src/server.ts` 与 `src/connection.ts` 仍会拒绝非空 `mcpServers`。
