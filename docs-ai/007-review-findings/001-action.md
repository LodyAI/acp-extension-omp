# 007 — 审查发现的终态、取消与进程收尾：行动记录

## 时间线

| 日期 | 变更 | 引用 |
| --- | --- | --- |
| 2026-10-10 | 独立只读安全审查报告 0 Critical、4 Important、1 Minor；普通 reviewer 因订阅 403 未运行 | [`000-plan.md`](000-plan.md) |
| 2026-10-10 | RED：混合 `agentInvoked:false` 的 current error 和延迟 settlement 分别暴露错误成功、提前放行；GREEN：按新版字段校验 status/settlement | [`test/connection.test.ts`](../../test/connection.test.ts)、[`src/connection.ts`](../../src/connection.ts) |
| 2026-10-10 | RED：已请求取消后收到正常 assistant `stop` 被误映射 `cancelled`；GREEN：按 native stopReason 区分 completed/aborted/error | [`test/connection.test.ts`](../../test/connection.test.ts)、[`src/connection.ts`](../../src/connection.ts) |
| 2026-10-10 | RED：同块 notification + prompt RPC failure 在 delivery 前拒绝；RED：异步通知读取切换后的 session identity；GREEN：错误结算等待 notification tail、入队捕获 sessionId | [`test/connection.test.ts`](../../test/connection.test.ts)、[`src/connection.ts`](../../src/connection.ts) |
| 2026-10-10 | Windows 宽限期后调用 child.kill；macOS 使用真实不响应 SIGTERM 子进程验证 process-group 强制关闭 | [`src/server.ts`](../../src/server.ts)、[`test/server.test.ts`](../../test/server.test.ts) |
| 2026-10-10 | 第二轮只读审查发现无 assistant 消息的 legacy abort 成功被误报 `end_turn`，以及 18.8.7 测试文档尚未记录；RED/GREEN 补齐无消息取消回归和原生 abort 确认后的结算 | [`src/connection.ts`](../../src/connection.ts)、[`test/connection.test.ts`](../../test/connection.test.ts)、[`TESTING.md`](../../TESTING.md) |
| 2026-10-10 | 18.8.7 latest stable 与 18.8.6 previous stable 官方 macOS arm64 assets 分别校验并通过隔离 real contract；补齐 TESTING/COMPATIBILITY 证据 | [`COMPATIBILITY.md`](../../COMPATIBILITY.md)、[`TESTING.md`](../../TESTING.md) |
| 2026-10-10 | 第三轮独立只读复审覆盖完整工作树，发现 6 个 Important（legacy fail-open、RPC failure race、cancel gate、late usage、诊断泄露、detached cleanup）及 2 个 Minor（contract runner 隔离/断言、测试未纳入 typecheck）；无 Critical，暂不能 clean | 独立复审报告 `artifact://810` |
| 2026-10-10 | 修复第三轮 Important：legacy terminal 严格校验、RPC failure 优先、取消期间 busy gate、usage generation 隔离、安全错误类别与 stderr 边界、宿主 signal 幂等清理；contract runner 隔离版本探测并逐条检查通知顺序和可观察 abort acknowledgement | [`src/connection.ts`](../../src/connection.ts)、[`src/rpc-transport.ts`](../../src/rpc-transport.ts)、[`src/server.ts`](../../src/server.ts)、`src/lifecycle.ts`（未移植到本分支，见 [002-stack-on-pr2.md](002-stack-on-pr2.md)）、[`scripts/contract.mjs`](../../scripts/contract.mjs) |
| 2026-10-10 | Node 22.22.3 下完整门禁 46 tests/3 files、build、OMP 18.3.1 smoke 与 18.2.8/18.3.1/18.8.6/18.8.7 四组 loopback-only real contracts 通过；`npm pack --dry-run` 显示 17 个 allowlist 文件，`git diff --check` 通过 | [`TESTING.md`](../../TESTING.md)、[`RELEASE.md`](../../RELEASE.md) |
| 2026-10-11 | 最终 17-file npm candidate（18,575 bytes, SHA-256 `bf9a6628bea518e2f567387eb11535e4cd13b74d0e106a990d69956434460256`）独立 production install、smoke 与四版本 real contracts 通过；基于该包的仓库外 zstd mirror（681,731 bytes, SHA-256 `98f90b827cb04e949e0734558922ccf5789ce5a8ce89fc7672dd3e426687bb85`）由 Lody `ManagedAgentRuntimeManager` 从 loopback 安装并成功 ACP initialize。未改写 Lody 文件 | [`TESTING.md`](../../TESTING.md)、[`RELEASE.md`](../../RELEASE.md) |
| 2026-10-10 | 第四轮审查 agent 不可用：reviewer 与通用 task 返回订阅 403，security reviewer 返回 upstream HTTP/2 错误。随后手工代码检查发现 plain-object legacy stop reason allowlist 会接受 `constructor`/`toString`/`__proto__`；三项回归先 RED，再改为 `Set.has` 并通过，完整 suite 增至 46/46 | [`src/connection.ts`](../../src/connection.ts)、[`test/connection.test.ts`](../../test/connection.test.ts) |
| 2026-10-11 | 第四轮 diff 只读复审（drain-until-stable `finishPrompt`、RPC `agentInvoked:false` 的 `applyCurrentPromptSettlement`、`hasOwn`/`Set.has`）：未发现 Critical；残留 Minor 两处——`String(frame.status)` 会把 `["completed"]` 等非字符串 coerce 进 allowlist，以及 `event()` 对 `yielded`/`isTerminal`/`messages` 使用 `in` 会读到原型链。已改为 `typeof status === "string"` + `Set.has`，以及 `hasOwn` 后才读判别字段；补 3 项回归。Node 22.22.3 下 `npm run check` 为 52 tests/3 files 全通过。仍不能标 clean | [`src/connection.ts`](../../src/connection.ts)、[`test/connection.test.ts`](../../test/connection.test.ts) |

