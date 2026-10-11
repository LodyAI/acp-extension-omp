# 006 — OMP 18.2.8 legacy RPC 终态：计划

| | |
| --- | --- |
| **状态** | 已核对 |
| **锚点日期** | 2026-10-07 |
| **规格核对** | TommyWu 于 2026-10-07 核对目标、非目标、备选方案、不可逆影响和验收证据，并明确允许按 legacy `agent_end` 方案实现。 |
| **相关** | [`AGENTS.md`](../../AGENTS.md)、[`COMPATIBILITY.md`](../../COMPATIBILITY.md)、[`TESTING.md`](../../TESTING.md)、[`src/connection.ts`](../../src/connection.ts)、[`test/connection.test.ts`](../../test/connection.test.ts) |

## 背景

官方 OMP `v18.2.8` macOS arm64 binary 已取得并按 release asset 的 size/SHA-256 校验；执行 `npm run contract -- dist/index.js /tmp/omp-18.2.8-darwin-arm64` 时，adapter 在 `session/prompt` 超时。

隔离 native probe 与 OMP `v18.2.8` 上游源码共同表明这是协议差异：该版本的 `prompt` command success response 可以没有 `data.agentInvoked`；正常异步 agent work 通过 `agent_end` session event 结束；只有本地处理的 prompt 通过 `prompt_result` 携带 `agentInvoked: false`。当前 adapter 只把带 `status` 和 `sessionSettled` 的 `prompt_result` 当作终态，因此不会完成 18.2.8 的正常 prompt。

## 目标

- 支持 OMP 18.2.8 的正常 agent prompt：以 terminal `agent_end` 作为 native 完成信号。
- 支持 OMP 18.2.8 的本地 prompt：识别 `prompt_result.agentInvoked: false` 并完成，不等待不存在的终态。
- 18.2.8 的 cancel 在 native `agent_end` 到达后才返回 ACP `cancelled`。
- 保持 18.3.1 已验证的 `prompt_result.status/sessionSettled` 路径、通知 ordering、usage 去重和错误传播。
- 保持 `agent_end.isTerminal === false` 时不提前完成。

### 非目标

- 不复制 OMP 源码或修改 OMP binary。
- 不把 OMP `agent_end` 的完整消息写入日志或 usage；usage 仍只来自 assistant `message_end`。
- 不广告新的 ACP capability。
- 不在本条目实现 Lody provider、runtime manifest 或 artifact。

## 方案

在 [`src/connection.ts`](../../src/connection.ts) 为 active prompt 增加最小取消状态。`cancel()` 在发送 native `abort` 前标记 active prompt；legacy `agent_end` 到达后，根据该状态映射为 ACP `cancelled` 或 `end_turn`。

在 `event()` 中增加 legacy `agent_end` 分支：仅当 `isTerminal` 不是 `false` 时调用现有通知排队/终态完成逻辑。`prompt_result` 分支同时接受：

- 当前版本的 `status` + `sessionSettled` 合同；
- 18.2.8 的 `agentInvoked: false` 本地完成合同。

为避免让两种终态互相覆盖，`finishPrompt()` 继续检查 active object identity；notification tail 仍在 ACP terminal response 前 drain。

版本差异不能用 prompt response 是否含 `agentInvoked` 判定：18.3.1 普通 prompt 也可能没有该字段，而 18.2.8 某些内建命令会返回 `agentInvoked: true`。18.3.1 的 `agent_end` 携带布尔 `yielded`，18.2.8 没有；只把有该字段的 event 视为新版 event、等待相关 `prompt_result`，无该字段的 legacy event 才按 `isTerminal` 完成。`agentInvoked: false` 仍可独立完成本地 prompt。

在 [`test/connection.test.ts`](../../test/connection.test.ts) 增加合成回归：

1. legacy prompt response 无 data，随后 `agent_end`，应返回 `end_turn`；
2. legacy `agent_end.isTerminal: false` 后再 terminal `agent_end`，第一次不能释放 prompt；
3. legacy cancel 在 `agent_end` 后返回 `cancelled`；
4. legacy `prompt_result.agentInvoked: false` 本地命令完成；`agentInvoked: true` 仍由 legacy `agent_end` 完成。
5. 新版 `agent_end.yielded` 后须等待 terminal `prompt_result`；provider error 必须传为 ACP error，不可提前成功。

先运行新测试观察当前实现失败，再取得规格核对后修改 `src/`。

## 备选与决策

- **只把 18.2.8 标记为不支持，保留 18.3.1 路径**：不满足 #930 要求的 18.2.8 fail-closed baseline，排除。
- **把所有 prompt response success 都立即映射为 end_turn**：会在 agent work 尚未完成时提前返回，破坏 ACP terminal ordering、usage 和 cancel，排除。
- **按上游事件语义兼容 `agent_end`，并保留新版本显式 terminal 路径**：覆盖 18.2.8，同时不放弃 18.3.1 已验证的 settlement 合同，选择此方案。

## 验收

- 新 legacy 回归测试在当前实现上失败，失败原因是 prompt 未完成或取消/非终态被错误处理。
- 实现后在隔离 profile 下 `npm run contract -- dist/index.js /tmp/omp-18.2.8-darwin-arm64` 通过。
- OMP 18.3.1 的已有 `npm run contract` 继续通过。
- `npm run check`、`npm run build`、`npm run smoke`、`npm pack --dry-run` 通过。
- 记录 OMP 18.2.8 的非敏感矩阵字段：release asset、size、SHA-256、Node、OS、adapter commit、Core 版本、profile 名和 pass/fail；不记录 prompt、token、cookie、headers 或 provider response。
- 不发布 artifact，不修改 Lody 工作树，不推送共享分支。

## 修订记录

（计划核对后追加行动记录或修订文件。）
