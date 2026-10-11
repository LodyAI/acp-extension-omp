# 002.002 — 信号重发失败的退出兜底，以及首个信号后停止拦截

## 背景

发布前审查对 [000-plan.md](000-plan.md) 的实现提出两项问题：

- **R7**：重发信号时 `target.kill` 可能抛错。在 Windows 上，libuv 的 `uv_kill` 只接受 `SIGINT`、`SIGTERM`、`SIGKILL`、`SIGQUIT` 和 0，而 Node 会在控制台关闭时发出 `SIGHUP`。这时重发会抛 `ENOSYS`，抛在 `.finally` 回调里会变成未处理的 rejection，适配器以 code 1 退出，而不是计划目标 2 要求的「以收到的信号退出」。这是根据 libuv 源码推断的，没有在 Windows 上实测。
- **R8**：每个信号各自注册一次性监听。先收到 `SIGTERM`，关闭期间再按 Ctrl+C，`SIGINT` 的监听仍在，适配器要等 `close` 完成（最长约 2 秒）才退出。这削弱了原计划「保留人工强制退出途径」的效果。

用户（笑尘）在 2026-10-09 核对了下面的规格，允许实现。

## 变更

规格：

1. 收到 `SIGTERM`、`SIGINT`、`SIGHUP` 中的任意一个后，立即同步移除这三个信号的全部监听，再开始 `close`。关闭期间再收到任何一个，都走 Node 默认行为立即退出。
2. `close` 完成或失败后仍重发同一信号。如果 `target.kill` 抛错，改为 `target.exit(128 + os.constants.signals[signal])`，不留下未处理的 rejection，也不以 code 0 退出。
3. `SignalTarget` 增加 `removeListener` 和 `exit`；生产代码仍传入 `process`。`close` 的宽限期、强杀和失败报告不变。

验收：

- 新增合成测试：重发抛错时，`exit` 以 `128 + 信号编号` 被调用；第一个信号触发后，三个信号的监听数都同步归零，且只重发一次第一个信号。先运行这些测试确认失败，实现后通过。
- `npm run check`、`npm run build`、`npm pack --dry-run` 通过；构建出的 `dist/index.js` 配合合成 `omp` 重复 POSIX 三种信号的手工复现，适配器以对应信号退出，OMP 被回收。
- Windows 的真实信号路径仍以 CI 和后续证据为准，不写成已验证。

## 引用

- [000-plan.md](000-plan.md)
- [001-action.md](001-action.md)

## 当前状态

已核对并已实现。

- `src/server.ts` 的 `closeOnSignals` 改用 `on` 注册，并在任一信号的处理函数开头同步移除三个信号的全部监听。重发时 `target.kill` 抛错，就调用 `target.exit(128 + constants.signals[signal])`。`src/index.ts` 不变。
- `test/server.test.ts` 新增 2 项：`exits with the signal status when re-raising is unsupported`、`stops intercepting every shutdown signal after the first`。原有信号用例的替身补了 `exit`。`README.md` 的回归测试数量改为 27（connection 13、server 14）。

已执行（Darwin 27.0.0 arm64，Node `v26.10.0`）：

| 命令 / 场景 | 结果 |
| --- | --- |
| 实现前运行这 2 项新测试 | FAIL（预期 RED）：退出兜底超时，并出现 `ENOSYS` 未处理错误；收到首个信号后 `SIGINT` 的监听数为 1 |
| `npm run check` | PASS：类型检查通过；2 个测试文件、27 项 |
| `npm run build` | PASS |
| 构建后的 `dist/index.js` 加合成 `omp`，完成 initialize/new 后分别发送 `SIGTERM`、`SIGINT`、`SIGHUP` | 适配器以对应信号退出（code 为 null），合成 OMP 进程都已回收 |
| `npm pack --dry-run` | PASS：15 个文件 |
| `omp --version` / `npm run smoke` / `npm run contract` | `omp/18.8.4`；smoke 与 loopback-only contract 都通过 |

未验证：Windows 上 `SIGHUP` 的 `ENOSYS` 兜底和 `SIGINT` 重发都只有合成替身证据。按用户安排，独立审核交给另一个模型执行。
