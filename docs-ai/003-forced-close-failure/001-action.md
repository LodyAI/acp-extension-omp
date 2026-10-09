# 003 — 强杀失败后让适配器退出：行动记录

## 时间线

| 日期 | 变更 | 引用 |
| --- | --- | --- |
| 2026-10-09 | 用构建产物复现 SIG-007：强杀失败后适配器在 8 秒内仍未退出，stderr 为空；起草计划，用户核对后允许实现 | [000-plan.md](000-plan.md) |
| 2026-10-09 | 先写失败测试，再在 `close` 的最终失败分支中释放子进程并写出 stderr 诊断 | 命令记录见下文 |

## 结果与当前状态（截至 2026-10-09）

- `src/server.ts`：`close` 中第二次 `waitForExit` 后子进程仍未退出时，会依次执行：
  - 调用 `owned.unref()`；
  - `destroy()` 子进程的 `stdin`、`stdout`、`stderr`；
  - 向 `process.stderr` 写一行 `acp-extension-omp: OMP child process did not exit after force termination (pid N)`；
  - 照旧抛出错误，交给 `reportParentFailure`。

  成功路径、LIFE-002 竞态和信号路径都没有改动。`src/index.ts` 也没有改动。
- `test/server.test.ts`：强杀失败的替身用例（`false`、`async-error` 两种）增加了以下断言，跨平台运行：
  - 失败分支：`unref` 被调用一次，三条 stdio 流都已销毁，stderr 含失败原因；
  - 子进程在强杀后退出的分支：不调用 `unref`，stdout/stderr 没有被销毁，不写 stderr。
- `test/signal.test.ts`：新增 POSIX 进程级用例 `exits with code 1 when OMP survives force termination`。
  - 合成 `omp` 忽略 SIGTERM 和 stdin EOF；
  - 用 `--import` 的 `data:` 预加载模块拦截适配器发往进程组的 SIGKILL；
  - 断言关闭 stdin 后适配器以 code 1 退出、stderr 含原因、OMP 进程按设计仍在运行；结束后由测试杀掉 OMP。
- `README.md`：在生命周期段落写明强杀失败时的行为；回归测试数量改为 31，其中 5 项只在 POSIX 上运行。

已执行（Darwin 27.0.0 arm64，Node `v26.10.0`）：

| 命令 / 场景 | 结果 |
| --- | --- |
| 实现前运行新增断言和进程级用例 | FAIL（预期 RED）：替身用例 `unref` 调用 0 次；进程级用例 15 秒超时，与复现一致 |
| 实现后 `npm run check` | PASS：类型检查通过；3 个测试文件、31 项；没有残留夹具进程或 `.signal-test-*` 目录 |
| `npm run build`，然后对 `dist/index.js` 重复背景中的复现 | 适配器约 2017 ms 后以 code 1 退出；stderr 只有那一行原因；OMP 按设计仍在运行，随后由脚本清理 |
| `npm pack --dry-run` | PASS：15 个文件 |
| `omp --version` / `npm run smoke` / `npm run contract` | `omp/18.8.4`；smoke 与 loopback-only contract 都通过 |

## 相对计划的偏差

- 计划方案 1 写了「移除本条目新增的监听器」。实际上本条目没有新增监听器；强杀阶段原有的 `error` 监听器在失败分支之前就已经移除，所以这一步不需要做。
- 「子进程在强杀后退出」这个分支的断言，最初写成三条 stdio 流都未销毁。运行后发现，`runtime.close()` 正常关闭 RPC 写端时，`stdin` 本来就会结束并销毁，所以改为只断言 stdout 和 stderr 未被销毁。这是修正测试断言，生产行为没有变化。

## 未验证的问题

- Windows 上这条失败分支只有替身证据：`ChildProcess.kill` 返回 false 或异步报错。进程级用例只在 POSIX 上运行，需要看 CI 的 Windows 结果。
- 真实的「SIGKILL 后进程仍不退出」（比如不可中断睡眠）没有复现，这里用的是拦截 SIGKILL 的模拟。
- 本条目的改动还没有被独立审核。
