# 002 — 终止信号时回收 OMP 子进程：行动记录

## 时间线

| 日期 | 变更 | 引用 |
| --- | --- | --- |
| 2026-10-09 | 复现信号孤儿进程；起草计划，经用户核对允许实现 | [000-plan.md](000-plan.md) |
| 2026-10-09 | 先写失败测试，再实现 `closeOnSignals` 并在入口接线；更新 README 测试数量 | 命令记录见下文 |

## 结果与当前状态（截至 2026-10-09）

- `src/server.ts` 导出 `closeOnSignals(close, target = process)`：对 `SIGTERM`、`SIGINT`、`SIGHUP` 注册一次性监听，触发时等待 `close()`（忽略其拒绝），再用 `target.kill(target.pid, signal)` 重发同一信号。`close` 的宽限期、强杀和失败报告未改动。
- `src/index.ts` 在 `serve` 之后调用 `closeOnSignals(server.close)`。
- `test/server.test.ts` 新增 4 项：三种信号各一项，用真实合成 OMP 子进程验证重发前子进程已退出、重发参数正确、监听已移除；另一项验证 `close` 拒绝时仍重发信号。`Harness` 增加 `serverClose`，只供这些用例调用 `server.close` 而不先关闭 ACP 输入。
- `README.md` 回归测试数量由 21 改为 25（connection 13、server 12）。

已执行（Darwin 27.0.0 arm64，Node `v26.10.0`，基线 `4fd87e3135631bef634230bf2e1c155910e831ee` 加未提交工作树）：

| 命令 / 场景 | 结果 |
| --- | --- |
| 实现前 `npx vitest run test/server.test.ts -t "re-rais"` | FAIL（预期 RED）：4 项因 `closeOnSignals` 不存在失败 |
| 实现后同一定向测试 | PASS：4 项 |
| `npm run check` | PASS：类型检查通过；2 个测试文件、25 项 |
| `npm run build` | PASS |
| 构建后 `dist/index.js` + 合成 `omp` 夹具，完成 initialize/new 后依次发送 `SIGTERM`、`SIGINT`、`SIGHUP` | 适配器均以对应信号退出（code 为 null）；合成 OMP 进程均已回收。修复前同一脚本三种信号均留下孤儿进程 |
| `npm pack --dry-run` | PASS：prepack 重建，15 个文件 |
| `omp --version` | `omp/18.8.4` |
| `npm run smoke` | PASS：隔离 profile initialize/new/load，未发 prompt |
| `npm run contract` | PASS：OMP 18.8.4、loopback-only 合成模型 |

## 相对计划的偏差

无已知偏差。

## 未验证的问题

- Windows 未在本地执行。Windows 上 Node 只模拟 `SIGINT`、`SIGHUP`（控制台关闭）等少数信号，`SIGTERM` 监听不会触发；新增测试用事件替身，不依赖平台信号，但 Windows 真实信号路径仍无证据。
- 宿主以 `SIGKILL` 结束适配器时无法拦截；OMP 在 stdin EOF 后是否自行退出未验证。
- 进程组首进程在 SIGTERM 后退出、但组内孙进程忽略 SIGTERM 的情况未处理，属于计划非目标。
- 本条目未经过独立 agent 代码审核；仅由实现者自查。
