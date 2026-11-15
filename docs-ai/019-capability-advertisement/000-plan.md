# 019 — Release 1 能力宣告与 resource_link 翻译：计划

| | |
| --- | --- |
| **状态** | 已核对 |
| **锚点日期** | 2026-11-15 |
| **规格核对** | 2026-11-15，非起草者独立 reviewer 两轮完整核对。第一轮不允许实现（PR19-001 至 PR19-008），修订后第二轮明确「允许实现019」，附条件 PR19-009 至 PR19-015。这些条件已写进本文，补充文字本身未再审，由实现后的源码／证据审查一并核对。许可只含 `promptContent` 的 `resource_link` 分支、`initialize` 的三项宣告、对应测试、`expectedInitialize` 和探针脚本；不含 load 宣告、合并、tag、发布。 |
| **相关** | [V1 剩余门禁](../012-remaining-v1-gates/000-plan.md)、[范围收口](../012-remaining-v1-gates/017-release1-scope-and-target.md)、[R-UX 合同](../012-remaining-v1-gates/007-r-ux-contract.md)、[兼容政策](../../COMPATIBILITY.md)、[验证合同](../../TESTING.md)、[发布门禁](../../RELEASE.md) |

## 背景

`src/server.ts` 的 `initialize` 现在只宣告 `_meta.lody.usage`，`promptCapabilities.image` 为 false，没有 `loadSession` 和 `sessionCapabilities`。`resumeSession`、`loadSession`、`unstable_forkSession` 和内联图片 prompt 的翻译路径都已实现并有合成测试。

用户在 2026-11-15 裁决把 load、resume、fork、图片都对 Lody 开放（012.017）。起草和第一轮核对查到三个事实，决定了本计划的形状。Lody 的观察来自本机工作树 `6adb42a71`，只读。

1. **load 不重放历史。** `src/connection.ts` 的 `loadSession` 只做精确 `sessionFile` 切换并返回 `configOptions`。ACP 的 `session/load` 要求 agent 把整段对话用 `session/update` 重放；`session/resume` 不重放。Lody 的 `apps/cli/src/lib/history-session-catalog-client.ts` 把 `agentCapabilities.loadSession` 当历史导入入口；`apps/cli/src/agent/agent-client.ts` 在两者都宣告时实时恢复优先走 load。宣告 `loadSession` 会让历史导入拿到空结果并当作成功。只宣告 resume 时，Lody 的实时恢复走 `resumeSession`。
2. **resume 和 fork 在 Lody 里受能力门控，图片不受。** `agent-client.ts` 读 `sessionCapabilities.resume` 和 `sessionCapabilities.fork`；不宣告就没有入口。`apps/cli` 不读 `promptCapabilities`，`apps/cli/src/lib/message-handler.ts` 无条件构造图片块。Lody 的 web／桌面界面是否另有门控没有核实。
3. **Lody 发图片时总附带 `resource_link`。** 每张图片是一个 `{type:'image', mimeType, data}` 加一个 `{type:'resource_link', uri:'file://…', name, mimeType, size}`；非图片附件只有 `resource_link`。`src/connection.ts` 的 `promptContent` 对 text 和 image 之外的块整条拒绝，`test/connection.test.ts` 把「image 加 resource_link 原子拒绝」固定成了测试。所以现在 Lody 里发图片和发文件附件都会失败，与是否宣告无关。ACP 把 `resource_link` 列为 prompt 基线，不需要能力位。

fork 没有带历史切点的风险：Lody 在没有 Core `forkAtTurn` 能力时不发带 turnId 的 fork；适配器不发 `_meta.lody.turnId`；未宣告 `additionalDirectories` 时 Lody 传空数组。

## 目标

- `promptContent` 接受 `resource_link`：按块顺序翻译成一段文字 `<name>: <uri>`，和其他文字段一样用双换行拼接。不读取 URI 指向的内容，不校验 scheme，不去重。这与 Lody 的 Pi 适配器（`Lody:packages/acp-extension-pi/src/connection.ts`）的写法一致。
- `initialize` 新增 `agentCapabilities.sessionCapabilities.resume: {}` 和 `sessionCapabilities.fork: {}`，`promptCapabilities.image` 改为 true。`_meta.lody.usage` 不变。
- `loadSession` 继续不宣告，方法保留现状。
- 宣告集合由精确断言固定：`test/server.test.ts` 的全量 `initialize` 断言和 `scripts/contract.mjs` 的 `expectedInitialize` 同步为新集合。

### 非目标

- 不实现 `session/load` 的历史重放，不宣告 `loadSession`。
- `resource`（embedded context）和 `audio` 继续整条拒绝，`embeddedContext` 保持 false。
- 不宣告 Core `forkAtTurn`、`mcpCapabilities`、`sessionCapabilities.list`／`close`／`delete`、`_meta.lody.subagents`、`_meta.lody.tasks`、`sessionTitle`。
- `src/connection.ts` 只改 `promptContent` 的 `resource_link` 分支。会话身份、结算、用量、消息归属、fork 和模型逻辑不动。
- 不改写 `TESTING.md` 的 Required cases。不打 tag、不发布、不改 Lody manifest。

## 方案

