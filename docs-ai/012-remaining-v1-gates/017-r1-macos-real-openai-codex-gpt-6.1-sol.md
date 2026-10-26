# 012.017 — R1：macOS 上 tip f0572cd 的真实 openai-codex/gpt-6.1-sol 证据

## 背景

[016](016-r1-macos-f0572cd-tip-matrix.md) 记录了 tip `f0572cd` 在 OMP 18.12.6／18.12.5 上的 **loopback-only** smoke + contract 矩阵。官方 `npm run contract` 按设计是 loopback；用例 5／7／9 的合成边界仍是合成，**不能**把真实 OMP provider 说成覆盖了那些夹具断言。

本文件补记同一 tip、同一安装后入口上，对 **真实** `openai-codex/gpt-6.1-sol` 的 ACP 路径旁证。由 TommyWu 在本机提供 oauth／配额；证据来自 `/tmp` 一次性 harness，不进入仓库 `src/`／`test/`／`scripts/`。这是本地证据，不是发布声明；**不关闭** R2／R3／R4–R6，**不替换** loopback 矩阵行。

## 环境与来源

| 字段 | 值 |
| --- | --- |
| 记录日期 | 2026-10-26（Asia/Shanghai） |
| 适配器提交 | `f0572cd904b88f9d80101d9b32ec7d5bffe1b6d1`（`origin/main`，PR #19 merge） |
| 被测入口 | `/tmp/acp omp install NVCi/node_modules/acp-extension-omp/dist/index.js`（安装后包 `acp-extension-omp@0.1.0`；`dist/index.js` SHA-256 `0ef502f35777c04d36a573223519ed747a26610005500094b47fa444d4d411cd`） |
| OMP | 18.12.6，`~/.local/bin/omp`（`omp/18.12.6`） |
| Node / npm | v22.22.3 / 10.9.8 |
| OS | macOS，Darwin 27.2.0 arm64 |
| 模型 | `openai-codex/gpt-6.1-sol`（经 `session/set_config_option` `configId=model`，value=`provider/id`） |
| Auth | 真实 `HOME=~` 下 `~/.omp` openai-codex oauth；**未**隔离 HOME；**未**设 `OMP_PROFILE` |
| Harness | `/tmp/acp-omp-real-61sol-20261026/harness.mjs`（仓外）；PATH shim 仅对 `omp --mode rpc` 注入 `--thinking=low --config low-thinking.yml --no-skills --no-extensions` |
| 机器可读摘要 | `/tmp/acp-omp-real-61sol-evidence.json` |
| 运行窗口 | 2026-10-26 19:29:34 → 19:30:48 Asia/Shanghai |
| 配额快照（跑后） | Openai Codex 5h Chat ~32% used；7d ~5% used（跑前约 26%／4%；首轮失败探测曾有额外消耗） |

启动边界：adapter 仍 spawn `omp --mode rpc`；不使用 `omp acp`。不记录 API key、cookie、oauth token、原始 provider headers／完整 payload；助手正文只保留长度／短预览／sha256 前缀。

## 场景结果（A–H）

