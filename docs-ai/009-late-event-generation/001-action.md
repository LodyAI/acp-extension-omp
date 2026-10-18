# 009 — 迟到事件归属与会话准备：行动记录

## 时间线

| 日期 | 变更 | 引用 |
| --- | --- | --- |
| 2026-10-18 | 独立上下文 reviewer 核对规格并明确允许实现；task agent 因本机缺少模型无法启动，改用独立 completion 审查 | `000-plan.md` |
| 2026-10-18 | 先增加旧消息在新 prompt 活跃时的回归，5 项失败；实现归属门禁后过滤旧 text/usage，保留 fresh ID | `src/connection.ts`、`test/connection.test.ts` |
| 2026-10-18 | 补会话准备失败、恢复和 3×3 并发公共接口测试，不复制 PR #8 的 switch rejection/cancelled 或无效文件用例 | `test/session-preparation.test.ts` |
| 2026-10-18 | 独立审查发现双 ID 旧归属丢失、分别观察的别名未合并；分别以 2 项、4 项失败回归驱动修复 | `test/connection.test.ts` |
| 2026-10-18 | 发现两个 ID 命名空间仅字符串相同会误拒 fresh usage，增加两向失败回归；以命名空间 key 修复 | `src/connection.ts`、`test/connection.test.ts` |

## 结果与当前状态（截至 2026-10-18）

- start/update/end 共同通过归属门禁。已知旧 generation、idle/preparation 首次观察、可靠 native identity 明确不符的消息不计入当前 text/usage；不关闭连接，也不重发 prompt。
- messageId 与 message.responseId 分属不同命名空间，只有同帧共现才合并为别名组。后到的关联证据传播到整个组；保留最早 generation，同代优先保留已有 usage key，重复和补全仍经 `SessionUsageAccumulator`。
- 当前 active 中首次出现、无可靠旧来源证据的 ID 正常接收，不要求先有 start。连续 6 次 new/load/resume 的 current/legacy 完整 end、重复和补全正常计费，各次 preparation 使用独立 usage scope。
- A16 新文件 22 项：三入口 get_state rejected/missing/empty sessionFile、exact load/resume 选错文件后恢复、ACK 后 EOF，以及准备阶段 9 种操作竞争。验证旧身份拒绝、无 fallback/偷偷 prompt、stale 通知抑制和恢复后 usage scope。
- 原私有 sessionId 篡改测试改为公共 new/load/resume 调用，证明通知排队期间不允许切换且最终通知身份不变。
- `COMPATIBILITY.md` 记录未知归属继续接收、已接收歧义通知不回溯撤销、无关联 terminal 依赖上游顺序及连接内归属表增长的限制。

### 已执行验证

- `npm run check`：类型检查通过；4 个文件 **112/112 tests passed**。connection 64、session-preparation 22、server 18、signal 8；本次相对初始 69 项新增 43 项。
- `npm run build`：退出码 0。
- 编译产物 synthetic smoke：直接 import `dist/connection.js`，合成 JSONL streams 经 new/load/resume 重复两轮；观察 6 条 fresh usage、6 个独立 scope，旧 text/legacy usage 被过滤、双 ID 去重、failure=0，退出码 0。临时会话文件已在 finally 删除；没有保存 smoke 脚本。
- 未修改 README.md、package.json 或 `/tmp/wt-fix`；未执行 git add、commit 或 push。

### 独立审查

审查者为非实现者、独立上下文 completion；每轮只审查，不编辑、不提交。规格核对和实现审查分开进行。

| 轮次 | 已检查 | 发现与处理 | 未检查 |
| --- | --- | --- | --- |
| 1 | 完整 connection/transport、新 preparation 测试及完整 tracked diff | A15-01：双 ID 只保存一种来源；补两向回归并修复。A15-02：native ID 缺省证据不足；补测试。A16-01：exact resume 恢复证据不足；补测试 | 当时未附完整旧测试、PR #8 和 accumulator 实现；未运行程序 |
| 2 | 完整 connection/transport、两个当前测试、PR #8 只读测试、accumulator 实现及完整 diff | 复核上轮；A15-01 部分未闭合，A15-03：双方已登记后未合并归属/计费 key；补 4 项失败回归、合并整个别名组，并补已有单边账本测试 | 未运行程序、真实 OMP 与发布矩阵 |
| 3 | 上轮问题及修复后的完整 diff、相关完整源码/测试/文档 | A15-01/A15-02/A15-03/A16-01 静态关闭，无新增阻断项 | 未运行程序、真实 OMP 与发布矩阵 |
| 4 | 复核前轮全部问题及最终完整 diff，含命名空间修复 | A15-04：跨 ID 域字符串相等不能证明关联；namespace 修复静态关闭，前轮结论维持，已检查范围无阻断项 | 未运行程序、真实 OMP 与发布矩阵 |

- 已解决并再次审核：A15-01、A15-02、A15-03、A16-01、A15-04；没有未解决或修了但未再审的问题。拒绝/延期的新增修复：无；真实 OMP background 和发布矩阵属于未验证范围，不将静态审核结论冒充真实合同通过。

## 相对计划的偏差

- 可写 task agents 无法启动，A16 由主实现者编写；独立规格和实现审查使用可用的 stateless completion，未改用户模型配置。
- 首次归属从单 ID 扩展为带命名空间的别名组。后到的可靠关联可将此前模糊归为当前的 ID 证明为旧 ID，故需要传播最早归属，不机械保留旧的推断；同代保留已入账 key，避免表征切换造成重复计费。
- 不新增可回溯撤销的账本：尚无关联证据时接收是用户要求；已经发送的歧义通知不撤回，兼容性文档明确这一边界。

## 未验证的问题

- 没有运行真实 OMP background/settlement 或 `npm run contract`，未证明上游正确 settled 后不会出现旧帧。编译产物 smoke 和合成回归不能代替真实合同或发布矩阵。
- 长连接归属记录随不同 ID 数量增长，没有做长期内存压测；不以任意淘汰窗口假装实现完整隔离。
- 真实 OS/版本矩阵、Lody 消费端与发布制品均未在本项验收。
