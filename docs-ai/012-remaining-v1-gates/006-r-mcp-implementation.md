# 012.006 — R-MCP 独立核对与回归准备

## 背景

本修订记录 `003-mcp-session-acceptance.md` 的独立规格核对及测试先行交付，不把整个 012 标成已核对或已实现。当前仅批准接受后丢弃 MCP 列表，不是 MCP 工具桥。

## 规格核对

核对者：非起草者 `SpecGateReview`；两轮核对日期均为 2026-10-24。

| 轮次 | 已检查 | 结论 |
| --- | --- | --- |
| 第一轮 | `000-plan.md` 及 002/003/004 修订的目标、非目标、备选、难以回头的动作与验收；对照 `AGENTS.md`、`MIGRATION.md`、`RELEASE.md`、`TESTING.md`、`README.md`、`COMPATIBILITY.md` 及 `docs-ai/README.md`，并查看相关适配器消费者、SDK/Core 声明和合同断言 | **允许实现 R-MCP，仅该阶段**。现存拒绝规则与 003 有真实冲突，须先记录许可、更新 `AGENTS.md`，再改 `src/`；不需要用户重选已选方向。R-UX 的 R0-001、R0-002 未解决，整体不 clean。 |
| 第二轮 | 重新完整阅读 `000-plan.md` 及 002/003/004，复核两项问题，并对照常驻规则和 `scripts/contract.mjs` 的 initialize 能力断言 | 再次明确 **允许实现 R-MCP，仅限 003 的接受后丢弃**；三入口、空/非空列表、原生请求不含 MCP 和能力集不变均需覆盖。两项问题仍未解决，无新增确定问题，整体仍不 clean。 |

两轮核对不包含 Lody 实际界面、目标 OMP 二进制及真实字段/来源关联、完整源码测试的独立审核、六行 CI、发布制品、镜像或公开回读，也没有运行 build、lint、tests 或 formatter。许可不能解释成 R-UX、R2、R3 的实现许可，亦不构成 R6 的维护者授权。

- **R0-001（P2，未解决）**：R-UX 提前要求 usage 宣告，却依赖后置 R2 原生来源关联结论及 R3 门禁，形成顺序循环。须先明确未宣告实现/采证与最终宣告/用户验收的先后，不能用普通 contract 通过关闭 R2。
- **R0-002（P2，未解决）**：fork、图片、模型、标题、子 agent 和后台终端仍缺逐项宿主翻译合同、能力键及验收。只连接原生命令或开启订阅不等于 Lody 可用，尤其不能把 `set_session_name` 当成自动标题能力的证明。

## 本轮变更

仅准备 `test/server.test.ts` 和 `test/connection.test.ts` 的消费者回归：

- 两层分别以 new、load、resume 参数化覆盖非空、名为 `lody` 的 stdio MCP 列表。
- 经真实适配器建立会话、完成一次合成 prompt，并核对精确原生 `sessionFile`；load 的 ACP 返回值不要求新增 `sessionId`，以原请求身份继续 prompt 证明实际会话可用。
- 在同一成功路径核对完整原生请求字段，确保 `new_session` / `switch_session`、`get_state` 和 prompt 均不携带 MCP 配置；不加入单独 mock echo 或源码文本断言。
- 空列表和 initialize 精确能力集复用已有测试；身份不匹配、missing/empty/directory、切换失败及活跃工作等原有非 MCP 拒绝用例保持不变。目标两份测试原先没有显式 MCP 拒绝用例，无需为切换合同删除其他错误测试。

本轮不改生产代码或常驻规则；后续实现者须先落实 `AGENTS.md` 边界更新，再移除 server 和 connection 的两道 MCP 非空拒绝。整个 012 尚未完成，因此不写 `001-action.md`。

## 待执行证据

本轮未运行测试，下列命令均为待执行，不是通过记录。主 Agent 应先运行精确 RED：

```sh
npm run test -- --exclude '**/.claude/**' test/server.test.ts test/connection.test.ts -t 'accepts non-empty lody stdio MCP'
```

预期现有实现的 server 三入口在 `validate` 抛出 `OMP ACP adapter V1 does not support MCP servers`；connection 三入口在 `rejectMcp` 抛出 `OMP ACP adapter V1 does not support MCP server configuration`。这是源码所示的预计失败原因，尚无实际 RED 输出。若失败原因不同，必须先定位，不能直接视为正确 RED。

两道拒绝移除后，主 Agent 再运行覆盖现有空列表、身份和文件边界的完整目标测试及类型检查：

```sh
npm run test -- --exclude '**/.claude/**' test/server.test.ts test/connection.test.ts
npm run typecheck
```

显式排除 `.claude`，避免把用户 worktree 内测试计为本仓库证据；不修改其目录或既有收集配置。合成测试不证明 OMP 18.12.2 / 18.12.1 或 Lody 实际兼容；旧候选 3258961 的 macOS 证据不能替代新实现证据，真实合同、矩阵与发布门禁仍待执行。

## 后续执行记录（2026-10-24）

主 Agent 已实际执行上面的精确 RED 命令：收集六个目标用例，六例均因既有 MCP 拒绝失败。server 三例为 `Invalid request: OMP ACP adapter V1 does not support MCP servers`；connection 三例为 `OMP ACP adapter V1 does not support MCP server configuration`。主 Agent 确认不是测试设置错误。此前“待执行”描述的是测试先行交付时状态，本段记录后续实测。

据此继续同一 R-MCP 切片：先在 `000-plan.md` 仅登记 R-MCP 局部核对及许可，整个计划仍为「计划中」；再更新 `AGENTS.md` 常驻边界，随后移除两层 MCP 拒绝。README 的 V1 翻译面同步说明接受后丢弃。其余验证、能力和启动参数保持现状。