| ID | 场景 | 结果 | 要点 |
| --- | --- | --- | --- |
| A | Baseline prompt + usage | **pass** | `initialize`→`session/new`→`set_config_option(model=openai-codex/gpt-6.1-sol)`→短 prompt「Reply with exactly: PONG」→`stopReason=end_turn`，回复预览 `PONG`。`_lody/session/usage_update` 的 `modelUsage` **key 含** `openai-codex/gpt-6.1-sol`；本轮 `inputTokens=11553`，`outputTokens=6`，`reasoningOutputTokens=0`，`costUSD=0.023166`（cost **有值**）。`usageScopeId` 观测为 `null`。newSession 前默认模型为 `xai-oauth/grok-4.7`，setter 后为请求模型。 |
| B | Cancel mid-stream | **pass** | 长列表 prompt；首个 `agent_message_chunk` 后 `session/cancel`；终端 `stopReason=cancelled`（11 个 chunk 通知）。**未**捕获原生 `abort_ack`：stdout tee 会与 adapter 的 `Readable.toWeb` 争用导致 EPIPE，故 journal 仅 PID／spawn 参数。 |
| C | Exact load／resume | **pass** | 对 A 的 `sessionFile` 执行 `session/load`（返回 `configOptions`）与随后短 prompt；再 `session/resume` 回到同一 path。load 后单次 usage 帧 `inputTokens=200`（非整段历史重算风暴）；usage 帧总数 before→after 为 2→3（本 prompt +1）。 |
| D | R2-ish 真实观察 | **pass（诚实边界）** | 同 session 第二次 prompt 有独立 usage 帧；`session/new` 后新 sessionId 的 usage 挂在新 path 上。**无法**用真实 provider 强迫 late／no-identity 或 missing-cost 帧；仍依赖合成用例 **5／7**。本轮真实 provider **有** cost，不能代替 missing-cost 夹具。 |
| E | Fork | **pass** | `session/fork`（`unstable_forkSession`）后 `newSessionId ≠ oldSessionId`；fork 会话上短 prompt `end_turn`。 |
| F | Set title | **pass** | `/rename R1-61sol-evidence` → `stopReason=end_turn`；`session/update` `session_info_update` 标题匹配，`titleSource=explicit`。 |
| G | Image prompt | **pass** | `initialize` 仍宣告 `promptCapabilities.image=false`；1×1 PNG content block + 短文本。Adapter 接受并完成：`stopReason=end_turn`，回复拼出 `IMG_OK`。说明代码路径可路由 image，即使能力位未宣告。 |
| H | SIGKILL／compaction（初轮） | **skip→见 H′** | 初轮为省配额跳过；同日续跑见下方 **H′**。 |

## 合成边界（再次明确）

真实 provider 旁证 **不**覆盖、**不**关闭：

- 用例 5：wrong-identity／迟到无身份用量段  
- 用例 7：duplicate-message／missing-cost  
- 用例 9：子进程失败夹具  

loopback contract 矩阵行仍以 [016](016-r1-macos-f0572cd-tip-matrix.md)／[011](011-r1-macos-18.12.6-clean-matrix.md) 为准。

## 命令（可复现 harness，不提交）

```bash
export PATH="/Users/tommywu/.nvm/versions/node/v22.22.3/bin:/tmp/acp-omp-real-61sol-20261026/bin:$PATH"
export REAL_OMP=/Users/tommywu/.local/bin/omp
unset OMP_PROFILE
cd /tmp/acp-omp-real-61sol-20261026
node harness.mjs
# 摘要：/tmp/acp-omp-real-61sol-evidence.json
```

首轮曾因 harness 对 omp stdout 做 tee 导致 adapter EPIPE（已改为 PID-only observer 后重跑成功）。不把首轮失败当作矩阵结果。

## 未验证／不升级

- R2：无身份迟到用量合同与来源关联（真实侧不可激发；合成仍必需）。  
- R3：能力宣告（含 `image:false` 与真实 image 路由并存）未改宣告、未独立审核。  
- R4–R6：可复现制品、Lody mirror、发布／pin。  
- 合作式 cancel 的原生 `abort_ack` 字节级观察仍未在首轮 B 捕获（H′ 为 SIGKILL，死进程无 ACK 可期）；自动 compaction、完整模型 A→B→A 仍未做。真实 Lody no-shim e2e 见下方（blocked）。  
- 其他 OS／架构；独立审核签字。  
- `usageScopeId` 在本轮真实帧中为 `null`——记录事实，不据此改合同。



## 续跑（2026-10-26 19:44 Asia/Shanghai）— H′ SIGKILL + tool/Lody 探测

TommyWu 确认配额仍够；在**不重做 A–G**的前提下续跑仓外 sibling harness。

