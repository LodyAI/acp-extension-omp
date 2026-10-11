# 001.005 — Windows CI 结果、eof 用例跳过与独立审核处理

## 背景

[001-action.md](001-action.md) 和 [002-review-fixes.md](002-review-fixes.md) 写的是「Windows CI 未执行」。分支推送后 CI 实际跑了，结果和随后的修正记录在本文件，已发布的那两份不回写。

用户安排的独立审核原定交给 Codex。Codex 用 `gpt-6-astra`、`gpt-5.4`、`gpt-5.4-mini` 都返回 400：当前 ChatGPT 账号不支持这些模型，一次审核都没跑成。经用户同意，改由 Sonnet 子 agent 只读审核从 `4fd87e3` 到 `0569e42` 的完整 diff，共两轮。结论是没有 P1 和 P2，有 8 条 P3（SIG-001 到 SIG-008）。信号相关的几条记在 [../002-signal-shutdown/003-independent-review.md](../002-signal-shutdown/003-independent-review.md)。

## 变更

**Windows CI**

- run `37874216376`：`ubuntu-latest` 两个 Node 版本通过；`windows-latest` 的 22.14.0 和 23.6.0 都只挂了 `closes the actual ACP connection after OMP eof`，表现为 `connection.closed` 超时。
- 第一次修正把夹具改成 `fs.closeSync(1)`（`7ccf70b`，run `37874381586`），Windows 仍然失败。查 libuv `v1.x` 源码后确认：
  - `src/win/fs.c` 的 `fs__close` 只在 `fd > 2` 时才真正关闭；
  - `src/win/pipe.c` 的 `uv_pipe_open` 对 fd 0–2 用 `DuplicateHandle` 复制出新句柄。

  所以在 Windows 上，活着的 Node 进程没有公开 API 能让父进程读到自己 stdout 的 EOF。另外在 macOS 上实测，关闭 `process.stdout._handle` 也不会产生 EOF。
- 最终处理（`0569e42`，run `37874658160`）：夹具恢复成 `process.stdout.end()`；eof 用例在 Windows 上用 vitest 的 `skip()` 明确跳过并注明原因，POSIX 上照旧用真实管道执行。结果是四个组合全部通过：Windows 26 项通过、1 项跳过，Ubuntu 27 项全部执行。Windows 日志里能看到 `force-terminates an OMP child that ignores stdin EOF` 和两个强杀竞态用例都执行了。

**审核发现的处理**

| ID | 处理 |
| --- | --- |
| SIG-001 强杀用例超时余量偏小 | 已修：强杀 close 的等待上限从 3 秒提到 `FORCED_CLOSE_TIMEOUT_MS`（6 秒），这两个用例的 vitest 超时设为它的 3 倍 |
| SIG-002 `missing` 用例的 PATH 带上了 node 所在目录 | 已修：`missing` 模式的 PATH 只含空的临时目录，恢复为基线行为，测试不会找到真实 `omp` |
| SIG-003 Windows 跳过 eof 用例的理由没有证据 | 拒绝改动：跳过理由已用 libuv 源码核实（见上）。审核者建议改用 `PassThrough` 替身覆盖 EOF；EOF 处理是平台无关的 JS，POSIX 已有真实管道证据，这次不加 |
| SIG-004 `test/` 不经过类型检查 | 延期：改动之前就存在，开启后有 17 个类型错误，其中包括原有 `connection.test.ts` 的问题，需要单独处理 |
| SIG-008.1 修订记录缺 `002-review-fixes.md` | 已修：在 [000-plan.md](000-plan.md) 修订记录末尾补登 |
| SIG-008.2 `002`、`003` 两次修订改了 `src` 行为，但没写规格核对 | 记录不改：两者都是计划目标 2 范围内对审核发现的修复，没有扩大方案；当时没有另做核对，这里如实说明 |
| SIG-008.3 README 的 27 项没区分平台 | 已修：注明一项 stdout EOF 用例只在 POSIX 上运行 |
| SIG-008.4 「Windows CI 未执行」已过时 | 由本文件更正 |

已执行（Darwin 27.0.0 arm64，Node `v26.10.0`）：

| 命令 | 结果 |
| --- | --- |
| `npm run check` | PASS：类型检查通过；27 项 |
| `npx vitest run test/server.test.ts -t "OMP missing"` | PASS |

## 当前状态

- 本轮的测试和文档修正，是在审核完成之后做的，还没有被再次审核。
- 本文件之后的 CI 结果见提交后的 run。
- Windows 上的真实 OMP 启动，以及 stdout EOF 路径，仍然没有证据。
