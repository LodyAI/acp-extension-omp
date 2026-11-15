# 018 — 启动模型配置与最新版 OMP 验证：计划

| | |
| --- | --- |
| **状态** | 已实现 |
| **锚点日期** | 2026-11-08 |
| **规格核对** | 2026-11-08，PlanReview（非作者独立 reviewer）核对目标、非目标、备选、身份与锁边界及验收，明确「允许实现018」；不授权恢复能力宣告或发布。 |
| **相关** | [模型翻译](../015-model-explicit-title/000-plan.md)、[兼容政策](../../COMPATIBILITY.md)、[验证合同](../../TESTING.md)、[发布门禁](../../RELEASE.md) |

## 背景

Lody 已通过 `_meta.lody.sessionConfig` 携带新建、加载、恢复和 fork 的模型选择；当前 adapter 未读取该元数据，只有建立会话后的标准 model setter。现有模型目录、原生 `set_model` 返回值及同一 `sessionFile` 的最终状态核实可以复用。用户要求执行兼容检查后的环境升级、真实验证和接入修复；现有未提交的消息归属改动不属于本条目，不覆盖。

## 目标

- 对 new/load/resume/fork 的显式启动模型配置，在 ACP 会话建立响应前应用并核实；第一次 prompt 使用已核实的选择。
- `modelId` 优先于 `configOptionValues.model`；两者省略时保留原生模型，其他配置不声称支持。
- supplied `sessionConfig` 的版本、字段类型和显式模型值有效；不认识的模型在提交 ACP 身份前失败。不得把未实现的配置选项当作成功应用。
- 模型选择继续使用目录中的原始 provider/id，不能拆分拼接后的值。目录歧义、原生拒绝、返回模型不符、最终 sessionFile 改变和断连均失败，不发 prompt，不回滚或自动重试。
- 在已安装的最新稳定 OMP 上跑隔离 smoke/contract，记录实际版本、工具链、字节摘要、源码状态及证据边界。

### 非目标

- 不升级 Core/SDK 依赖，不改变原有 live model setter 的公开行为。
- 不承诺模型在 OMP 进程启动或 `new_session`/`switch_session` 之前已选中；OMP 没有经本条目证明的对应原子接口。本条目承诺的是 ACP 建立交付前、首个 prompt 前。
- 不开放 load/resume/fork/images 的 capability，不绕过原有版本矩阵、平台和独立审核门禁。
- 不实现 MCP、typed ask、审批或子代理桥，不改变消息归属、结算、计费来源和进程回收。

## 方案

1. 在 `test/connection.test.ts` 的现有真实连接夹具中先增加消费者行为回归：new/load/resume/fork 的启动模型选择；省略配置保留默认；modelId 优先；未知/畸形选择失败；原生 set_model 拒绝、模型或身份不符不能交付会话；首个 prompt 使用最终选择。测试文件当前有用户改动，保留原段落。
2. 主 agent 先运行新增测试并观察预期失败，再允许修改 `src/connection.ts`。
3. 通过 Zod 解析 foreign metadata，在任何相关 native session mutation 前拒绝结构错误。用既有模型目录映射解析选择，保持同一 sessionFile；在 prepareSession 交付身份前完成 set_model 及最终读回。必要时抽取仅在本模块复用的最小模型应用函数，避免调用会再次获取 sessionChanging 锁的公开 setter。
4. 对未支持且非空的 startup config options 返回明确错误，不默默报告应用成功；缺少 metadata 与空配置保留现有行为。
5. 主 agent 在源码冻结后运行完整 check/build、真实 smoke/contract 和针对首个 prompt 模型的隔离回环验证；合成边界与真实 OMP 证据分开记录。
6. 实现者以外的 reviewer 最少两轮完整审查；处理发现后重跑受影响验证。只在实际通过的范围内更新根文档并新增本目录行动记录。

## 备选与决策

- 只升级依赖：不采用，Core 0.1.8 已满足当前 usage 表面，版本升级不会自动消费 metadata。
- 仅依赖宿主后置 setter：保留宿主兼容行为，但 adapter 对新 metadata 不再忽略显式选择。
- 在 native session 变更后调用公开 setter：不采用，其锁与身份前提不适用于尚未交付的会话；复用底层校验，单一入口持有准备锁。
- 提前开放恢复 capability：不采用；本机新版通过不等于完整已批准矩阵通过。

## 验收

- 新增回归先失败、实现后通过；`npm run check` 和 `npm run build`。
- `node scripts/smoke.mjs /absolute/dist/index.js /absolute/omp` 与 `node scripts/contract.mjs /absolute/dist/index.js /absolute/omp`，隔离 HOME/profile，仅本地回环模型，不使用用户凭据。
- throwaway 回环验证在 ACP new/load/resume/fork 上传入显式选择，核实建立响应和首个模型请求；未知模型不能产生模型请求。不得把合成 RPC 帧当作真实 OMP 证据。
- 最少两轮非实现者审查；未具备的 OS/上一稳定版/能力宣告/发布门禁继续明确未通过。

## 修订记录
