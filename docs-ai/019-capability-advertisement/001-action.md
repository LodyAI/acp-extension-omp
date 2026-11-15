# 019 — Release 1 能力宣告与 resource_link 翻译：行动记录

## 时间线

| 日期 | 变更 | 引用 |
| --- | --- | --- |
| 2026-11-15 | 计划两轮独立核对：第一轮不允许实现（PR19-001 至 008），修订后第二轮允许实现并附条件（PR19-009 至 015） | `000-plan.md` |
| 2026-11-15 | 先改测试观察到 5 项预期失败，再实现翻译和宣告 | `1edd890` |
| 2026-11-15—16 | 三轮独立实现审核及修复 | `4eed318`、`e70795a`、`d6362de` |
| 2026-11-16 | 干净导出上对 OMP 18.20.2 和 18.20.1 跑 smoke、contract 和探针 | `TESTING.md` |

## 结果与当前状态（截至 2026-11-16）

- `src/connection.ts` 的 `promptContent` 把 `resource_link` 按块顺序翻译成文字 `<name>: <uri>`。`audio` 和 `resource` 仍整条拒绝。
- `src/server.ts` 的 `initialize` 宣告 `_meta.lody.usage`、`sessionCapabilities.resume`、`sessionCapabilities.fork` 和 `promptCapabilities.image: true`。`loadSession` 不宣告。
- `test/server.test.ts`、`test/connection.test.ts` 和 `scripts/contract.mjs` 的 `expectedInitialize` 固定了这个集合和翻译格式。
- 新增 `scripts/capability-probe.mjs`，不在 npm `files` 白名单里。`COMPATIBILITY.md` 写明每个新的 OMP 目标行都要重跑它。
- 两个目标版本上的真实证据见 `TESTING.md` 的 `d6362de` 记录。全有全无的失败处置没有触发。
- 未打 tag、未发布、未改 Lody manifest。

### 独立审核

实现审核由非实现者 reviewer 做了三轮，每轮都重审完整 diff，并自己运行了 check、build、contract 和探针（18.20.2）。

- 三轮都没有在 `src/` 的翻译和宣告里发现缺陷。
- 已解决并经再审确认：IR19-001 至 IR19-011。主要是探针的证明力（单个请求同时带图片、链接文字和历史；fork 会话 prompt 后再比源文件；删掉恒真的判定）和清理（OMP 不在适配器进程组内，改为经适配器的关闭路径回收；审核者重做 SIGTERM、SIGINT 中断实验确认无残留）。
- 修了但未再审：IR19-013（关闭定时器不清除，进程多挂 10 秒）、IR19-014（强杀兜底不报告）、IR19-015（中断后的窄竞态），在 `d6362de` 修复；以及 IR19-012 对应的 `TESTING.md` 记录和本文件。
- 未解决：无已知。
- 审核者没有覆盖：OMP 18.20.1 上的运行（由主 agent 执行）、外网抓包、强杀兜底路径和终端 Ctrl-C 的实测、Lody 界面、Linux／Windows。

## 相对计划的偏差

- 计划写探针「核对回环端点实际收到的请求里有该图片字节」。实测 OMP 把提交的 PNG 转码为 WebP，原始字节不保留。探针改为要求最后一条用户消息里恰好有 1 个图片部件，且按文件签名是一张图。它证明图片经适配器到达了模型请求，不证明内容与提交的图片逐字节相同。
- 用户裁决是 load、resume、fork、图片四项都宣告。`loadSession` 没有宣告，原因和依据在计划的背景与备选里。
- 实现审核做了三轮，多于计划的最少两轮。

## 未验证的问题

- 真实 Lody 界面上的恢复、fork、发图片和发附件；Lody web／桌面界面是否另有能力门控。
- 模型声明不支持图片时 OMP 是报错还是静默丢图；大图（Lody 允许到 20 MB）经 RPC 单行 JSON 是否有上限。
- 含空格或非 ASCII 路径的 `file://` URI 是百分号编码的，模型能否据此读到文件没有验证。
- `/rename 标题` 带附件时走普通 prompt 路径，OMP 原生如何处理这段文字没有实测。
- 探针和 contract 运行期间 OMP 是否访问外网，没有抓包。
- 其他平台／架构和 Node 工具链。宣告的真实证据只有 macOS arm64 / Node 26.13.0。
- Lody 的 `specs/builtin-omp.zh.md` 写的是标准 ACP `new/load/resume`，与本适配器不宣告 load 不一致，归 Lody 仓库处理。
