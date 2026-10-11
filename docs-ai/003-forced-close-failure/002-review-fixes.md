# 003.002 — 独立审核结果与修复

## 背景

[001-action.md](001-action.md) 写了「本条目的改动还没有被独立审核」。之后由另一个 Sonnet 子 agent（不是实现者）只读审核了 `2e99bfd..6d2b937`，并把 `4fd87e3..6d2b937` 全分支当作第一次看到那样重审了一遍，共两轮。

审核者在临时副本中独立复现了 RED：用 2e99bfd 的 `src/server.ts`，替身用例报 `unref` 调用 0 次，进程级用例 15 秒超时，与行动记录一致。结论是没有 P1 和 P2，有 3 条 P3。

## 变更

| ID | 问题 | 处理 |
| --- | --- | --- |
| FCF-001 | `test/signal.test.ts` 的「杀不死」夹具不会自行退出；用例若在读到 pid 之前失败，`finally` 不清理它 | 已修：`finally` 中 `ompPid` 仍未知时，从夹具目录的 `child.pid` 再读一次并杀掉。没有专门构造这种失败路径来验证 |
| FCF-002 | `src/server.ts` 写 stderr 诊断时若同步抛错，会替换原来的「did not exit after force termination」错误 | 已修：写入包在 try/catch 中，属于已核对规格目标 2、3 的范围。替身中的 `process.stderr.write` 改为记录后抛错；去掉 try/catch 时两项都因拿到 `synthetic stderr EPIPE` 而失败（RED），恢复后通过 |
| FCF-003 | README 的「exits with code 1」没有限定只适用于非信号路径 | 已修：补上「或按收到的信号退出」 |

已执行（Darwin 27.0.0 arm64，Node `v26.10.0`）：

| 命令 | 结果 |
| --- | --- |
| 去掉 try/catch 后运行 `npx vitest run test/server.test.ts -t "forced-kill failure races"` | FAIL（预期 RED）：两项拿到 `synthetic stderr EPIPE`，而不是原始错误 |
| 恢复后 `npm run check` | PASS：3 个测试文件、31 项；没有残留夹具进程 |

## 当前状态

- 001-action 所说的「尚未独立审核」，至此由两轮审核和本文件闭合。
- 本文件的三项修复还没有被再次审核。
- 「Windows 上这条失败分支只有替身证据」，以及「真实的 SIGKILL 后不退出没有复现」，仍然成立。
