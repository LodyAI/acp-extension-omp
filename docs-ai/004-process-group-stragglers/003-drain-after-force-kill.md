# 004.003 — 强杀之后仍给 stdio 一个排空窗口

## 背景

对 #2 的一次只读审核（Grok 4.7，发现已对照代码核实）提出一项 Minor：`close` 的 stdio 排空截止是 `graceEnds + SHUTDOWN_GRACE_MS`，从关闭开始算起。走强杀路径时，SIGKILL 之后的等待可能已经用掉这段时间，确认退出时截止已过，stdout/stderr 被立即销毁，OMP 最后写出的诊断随之丢失。[000-plan.md](000-plan.md) 目标 4 只覆盖了正常路径。

用户（TommyWu）2026-10-11 核对了下面的规格，允许实现。

## 变更

- 规格：确认首进程退出（POSIX 上还要进程组清空）之后，再以 `performance.now() + SHUTDOWN_GRACE_MS` 作为排空截止。正常路径的总上限不变大；强杀路径最多多出一个宽限期。
- `src/server.ts` 按此修改排空截止。
- `test/server.test.ts` 新增替身用例 `delivers OMP's last stderr output written after force-kill`：子进程忽略 SIGTERM，SIGKILL 时退出，并把单调时钟往前拨 5 秒，模拟确认退出时旧截止已过；300 ms 后才写出最后一行 stderr，断言这一行被转发。

已执行（Linux 6.12 x86_64，Node `v22.22.3`）：

| 命令 | 结果 |
| --- | --- |
| 新用例在旧 `src/` 上运行 | FAIL（预期 RED）：转发内容为空字符串，缺少 `omp: final diagnostic` |
| 实现后 `npm run check` | PASS：3 个测试文件、39 项 |

其余检查见 [../002-signal-shutdown/006-second-signal-reap.md](../002-signal-shutdown/006-second-signal-reap.md)。

## 引用

- #2
- [000-plan.md](000-plan.md)

## 当前状态

- 真实 OMP 在强杀后写出最后诊断的情况没有复现，只有替身证据。
- 本文件的改动还没有经过独立的两轮审核。
