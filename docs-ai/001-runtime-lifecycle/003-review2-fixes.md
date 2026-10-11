# 001.003 — 第二轮 review 修复与测试数量修订

## 背景与审查范围

第二轮独立 review 报告 LIFE-002（强杀错误与随后 exit 的竞态）、DOC-COUNT-002（测试数过时）和 DOC-REVISION-002（修订记录缺失）。复核范围：`src/server.ts` 关闭/强杀路径、`test/server.test.ts` 合成 ChildProcess double、`README.md` 当前测试数量，以及 `000-plan.md` 的修订记录。第一轮的 REL-001、DOC-INDEX-001、DOC-EVIDENCE-001 保持既有修复；未修改 `package-lock.json` registry、`TESTING.md` Required cases、真实 OMP 矩阵或 Lody 文件。

## 变更

- **LIFE-002**：强杀信号返回 false 或记录异步错误后，若第二次 `waitForExit` 已观察到子进程退出，`close` 现在成功返回；只有第二次等待超时或仍未退出才拒绝，并将 `killError` 保留为失败 cause。失败仍报告 `onParentFailure` 并设置失败退出状态。
- 新的确定性 race 场景覆盖强杀返回 false/异步 error 后紧接 exit，断言关闭成功、`process.exitCode` 不变且父连接没有收到失败；同一参数化用例还保留未退出时的失败断言。既有 ignore-EOF 同 PID 强杀成功测试继续保留。
- **DOC-COUNT-002**：`README.md` 当前测试数更新为 21。`001-action.md` 保持不变；其 19 项是前一阶段行动记录。本修订将最终数量验收定为 21 项（connection 13、server 8）。
- **DOC-REVISION-002**：只在 `000-plan.md` 的修订记录追加本文件链接；未改计划其他正文。`002-review-fixes.md` 与已发布 `001-action.md` 未回写。

## 验证矩阵元数据

| 项目 | 本轮实际值 |
| --- | --- |
| 日期 | 2026-10-09 |
| Node.js | `v26.10.0` |
| OS / 架构 | `Darwin 27.0.0` / `arm64` |
| Adapter commit | 基线 `4fd87e3135631bef634230bf2e1c155910e831ee`；工作树有未提交改动，本轮未创建 commit |
| Core | `acp-extension-core@0.1.8` |
| OMP | `omp --version` stdout 为 `omp/18.8.4`；这是补充版本证据，不替换根文档中记录的 18.3.1 |
| Smoke profile | `lody-smoke-${process.pid}`，运行时使用临时 HOME 和独立 profile |
| Contract profile | `contract`，使用临时 HOME/XDG 目录和 loopback-only 合成模型 |
| OMP digest | 未记录；不收集本机 OMP 可执行文件 fingerprint |

## 命令结果

| 命令 / 场景 | 结果 |
| --- | --- |
| `npm test -- test/server.test.ts -t 'accepts a child exit after force-kill failure' --testTimeout=10000`（修复前） | FAIL（预期 RED）：两个场景均因已观察到 exit 后仍抛 `OMP child process force termination failed` |
| 同一 race 定向测试（删除 exit 后的无条件 `killError` 拒绝后） | PASS：`false` 与 `async-error` 两个场景均 resolve，exit code 保持原值 |
| `npm test -- test/server.test.ts --testTimeout=10000` | PASS：8 项通过；含 race、仍存活失败和同 PID 成功退出场景 |
| `npm run check` | PASS：2 个测试文件、21 项通过；类型检查通过 |
| `npm run build` | PASS |
| `npm pack --dry-run` | PASS：prepack 构建成功，制品为 15 个文件 |
| `omp --version` | PASS：stdout 为 `omp/18.8.4` |
| `npm run smoke` | PASS：隔离 profile initialize/new/load；未发送 prompt |
| `npm run contract` | PASS：OMP 18.8.4、loopback-only 合成模型的真实 ACP contract |
| `windows-latest` CI | 未执行；本机只验证了 Darwin/POSIX 路径。Windows `ChildProcess.kill` false/error 分支须等待 CI 证据 |

## 当前状态

LIFE-002、DOC-COUNT-002、DOC-REVISION-002 已在工作树修复。最终测试总数为 21；第一阶段 `001-action.md` 的 19 项历史结果保留原样。Windows CI 未验证，不据此宣称 Windows 路径通过。