GREEN、类型检查、build 及编译适配器的合成 smoke 等待主 Agent 统一执行；本段不记录任何通过结论。

已落地的生产改动仅为删除 `src/server.ts` 的非空列表 `validate` 及三处调用、`src/connection.ts` 的 `rejectMcp` 及三处调用；未改导出接口、其他验证、能力集、usage 或启动参数。除 `README.md` 的翻译面和 `AGENTS.md` 的常驻边界外，无需修改其他根文档。

另准备一次性脚本 `/tmp/acp-omp-r-mcp-smoke.ai2oyi/smoke.mjs`，未运行。它以真实编译后的 adapter 进程连接隔离的合成 OMP 可执行夹具，经 ACP 为 new/load/resume 分别传入非空 `lody` stdio MCP，核对三份精确原生身份及三次 prompt 完成、九个原生请求的完整字段、能力集不变、未启动 MCP 工具进程，并检查 adapter 退出码为 0 及 OMP 进程组已回收。运行时只在临时目录建立合成 home/workspace，结束时删除运行夹具；不使用真实 OMP、用户 profile 或模型端点。编译由主 Agent 统一执行，之后从仓库根目录运行：

```sh
node /tmp/acp-omp-r-mcp-smoke.ai2oyi/smoke.mjs dist/index.js
```

该脚本是 POSIX 的临时合成边界检查，不是 `npm run smoke` 或真实合同；验证完应删除其所在临时目录，不把脚本加入仓库。

## 统一 GREEN 证据（2026-10-24）

主 Agent 在 Node 26.10.0 / npm 11.19.1 下实际执行并确认以下完整命令通过：

```sh
npm run typecheck && npm run test -- --exclude '**/.claude/**' && npm run build && node /tmp/acp-omp-r-mcp-smoke.ai2oyi/smoke.mjs dist/index.js
```

- 类型检查通过；仅收集本仓库根下四个测试文件，164 项测试通过，未把 `.claude` 用户 worktree 的测试计入。
- build 通过；编译 adapter 的合成 smoke 通过：非空 `lody` MCP 的 new/load/resume、三份精确身份、三次 prompt 完成、九个不含 MCP 的原生请求、能力集不变、未启动工具桥均获得合成边界证据；adapter 退出码为 0，原生进程组已回收。
- 以上“待执行”“未运行”是先前交付时状态，本节记录主 Agent 后续实测结果，不表示本轮工作者又运行了一遍检查。README 删除滞后的具体测试数量，保留原有平台 skip 描述。

该证据只覆盖合成夹具，不是真实 OMP 18.12.2 / 18.12.1 或 Lody 验收，不关闭 R1、R5、R0-001、R0-002 或其他门禁。R-MCP 在 `000-plan.md` 仍保持“已核对，允许实现（仅此阶段）”；至少两轮独立实现审核完成前，不把阶段标为已实现，整个 012 亦未完成。

一次性脚本及其专属临时目录在验证后清理，不纳入仓库；上面的临时命令只作为已执行证据，不是保留的可重跑入口。

## 两轮独立实现审核与阶段结论（2026-10-24）

以下是实现后的审核，区别于前面的两轮规格许可核对。两位 reviewer 均未参与本切片实现、未重跑验证；运行证据引用主 Agent 的实际执行结果。

| 轮次／审核者 | 已检查范围 | 结果及未检查范围 |
| --- | --- | --- |
| 第一轮：`SpecGateReview` | 完整 R-MCP 实现 diff 与消费者追踪；补读 006 的统一 GREEN 记录全文和 README 相对 `7088ae5` 的最新差异，核对合成结果的归属与边界 | `findings=[]`，R-MCP 无可证实缺陷。未逐条完整审核所有未改动测试，未审 007、已删除临时脚本源码、目标真实 OMP/Lody、跨 OS 或发布链路。 |
| 第二轮：`McpQualityRoundTwo` | 从头重读相对 `7088ae5` 的完整 R-MCP diff 和 006，并复核第一轮报告；核对 003、000 局部许可、SDK 三入口/schema、完整 connection/server/transport/CLI 生产链、新测试与相关原有边界测试。追踪精确身份、显式原生序列化、prompt、取消结算、usage 来源、通知排空/失败、EOF/退出/信号及回收 | Standards／Spec 均无新增发现，`findings=[]`。未审 007 或逐条完整审核所有未改动测试，未取得已删除临时脚本源码；未核验真实 OMP/Lody、跨 OS 矩阵、CI、制品、mirror、公开字节回读或发布链路。 |

两轮均仅认可 R-MCP 切片，不构成 Release 整体 clean。第一轮没有遗留实现 findings，第二轮没有新增 findings；结合合成验收，将 `000-plan.md` 的局部状态登记为“R-MCP 已实现”，并明确真实 Lody 仍待验收。该阶段记录不改变仍为「计划中」的整个 012，也不触发最终 `001-action.md`。

### 未解决门禁

- R0-001、R0-002 不因本切片审核通过而关闭。007 仅补充 R-UX 合同草案，仍为计划中、未核对；R-UX 实现等待目标原生证据及明确的分片许可，不能从源码线索或 R-MCP 成功推导运行合同已成立。
- 按主 Agent 本轮定位结论，两台在线机器的限定检索范围内均未定位到可用于本次切片的目标 OMP 18.12.2／18.12.1 runtime。这不是机器所有路径均不存在目标版本的证明，也不否定旧候选上的历史记录；当前新实现的真实运行门禁仍未满足。
- 本次没有取得新的 runtime 下载、发布、tag、正式 pin 或 R6 授权；不据此下载 OMP、扩大机器搜索至用户 profile、使用付费端点，或推进发布动作。R1/R2/R3/R5 等剩余门禁继续按原计划及经核对的后续修订处理。