1. 先改测试并观察失败。`test/connection.test.ts`：把 `resource_link` 从原子拒绝的参数表里移出，新增 `[text, image, resource_link, text]` 的顺序与拼接断言、只有 `resource_link` 的 prompt、以及 `audio`／`resource` 仍原子拒绝。`test/server.test.ts`：全量 `initialize` 断言改为新集合，其余位置同步，并断言没有 `loadSession`、`mcpCapabilities`，`embeddedContext` 为 false。
2. 改 `src/connection.ts` 的 `promptContent` 和 `src/server.ts` 的 `initialize`；更新那条「其他能力保持不宣告」的注释，说明 load 为何不宣告。
3. 同步 `scripts/contract.mjs` 的 `expectedInitialize` 及其上方注释。Required case 1 的文字不动。
4. 真实证据在合并宣告之前取得，两个目标版本各一次，入口是干净导出后独立安装的归档：
   - `scripts/smoke.mjs` 和 `scripts/contract.mjs`。
   - 探针 `scripts/capability-probe.mjs`（提议；隔离 HOME／profile，只用本地回环模型；不在 npm `files` 白名单里，不随包发布）：
     - fork：源连接保持存活，另开连接对同一 `sessionFile` 调 `session/fork`。记录新旧 `sessionFile` 不同、源文件 fork 前后 SHA-256 相同、fork 后首个模型请求带有源会话第一轮的用户文字和助手回复、源会话之后还能完成一轮且不改动 fork 出的文件。
     - 图片：回环模型声明支持图片输入，发 `[text, image, resource_link]`，核对回环端点实际收到的请求里有该图片字节和 `<name>: <uri>` 文字。
     - resume：新连接 `session/resume` 同一文件后完成一轮 prompt，模型请求带有源会话第一轮的用户文字和助手回复。
   - 记录里写探针脚本的 SHA-256，审核者直接读仓库里的脚本。
5. 失败处置是全有全无。18.20.2 或 18.20.1 上 contract 或探针任何一项不过，三项都不宣告：`initialize`、`test/server.test.ts` 的断言和 `expectedInitialize` 一起回到只宣告 usage 的集合。`resource_link` 翻译只有在它自己的探针项（文字到达模型请求）通过时才保留，否则一并撤回。结果写进行动记录。
6. 非实现者 reviewer 至少两轮完整审查源码、测试和证据。
7. 根文档只改回答该问题的句子：`README.md` 里说 load／resume／fork／图片不宣告和 prompt 内容范围的几处；`COMPATIBILITY.md` 的 Runtime and release policy 里关于宣告的那一句；`TESTING.md` 新增记录。`TESTING.md` 历史记录里「初始化仍只宣告 usage」是当时的事实，不回写。写本目录的 `001-action.md`（提议）。

## 与既有门禁的关系

012 的 R3 写的是 R1 目标行和独立审核都通过后才宣告，007 把图片宣告排在 R3 之后。012.017 的用户裁决把宣告方向定了下来，本计划就是 R3 对 resume、fork、图片的落地，前置条件仍是上面第 4 步的目标版本真实证据和第 6 步的独立审核。R1 的其他平台行没有因此关闭：宣告的证据只有 macOS arm64 单一工具链，这一点写进 `COMPATIBILITY.md`，发布前是否接受由维护者在 R6 决定。

## 备选与决策

| 方案 | 结论 |
| --- | --- |
| 宣告 resume、fork、图片，并翻译 `resource_link`；load 不宣告 | 采用。 |
| 按裁决原文四项全部宣告 | 不采用。`loadSession` 不重放历史，Lody 历史导入会拿到空结果。这是对用户裁决的偏离，交付时明确告知。 |
| 只宣告 resume 和 fork，图片另立计划 | 不采用。图片是 Release 1 底线；不修 `resource_link`，Lody 里发图和发附件现在就是失败的，拖到下一条目没有好处。 |
| 宣告图片但不处理 `resource_link` | 不采用。Lody 的图片 prompt 仍被整条拒绝，宣告等于空话。 |
| 丢弃 `resource_link`，只转发图片 | 不采用。非图片附件会被静默吞掉，用户以为模型看到了文件。 |
| 读取 `file://` 内容内联给 OMP | 不采用。适配器不替 OMP 读用户文件；OMP 自己有读文件工具，给路径即可。 |
| 先实现历史重放再宣告 load | 不在本条目。它是新的实质翻译，需要自己的计划和真实证据。 |
| 把 fork、图片、resume 的真实核对并进 `scripts/contract.mjs` | 不采用。contract runner 对应 `TESTING.md` 的 Required cases，本条目不改写它们。改为单独的探针脚本留在仓库，并在 `COMPATIBILITY.md` 写明每个新的 OMP 目标行都要重跑探针，否则这三项宣告没有该版本的真实证据。 |
| 用 `description` 里的可读相对路径代替或补充 URI | 不采用。保持与 Pi 适配器相同的 `<name>: <uri>`；`file://` URI 对空格和非 ASCII 是百分号编码的，模型需自行解码，列为已知限制。 |

难以回头的是宣告本身：宿主一旦依赖，回收就是破坏性变更。`resource_link` 的文字格式也会进入用户会话历史。

## 验收

- 新断言先失败、实现后通过；`npm run check`、`npm run build`、`node scripts/verify-package.mjs` 通过。
- `scripts/contract.mjs` 在 OMP 18.20.2 和 18.20.1 上用新 `expectedInitialize` 通过。
- 第 4 步探针在两个版本上通过，命令、版本、摘要和观察值写进 `TESTING.md`。探针用的是合成小图和回环模型，不证明真实 provider 的视觉能力。
- 已知未覆盖，写进行动记录的未验证项：模型声明不支持图片时 OMP 是否报错而非静默丢图；大图经 RPC 单行 JSON 是否有上限；含空格或非 ASCII 路径的 `file://` URI。
- 证据边界照实写：图片在本计划之前只有合成证据；fork 的既有真实证据在 18.18.1 和 18.12.6 上。真实 Lody 界面上的恢复、fork、发图片和发附件不在本条目验收内，列入未验证。
- 至少两轮非实现者审查，结论分开记录已解决、未解决、修了未再审。

## 修订记录
