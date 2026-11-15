# 018 — 启动模型配置与最新版 OMP 验证：行动记录

## 时间线

| 日期 | 变更 | 引用 |
| --- | --- | --- |
| 2026-11-08 | 非作者 PlanReview 核对后允许实现；先完成行为 RED，再实现四入口启动配置 | `000-plan.md`、`src/connection.ts`、`test/connection.test.ts` |
| 2026-11-08—09 | 统一类型/测试/构建、真实隔离验证与两轮独立源码审查 | `TESTING.md`、本记录 |

## 结果与当前状态

new/load/resume/fork 在交付 ACP 建立响应及首个 prompt 前消费 Core `sessionConfig`。
显式 `modelId` 优先，否则采用 `configOptionValues.model`；省略配置保留原生默认。
结构错误、空模型值及未支持的配置选项在原生会话变更前拒绝；未知所选模型不回退到默认。
目录值映射保留原始 provider/id，最终核实精确 `sessionFile` 和选中模型后才提交可用身份。
这不是 OMP 进程启动或原生 new/switch 前的原子选择。live setter 共用底层核验，原有通知排空、
失败失效及 scope 生命周期不变；既有用户消息分段改动保留。

候选基于 `f3dd62a8424711a3ed1065482ddc09c27f172c73`，包含既有用户改动及本条目，未提交、
未打 tag、未发布。运行时源码身份见 `TESTING.md` 的 18.18.1 本地记录。

### 已执行的验证

- 原工作树初次新增测试出现 28 个预期行为失败；独立 pre-feature HEAD 临时副本中的无默认模型选择
  再出现 4 个预期行为失败。额外 4 项 metadata 扩展/后续 live setter 用例原本通过，属于兼容保护。
- Node 26.13.0 / npm 11.20.0 上 `npm run check`：4 文件 414 项通过；`npm run build` 通过。
- 官方 OMP 18.18.1 的现装 Homebrew 字节经大小及 SHA-256 核实；隔离 smoke/contract 通过。
  Required cases 的真实/合成边界只以 `TESTING.md` 对应记录为准，不将故障夹具冒充真实 OMP。
- 临时双模型回环探针通过真实 Lody resolver 启动 adapter：new/load/resume/fork 建立响应与首个实际
  模型请求均使用明确选择，依次 B/A/B/A；真实 usage 经 Lody parser 保留独立 scope；未知模型无推理。
  同一探针在保留的 18.12.6 上也通过。无用户凭据或付费模型请求。
- `node scripts/verify-package.mjs` 通过：同一工具链两次清理 dist 后重建得到相同 manifest
  和 tarball 字节；生产依赖独立安装后的 npm bin ACP 初始化也通过。这不是干净 Git 提交、
  公开制品回读或恢复能力验收。归档是临时验证产物，未发布或 pin。
- Lody 宿主对应 scope 修复已实际验证：4 个相关文件 113 项通过，CLI 类型检查通过，dev CLI
  构建及版本入口通过；有效 scope 入账，无效 scope 和 pre-Core 绕过均丢弃。
- 独立 Core checkout 及用户 fork 已正常快进至 0.3.0；隔离依赖安装后的 Core 构建和 10 项测试通过。
  本 adapter 仍固定 npm Core 0.1.8，不消费该 checkout；未进行无关依赖升级。

### 独立审核

PlanReview 完成非作者规格核对及至少两轮完整源码/测试复审，第二轮重新阅读完整跨仓 diff，
覆盖原生模型映射、准备锁、失败身份、live setter 兼容、消息归属交互及 Lody scope 消费链。
两轮没有未解决或修后未再审的源码问题。审核者未自行运行测试，运行证据由主 agent 提供；
源码审查不授权恢复能力或发布。

### 最新 OMP 的静态合同核对

18.18.1 仍支持 `omp --mode rpc` 和默认 RPC v1。适配器依赖的终态状态、settlement、state、
usage 与消息身份未发现明确破坏；新 bash 排除上下文能力不是当前 adapter 的使用面。
固定 tag 的主要依据：

- [启动 ready、prompt_result 和 session_settled](https://github.com/can1357/oh-my-pi/blob/v18.18.1/packages/coding-agent/src/modes/rpc/wire/frames.ts#L11-L56)
- [默认协议及协商](https://github.com/can1357/oh-my-pi/blob/v18.18.1/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L1417-L1432)
- [终态与 settlement 顺序](https://github.com/can1357/oh-my-pi/blob/v18.18.1/packages/coding-agent/src/modes/rpc/rpc-session-settle.ts#L80-L108)
- [消息 identity 与 full 更新](https://github.com/can1357/oh-my-pi/blob/v18.18.1/packages/coding-agent/src/modes/rpc/rpc-session-events.ts#L82-L143)
- [usage schema](https://github.com/can1357/oh-my-pi/blob/v18.18.1/packages/coding-agent/src/modes/rpc/wire/rpc-wire.schema.json#L1081-L1173)

这是关键合同子集的静态核对，不是整个上游变更的全面审计；用量字段形状匹配不证明原生总账或
真实 provider 账单完整一致。

## 相对计划的偏差

无已知功能范围偏差。真实验证采用含原有用户改动的候选工作树及当前构建，不能冒称干净发布提交。
没有为了让 Lody 恢复通过而提前添加 load/resume capability。跨平台/上一稳定版证据不足仍保留门禁。

## 未验证的问题

OMP 18.18.0、其他平台/架构和工具链、原生后台/自动 compaction/进行中真实进程故障，以及真实付费
provider 账单完整性均未验证。Lody GUI 操作未执行；机器环境配置只供后续新启动进程继承，不修改共享
Agent 数据库，也不重启现有 GUI/daemon。不可变发布、公开字节回读、runtime manifest pin 均未执行。
