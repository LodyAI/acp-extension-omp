# 012.012 — 内置注册、按 agent 日用量与 Lody 侧交接

## 背景

[009](009-user-scope-decisions.md) 把计费改为跟随 Lody 其他内核的每日用量汇总。2026-10-25 用户追加两项裁决，并限定当前只改本仓库、不改 Lody 客户端。同日两次只读调查读了 Lody HEAD `557fdc0b` 及其工作区里尚未提交的 54 个改动（分支 `feat/omp-release1-local-usage-title`）。以下结论均来自读源码和 Lody 自带的测试，没有跑真实 Lody 界面，也没有看私有云端代码。

## 追加裁决（用户，2026-10-25）

| 项 | 裁决 |
| --- | --- |
| 注册 | OMP 注册为 Lody 内置 agent（builtin） |
| 按 agent 查看 | 每日用量里要能单独看到 OMP 那一份 |
| 改动范围 | 当前只改本仓库；Lody 侧改动只列出、交接，不由本仓库实施 |

## 已查到的 Lody 现状

- 日用量唯一来源是 `_lody/session/usage_update`，经 `UsageTrackingService` 上云，按 key／模型／字段取最大值合并（合并语义是推断）。
- `message-handler.ts:1073` 直接丢弃非 builtin agent 的用量，而 `packages/shared/src/ai.ts` 的 `BUILTIN_AGENTS` 里没有 `omp`。
- HEAD 的 `SessionUsageUpdateSchema` 会剥掉 `_meta.lody.usageScopeId`（LI-003）；云端 key 只用 `acpSessionId`。适配器每次 prepare 都换新 scope，于是重新加载或重启后会少算（推断）。
- `UsageSummary` 只有 `byUser` 和 `byModel`，没有按 agent 的维度。
- 未提交改动是「OMP 只在本地按 prompt 记账、不上云、每轮显示费用」，与 009 和本文件冲突。它还把 scope 当成每个 prompt 一个，与适配器每次 prepare 一个 scope 不一致。改动约 7955 行，`oxfmt --check` 有 27 个文件不过，不能整体合入。

## 适配器侧

不改 `src/`。保留每次 prepare 一个 `SessionUsageAccumulator`／`usageScopeId`，不切换 U-B。现有的累计 `modelUsage`（key 为 `${provider}/${model}`）、去重和「cost 缺失即未知」已满足进入日汇总的输入要求。

`agentCapabilities._meta.lody.usage={version:1}` 的宣告条件：下面的 L1–L3 在 Lody 合入；R2（收窄后）、矩阵和独立审核都通过；另写 U 合同并由非起草者核对。在那之前不宣告。

## 交接给 Lody 的改动（本仓库不实施）

| 编号 | 改动 | 依赖 |
| --- | --- | --- |
| L1 | 注册 builtin agentType `omp`（`BUILTIN_AGENTS`、catalog、launch、runtime manifest），按 Lody 的 builtin 合同和 proposed note `2026-09-23-builtin-omp-agent` 推进 | 本仓库的 R4–R6 制品 |
| L2 | 保留 `usageScopeId`，OMP 改走现有云端路径；云端 key 参照 Codex 派生成 `${acpSessionId}:scope:${usageScopeId}`；删除 `ignore_builtin_omp` 和按 prompt 记账的分支 | L1 |
| L3 | 日汇总增加按 agent（`cliType`／agentType）的维度，界面能单独显示 OMP；后端在私有仓库，先提 Issue | L2 |
| L4 | 向云端确认：跨天的累计行算在哪一天；缺失的 `costUSD` 在汇总里当 0 还是当未知 | — |

建议的 Lody 拆分：把 WIP 里的 scope 解析、只信任当前原生会话的帧、`retireHostConnection` 抽出来，重写进 L2 的 PR。标题（主题 D）、通用收尾逻辑（E）、移动端计时器（F）各自单独提交。存储层、每轮费用界面和对应的 spec 一节暂不合入。每个 PR 都要先过 `pnpm format`、`pnpm check`，并遵守 Lody 社区 PR 不超过 1000 行的规定。

## 不变

本文件不授权改 `src/`，也不授权改 Lody 仓库。子 agent 状态和后台终端仍按 009、017 不进 Release 1。

## 引用

基准正文是同目录的 `000-plan.md`；相关条目见 [009](009-user-scope-decisions.md) 和 [017](../017-subagent-status-by-id/000-plan.md)，归属以 `MIGRATION.md` 为准。
