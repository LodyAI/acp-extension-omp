# 003 — 审查发现的终态、取消与进程收尾：计划

| | |
| --- | --- |
| **状态** | 已核对 |
| **锚点日期** | 2026-10-10 |
| **规格核对** | TommyWu 于 2026-10-10 明确要求继续完成独立 review、矩阵、artifact 与集成前置；本计划收敛 review 发现的终态、取消、通知顺序和子进程收尾问题，允许按 TDD 修复后继续验证。 |
| **相关** | [`AGENTS.md`](../../AGENTS.md)、[`COMPATIBILITY.md`](../../COMPATIBILITY.md)、[`TESTING.md`](../../TESTING.md)、[`src/connection.ts`](../../src/connection.ts)、[`src/server.ts`](../../src/server.ts)、[`test/connection.test.ts`](../../test/connection.test.ts)、[`test/server.test.ts`](../../test/server.test.ts) |

## 背景

独立只读审查发现当前工作树存在四个重要问题：带 `agentInvoked: false` 的混合新版终态可能绕过 status/settlement 校验；legacy 取消请求与正常 `agent_end` 存在竞态；prompt RPC 失败时可能绕过已有 ACP notification tail；Windows 关闭路径在 OMP 不响应 stdin EOF 时没有宽限期后的强制终止。审查还发现 README 的测试数量和 18.2.8 状态摘要过期。

## 目标

- 只有不带新版 status/settlement 字段的 legacy `prompt_result.agentInvoked: false` 才能直接完成 local prompt。
- 新版字段存在时，无论 `agentInvoked` 值如何，都校验 `status` 与 `sessionSettled`，并保持 error、aborted 和 delayed settlement 语义。
- legacy cancel 不把“已发出取消请求”误当作 native 已取消；可观测的 assistant `stopReason: "aborted"` 优先映射为取消，正常 stop/toolUse 不被误标为取消；兼容 18.2.8 真实终态和既有合成夹具。
- prompt RPC 命令失败也等待当前 prompt 已排队 notification 完成后再 reject；notification 闭包捕获产生它的 session identity。
- Windows 子进程在 stdin EOF 后经过宽限期仍未退出时被强制终止；保留 macOS/Linux 的 process-group termination。
- README 反映当前 28 项单元测试、18.2.8 macOS arm64 real-contract evidence 与仍未完成的生产发布矩阵。

### 非目标

- 不扩展 ACP capability，不改变 `omp --mode rpc` 启动参数。
- 不把未来 OMP 版本自动声明为兼容，不把未验证 OS 或 background/compaction 写成通过。
- 不修改 Lody 工作树、生产 manifest、managed runtime 或发布 artifact。
- 不记录 prompt、headers、credentials、cookies 或 raw provider response。

## 方案

在 [`src/connection.ts`](../../src/connection.ts) 中把 `prompt_result` 的 local-only 分支限定为没有新版状态字段的 frame；若 frame 含 `status` 或 `sessionSettled`，统一走新版校验和 `finishPrompt`。为 legacy 取消增加可观测 aborted 判断，并让正常 assistant stop reason 保持 completed；既有无 message 的 cancel fixture 仍使用已确认的 abort 终态路径。

让 prompt RPC catch 保存 `ActivePrompt` identity，并通过现有 `finishPrompt`/notification tail 完成 error settlement，而不是直接 reject；`forwardMessage` 在 enqueue 前捕获 session id，避免切换后闭包读取新的 `this.sessionId`。

在 [`src/server.ts`](../../src/server.ts) 抽取最小的关闭后强制终止分支：非 Windows 继续 kill process group；Windows 在 `waitForExit` 超时后调用 child 的 kill API，并再次等待实际 exit。测试使用真实 fixture child；无法在 macOS 上执行 Windows 分支的测试必须标为平台未覆盖，不伪造通过。

在 [`test/connection.test.ts`](../../test/connection.test.ts) 先增加合成回归：

1. `agentInvoked:false` + `status:"error"` + `sessionSettled:true` 必须 reject；
2. `agentInvoked:false` + `status:"completed"` + `sessionSettled:false` 必须等待 `session_settled`；
3. cancel 请求后收到正常 assistant `stopReason:"stop"` 的 legacy terminal 必须返回 `end_turn`；
4. legacy terminal error / aborted message 仍分别返回 rejection / cancelled；
5. 已排队 notification 后 prompt command failure 必须在 notification delivery 后 reject；
6. session identity 在异步 notification delivery 中保持事件产生时的值。

在 [`test/server.test.ts`](../../test/server.test.ts) 增加可复用的关闭/子进程行为回归；对当前 macOS 可执行的 process-group 路径运行真实夹具，Windows 专用分支只保留代码审查与跨平台后续验证记录。

README 只做事实同步，不修改能力合同之外的边界。

## 备选与决策

- **继续把 `agentInvoked:false` 无条件当作 completed**：会违反 fail-closed 终态要求，排除。
- **仅把 cancelRequested 改名为 cancelConfirmed**：若 OMP 在同一输入块中先返回 abort response、再发 terminal event，Promise continuation 可能晚于 event；因此同时依据 native assistant stop reason 和既有 abort 终态，避免依赖微任务顺序。
- **在命令失败 catch 中直接 reject**：会破坏 ACP notification-before-terminal ordering，排除。
- **为了测试 Windows 分支修改 process.platform 或引入运行时平台注入**：会增加生产抽象且不能证明真实 Windows 行为，排除；保留最小代码修复并明确 macOS 验证边界。

## 验收

- 每个新增回归先在未修复实现上失败，失败原因必须是对应审查问题；再用最小实现修复并通过。
- Node `22.22.3` 下 `npm run check`、`npm run build`、`npm run smoke` 通过。
- OMP `18.2.8` 与 `18.3.1` 的隔离 real contract 均通过。
- `npm pack --dry-run`、`git diff --check` 通过，README/TESTING/COMPATIBILITY 不再互相矛盾。
- 记录 Windows 强制终止分支未在 macOS 实机执行，不把它写成已验证。
- 不创建 commit、PR、tag、release，不修改 Lody 工作树。

## 修订记录

（行动记录追加在 `001-action.md`；后续纠正使用新的 `002+` 文件。）
