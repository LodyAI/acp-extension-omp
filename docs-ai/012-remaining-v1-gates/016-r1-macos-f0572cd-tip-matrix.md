# 012.016 — R1：f0572cd tip 的 macOS arm64 Latest／Previous 矩阵记录

## 背景

[011](011-r1-macos-18.12.6-clean-matrix.md) 的运行证据钉在 `51e1a04`；[013](013-omp-18.12.6-target-review.md) 将 Latest／Previous 目标改为 18.12.6／18.12.5，当时 Previous 未安装、未测、阻塞。历史记录的时态和证据限制见 [015](015-factual-corrections.md)。本修订保留这些历史检查点，补记 PR #19 merge 后 tip 的两行矩阵。

以下运行事实由 TommyWu 在本轮提供，按已在本机跑通的事实记录；本次文档编辑未重新执行这些命令，也不补造原始输出、临时路径或独立审核签字。这是本地证据，不是发布声明。

## 变更

### 环境与来源

| 字段 | 值 |
| --- | --- |
| 记录日期 | 2026-10-26 |
| 适配器提交 | `f0572cd904b88f9d80101d9b32ec7d5bffe1b6d1`（`origin/main`，PR #19 merge） |
| 构建来源 | 该 tip 的干净 worktree |
| Node / npm | v22.22.3 / 10.9.8 |
| OS | macOS，Darwin 27.2.0 arm64 |
| Core | `acp-extension-core` 0.1.8（沿用仓库固定依赖，不是本轮新增的安装目录核验） |
| 被测入口 | 从该 tip 执行 `npm pack`，安装到含空格路径的独立目录；使用安装后的 `dist/index.js` |
| 归档 | tgz SHA-256 `e92db722d0983295546ed647e8f2a894819b3e843a6704c581fdf146d226b6d8`，约 34651 bytes，15 files |
| 测试配置 | isolated profile，loopback-only model；沿用 runner 的 `contract`／smoke `lody-smoke-<pid>` 配置，不记录凭据或原始 provider 数据 |
| 启动边界 | runner 使用 `omp --mode rpc`；不使用 `omp acp` |

### Latest／Previous 矩阵

两行均使用上述 tip、Node/npm、OS 与安装后入口。

| 角色 | OMP 与来源 | SHA-256 / 大小 | 结果 |
| --- | --- | --- | --- |
| Latest stable | 18.12.6，`~/.local/bin/omp` | `cfbb5e38cd8f8a3be55e710700be587d287deaacdc58c9b0a661c5086bccfe58`，197245984 bytes | smoke + contract 通过 |
| Previous stable | 18.12.5，官方 Release 资产 `omp-darwin-arm64` | `5e50df9879de9165d5c6df5e48bb5d038737270013cd849e189da7774fb7368b`，197113888 bytes；与 `SHA256SUMS` 一致 | smoke + contract 通过 |

18.12.6 的摘要与 011 的官方资产字节记录一致；本修订不声称重新执行了 011 的 GitHub／Homebrew 来源查询。18.12.5 的本机安装绝对路径未在本轮提供，不补造。

### 命令与结果

| 步骤 | 已提供的本机结果 |
| --- | --- |
| `npm ci --ignore-scripts && npm run check` | 干净 worktree 上通过；4 files / 373 tests |
| `npm run build` | 通过 |
| `npm pack` 与独立安装 | 从该 tip 打包，安装到含空格路径的独立目录；归档摘要、约大小与文件数见上表 |
| `npm run smoke`，OMP 18.12.6 | 安装后的入口，isolated profile；通过 |
| `npm run contract`，OMP 18.12.6 | 安装后的入口，isolated profile，loopback-only model；通过 |
| `npm run smoke`，OMP 18.12.5 | 安装后的入口，isolated profile；通过 |
| `npm run contract`，OMP 18.12.5 | 安装后的入口，isolated profile，loopback-only model；通过 |

本轮没有提供两次构建字节比对或 `node scripts/verify-package.mjs` 的新结果；单次 tgz 摘要和约大小不升级为 R4 可复现发布制品验收。

### 合成边界

真实 OMP 覆盖 Required cases 1–8 的主路径；与 011 相同，以下部分仍是 synthetic／fixture，不是真实 OMP provider 证据：

- 用例 5 的 wrong-identity 段。
- 用例 7 的 duplicate-message／missing-cost。
- 用例 9 的子进程失败夹具。

runner 成功不使上述部分变成真实 OMP 证据，不证明原生后台任务、自动 compaction、真实进程退出路径、完整模型切换合同或真实 Lody e2e。

### COMPATIBILITY.md 与 TESTING.md 判断

Previous stable 18.12.5 的「未安装、未测」阻塞已解除，范围仅为本机 macOS arm64 / Node 22.22.3 / tip `f0572cd` 的安装后入口。Latest stable 仍为 18.12.6，并新增同一 tip 重跑证据。`51e1a04` 的历史矩阵和 013 的静态 review 保留，不把历史 Node 26 结果写成本轮重跑。

## 未验证

- 其他 OS／架构，以及批准矩阵尚缺的平台行。
- Node 26 本轮未重跑。
- R2 的无身份迟到用量合同与来源关联。
- R3 能力宣告、R4 冻结候选的可复现制品验收、R5 Lody 临时 mirror refresh／install、R6 发布／公开字节回读／正式 pin。
- 真实 Lody e2e、独立审核者对本轮候选 source／tests／release bytes 的签字。
- 上述合成边界及原生后台／compaction／真实退出路径。

## 引用

基准 tip 为 PR #19 merge；历史运行见 011，目标静态 review 见 013，证据更正见 015。Required cases 保持原样。

## 当前状态

只补文档证据，不改 `src/`、`test/`、`scripts/`、`package.json` 或能力宣告。整体 012 仍为「计划中」，Release 1 未完成；本机两行进展不等于批准的完整矩阵通过。`RELEASE.md` 的未勾项保持不变，不授权发布、合并 PR #14 或修改 Lody manifest。
