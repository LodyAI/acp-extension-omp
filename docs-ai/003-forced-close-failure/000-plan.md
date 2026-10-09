# 003 — 强杀失败后让适配器退出：计划

| | |
| --- | --- |
| **状态** | 已实现 |
| **锚点日期** | 2026-10-09 |
| **规格核对** | 用户（笑尘）2026-10-09 核对目标、非目标、备选与验收，允许实现。 |
| **相关** | [001 — 运行时生命周期与可复现检查](../001-runtime-lifecycle/000-plan.md)、[002 — 终止信号时回收 OMP 子进程](../002-signal-shutdown/000-plan.md)、[独立审核 SIG-007](../002-signal-shutdown/003-independent-review.md) |

## 背景

`src/server.ts` 的 `close` 在 SIGKILL 发出后再等 1 秒，子进程仍未退出时就拒绝：先调用 `reportParentFailure` 设置 `process.exitCode = 1`，再经 `onParentFailure` 销毁适配器自己的 stdin/stdout。但它没有释放 `ChildProcess` 句柄，也没有释放该子进程的 stdio 管道。

2026-10-09 在 Darwin arm64 上用构建后的 `dist/index.js` 复现了这个问题。复现条件：

- 用 `--import` 预加载模块拦截发往进程组的 SIGKILL，模拟子进程强杀后仍不退出，比如处于不可中断睡眠；
- 合成 `omp` 忽略 SIGTERM 和 stdin EOF；
- 不发 prompt，也不用凭据。

观察结果：

- 完成 initialize 和 session/new 后关闭适配器 stdin，8 秒后适配器仍在运行；
- stderr 没有任何输出；
- 测试脚本手动杀掉 OMP 后，适配器才以 code 1 退出。

宿主只能看到适配器一直不退出，既拿不到失败状态，也拿不到原因。信号路径不受影响：那里最后靠重发信号结束自己。

## 目标

1. `close` 判定强杀失败后，适配器不再被这个子进程挂住：stdin EOF 路径下以 code 1 退出，而不是等子进程最终退出。
2. 失败原因写到 stderr 一行，比如「OMP child process did not exit after force termination」，stdout 不受影响。
3. 现有语义不变：
   - `close` 仍然拒绝；
   - `onParentFailure` 仍然恰好调用一次；
   - 强杀成功或子进程在强杀后退出（含 LIFE-002 竞态）时，仍然成功、不写 stderr。

### 非目标

- 不让无法终止的 OMP 进程消失。适配器释放的只是自己持有的句柄，那个 OMP 进程会被留下。
- 不改宽限期、SIGTERM/SIGKILL 顺序、`detached`，也不改信号路径。
- 不处理孙进程，也不加重试。

## 方案

1. 在 `src/server.ts` 的 `close` 中，只在最后的失败分支，也就是第二次 `waitForExit` 后子进程仍未退出时，抛错之前做三件事：
   - 移除本条目新增的监听器；
   - 对 `owned` 调用 `unref()`，并 `destroy()` 它的 `stdin`、`stdout`、`stderr`；
   - 向 `process.stderr` 写一行失败原因。

   之后照旧 `throw`，由现有的 `.catch` 交给 `reportParentFailure`。
2. 不改 `src/index.ts`。现有的 `onParentFailure` 会销毁适配器自己的 stdin/stdout，加上方案 1 释放的子进程句柄，事件循环就能结束，`process.exitCode = 1` 生效。
3. 测试：
   - `test/server.test.ts` 已有强杀失败的替身用例，在其中断言失败分支调用了 `unref()`、子进程三条 stdio 流都已销毁，并且写了 stderr。这部分跨平台运行。
   - 提议在 `test/signal.test.ts` 增加一个只在 POSIX 上运行的进程级用例，沿用背景里的预加载拦截方式。断言关闭 stdin 后，适配器在 10 秒内以 code 1 退出，stderr 含失败原因；结束后由测试杀掉 OMP。

## 备选与决策

- **在 `onParentFailure` 里 `process.exit(1)`：不采用。** `abortParent` 先调用 `reportParentFailure`，后调用 `close(true)`。在那里直接退出，会让正常的子进程失败路径跳过对 OMP 的回收，而且可能截断 stderr。
- **在 `close` 失败后设定时器强制 `process.exit`：不采用。** 超时长度是任意的；而且只要释放掉句柄，进程就会按 `exitCode` 自然结束，不需要再造一个计时器。
- **保持现状，只写进文档：不采用。** 宿主会无限期等下去，没法区分「仍在工作」和「已经失败」。
- **选择释放句柄。** 改动只发生在已经判定失败的分支，成功路径的行为和测试都不受影响。

## 验收

- 先写新的断言和进程级用例，在实现前运行，确认它们失败（RED）。
- `npm run check`、`npm run build`、`npm pack --dry-run` 通过，打包文件数不变。
- 按背景里的方式复现：关闭 stdin 后，适配器在 1 秒宽限期加 1 秒强杀等待之后不久，以 code 1 退出，stderr 有一行原因。
- 正常 SIGTERM、强杀成功和 LIFE-002 竞态的现有用例保持通过，信号用例保持通过。
- 若 `omp --version` 的 stdout 以 `omp/` 开头，运行 `npm run smoke` 和 `npm run contract`，确认既有路径没有回归。
- Windows 上这条失败路径只有替身证据，留给 CI 验证，不写成已在 Windows 上验证。
- 实现后交给独立 reviewer 至少两轮审核。

## 修订记录

- 更新于 2026-10-09：独立审核两轮，修复 FCF-001～003 — 见 [002-review-fixes.md](002-review-fixes.md)
- 更新于 2026-10-09：夹具原子发布 pid 并加看门狗（FCF-004） — 见 [003-fixture-hardening.md](003-fixture-hardening.md)
