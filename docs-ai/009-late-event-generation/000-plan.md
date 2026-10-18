# 009 — 迟到事件归属与会话准备：计划

| | |
| --- | --- |
| **状态** | 已实现 |
| **锚点日期** | 2026-10-18 |
| **规格核对** | 独立 completion reviewer（2026-10-18，独立上下文）核对目标、非目标、备选、长期选择和验收后明确「允许实现」；task reviewer 启动因本机缺少模型失败。实现通过合成验收与四轮独立静态审查；真实 OMP 合同仍待验证，见 `001-action.md`。 |
| **相关** | `COMPATIBILITY.md`；审计 A15、A16 |

## 背景

`src/connection.ts` 将 message_end 直接交给当前 active.generation，不能辨认已在旧 generation 出现过的 messageId。现有测试仅覆盖 replacement idle，未覆盖新 prompt 活跃时的旧消息。`/tmp/wt-fix/test/connection.test.ts` 的 PR #8 已覆盖 switch rejection/cancelled 和文件 missing/empty/directory；本条目不重复这些用例。

## 目标

- 只忽略可证明不属于当前 generation 的消息，保留当前 prompt 新 messageId 的正常 usage，包括多次 new/load/resume 后、legacy responseId 和无 message_start 的完整 message_end。
- 已观察的 message_start/message_update/message_end 身份保留首次归属；跨 generation 旧 ID 的 text 和 usage 不进入新 session。
- 无当前 active prompt、sessionChanging 或明确 sessionId 不匹配时，不发送 text/usage；此时看到的 ID 不能稍后成为当前 prompt 的新消息。
- 补会话 get_state 失败、缺失/空 sessionFile、exact identity 不符、ACK 后 EOF，以及准备阶段会话操作互斥、load/resume 恢复和 usage scope 的公共接口证据。

### 非目标

- 不重做取消与 settlement 状态机（A01/A02）。
- 不新增协议字段、不推断无身份事件来源、不宣告 load/resume/usage 能力。
- 不改真实 contract runner 或宣称真实 background/settlement 交错已经证实。
- 不改 README.md、package.json，也不合并或修改 PR #8 的只读工作树。

## 方案

1. 在 `test/connection.test.ts` 增加 generation 回归，先运行观察旧消息串入当前 scope 的失败。保留并改写私有 sessionId 篡改测试，用公共 session API 证明排队通知期间互斥。
2. `src/connection.ts` 保存 prepareSession 得到的 native sessionId。事件携带 sessionId 且能与已知 native sessionId/sessionFile 对比时，拒绝明确不匹配；缺少可靠 native identity 时不臆测。
3. 连接级 Map 保存消息 ID 首次观察的 generation（无 active 或明确不匹配用不可归属哨兵）。识别顶层 messageId，legacy 回退 message.responseId。只在消息 start/update/end 处理该表；不清空旧记录，以免旧 ID 在后续切换被重新入账。不改变 accumulator 去重/补全语义。
4. message_update 和 message_end 共享归属门禁；当前 active 的未知 ID 记录为当前 generation 并正常处理，绝不因 generation > 1 关闭 RPC。删除把当前 active.generation 传回自身比较的伪防护。
5. 提议新增 `test/session-preparation.test.ts`，专用合成 RPC fixture 控制 get_state，避免与 A15 在同一文件编辑。失败只通过公共 API 驱动；检查旧身份拒绝、无 fallback/prompt、无 stale 通知、可恢复错误后 fresh new/load/resume 正常、EOF 后连接不可复用。并发在 get_state 被显式 gate 阻塞时测试。
6. `COMPATIBILITY.md` 简述限制：当前 prompt 中首次出现且无可靠 session identity 的旧帧与新帧无法区别，仍接收；无关联 legacy terminal/session_settled 仍依赖上游顺序。Map 生命周期内增长是保留旧归属的代价，不以任意淘汰窗口制造隔离保证。

## 备选与决策

- 拒绝第二次切换后的未知 ID：否；会丢失正常当前 usage，违反硬约束。
- 每次切换清空 ID 表：否；恰好失去旧事件证据。
- 按 generation number、sleep 或模型猜测来源：否；这些不是事件归属证据。
- 只处理已证明旧 ID 和已知 session identity：采用；有界于可观察协议事实，无身份歧义明确留在兼容性限制。

## 验收

- A15：旧 generation 已结束/已 start 的 ID、新 prompt 活跃、取消后切换、idle 观察过的 ID、wrong sessionId；旧 text/usage 无输出，当前 text/usage 及 terminal 正常。多轮 new/load/resume 与 legacy/current fresh ID、重复/补全 usage 正常。
- A16：new/load/resume 的 get_state rejection、缺失/空 sessionFile；exact load/resume 选错文件；switch ACK 后 EOF；准备中的 new/load/resume 竞争；恢复后独立 usage scope。与 PR #8 不重复 switch ACK rejection/cancelled 或无效文件用例。
- 运行针对回归的 vitest（修复前失败、修复后通过），最终 `npm run check` 与 `npm run build`。
- 用合成 RPC 流直接运行编译产物，演练切换后旧帧过滤与新 usage 计费，作为非测试 smoke；不读取用户 OMP profile。
- 非实现者进行规格核对和至少两轮完整 diff 审查，记录已检查/未检查范围。真实 OMP background quiescence、版本/OS 发布矩阵未在本条目验收。

## 修订记录
