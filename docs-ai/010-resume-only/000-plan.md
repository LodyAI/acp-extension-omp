# 010 — 只宣告 session/resume：计划

| | |
| --- | --- |
| **状态** | 已实现 |
| **锚点日期** | 2026-10-18 |
| **规格核对** | Grok Bot（编排代理，非起草者）核对目标、非目标、备选与验收，允许实现 |
| **相关** | [`COMPATIBILITY.md`](../../COMPATIBILITY.md)、[`README.md`](../../README.md)、[`src/server.ts`](../../src/server.ts)、[`src/connection.ts`](../../src/connection.ts) |

## 背景

`resumeSession` 已走 `openExactSession()`：请求的 native `sessionFile` 必须是非空文件，`switch_session` 之后 `get_state` 必须返回同一路径，失败先清空旧 ACP identity。切换期间没有 active prompt，`forwardMessage` 不会发出 `session/update`。`loadSession` 仍不回放历史，不能宣告。

ACP SDK 1.3.0 的 `sessionCapabilities.resume` 用 `{}` 表示支持 `session/resume`。协议要求 resume 恢复会话上下文，并且 **MUST NOT** 在响应前重放历史。`loadSession` 是另一枚布尔旗标。

## 目标

- initialize 只增加 `agentCapabilities.sessionCapabilities.resume: {}`。
- 不宣告 `loadSession`、usage、MCP、`additionalDirectories`、`close`。
- 不改变 `resumeSession` / `loadSession` 的切换实现。
- 测试覆盖：精确能力对象、resume 精确身份、resume 失败 fail-closed、resume 期间不回放历史。

### 非目标

- 不实现 load 的历史重放，不把 `loadSession` 设为 true。
- 不放宽 MCP 拒绝，不读取私有会话文件。
- 不把这次宣告写成生产兼容或完整矩阵通过。
- 不改 `package.json`。

## 方案

[`src/server.ts`](../../src/server.ts) 的 initialize 增加 `sessionCapabilities: { resume: {} }`。`loadSession` 字段继续省略。

[`test/server.test.ts`](../../test/server.test.ts) 和 [`scripts/contract.mjs`](../../scripts/contract.mjs) 的精确 initialize 断言改成同一集合：保留 `promptCapabilities`，加上 `sessionCapabilities.resume`，仍然没有 `loadSession`。

[`test/connection.test.ts`](../../test/connection.test.ts) 增加三条 resume 证据：成功时返回请求的 `sessionFile` 且不调用 `new_session`；缺失或空文件拒绝且不发送 `switch_session`，旧 identity 不能 prompt；`switch_session` 响应前注入 `message_update` 时 host 收不到 `session/update`。

[`COMPATIBILITY.md`](../../COMPATIBILITY.md) 和 [`README.md`](../../README.md) 改为：resume 已按精确切换宣告；load 与 usage 仍不宣告；这不是生产版本声明。

## 备选与决策

- **继续不宣告，等完整矩阵和独立审查**：矩阵证明哪些 OMP 版本跑过，不证明当前 resume 翻译缺少 exact switch 或会重放历史。宿主因此继续走文字回放，丢掉 native 状态。排除。
- **同时打开 `loadSession`**：load 必须在响应前重放全部历史。当前实现没有这条路径。排除。
- **只宣告 `sessionCapabilities.resume: {}`**：与 SDK 1.3.0 schema 和现有 fail-closed switch 一致。选择此方案。

## 验收

- `npm run check` 与 `npm run build` 通过。
- server 测试的 initialize 精确等于新能力集，且不含 `loadSession: true`。
- resume 成功返回请求路径；缺失、空文件、选错文件后旧 session 不能 prompt，且缺失/空文件不发 `switch_session`。
- resume 完成前注入的 text delta 不进入 host updates。
- 不跑 `npm run contract`：它需要本机 OMP，本次不把它写成已通过。

## 修订记录
