# 011 — 通知失败及时关闭：行动记录

## 时间线

| 日期 | 变更 | 引用 |
| --- | --- | --- |
| 2026-10-17 | 独立上下文核对规格，明确允许实现 | `000-plan.md` |
| 2026-10-17 | 新增通知失败回归，6 个无 terminal 用例在旧实现均因 prompt 保持 pending 而失败 | `test/connection.test.ts` |
| 2026-10-17 | 队列失败立即关闭 RPC，删除终态排空后的延迟失败报告 | `src/connection.ts` |
| 2026-10-17 | 真实 ACP SDK writable reject／输出关闭回归观察 ACP 关闭及实际合成子进程退出 | `test/server.test.ts` |
| 2026-10-17 | 全量 check、build 与编译产物 smoke 通过 | 下述证据 |

## 结果与当前状态（截至 2026-10-17）

- 队列 catch 保留失败标记，立即调用已有 `rpc.close()`；transport 幂等失败路径拒绝 pending RPC，并触发 host failure。
- ACK 未到、native terminal 永不到达时，公共 prompt Promise 仍及时 reject。
- 失败后的通知被跳过，新的会话请求被已关闭 transport 拒绝，不重发 prompt。
- 原始通知错误不进入 host failure 或 prompt 错误。
- 稳定排空与 active 身份复核保留，成功但慢的通知顺序不变。
- `README.md` 仅补充 V1 的通知失败语义；未修改取消、能力或进程关闭策略。

### 验证证据

- 先运行新增 connection 回归：6 failed，均为预期的 `pending` 而非 `rejected`。
- 修复后定向测试：12 passed，含新增 9 个用例及已有慢通知／排空用例。
- 最终 `npm run check`：typecheck 通过；3 个文件、80 tests 全部通过。connection 51、server 21、signal 8；相对原套件新增 11 例，无未处理 rejection 报告。
- `npm run build`：通过。
- 使用内联 Node 脚本运行编译后的 `dist/connection.js`，text／usage 两种明确 reject 场景均无 ACK／terminal：prompt 失败、host failure=1、替代会话拒绝、prompt 仅发送一次；退出码 0。脚本未写入仓库。
- 所有夹具均为合成数据；没有运行真实 OMP／付费提供商。
- 独立 completion reviewer 两轮均重审完整 diff；第一轮建议直接覆盖同批 terminal 与通知 reject，补充 text／usage 两例后第二轮已静态复核。随后取得上述最终 80 tests 通过结果。
- 审查状态：原 A03 静态复核已解决；无阻塞发现，无修了未再审的源码／测试。usage 同步 throw 尚无独立用例，作为非阻塞覆盖限制记录；不宣称全平台或真实 OMP 审核 clean。

## 相对计划的偏差

- task reviewer 因没有默认模型而无法启动；使用无会话历史的独立 completion reviewer 完成实现前规格核对。
- SDK 实测在 writable 失败时先自行关闭 ACP，并进入正常 close；adapter 的 failure 回调不一定先触发。server 回归因此验收 ACP 关闭、无成功终态及子进程退出，不要求 failure 回调计数或进程退出码。connection 回归单独验证及时 reject 和单次 host failure。

## 未验证的问题

- 没有执行真实 OMP contract／发布矩阵；合成证据不代表真实版本兼容或 Lody 接入验收。
- 本次运行环境为 macOS；Windows 的实际子进程回收行为未在本次执行。
