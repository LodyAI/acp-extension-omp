# 012.017 — Release 1 范围收口与 18.20 目标

## 背景

[009](009-user-scope-decisions.md) 把子 agent 状态定为「面板不可行则移出」，[017 计划](../017-subagent-status-by-id/000-plan.md) 的只读核实结论是不可行，但移出还没有人拍板。当前适配目标停在 18.18.1，上游 Latest 已是 18.20.2。load、resume、fork、图片的翻译路径已经在 `main` 和候选分支上，`initialize` 只宣告 usage。

## 裁决（用户，2026-11-15）

| 项 | 裁决 |
| --- | --- |
| 子 agent 状态 | 正式移出 Release 1。不宣告 `_meta.lody.subagents`，不实现 017 的映射。 |
| 适配目标 | Latest stable 改为 18.20.2，Previous stable 改为 18.20.1。 |
| 18.20.1 二进制 | 授权从官方 GitHub Release 下载 `omp-darwin-arm64` 到隔离临时目录，核对大小和 SHA-256 后只用于隔离测试（smoke、contract 和 019 的能力探针）。不替换本机 `omp`，不进入仓库或制品。授权只覆盖这一个资产。 |
| 能力宣告 | 方向是把 load、resume、fork、图片都对 Lody 开放。具体宣告集合、证据和例外由 [019 计划](../019-capability-advertisement/000-plan.md) 决定，核对通过后才改 `src/`。 |
| 推送与 PR | 允许推送候选分支并开到 `main` 的非 Draft PR。合并、tag、发布和 pin 不在本次授权内。 |

## 变更

Release 1 的用户底线收口为：开对话、连续文字对话、中途取消、计入 agent 每日用量、恢复会话、基本 fork、提交图片、换模型、显式改标题。子 agent 状态和后台终端都不在内。

本文件不关闭 R1 的其他平台行、R4 之后的制品、mirror、tag、发布和 pin。R6 仍需维护者另行授权。

## 编号说明

本目录跳过 016：`016-r1-macos-f0572cd-tip-matrix.md` 已被未合并的 PR #20 占用。

## 引用

基准正文是同目录的 `000-plan.md`；被收口的条件裁决见 [009](009-user-scope-decisions.md)。

## 当前状态

整体 012 仍是「计划中」。18.20.2 的本地与干净提交证据见 `TESTING.md`。
