# 001 — 会话切换失败后的身份失效：行动记录

## 时间线

| 日期 | 变更 | 引用 |
| --- | --- | --- |
| 2026-10-07 | 新增缺失/空 native session 切换后的旧 identity 回归测试 | [`test/connection.test.ts`](../../test/connection.test.ts) |
| 2026-10-07 | 先运行回归测试，确认当前实现错误地继续完成旧 session prompt | `npm test -- --run test/connection.test.ts` |
| 2026-10-07 | 在 native `stat()` 预检前清空 `this.sessionId` | [`src/connection.ts`](../../src/connection.ts) |
| 2026-10-07 | 运行完整 check/build/smoke/contract/pack dry-run | [`TESTING.md`](../../TESTING.md) |

## 结果与当前状态（截至 2026-10-07）

exact `load`/`resume` 进入切换流程后，旧 ACP identity 会在 native 文件预检前失效。缺失或空 session 文件仍在发送 `switch_session` 前被拒绝；失败后使用旧 `sessionId` 的 prompt 也会因 identity 不匹配被拒绝。

回归测试从原实现的 2 项失败变为通过；连接测试共 15 项，server 生命周期测试共 5 项，总计 20 项。

## 相对计划的偏差

无已知偏差。实现保持 `sessionChanging` 互斥、exact identity 校验、RPC 协议和成功切换路径不变。

## 未验证的问题

- OMP 18.2.8 仍未获得可运行 binary，不能据此宣称最低基线兼容。
- 其他稳定版本、其他 OS、native background/compaction 行为仍未验证。
- 独立维护者 review 仍未完成；尝试委派 reviewer 时因模型订阅返回 `403 No active subscription found for this group` 失败。
- 未创建 commit、PR、tag、release 或 artifact；未修改 Lody 工作树。

## 验证证据

在 Node `22.22.3`、OMP `18.3.1`、macOS arm64 下通过：

```text
npm run check       20/20 tests passed
npm run build       passed
npm run smoke       isolated initialize/new/load passed
npm run contract    real prompt/cancel/load/resume/usage/restart/order/error passed
npm pack --dry-run  15 package files; no node_modules/dist source leak beyond files whitelist
```
