# 003.003 — 「杀不死」夹具的 pid 发布与看门狗

## 背景

第 3 轮独立审核提出 FCF-004（P3），是对 [002-review-fixes.md](002-review-fixes.md) 中 FCF-001 修复的补充。指出了两个窗口，都是推断，审核者没有构造出来：

- 兜底读取 pid 时，如果正好读到写了一半的文件，可能把 SIGKILL 发给一个无关的进程；
- 如果测试在夹具写出 pid 文件之前就失败，夹具会永久残留。

## 变更

- `test/signal.test.ts` 的合成 `omp` 先写 `child.pid.tmp`，再 `renameSync` 成 `child.pid`。POSIX 上 rename 是原子的，读的一方要么读到完整的 pid，要么读不到文件。
- 「杀不死」夹具加了 30 秒看门狗（`setTimeout(() => process.exit(0), 30_000)`），无论测试从哪一步失败，孤儿进程最多存活 30 秒。用例在 OMP 被释放后约 2 秒内断言「OMP 仍在运行」，不受影响。
- `src/` 没有改动。

已执行（Darwin 27.0.0 arm64，Node `v26.10.0`）：

| 命令 / 场景 | 结果 |
| --- | --- |
| 把夹具中的保活与看门狗代码单独运行，2 秒时发送 SIGTERM | 收到 SIGTERM 后仍存活（符合预期），30 秒时以 status 0 自行退出 |
| `npm run check` | PASS：31 项；没有残留夹具进程，也没有残留 `.signal-test-*` 目录 |

## 当前状态

FCF-004 已闭合。本文件的改动还没有经过独立审核。