| 字段 | 值 |
| --- | --- |
| Harness | `/tmp/acp-omp-real-61sol-20261026/harness-hprime.mjs` |
| 观察 | PID journal + **独立进程** `OMP_FRAME_JOURNAL` tee（不与 adapter `Readable.toWeb` 争用 stdout） |
| 窗口 | 2026-10-26 19:44:18 → 19:45:10 Asia/Shanghai |
| 配额 | 跑前／跑后 `omp usage` 均显示 Codex 5h Chat ~**52%**／7d ~**8%**（相对本续跑窗口 Δ 不明显；杀中流后未再烧长上下文） |

### H′ SIGKILL mid-stream — **pass**

| 步骤 | 结果 |
| --- | --- |
| `initialize` / `set_config_option(model=openai-codex/gpt-6.1-sol)` | ok |
| native spawn | pid **4732**，`detached:true`，args `--mode rpc`（实为 frame-tee node；同组含真实 `/Users/tommywu/.local/bin/omp` 与 `mcpbridge` 孙进程） |
| 首个 `agent_message_chunk` 后 `process.kill(-4732, SIGKILL)` | ok；journal `exit signal=SIGKILL` |
| prompt 结算 | `promptError=Adapter closed before response`（~48ms）；**非** `end_turn` |
| adapter | 随后 `close code=1` |
| 进程组残留 | **无**（`stillAlive=false`，`leftovers=[]`） |
| 原生 `abort_ack` / `session_settled` | SIGKILL 路径下**不可期望**合作式 ACK（omp 已死）；本杀前 frame journal 无 abort 标记 — 诚实记录 |

解释：POSIX `-pid` 组杀与 tip `server.ts`／smoke 收尾一致；含 tee／omp／mcpbridge 的组被一次收净。Adapter 走 `OMP RPC process exited` → parent abort → ACP 侧 prompt 未干净完成。这是 **真实 provider 旁证**，不替代 loopback contract 夹具。

### Tool-grandchild / cancel — **skip**

一次尝试：prompt 要求 bash `echo HPRIME_TOOL_OK`。45s 内无 `tool_call`／`tool_call_update`（仅 `agent_message_chunk`）；随后模型以 `end_turn` 结束。已 `session/cancel` 以避免空等。**未**再 SIGKILL／未循环。可能原因：权限／yolo、`--no-skills/--no-extensions`、或模型选择不调工具。不把「跳过」写成通过。

frame tee 在该会话后期仍见到原生 `prompt_result`（含 `sessionSettled` key）与 `session_settled` 各 1 次 — 证明 journal 通路可用；但因无 tool 窗口，不能当作 cancel-during-tool／abort_ack 证据。

### Lody no-shim e2e — **blocked**

本机存在：

- `/Applications/Lody.app`（当时有进程）
- `/Users/tommywu/Desktop/Lody` checkout，含 `packages/acp-extension-omp`
- `BuiltinACPSetting.omp` → `packageName: acp-extension-omp`

阻塞：

- `lody` **不在 PATH**
- `apps/cli` 的 `prepare:acp-adapters` 只编 claude／codex／grok／dsh（**未含 omp**）
- 经 GUI 选 agent／可能拉 managed-runtime 做一次真实 6.1-sol 聊天需要交互与较长 setup

按任务要求 **停止**，不烧配额硬装。**不关闭 R5**。

### 命令（H′）

```bash
export PATH="/Users/tommywu/.nvm/versions/node/v22.22.3/bin:/tmp/acp-omp-real-61sol-20261026/bin:$PATH"
export REAL_OMP=/Users/tommywu/.local/bin/omp
unset OMP_PROFILE
cd /tmp/acp-omp-real-61sol-20261026
node harness-hprime.mjs
# 合并进 /tmp/acp-omp-real-61sol-evidence.json（scenarios.Hprime_* / Lody_noshim_e2e）
```

