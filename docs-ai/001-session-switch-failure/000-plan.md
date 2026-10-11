# 001 — 会话切换失败后的身份失效：计划

| | |
| --- | --- |
| **状态** | 已实现 |
| **锚点日期** | 2026-10-07 |
| **规格核对** | TommyWu 于 2026-10-07 核对目标、非目标、备选方案、不可逆影响和验收证据，并明确允许按 fail-closed 方案实现。 |
| **相关** | [`AGENTS.md`](../../AGENTS.md)、[`COMPATIBILITY.md`](../../COMPATIBILITY.md)、[`TESTING.md`](../../TESTING.md)、[`src/connection.ts`](../../src/connection.ts)、[`test/connection.test.ts`](../../test/connection.test.ts) |

## 背景

`OmpRpcConnection.openExactSession()` 当前先对请求的 native session 路径执行 `stat()`，之后才清空已有 `sessionId`。如果请求的文件不存在或为空，校验会在发送 `switch_session` 之前失败；已有 ACP identity 因而仍保留，旧 session 可能继续接受 prompt。

这与仓库的 fail-closed 约束不一致：session 切换失败后旧 ACP identity 必须失效，缺失或空 native session 必须拒绝，不能继续使用不再确认的旧身份。

## 目标

- 对 exact `load`/`resume` 的任何失败切换，先使旧 ACP identity 失效。
- 保持缺失、空文件和 native identity mismatch 的拒绝行为。
- 用回归测试证明失败后旧 sessionId 不能再 prompt。

### 非目标

- 不改变 OMP RPC 的 `switch_session` 协议或错误文本。
- 不改变成功切换、`newSession`、prompt/cancel 或 usage 逻辑。
- 不在本条目实现 Lody provider、runtime manifest 或 artifact。

## 方案

在 [`src/connection.ts`](../../src/connection.ts) 的 `openExactSession()` 进入受保护的切换流程后，执行 native 文件检查前清空 `this.sessionId`。保留 `sessionChanging` 互斥，使文件检查、RPC 切换和状态确认期间 prompt 都被拒绝。已有的 exact identity 校验继续负责拒绝 OMP 选中不同文件的情况。

在 [`test/connection.test.ts`](../../test/connection.test.ts) 增加回归用例：先建立可用 session，再请求缺失或空 native session；确认切换请求失败，并确认旧 sessionId 的 prompt 以 identity 错误拒绝。测试先观察当前实现失败，再修改源码。

## 备选与决策

- **保留旧 identity，只有 `switch_session` 已发送后才清空**：可以让文件预检失败后继续使用旧 session，但与“失败切换使旧 ACP identity 失效”的 fail-closed 合同冲突，排除。
- **切换失败后恢复旧 identity**：会让调用方继续使用未被本次失败切换重新确认的 session，错误边界更隐蔽，排除。
- **在预检前清空 identity**：失败后不可继续 prompt，且现有 `sessionChanging` 保证切换过程不接受 prompt；选择此方案。

## 验收

- 新回归测试在当前实现上因旧 prompt 未被拒绝而失败。
- 最小修改后该回归测试通过。
- `PATH=/Users/tommywu/.nvm/versions/node/v22.22.3/bin:$PATH npm run check` 全部通过，测试数量增加且不减少既有覆盖。
- `npm run build`、`npm run smoke`、`npm run contract` 和 `npm pack --dry-run` 继续通过；contract 仍使用隔离 profile 和 loopback-only synthetic model。
- 不发布 artifact，不修改 Lody 工作树，不推送共享分支。

## 修订记录
- 更新于 2026-10-07：完成预检前失效旧 ACP identity 的实现与验证 — 见 [001-action.md](001-action.md)

（计划核对后追加行动记录或修订文件。）
