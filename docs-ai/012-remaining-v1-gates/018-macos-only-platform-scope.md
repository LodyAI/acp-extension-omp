# 012.018 — Release 1 的平台范围只有 macOS arm64

## 背景

`000-plan.md` 的 R1 把 18.2.8 的非 macOS 行和各目标 OS 的退出路径列为仍缺的证据，`README.md` 和 `COMPATIBILITY.md` 写发布要通过操作系统矩阵。截至 2026-11-16，所有真实 OMP 证据都来自 macOS arm64：Latest stable 18.20.2 和 Previous stable 18.20.1 在 `d6362de` 的干净导出上通过了 smoke、contract 和能力探针。Linux 和 Windows 上只有 CI 的合成测试。

## 裁决（用户，2026-11-16）

目前只有 Mac 可以做测试。Release 1 的平台范围定为 macOS arm64。

## 变更

- Release 1 的批准矩阵是 macOS arm64 上的 Latest stable 和 Previous stable 两行。
- 其他 OS 和架构的行不再是 Release 1 的门禁，包括 18.2.8 的非 macOS 行和各目标 OS 的退出路径。它们仍照实列为未验证，不声称支持。
- 进程回收在 Windows 上的已知限制（见 `COMPATIBILITY.md` 的「进程回收限制」）不变，也没有因此变成已验证。
- `README.md`、`COMPATIBILITY.md` 的 Runtime and release policy 和 `TESTING.md` 的 Remaining gates 同步了这句范围。

## 不变

- 本文件不勾选 `RELEASE.md` 的任何复选框。批准矩阵是否已通过、独立审核是否完成，仍由维护者在发布门禁上确认。
- 原生后台任务、自动 compaction、真实进行中进程失败的证据要求没有被本裁决触及。
- R4 之后的制品、mirror、tag、发布、公开字节回读和 Lody manifest pin 不变，R6 仍需另行授权。
- Lody 把这个适配器提供给哪些平台的用户，由 Lody 仓库决定；在非 macOS 平台上启用它没有本仓库的证据支持。

## 引用

基准正文是同目录的 `000-plan.md`；范围收口见 [017](017-release1-scope-and-target.md)。

## 当前状态

整体 012 仍是「计划中」。
