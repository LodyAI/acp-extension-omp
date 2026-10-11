# 002.005 — Windows 上的退出状态限定

## 背景

Lody 独立审核提出 LDY-002（P3）：[000-plan.md](000-plan.md) 的目标 2「适配器仍以收到的信号退出」，以及 `src/server.ts` 中 `closeOnSignals` 的注释，都没有限定平台。审核者推断 Windows 上的退出状态并不统一。

2026-10-09 读 libuv `v1.x` 的 `src/win/process.c`，`uv__kill` 证实了这一点：

- `SIGINT`、`SIGTERM`、`SIGKILL`、`SIGQUIT` 一律调用 `TerminateProcess(process_handle, 1)`，退出码是 1；
- 其他信号（包括 `SIGHUP`）返回 `ENOSYS`，于是走 [002-signal-fallback.md](002-signal-fallback.md) 的兜底，以 `128 + 信号编号` 退出，`SIGHUP` 是 129。

## 变更

- 目标 2 只在 POSIX 上成立。Windows 没有「被信号终止」这种退出状态：`SIGINT`、`SIGTERM` 以 1 退出，`SIGHUP` 以 129 退出。两者都是非零，都不会伪装成成功；回收 OMP 的顺序和平台无关。
- `src/server.ts` 只改了注释：`closeOnSignals` 的文档注释写明上面两种 Windows 状态，兜底处的注释改为「非零、按信号编号」。代码行为没有变化。
- 根 `README.md` 原本就只对 POSIX 声明按信号退出，不需要改。

## 当前状态

Windows 上的退出码来自 libuv 源码，没有在 Windows 上实测。本文件的改动还没有经过独立审核。
