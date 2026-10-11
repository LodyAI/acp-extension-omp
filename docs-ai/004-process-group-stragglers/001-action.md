# 004 — OMP 首进程退出后的残留进程与管道：行动记录

## 时间线

| 日期 | 变更 | 引用 |
| --- | --- | --- |
| 2026-10-09 | 用构建产物复现 LDY-004，起草计划，用户核对后允许实现 | [000-plan.md](000-plan.md) |
| 2026-10-09 | 先写失败测试，再改 `close`：在宽限期内等整个进程组清空，截止时对进程组发 SIGKILL，并给 stdio 释放设上限 | 命令记录见下文 |

第一次复现时，适配器 6 ms 就以 code 0 退出，孙进程也已不存在。原因是复现脚本在孙进程注册 SIGTERM 处理函数之前就发出了 SIGTERM。改为孙进程注册好处理函数之后再写出 pid、脚本等这个文件出现后再关闭 stdin，才复现出挂住。测试夹具采用同样的发布顺序。

## 结果与当前状态（截至 2026-10-09）

`src/server.ts` 的改动：

- 新增三个辅助函数：
  - `groupAlive(pgid)`：用信号 0 探测进程组，除 ESRCH 以外都视为还有成员；
  - `stdioOpen(child)`：子进程的 stdout 或 stderr 是否还没关闭；
  - `waitUntil(done, deadline)`：以 `SHUTDOWN_POLL_MS`（25 ms）为间隔轮询，到截止时间为止。
- `close` 的流程：
  1. 发 SIGTERM（Windows 上是结束 stdin）时记下 `graceEnds`。
  2. POSIX 上，首进程退出且进程组清空才算结束；Windows 上只看首进程退出。到 `graceEnds` 还没结束，就发 SIGKILL：POSIX 发给进程组，Windows 发给子进程。
  3. SIGKILL 之后，在第二个宽限期内首进程仍未退出，或者进程组仍有成员，就按 003 的方式处理失败：`unref`、销毁 stdio、写 stderr、拒绝。首进程已退出时，错误消息是「OMP process group did not exit after force termination」，否则沿用「OMP child process …」。
  4. 成功之后，最多等到 `graceEnds + SHUTDOWN_GRACE_MS`，让 stdout/stderr 自然关闭；仍未关闭就销毁 stdin、stdout、stderr。
- `close(true)` 路径（OMP 意外退出）也走这一套流程。宽限期、启动参数、`detached` 和信号路径都没有改动。

测试的改动：

- `test/signal.test.ts`（只在 POSIX 上运行）：
  - 合成 `omp` 改为按模式生成，新增 `straggler` 模式：派生一个继承 stdout/stderr、忽略 SIGTERM 的孙进程。孙进程注册好处理函数后用 rename 原子发布 pid，并带 30 秒看门狗。
  - 新增两个用例：孙进程被回收、适配器以 code 0 退出、stderr 为空；进程组的 SIGKILL 被拦截时，适配器以 code 1 退出，stderr 含「process group did not exit after force termination」。
- `test/server.test.ts`：
  - 新增共用的 `answerRpc` 和 `noSuchProcess`。
  - 强杀竞态替身模拟的 `process.kill` 支持信号 0：替身存活时进程组存在，退出后抛 ESRCH。
  - 删掉成功分支里「stdout/stderr 未被销毁」的断言：按本计划，所有路径都会释放 stdio。成功分支仍然用「没调用 `unref`、没写 stderr」与失败分支区分。
  - 新增跨平台替身用例：子进程退出后管道一直不关，`close` 要在期限内销毁 stdio，不发 SIGKILL，也不算失败。
- `README.md`：生命周期段落写明了进程组回收和 stdio 释放上限，以及 Windows 不回收子孙进程；回归测试数量改为 35，其中 8 项只在 POSIX 上运行。

已执行（Darwin 27.0.0 arm64，Node `v26.10.0`）：

| 命令 / 场景 | 结果 |
| --- | --- |
| 实现前运行新用例 | FAIL（预期 RED）：两个孙进程用例都在 15 秒时超时；替身用例中 stdio 未被销毁（`[false, false]`）。其余 14 项 server 用例在旧代码上仍然通过 |
| 实现后 `npm run check` | PASS：类型检查通过；3 个测试文件、35 项；没有残留夹具进程或 `.signal-test-*` 目录 |
| 各用例耗时 | 正常 EOF 和信号用例约 0.4 s，没有变慢；回收孙进程约 1.5 s；进程组强杀失败约 2.6 s；stdio 释放替身约 2.0 s；强杀竞态用例从约 3 s 变为约 4 s（成功分支要等 stdio 期限） |
| `npm run build`，然后对 `dist/index.js` 重复背景中的复现 | 适配器约 1051 ms 后以 code 0 退出；OMP 和孙进程都已不存在；stderr 为空 |
| `npm pack --dry-run` | PASS：15 个文件 |
| `omp --version` / `npm run smoke` / `npm run contract` | `omp/18.8.4`；smoke 与 loopback-only contract 都通过 |

## 相对计划的偏差

- 方案 4 原本写的是「等 `ChildProcess` 的 `close` 事件」。实际改为轮询 stdout/stderr 的 `closed`/`destroyed` 状态，原因有两个：
  - 等事件，必须在事件发生之前就挂上监听，否则会错过已经发出的事件；
  - 进程内替身不会发出 `close` 事件。

  效果相同：正常关闭时等管道自然关闭，期限到了就销毁。
- 强杀竞态用例删掉了成功分支对 stdio 的断言（见上文），这是本计划带来的预期语义变化，不是绕过测试。

## 未验证的问题

- Windows 上只有替身证据：stdio 释放这一部分跨平台运行，需要看 CI；孙进程不回收，这是计划的非目标。
- 不可中断睡眠这类真实的「SIGKILL 杀不死」没有复现，这里是用拦截进程组 SIGKILL 模拟的。
- 进程组 id 复用的窗口没有验证：首进程退出、进程组也清空之后，如果在一次轮询间隔（25 ms）内，同一个编号被一个新的进程组首进程拿到，`groupAlive` 会把它误判为还有成员，截止时 SIGKILL 会打到无关的进程组。改动之前，`close` 对已退出首进程的 `-pid` 发信号，也有同类窗口。
- 本条目的改动还没有被独立审核。
