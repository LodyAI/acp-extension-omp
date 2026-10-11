# 002.006 — 宽限期内的第二个信号先强杀 OMP 进程组

## 背景

对 #2 的一次只读审核（Grok 4.7，发现已对照代码核实）提出一项 Important 和一项 Minor：

- **第二个信号会漏掉 OMP。** [002-signal-fallback.md](002-signal-fallback.md) 让 `closeOnSignals` 在第一个信号时同步移除全部监听。关闭期间再来一个 `SIGTERM`、`SIGINT` 或 `SIGHUP`，就走 Node 默认行为立即退出，此时 `close` 还停在约 1 秒的 SIGTERM 宽限里，进程组 SIGKILL 还没发出。OMP 以 `detached: true` 启动，不会随适配器退出；忽略 SIGTERM 的 OMP 或孙进程会成为孤儿。原测试 `stops intercepting every shutdown signal after the first` 把这个行为钉住了，但替身没有进程组可漏。
- **信号路径上的失败诊断可能丢。** `close` 强杀失败时用 `process.stderr.write` 写一行诊断，信号路径紧接着重发信号。stderr 是异步管道时，这一行可能还在缓冲里，进程就已经退出。这一点是根据 Node 管道写入语义推断的，没有单独复现。

[000-plan.md](000-plan.md) 的决策「第二个信号不再拦截」保留了人工强制退出，但代价是跳过进程组回收。本文件纠正这一条：立即退出可以保留，跳过回收不行。

用户（TommyWu）2026-10-11 核对了下面的规格，允许实现。

## 变更

规格：

1. 第一个信号后不再移除监听。第一个信号仍然执行 `close()`，完成或失败后重发该信号一次。
2. 关闭期间收到第二个 `SIGTERM`、`SIGINT` 或 `SIGHUP`：先同步调用 `forceKill()`（POSIX 上 `process.kill(-pid, "SIGKILL")` 发给 OMP 进程组，Windows 上 `owned.kill("SIGKILL")`；没有子进程时什么也不做，忽略 `ESRCH`），再移除全部监听并重发第二个信号；重发抛错时沿用 `128 + 信号编号` 兜底。`forceKill` 抛错也不跳过重发。
3. 之后 `close()` 才完成时不再重发，整个过程最多重发一次。
4. `serve` 额外返回 `forceKill`，`closeOnSignals(close, target, forceKill)` 的第三个参数默认什么也不做；`src/index.ts` 传入 `server.forceKill`。
5. `close` 的强杀失败诊断改用 `fs.writeSync(2, …)` 同步写出，仍是尽力而为。

实现：

- `src/server.ts`、`src/index.ts` 按上面的规格修改。
- `test/server.test.ts`：
  - 原用例改为 `force-kills and exits on a second shutdown signal during grace`：第一个信号后三个监听仍在，第二个信号同步调用 `forceKill`，以第二个信号重发一次，之后 `close` 完成不再重发。
  - 新增 `exits by the second signal when re-raising it is unsupported`。
  - `handles forced-kill failure races` 改为通过 mock `node:fs` 的 `writeSync` 捕获诊断（ESM 绑定不能 `vi.spyOn`）。
- `test/signal.test.ts`（只在 POSIX 上运行）新增 `force-kills a SIGTERM-ignoring grandchild when a second signal arrives during grace`：用 `straggler` 夹具，对编译出的适配器先发 SIGTERM，确认 OMP 首进程已退出、孙进程仍在后，在宽限期内再发 SIGINT；断言适配器以 SIGINT 退出，OMP 和孙进程都在 1 秒内消失。
- `README.md` 写明第二个信号的行为，回归测试数量改为 39，其中 9 项只在 POSIX 上运行。

实现由 `omp` CLI 驱动 `xai-oauth/grok-4.7` 在独立 worktree 中完成，之后由另一个 agent 复核 diff 并重跑下面的检查。

已执行（Linux 6.12 x86_64，Node `v22.22.3`）：

| 命令 / 场景 | 结果 |
| --- | --- |
| 新测试在旧 `src/` 上运行 `npx vitest run` | FAIL（预期 RED）：6 项失败、33 项通过。第二信号替身用例：第一个信号后监听数为 0、`forceKill` 未被调用；两个强杀失败竞态用例：`writeSync(2)` 没捕获到诊断；进程级用例：孙进程在第二个信号后仍然存活。另一项见 [../004-process-group-stragglers/003-drain-after-force-kill.md](../004-process-group-stragglers/003-drain-after-force-kill.md) |
| 实现后 `npm run check`（连续 3 次） | PASS：类型检查通过；3 个测试文件、39 项 |
| `npm run build` | PASS |
| `omp --version` / `node scripts/smoke.mjs` / `node scripts/contract.mjs dist/index.js` | `omp/18.8.8`；smoke 与 loopback-only contract 都通过 |

## 引用

- #2
- [000-plan.md](000-plan.md)
- [002-signal-fallback.md](002-signal-fallback.md)

## 当前状态

- Windows 上第二个信号的强杀只有替身证据；Windows 不回收孙进程，仍是 [../004-process-group-stragglers/000-plan.md](../004-process-group-stragglers/000-plan.md) 的非目标。
- `writeSync` 能避免异步管道丢行这一点没有在 macOS 上复现。
- 本文件的改动还没有经过独立的两轮审核。
