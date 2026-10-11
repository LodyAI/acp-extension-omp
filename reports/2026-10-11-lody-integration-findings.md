# 2026-10-11 Lody 实机集成测试：问题清单

本文记录在真实 Lody 桌面端里试用 `acp-extension-omp` 时发现的问题。

- 这是一次调查记录，不是能力合同，也不是 `docs-ai/` 计划。
- 结论只代表这一次的环境；标注「推断」的条目没有被直接观察证实。
- 修复方案在这里只列方向，正式改动仍按 `AGENTS.md` 先写计划、经核对后再实现。

## 测试环境

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-11 |
| 机器 | macOS arm64，用户本机，作为 Lody 在线机器 |
| Lody | 桌面端自带 CLI；`agent-config` 为 Custom ACP（`cliType: custom`） |
| 适配器 | 可复现 tarball（构建自 `39d745a`，SHA-256 `c7729e02…f8a1`），独立安装在用户 home 下的演示目录 |
| OMP | 18.8.4（Homebrew，darwin-arm64） |
| Node | 26.10.0（Lody 启动命令中的 `/opt/homebrew/bin/node`） |
| OMP profile | 隔离：独立的 `HOME` 与 `OMP_PROFILE`，只含用户自有的一个真实付费提供商，默认模型为该提供商的模型（`<redacted>`） |
| 工作目录 | 演示目录下的 `omp-demo` 项目（登记为 Lody 本地项目） |
| 演示垫片 | 演示目录下的 `shim.mjs`，只为绕过问题 LI-001；不在本仓库，也不是适配器的一部分 |

测试会话：

- `<lody-session-1>`：未加垫片，失败（LI-001）。
- `<lody-session-2>`：加垫片后的四轮测试。

## 测试结果总览

| # | 场景 | 结果 |
| --- | --- | --- |
| 0 | 不加垫片直接建会话 | 失败，见 LI-001 |
| 1 | 连通性：短 prompt、无工具 | 通过：回复正确，`session/new` 约 0.2 s |
| 2 | 同一会话第二轮，读取文件 | 通过，但上下文来自 Lody 的文字回放，见 LI-002 |
| 3 | 生成中途取消 | 通过：取消后 8 ms 结束，状态为 `cancelled`，已生成的部分保留 |
| 4 | 进程回收 | 通过：Lody 的空闲回收与恢复试探都用 SIGKILL，事后无遗留进程 |
| 5 | 用量显示 | Lody 界面上没有用量，见 LI-003 |

## 问题清单

严重程度：P1 阻塞集成，P2 应修，P3 次要。

### LI-001 · P1 · Lody 注入的 MCP 服务器被适配器拒绝，会话无法建立

- **现象**：未加垫片时，第一轮直接失败，Lody 日志为
  `Failed to create agent: Invalid request: OMP ACP adapter V1 does not support MCP servers`，
  随后 agent 进程被 SIGKILL。
- **根因（事实）**：
  - Lody CLI 的 `buildBuiltinMcpServers` 只要会话有 workspace 和机器，就无条件给 `session/new` 附上一个名为 `lody` 的 stdio MCP 服务器；
  - Custom ACP 配置没有关闭它的开关。
  - 适配器按 `AGENTS.md` 的边界拒绝任何非空 `mcpServers`（`src/server.ts` 的 `validate`）。
- **影响**：照现在的设计，适配器在 Lody 里一个会话都建不起来。CI、smoke 和 contract 都传 `mcpServers: []`，所以没有发现。
- **适配器自身的表现**：符合设计。明确报错，不合成成功，进程被回收。
- **归属与方向**：`MIGRATION.md` 规定 MCP 策略归 Lody。可选方向：
  1. Lody 对 OMP provider 不注入内置 MCP，传空列表；
  2. 适配器改为「接受但不转发 MCP 配置」。这会改变 `AGENTS.md` 的边界，需要先写 `docs-ai` 计划并经核对。
- **演示期间的绕行**：垫片在 `session/new`、`session/load`、`session/resume` 中清空 `mcpServers`。代价是会话里的 OMP 用不了 Lody 工具。

### LI-002 · P2 · 进程被回收后不能原生延续会话，只能靠文字回放

- **现象**：第一轮结束约 20 s 后，Lody 用 SIGKILL 回收 agent 进程。第二轮时，Lody 日志依次为：
  1. 用上一轮精确的 `sessionFile` 尝试恢复（`acpResumeSessionId=<omp-session-file>`）；
  2. `ACP_RESUME_UNSUPPORTED (agent_did_not_advertise_resume_or_loadSession)`，试探进程被 SIGKILL；
  3. `ACP resume failed, attempting fallback with chat history replay`，新开 OMP 会话，并发送「回放 prompt」（`messages=2`，`chars=214`）。
- **根因（事实）**：适配器 V1 按计划不宣告 `loadSession` 和 `resume`，要等基线矩阵和独立审核通过后才宣告。
- **影响**：
  - 模型能「记得」聊天文字，但工具调用细节、推理内容和 OMP 内部状态不会带到下一轮；
  - 每次进程被回收后，下一轮都对应一个新的 OMP 会话文件。
- **正面结论**：Lody 恢复时传的是精确的 `sessionFile`，和适配器「会话身份即 `sessionFile`」的设计一致。
- **方向**：宣告 load/resume 是已有的发布门禁，按 `COMPATIBILITY.md` 推进，不在本问题里提前宣告。