### 对 R2／R3／R5 的影响

- **仍不关闭** R2／R3／R4–R6。
- H′ 补上真实 SIGKILL／进程组收尸旁证；用例 5／7／9 仍合成。
- 合作式 cancel→原生 `abort_ack` 字节级捕获、tool-during-cancel、Lody no-shim e2e 仍开。



## 续跑（2026-10-26 19:50–19:54 Asia/Shanghai）— 合作式 abort_ack + tool-in-flight cancel

TommyWu「做吧，都做」。仓外 harness：`harness-abort-tool.mjs`、`harness-tool-native.mjs`；`OMP_FRAME_JOURNAL` tee 记录 **type/command/success/keys/ts** 仅（无正文／无 secrets）。

### I. Cooperative cancel → native abort ACK — **pass**

| 项 | 值 |
| --- | --- |
| 流程 | streaming poem → 首 chunk 后 ACP `session/cancel`（**非** SIGKILL） |
| ACP | `stopReason=cancelled`（~10ms） |
| 原生 abort ACK | **见到**：`{type:"response", command:"abort", success:true, id:"omp-9"}`（与 `scripts/contract.mjs` 把该形状记为 `abort_ack` 一致） |
| 伴随帧 | `prompt_result` status=`aborted` + `sessionSettled:true`；`session_settled` |

### J. Tool-in-flight cancel（ACP `tool_call` 等待）— **fail（诚实）**

两轮 prompt（`/force bash sleep 30; echo …` 与更硬的英文指令）。ACP `session/update` **从未**出现 `tool_call`／`tool_call_update`（仅 `agent_message_chunk`）。按 brief 两轮后停止，不继续烧配额。

事后读同一 frame journal：原生侧其实有 `tool_execution_start/update/end`（sleep≈30s）——说明 **tip `connection.ts` 未把 `tool_execution_*` 映射为 ACP tool notifications**，不是模型拒工具。J 的失败是「错误等待面」，不是「无工具」。

### J′. Native `tool_execution_start` 后 cancel — **pass**

| 项 | 值 |
| --- | --- |
| 等待面 | poll `OMP_FRAME_JOURNAL` 直至 `type=tool_execution_start`（≤60s） |
| 然后 | ACP `session/cancel` |
| ACP | `stopReason=cancelled` |
| 原生 abort ACK | **再次见到** `type=response command=abort success=true` |
| ACP tool_call 转发 | **否**（`acp_tool_call_forwarded=false`；与源码面一致） |
| sleep 孙进程 | 本轮 `ps` 未及时捕到 `sleep` 命令行（可能包装名／窗口短）；cancel 后无残留；**未**再 SIGKILL |

### 配额

续跑前后 `omp usage`：Codex 5h Chat ~**70%**／7d ~**11%**（本段 Δ 不明显）。

### 命令

```bash
export PATH="/Users/tommywu/.nvm/versions/node/v22.22.3/bin:/tmp/acp-omp-real-61sol-20261026/bin:$PATH"
export REAL_OMP=/Users/tommywu/.local/bin/omp
unset OMP_PROFILE
cd /tmp/acp-omp-real-61sol-20261026
node harness-abort-tool.mjs   # I pass；J fail（ACP tool_call 面）
node harness-tool-native.mjs  # J′ pass（native tool 面）
```

### 对开放项

- 合作式 cancel 的原生 abort ACK **字节级旁证已有**（真实 provider）。
- Adapter **仍不**向宿主转发 ACP `tool_call`（R3／宿主合同相关缺口，记录事实）。
- 仍 **不关闭** R2／R3／R4–R6；用例 5／7／9 仍合成；Lody no-shim e2e 仍 blocked。


## 当前状态

只增文档与仓外 harness／JSON 证据。不改 `src/`、`test/`、`scripts/`、`package.json` 或能力宣告。整体 012 仍为「计划中」；本文件不授权发布、开 PR、commit／push／merge。
