# 016 — ACP 关闭原因与失败退出分类：行动记录

## 时间线

| 日期 | 变更 | 引用 |
| --- | --- | --- |
| 2026-10-25 | M compiled 通知故障无成功响应、组已回收，却自然 exit 0；静态追到既存 PROD-NOTIFY-EXIT-01，不把它冒充 M 新增根因 | `artifact://924`；[000-plan.md](000-plan.md) |
| 2026-10-25 | 单次真实 before trace 证明故障先于 SDK abort／正常 close，parent 没有先发 EOF | `artifact://939` |
| 2026-10-25 | 两位非作者核对规格并登记许可；主 Agent permanent 功能 RED 经过真实关闭／组消失后在 exitCode 0≠1 断言失败，再授权 server-only 源码 | `artifact://955` |
| 2026-10-25 | 实施 decoded flush 正常见证与失败先报告后回收；主 Agent 完成当前全部根检查及 M49＋五保留 compiled | `artifact://956`／`artifact://963` |
| 2026-10-25 | 两位非作者各完成第二轮完整当前实现复审，最终 findings=[]，允许本窄片源码／合成验收闭合 | `ModelTitleSpecReviewOne`、`ModelTitleSpecReviewTwo` 最终报告 |

## 结果与当前状态（截至 2026-10-25）

`src/server.ts` 在既有 decoded 父输入桥的 `flush` 同步登记正常来源，早于向 SDK 交付 done。显式 `server.close()` 与信号仍使用原正常入口；未有正常来源的 SDK abort 或真实 readable error 先调用 parent failure 报告、设置失败退出码，再 `close(true)` 回收 OMP。

分类不比较 reason 文案或是否存在；SDK 对非法 JSON 的 logskip 不是 server decoded readable error。正常首因后的派生 reader 取消／晚 write rejection 不升级故障，错误先登记也不被后到 EOF 洗零。真正强制回收失败仍走原 catch 直接升级，幂等关闭、单调宽限、第二信号、stdio 排空及 fd2 容错未改。

### 消费者与实际 after

`test/server.test.ts` 使用真实 SDK、实际 serve 与合成 OMP：保持父输入开放的真实 Writable 拒绝、独立 decoded EOF、Error／undefined source error、显式 close、EOF 先真实 closed 再释放既入场 write 拒绝。主断言先于 cleanup，gate 在 finally 释放；`test/signal.test.ts` 保留原八项信号／EOF／强杀合同，fixture 只迁移模型 catalog 支持。

以下为主 Agent 实际执行结果；本作者与两 reviewer 均未重复运行。

| 证据 | 观察 |
| --- | --- |
| permanent RED955 | `npm run test -- test/server.test.ts --exclude '**/.claude/**' -t 'reports one parent failure and exit 1 when a real output write rejects with parent input open' --reporter=dot`；live 输入真实拒绝后 closed、pending 无成功、native PID／组消失断言已经过，exitCode actual 0 vs expected 1 失败，1 failed／83 skipped，非 timeout／cleanup 兜底。 |
| 当前根检查 | `npm run typecheck`、`npm run test -- --exclude '**/.claude/**'`、`npm run build` 分别通过；4 files／315 tests（23 preparation、200 connection、8 signal、84 server）。并非另记 `npm run check` 已执行。after 为 `artifact://963:1-175`，完整原输出亦见 `artifact://956`。 |
| compiled 通知故障 | `artifact://963:34326-34334` 的 notification-write-failure passed，自然 adapter exit 1／无 signal，owned group gone；实际故障 marker、无成功 config 通知／setter response，未靠 parent 先 EOF 或 watchdog 制造退出。 |
| 当前完整 compiled | M49全 passed，`963:34931-34934` driver 0／scratch removed；同字节 identity、F/I22、root outcome、malformed3、legacy3 五 bundle 的完整结论在 `963:34939-41653`。均为真实编译 adapter＋隔离合成 native fixture，不是真实 OMP。 |
| 两轮实现复审 | `ModelTitleSpecReviewOne`、`ModelTitleSpecReviewTwo` 重新全文审当前组合 source／tests并亲读963，最终 findings=[]；明确仅关闭 PROD-NOTIFY-EXIT-01 已界定的失败退出分类及受测合成路径，不称任意生命周期环境都被证明。 |

before trace939 的可见顺序保留：adapter seq6真实 write 故障→7 SDK close(error)→8 abort但退出码未设→9正常close caller→10–14 host.failure实际调用仍未设1→22 SDK cancel 引起stdin.destroy→55／56自然exit0；parent完整记录没有stdin.end，parent.destroy晚于adapter退出。closeRequested没有直接采样，guard状态仅由stack与同步赋值源码推断，不冒充动态读值。历史924失败及当时 `&&` 后未执行的旧bundle不被最终通过回写。

## 相对计划的偏差

无已知范围偏离。生产只改 `src/server.ts` 的既有桥与关闭入口，复用 closeRequested／parentFailed，不引入通用状态框架、timer成功、重试、SDK/parser/RPCTransport更改或新 stdout 诊断。016不改变M／013／014的prompt结果、用量、身份或取消语义。

## 未验证的问题

- 未运行真实目标 OMP、真实 Lody、新版本／OS兼容矩阵或发布字节验收；native N、R2、R3、R4–R6／Release未由本片关闭，T1尚未实现。
- SDK-BOOT-01（014-VERIFY-001）历史 session/new 准备超时仍未归因；本次成功不证明已修复或 flaky。SDK-OBS-01 raw harness pending 可观测性缺口仍独立开放，见 [014 行动记录](../014-post-local-session-identity/001-action.md)。
- 外部 I/O／插件永不返回和未覆盖的宿主环境不获得全链期限保证；本记录不提供提交、推送、打包、发布或 pin 结果。