## 结果与当前状态（截至 2026-10-11）

第三轮 Important 修复、其后发现的原型继承 stop reason fail-open 修复、以及第四轮 WIP（drain-until-stable、RPC `agentInvoked:false` settlement、`hasOwn`/`Set.has`）均已写入工作树。本日对第四轮 diff 的只读复审又修了两处 Minor（非字符串 status coerce、`event()` 原型链判别字段）；独立 reviewer 复审仍未完成。不能标为 clean、ready to merge 或 release-ready。

本日（Linux / Node 22.22.3）仅重跑 `npm run check`：52 tests/3 files 全通过（typecheck + typecheck:test + vitest）。未在本轮重跑 smoke、real contracts、`npm pack` 或 Lody mirror。

此前 Node 22.22.3/macOS arm64 证据（对应当时 46 tests 工作树，不含本日新增回归）：`npm run check` 全通过，`npm run build` 通过，`npm run smoke` 使用 OMP 18.3.1 完成 initialize/new/load，四个目标版本的 loopback-only real contracts 均通过。最终 npm candidate：`/Users/tommywu/.cache/acp-extension-omp/artifact-final-kmQPWu/acp-extension-omp-0.1.0.tgz`，18,575 bytes，SHA-256 `bf9a6628bea518e2f567387eb11535e4cd13b74d0e106a990d69956434460256`；独立 production install 的 smoke 与四版本 contracts 均通过。临时 Lody mirror 位于 `/Users/tommywu/.cache/acp-extension-omp/lody-mirror-final-vpBqpD`，archive 为 681,731 bytes、SHA-256 `98f90b827cb04e949e0734558922ccf5789ce5a8ce89fc7672dd3e426687bb85`；最新 manager test 完成 loopback 下载、校验、解压、安装和 ACP initialize。该本地验证不代表 Lody tracked manifest、public artifact read-back 或 production acceptance，也不覆盖本日新增的 status/`hasOwn` 回归。

## 相对计划的偏差

- 007 计划预期“无 message cancel 夹具仍保留”，初版修复暂时将其改成显式 `stopReason: "aborted"`；第二轮 review 指出遗漏后补回独立回归。不能把取消请求本身视为 native abort 已确认。

- Windows 与其他 OS、native background/compaction 未验证；本地 macOS 子进程测试不替代跨平台实测。
- 公开 artifact byte read-back、Lody tracked manifest 与 production acceptance 均未验证；当前临时 mirror 只证明本地 managed-runtime install/initialize 链路。
- Lody 现有 adapter 指令仍是 `omp --mode rpc --no-ui`，而本仓库硬合同为 `omp --mode rpc`；需由集成 owner 决定，不静默改变参数。
- 独立 reviewer 复审仍待完成。
