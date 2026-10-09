# 002 — 终止信号时回收 OMP 子进程：计划

| | |
| --- | --- |
| **状态** | 已实现 |
| **锚点日期** | 2026-10-09 |
| **规格核对** | 用户（笑尘）2026-10-09 核对目标、非目标、备选与验收，允许实现。 |
| **相关** | [001 — 运行时生命周期与可复现检查](../001-runtime-lifecycle/000-plan.md)、`TESTING.md` |

## 背景

`src/server.ts` 在 POSIX 上以 `detached: true` 启动 OMP，使其进入独立进程组，以便 `close` 能对整个进程组发信号。代价是终端或宿主发给适配器的信号不会传给 OMP。

`src/index.ts` 没有注册任何信号处理。2026-10-09 在 Darwin arm64 上用构建后的 `dist/index.js` 和合成 `omp` 夹具（PATH 注入、无凭据、不发 prompt）复现：完成 `initialize` 和 `session/new` 后，分别向适配器发送 `SIGTERM`、`SIGINT`、`SIGHUP`，适配器以该信号退出，而三种情况下合成 OMP 进程都继续存活。对照组中，关闭适配器 stdin 后适配器以 code 0 退出，OMP 被回收。

即宿主用信号停止适配器时，OMP 及其进程组会成为孤儿，继续占用资源或继续执行工作。

## 目标

1. 适配器收到 `SIGTERM`、`SIGINT` 或 `SIGHUP` 时，先执行与 stdin EOF 相同的 `close` 路径（POSIX 进程组 SIGTERM，宽限期后 SIGKILL；Windows 直接终止已拥有的子进程），再退出。
2. 关闭完成后，适配器仍以收到的信号退出，不把信号终止伪装成 code 0。
3. `close` 失败（强杀后子进程仍未退出）时，同样以该信号退出，不挂起。

### 非目标

- 不处理 `SIGKILL` 或宿主强杀适配器的情况；这类情况无法在进程内拦截，OMP 是否在 stdin EOF 后自行退出属于 OMP 行为，不在本条目验证。
- 不改变 `detached`、启动参数、宽限期时长或 `close` 的强杀语义。
- 不处理已退出 OMP 进程组中残留的孙进程。

## 方案

1. 在 `src/server.ts` 增加导出函数 `closeOnSignals(close, target = process)`：对 `SIGTERM`、`SIGINT`、`SIGHUP` 各注册一次性监听；触发时调用 `close()`，忽略其拒绝（失败已经由 `reportParentFailure` 报告），之后用 `target.kill(target.pid, signal)` 重新发出同一信号。监听已被 `once` 移除，因此重发走 Node 默认行为，以该信号退出。
2. `src/index.ts` 在 `serve` 之后调用 `closeOnSignals(server.close)`。
3. `target` 参数只为测试注入事件源，生产使用 `process`。

## 备选与决策

- **重发信号，而不是 `process.exit(128 + n)`。** 重发让宿主观察到真实的信号终止，与修复前的退出语义一致；也避免在 Windows 上手写信号编号。
- **复用 `close`，而不是在信号处理里直接 `process.kill(-pid)`。** 只保留一条子进程回收路径，宽限期、Windows 分支和失败报告不重复实现。
- **不取消 `detached`。** 取消后终端 Ctrl+C 会同时打到 OMP，但宿主用 `kill <pid>` 时仍不会传播，并会失去对 OMP 进程组的整体回收。
- **第二个信号不再拦截。** 关闭期间重复收到同一信号时走默认行为立即退出，保留人工强制退出的途径。

## 验收

- 新增合成测试：注入 `EventEmitter` 替身作为 `target`，用真实合成 OMP 子进程建立会话后发出 `SIGTERM`；断言 `close` 完成、子进程已退出，且 `target.kill` 以 `(pid, "SIGTERM")` 被调用一次。另一用例覆盖 `close` 拒绝时仍重发信号。
- `npm run check`、`npm run build`、`npm pack --dry-run` 通过，制品文件数不变。
- 手工复现脚本：对构建后的 `dist/index.js` 与合成 `omp` 重复背景中的三种信号，观察适配器以对应信号退出，且合成 OMP 进程不再存活。结果记录到 `001-action.md`。
- `omp --version` 的 stdout 以 `omp/` 开头时运行 `npm run smoke` 与 `npm run contract`，确认既有路径无回归；不据此扩大兼容性声明。
- Windows 上的信号行为没有本地证据，留给 CI，不在行动记录中写成已验证。

## 修订记录

- 更新于 2026-10-09：重发失败时按信号编号退出，首个信号后停止拦截全部信号 — 见 [002-signal-fallback.md](002-signal-fallback.md)
