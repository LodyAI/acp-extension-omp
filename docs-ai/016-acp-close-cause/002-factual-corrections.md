# 016.002 — 历史证据与分片状态澄清

## 背景

本修订承接已发布 000／001 的未提交事实更正。按 `docs-ai/README.md` 恢复并保留历史正文与原修订行，以新文件澄清证据边界，不改写原失败、未执行或后续结果。

## 变更

### 输出与审核的可复核范围

000 背景／修订记录及001所列运行结果和审核结论均为原实施记录的历史报告，不是本次重新执行或独立确认的结果。原记录称由主 Agent 执行、作者与两 reviewer 未复跑。旧表中的「当前」仅指原实施检查点；分别执行 typecheck、test、build 不表示另跑过 `npm run check`。

`artifact://924`、939、955、956、963，及「输出 NNN」「RED955」「trace939」「NNN:行号」只标识当时的原始输出和行号，不是仓库内可读取的证据链接。原输出、compiled runner 与完整审核报告未存入仓库，无法从仓库复核。309／315 根 tests、M49、五保留 bundle、自然 adapter exit 1／组消失、driver 0 和两位非作者 findings=[] 只能作为原报告的历史结果保留，不能当成本轮验证，也不能升级为真实 OMP 或任意环境的生命周期证明。

原记录的 924 通知故障自然 exit 0 与当时 `&&` 后未执行的旧 bundle，不能被最终963通过回写。000背景当时尚缺首因时间线，后来939的文字记录并不使924原输出重新可读。

### 永久消费者与历史交接

现存永久测试可供源码复查：`test/server.test.ts` 的 `reports one parent failure and exit 1 when a real output write rejects with parent input open`。原记录描述的消费者覆盖保持父输入开放的真实 Writable 拒绝、独立 decoded EOF、Error／undefined source error、显式 close、EOF 已真实 closed 后才释放既入场 write 拒绝；主断言先于 cleanup，gate 在 finally 释放。`test/signal.test.ts` 保留八项信号／EOF／强杀合同，fixture 仅迁移模型 catalog 支持。测试存在不是本轮运行通过。

保留此前更正所表达的 test-only 交接语义：harness 只增加受控 endInput／errorInput／输入事件与可等待输出 sink；SDK 对非法 JSON 的 logskip 不等于 server decoded source error。这些原始交接细节保留于000历史修订行，不回填已发布001。

001 的 before trace939 是原记录称由 API owner 读取的输出：adapter seq6真实 write 故障→7 SDK close(error)→8 abort但退出码未设→9正常close caller→10–14 host.failure实际调用仍未设1→22 SDK cancel 引起stdin.destroy→55／56自然exit0；parent记录没有stdin.end，parent.destroy晚于adapter退出。这里保留的是该历史报告，不声称本轮读到了trace。closeRequested 未直接采样，guard状态仅由stack及同步赋值源码推断，不能冒充动态读值。

### T1 时间语义

001「T1 尚未实现」指本记录写成时，而非当前状态；后续整体实现的历史记录见 [015 行动记录](../015-model-explicit-title/001-action.md)。原记录未运行真实目标 OMP、真实 Lody、新版本／OS矩阵或发布字节验收，native N、R2、R3、R4–R6／Release没有由016关闭。

## 未验证的问题

本修订未运行构建、测试、lint、formatter、compiled smoke、真实 OMP 或 Lody，没有新增审核证据。SDK-BOOT-01（014-VERIFY-001）的历史准备超时未归因，SDK-OBS-01 raw harness pending 可观测性缺口仍开放，旧报告成功不是已修复或 flaky 的证明；见 [014 行动记录](../014-post-local-session-identity/001-action.md)。外部 I/O／插件永不返回或未覆盖宿主环境没有全链期限保证。未提交、推送、合并、打包或发布。
