# 011 — 通知失败及时关闭：计划

| | |
| --- | --- |
| **状态** | 已实现 |
| **锚点日期** | 2026-10-17 |
| **规格核对** | 独立 completion reviewer（default，2026-10-17）核对目标、非目标、备选、回退风险和验收，无阻塞，明确「允许实现」。task reviewer 因无默认模型不可用，改用无历史独立上下文核对。 |
| **相关** | `README.md` 的 V1 contract；审计 A03 |

## 背景

审计 A03 已观察到：`host.update` reject 后只保存 `notificationFailure`，prompt 在没有 native terminal 时仍 pending。`host.usage` 使用同一队列。
`prompt()` 还会先等待 prompt RPC ACK，再返回内部结果，因此只 reject 内部 deferred 不足以保证 ACK 尚未到达时的及时失败。

## 目标

- 通知明确 reject 或同步 throw 后立即走现有 RPC／ACP 失败路径，不等 native terminal。
- 关闭 RPC，解除尚未收到 ACK 的请求；ACP server 复用 `abortParent` 回收 OMP。
- 失败后不发送队列后续通知，不产生成功终态，不泄露原始错误内容。
- 保留成功但缓慢通知的严格顺序及稳定排空。

### 非目标

- 不修 A01、A02 或其他审计条目。
- 不引入超时、重试、新能力、SDK 替换或进程回收策略。
- 不修改 `package.json`，不执行 Git 写操作。

## 方案

- `src/connection.ts`：队列 catch 保存错误后立即调用 `rpc.close()`；transport 已有幂等失败路径会 reject RPC pending、调用 connection 的 `fail()`、通知 host。移除 `finishPrompt()` 中延迟报告通知失败的旧分支，避免重复失败报告。
- `test/connection.test.ts`：补 text／usage reject、同步 throw、部分成功后失败、后续通知被跳过、无 terminal、无 ACK 的公共接口回归。
- `test/server.test.ts`：使用真实 ACP SDK 和可失败的 WritableStream，在通知写入 reject／输出关闭时观察 ACP 关闭、无成功 prompt response、实际合成 OMP 子进程退出。
- `README.md`：仅在 V1 contract 的连接失败说明中补充通知发送失败语义。
- 按本仓规则新增本条目及索引；完成后提议新增同目录 `001-action.md`。

## 备选与决策

- 仅在 catch 中调用 `fail()`：拒绝。不能解除尚未收到 ACK 的 RPC 等待，且依赖 host 自行关闭 transport。
- 等 native terminal 或增加超时：拒绝。前者保留 A03，后者把明确失败延后，并可能误判正常背压。
- 立即关闭 RPC：选择。复用已存在的 pending rejection、host failure 和子进程回收，不增加新的状态机；内部错误沿现有脱敏规则报告。
- 无新持久格式、导出 API 或难以回退的迁移。

## 验收

- 新回归必须区分及时失败与等待 native terminal；不发送 terminal，覆盖 ACK 缺失。
- 真实 SDK writable 故障回归观察 `connection.closed`、失败回调、OMP 子进程退出，确认没有成功 prompt 终态。
- 已有慢通知／排空测试继续通过；Vitest 不出现未处理 rejection。
- `npm run check`、`npm run build` 均通过，报告实际测试数量。
- 使用隔离合成子进程做运行 smoke，不使用用户 OMP 会话或提供商。

## 修订记录
