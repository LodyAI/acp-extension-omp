# 002.003 — 独立审核结果与信号相关发现

## 背景

[001-action.md](001-action.md) 写了「本条目未经过独立 agent 代码审核」。经用户同意，由 Sonnet 子 agent（与实现者不是同一个模型）只读审核了 `4fd87e3..0569e42`，共两轮，没有 P1 和 P2。为什么没用 Codex、各条发现的总表，见 [../001-runtime-lifecycle/005-windows-ci-review.md](../001-runtime-lifecycle/005-windows-ci-review.md)。

## 变更

本文件只记录与信号回收有关的发现，`src/` 没有改动。

| ID | 处理 |
| --- | --- |
| SIG-005 信号重发只有替身测试，没有真实 `process` 的自动证据 | 延期：`npm run check` 在构建之前运行，测试拿不到可执行的入口。已有的证据是 [002-signal-fallback.md](002-signal-fallback.md) 里由实现者对构建后的 `dist/index.js` 实际执行的三种信号复现。审核者没有复现这一项 |
| SIG-006 无条件注册 SIGHUP 会覆盖 `nohup` 的忽略设置 | 撤回：2026-10-09 在 Darwin 上实测，`nohup node -e 'setTimeout(()=>{},4000)'` 收到 SIGHUP 后以 129 退出。Node 启动时本来就会重置继承来的信号处理，所以这次改动没有改变 `nohup` 下的行为 |
| SIG-007 强杀失败后 `close` 拒绝，stdin EOF 路径下仍在运行的子进程句柄可能让适配器挂住 | 延期，未验证：只在 SIGKILL 发出 1 秒后子进程仍未退出时出现，比如进程处于不可中断睡眠。修复要改 `src/` 的失败语义，需要另写计划并经核对 |

## 当前状态

- 001 和 002 至此都经过了一次独立的两轮审核。
- 本轮修改了测试和文档，这些修改还没有被再次审核。
- Windows 上真实的信号行为仍然没有证据。
