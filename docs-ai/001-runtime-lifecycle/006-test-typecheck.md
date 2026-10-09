# 001.006 — 测试纳入类型检查，等待上限显式化

## 背景

[005-windows-ci-review.md](005-windows-ci-review.md) 把两条审核发现留着没处理：

- SIG-004 写为延期：`tsconfig.json` 只包含 `src/`，测试代码不经过类型检查。严格检查测试会报 22 个错误，其中 `test/connection.test.ts` 那一处是改动之前就有的。
- SIG-009 没有处理：`withTimeout` 默认等待 3 秒，以后新增强杀用例时如果忘了传上限，SIG-001 的问题会再出现。

## 变更

- 新增 `tsconfig.test.json`：继承 `tsconfig.json`，包含 `src/` 和 `test/`，`noEmit`，`lib` 为 `ES2024`。`Promise.withResolvers` 需要 ES2024 的类型；`engines` 要求的 Node 22.14 和 23.6 运行时已经提供它。生产配置的 `target` 和 `lib` 不变。
- `package.json` 的 `typecheck` 改为 `tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json`。`npm run check` 因此同时检查测试代码，CI 步骤不变。
- 修正测试里的类型错误：
  - `test/connection.test.ts` 中 `usage` 的回调不再返回 `push` 的结果；
  - `test/server.test.ts` 中 harness 的 `request` 补上参数类型；
  - 强杀竞态的子进程替身保留它推断出的结构类型，只在交给 `serve` 时转换为 `ChildProcess`。
- SIG-009：`withTimeout` 的上限改为必填，新增 `RPC_TIMEOUT_MS`（3 秒），与 `FORCED_CLOSE_TIMEOUT_MS`（6 秒）并列，每个调用点都显式选择其一。
- `src/` 没有改动。

已执行（Darwin 27.0.0 arm64，Node `v26.10.0`）：

| 命令 / 场景 | 结果 |
| --- | --- |
| 实现前，用临时配置把 `test/` 纳入严格检查 | 22 个错误 |
| 实现后，临时放入一个含类型错误的 `test/zz-typecheck-probe.ts`，运行 `npm run typecheck` | 报出 `TS2322`，检查失败；随后删除该文件 |
| `npm run typecheck` | PASS |
| `npm run check` | PASS：3 个测试文件、31 项 |

## 当前状态

SIG-004 和 SIG-009 已闭合。本文件的改动还没有经过独立审核。
