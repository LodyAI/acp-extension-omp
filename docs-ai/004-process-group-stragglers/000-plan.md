# 004 — OMP 首进程退出后的残留进程与管道：计划

| | |
| --- | --- |
| **状态** | 已实现 |
| **锚点日期** | 2026-10-09 |
| **规格核对** | 用户（笑尘）2026-10-09 核对目标、非目标、备选与验收，允许实现。 |
| **相关** | [002 — 终止信号时回收 OMP 子进程](../002-signal-shutdown/000-plan.md)、[003 — 强杀失败后让适配器退出](../003-forced-close-failure/000-plan.md) |

## 背景

Lody 独立审核提出 LDY-004：`src/server.ts` 的 `close` 只等 OMP 首进程退出。首进程一退出，`close` 就成功返回，不再处理同一进程组里的其他进程，也不管这些进程是否还持有继承来的管道。002 计划把「残留孙进程」列为非目标，但没有写出由此导致的后果。

2026-10-09 在 Darwin arm64 上用构建后的 `dist/index.js` 复现。复现条件：

- 合成 `omp` 派生一个孙进程，孙进程继承 `omp` 的 stdout/stderr、忽略 SIGTERM；
- `omp` 自身收到 SIGTERM 后正常退出；
- 不发 prompt，也不用凭据。

观察结果：

- 完成 initialize 和 session/new 后关闭适配器 stdin，`omp` 首进程已退出，孙进程仍在；
- 8 秒后适配器仍在运行，stderr 为空；
- 测试脚本杀掉孙进程后，适配器立即以 code 0 退出。

原因有两个：孙进程持有的 stdout 管道让 `Readable.toWeb` 的读取一直挂着，stderr 管道让 `pipe(process.stderr)` 一直挂着，适配器的事件循环因此结束不了；同时，忽略 SIGTERM 的孙进程会作为孤儿一直运行。

OMP 意外退出时，`abortParent` 走 `close(true)`，也会遇到同样的挂住。

## 目标

1. 无论 OMP 的子孙进程是否持有继承来的管道，适配器关闭时都不会无限期挂住：最迟在既有的两段宽限期内释放 OMP 的 stdio。
2. POSIX 上，首进程退出后，如果进程组里还有成员，在同一个宽限期截止时对整个进程组发 SIGKILL。这样忽略 SIGTERM 的孙进程也会被回收，不会变成孤儿。
3. 发了 SIGKILL 后，进程组里仍有成员存活（例如不可中断睡眠）时，按 003 的失败语义处理：写一行 stderr，释放句柄，`close` 拒绝，适配器以 code 1 退出。
4. 正常路径不变：OMP 和它的子孙按时退出时，`close` 成功，不写 stderr，OMP 最后的 stderr 输出不会因为提前销毁管道而丢失。

### 非目标

- Windows 上不回收孙进程。Windows 没有进程组，只有 Job Object 能做到，属于另一项能力；本条目在 Windows 上只保证目标 1，即释放管道、不挂住。
- 不处理在宽限期之内调用 `setsid` 脱离进程组的进程。
- 不改宽限期时长、启动参数、`detached`，也不改信号路径。

## 方案

改 `src/server.ts` 的 `close`：

1. 发 SIGTERM 时记下截止时间：发出时刻加 `SHUTDOWN_GRACE_MS`。
2. 首进程在宽限期内退出后（POSIX）：
   - 用 `process.kill(-pid, 0)` 检查进程组是否还有成员；
   - 有成员，就按固定间隔轮询，直到截止时间；
   - 截止时仍有成员，就对进程组发 SIGKILL，再在第二个宽限期内轮询进程组是否已经清空。
   - 仍未清空，就进入方案 4 的失败处理。
3. 首进程在宽限期内没有退出：沿用现有的 SIGKILL 和 003 的失败处理。
4. 释放 stdio：
   - 首进程退出后，等 `ChildProcess` 的 `close` 事件（表示所有 stdio 已关闭），最多等到第二个宽限期结束，这样 OMP 正常退出时最后的输出能完整送达；
   - 等不到就 `destroy` 它的 stdin、stdout、stderr。
   - 方案 2 判定进程组存活失败时，复用 003 的处理：`unref`、销毁 stdio、写 stderr、抛错。
5. `close(true)` 路径（OMP 意外退出）走同一套逻辑，因为它也调用这个 `close`。
6. 测试：
   - 提议在 `test/signal.test.ts`（只在 POSIX 上运行）加进程级用例：合成 `omp` 派生一个忽略 SIGTERM 的孙进程，断言关闭 stdin 后适配器在 2 个宽限期内以 code 0 退出、孙进程已被回收。
   - 再加一个用例，用预加载模块拦截进程组 SIGKILL，断言适配器以 code 1 退出并写出 stderr。
   - 在 `test/server.test.ts` 的替身里覆盖「`exit` 之后迟迟不来 `close` 事件」的情况，断言 stdio 在期限内被销毁。这部分跨平台运行。

## 备选与决策

- **只销毁管道，不杀进程组：不采用。** 这样适配器能退出，但忽略 SIGTERM 的孙进程会作为孤儿一直运行、继续工作，和 002「不留下 OMP 进程」的目的相反。
- **首进程一退出就立刻对进程组发 SIGKILL：不采用。** 这会剥夺子孙进程在宽限期内正常退出的机会，和首进程本身享有的 SIGTERM 宽限期不对称。
- **首进程退出时立刻销毁 stdio：不采用。** `exit` 事件可能早于 stdio 读完，正常关闭时会丢掉 OMP 最后的 stderr 诊断；等 `close` 事件并设上限，能兼顾两者。
- **Windows 用 Job Object 回收整棵进程树：不采用。** 需要原生依赖或额外的平台工具，超出适配器边界。
- **选择在同一截止时间统一处理首进程和进程组成员，并给 stdio 释放设上限。** 总耗时上限与现有的两段宽限期一致，不引入新的超时常量。

## 验收

- 先写新用例，在实现前运行，确认失败（RED）。期望表现是：孙进程用例超时，替身用例的 stdio 没有被销毁。
- `npm run check`、`npm run build`、`npm pack --dry-run` 通过，打包文件数不变。
- 用构建产物重复背景里的复现：适配器在约 1 秒宽限期后以 code 0 退出，孙进程已不存在，stderr 为空。
- 已有的强杀成功、强杀失败、LIFE-002 竞态、信号回收、stdin EOF 以 code 0 退出等用例全部保持通过。
- 若 `omp --version` 的 stdout 以 `omp/` 开头，运行 `npm run smoke` 和 `npm run contract`，确认没有回归。
- Windows 只有替身证据，交给 CI；不写成已在 Windows 上验证。
- 实现后交给独立 reviewer 至少两轮审核。

## 修订记录