### LI-003 · P2 · Lody 界面上看不到用量

- **现象**：四轮测试后，用户在 Lody 界面上看不到这个会话的用量信息。
- **适配器侧（事实）**：绕过 Lody 直接运行同一套隔离配置，发送一个短 prompt，适配器在轮次结束时发出 1 条 `_lody/session/usage_update`：
  - 载荷包含输入、输出和缓存读取的 token 计数（具体数字为 `<redacted>`）；
  - 按真实付费提供商的模型归属（`<redacted>`）；
  - `costUSD` 来自用户 `models.yml` 中该提供商的 cost 配置，是配置值，不是「未知」。
- **Lody 侧（事实）**：
  - Lody 内置的 `LODY_EXTENSION_METHODS.sessionUsageUpdate` 与适配器使用的方法名完全一致（`_lody/session/usage_update`），载荷结构也一致；
  - 日志在轮次收尾时出现 `Skipping session usage flush: cloud plane is offline`；
  - 同一天另一个 Claude 会话（`<agent-session>`）也出现了 7 次同样的提示，以及 completion notification、permission inbox 的同类跳过。
- **判断（推断）**：用量很可能卡在 Lody 的「cloud plane offline」状态，与适配器无关。还没确认的是：
  - 同一时段其他 agent（例如 Claude）的会话是否也没有用量；
  - 经过垫片后，Lody 是否确实收到了这条通知。
- **方向**：先在 Lody 界面核对其他 agent 会话的用量。若其他 agent 也没有，就是 Lody 的云同步问题；若只有本适配器没有，再在 Lody 侧加日志定位。

### LI-004 · P3 · Lody 用 SIGKILL 回收 agent，适配器的回收流程不会执行

- **现象（事实）**：空闲回收和恢复试探失败后，Lody 结束 agent 进程用的都是 SIGKILL。
- **影响**：
  - 正式集成时没有垫片，Lody 会直接 SIGKILL 适配器。适配器的 `close`（进程组 SIGTERM/SIGKILL、宽限期、孙进程回收）和 `closeOnSignals` 都来不及执行。
  - 这时 OMP 能否退出，只取决于它在 stdin EOF 后会不会自行退出。
- **已验证（事实）**：OMP 18.8.4 空闲时在 stdin EOF 后 27 ms 以 code 0 退出。
- **未验证**：
  - 一轮进行中被 SIGKILL 时，OMP 是否同样退出；
  - OMP 启动的工具子进程（docs-ai/004 处理的那类孙进程）在这条路径上是否会遗留。
- **说明**：本次测试中被 SIGKILL 的是垫片，适配器仍能通过 stdin EOF 走完自己的回收流程，所以「事后无遗留」不能直接代表正式集成的情况。
- **方向**：在 Lody 侧确认能否先发 SIGTERM、给出宽限期；或在适配器侧评估 stdin EOF 之外的兜底。任何改动都要先写计划。

### LI-005 · P3 · Lody 的能力探测和每次重建都会留下 OMP 会话文件

- **现象（事实）**：测试结束后，隔离 profile 的 `sessions/` 下有 9 个 OMP 会话文件，其中只有 3 个对应真实对话轮次（01:43:06、01:46:09、01:48:13）；其余来自本机启动验证、配置的 Test / 能力刷新等。
- **影响**：长期使用会在用户的 OMP profile 中积累大量空会话或短会话文件。这和 LI-002 叠加：每次回收后的下一轮都会新增一个会话文件。
- **方向**：与 LI-002 的 load/resume 一起考虑。能力探测是否必须调用 `session/new`，属于 Lody 侧的行为。

### LI-006 · P3 · 用户已有的「On My Pi」配置不是本适配器

- **现象（事实）**：用户 Lody 中已有一个名为「On My Pi」的 Custom ACP 配置，宣告了 `default`/`plan` 模式和几十个可切换模型。本适配器 V1 不宣告这些。
- **判断（推断）**：它很可能是 OMP 自带的 `omp acp` 模式。`AGENTS.md` 规定适配器不得使用这种启动方式。
- **影响**：在 Lody 里试用时，容易误以为「On My Pi」就是本适配器，测试结论会被混淆。
- **方向**：试用本适配器时使用单独命名的配置；正式集成后由 Lody provider 统一命名。

## 未覆盖的范围

- 适配器没有经过垫片之外的路径在 Lody 中运行（受 LI-001 阻塞）。
- Lody 界面上的用量显示没有在其他 agent 上对照（LI-003）。
- 权限请求、图片附件、长时间多工具任务、多会话并发没有测试。
- Linux 与 Windows 上的 Lody 实机行为没有测试。容器路径的尝试受网络和登录页面限制而中止；容器内只完成了 OMP 18.8.6（npm 分发、Bun 1.4.2）上的 smoke 与 contract。
- 本次没有提交任何适配器代码改动。

## 测试遗留物（待清理）

- 本机演示目录：适配器安装、隔离 OMP profile、垫片、演示项目。
- Lody 中的「OMP adapter (demo)」Agent 配置和 `omp-demo` 本地项目。
- 容器测试环境与若干临时目录。
- 提供商凭据的存放位置不在本文记录，清理时由用户自行处理。
