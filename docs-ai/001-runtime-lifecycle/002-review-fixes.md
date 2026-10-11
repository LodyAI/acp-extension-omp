# 001.002 — 第一轮 review 修复与补充证据

## 背景

第一轮独立 review 提出 LIFE-001、REL-001、DOC-INDEX-001、DOC-EVIDENCE-001 四项 P2。本记录保存修复和本轮补充验证，不回写 `001-action.md`。

## 变更

- **LIFE-001**：`waitForExit` 现在区分实际退出与超时。强杀后若进程仍存活、信号未被接受或收到异步终止错误，关闭 Promise 拒绝；失败设置 `process.exitCode = 1` 并报告 `onParentFailure`。ACP abort 触发的 fire-and-forget close 显式捕获拒绝，避免未处理 rejection。新增合成 ChildProcess double；本机执行了 POSIX process-group 失败路径，Windows 分支配置 `ChildProcess.kill` 返回 `false` 与异步 `error` 两例，须由 Windows CI 实际执行确认。既有 ignore-EOF 同 PID 成功退出路径保留。
- **REL-001**：`package.json` 的 `prepack` 改用 `scripts/prepack.mjs`。脚本先删除整个 `dist/`，再通过当前 Node 和 npm 的 `npm_execpath` 运行 `npm run build`；失败退出会阻断打包。
- **DOC-INDEX-001**：`docs-ai/README.md` 第 9 行改为提示文末已有编号条目索引，不再声称尚无条目。
- **DOC-EVIDENCE-001**：本轮 OMP 18.8.4 检查作为 supplemental evidence 单独记录，不取代根 `README.md`、`TESTING.md`、`COMPATIBILITY.md` 中已有的 OMP 18.3.1 本地证据，也不更改这些根文档。

## 验证矩阵元数据

| 项目 | 本轮实际值 |
| --- | --- |
| 日期 | 2026-10-08 |
| Node.js | `v26.10.0`（本轮实际命令运行时） |
| OS / 架构 | `Darwin 27.0.0` / `arm64` |
| Adapter commit | 基线 `4fd87e3135631bef634230bf2e1c155910e831ee`；工作树有未提交改动，未创建新 commit |
| Core | `acp-extension-core@0.1.8` |
| OMP | `omp --version` stdout 为 `omp/18.8.4`；OMP digest 未记录，按本仓库隔离与数据最小化策略不采集本机 OMP 可执行文件 fingerprint |
| Smoke profile | `lody-smoke-${process.pid}`，脚本每次运行生成独立 profile，位于临时 HOME；PID 不作为持久化证据 |
| Contract profile | `contract`，临时 HOME/XDG 目录、loopback-only 合成模型；无用户 profile、凭据或外部模型端点 |

## 命令结果

| 命令 / 场景 | 结果 |
| --- | --- |
| `npm test -- test/server.test.ts -t 'reports forced termination failure' --testTimeout=10000`（修改实现前） | FAIL（预期 RED）：两个断言观察到 close Promise resolve，而非拒绝 |
| 同一强杀失败定向测试（修改实现后） | PASS：本机 POSIX process-group 失败路径的两个情形通过；Windows ChildProcess.kill 分支未在本机执行 |
| `npm test -- test/server.test.ts --testTimeout=10000` | PASS：8 项通过，含强杀失败和同 PID 成功退出场景 |
| `npm run check` | PASS：类型检查通过；2 个测试文件、21 项通过 |
| `npm run build` | PASS |
| 创建临时 `dist/obsolete.js` 后执行 `npm pack --dry-run` | PASS：`prepack` 删除旧 `dist/` 并重建；制品为 15 个文件，不含 `dist/obsolete.js` 或 `scripts/prepack.mjs` |
| `omp --version` | PASS：stdout 为 `omp/18.8.4`，满足 smoke 门禁 |
| `npm run smoke` | PASS：隔离 profile 的 initialize/new/load；未发送 prompt |
| `npm run contract` | PASS：OMP 18.8.4、loopback-only 合成模型的真实 ACP contract |
| `windows-latest` CI | 未运行；本轮机器为 Darwin，Windows `ChildProcess.kill` 测试路径仍待 Windows CI 证据 |

## 引用

- [000-plan.md](000-plan.md)
- [001-action.md](001-action.md)

## 当前状态

四项 review P2 已在工作树修复并按上表验证。Windows CI 尚未执行；不得据此宣告 Windows 运行结果或扩大 OMP 兼容性。
