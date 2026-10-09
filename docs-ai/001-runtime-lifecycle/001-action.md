# 001 — 运行时生命周期与可复现检查：行动记录

## 时间线

| 日期 | 变更 | 引用 |
| --- | --- | --- |
| 2026-10-08 | 审查共享分支改动；补齐跨平台直接子进程终止测试、`types` 限定、`prepack`、CI OS 矩阵、runner 退出码检查和 README 基线；保留计划索引 | [000-plan.md](000-plan.md) |
| 2026-10-08 | 运行定向测试、完整检查、构建、无 `dist/` 打包，以及隔离 OMP smoke/contract；用退出码 23 的临时适配器验证两个 runner 均失败退出 | 命令记录见下文 |

## 结果与当前状态（截至 2026-10-08）

- `src/server.ts` 在宽限期后对 Windows 直接调用已拥有的 `ChildProcess.kill("SIGKILL")`；POSIX 仍终止进程组。默认仍为 `spawn("omp", ["--mode", "rpc"], ...)`，不启用 shell。`spawnProcess` 标记为 `@internal`，只供合成测试注入。
- `test/server.test.ts` 用 `path.delimiter` 拼接 `PATH`。Windows fixture 通过直接 Node runner 注入；POSIX 使用 shebang 命令并走 POSIX 进程组分支。ignore-EOF fixture 同时忽略 SIGTERM，测试验证 `serve` 持有的 PID 在强制终止后退出，并在失败路径清理残留进程。
- `tsconfig.json` 限制 `compilerOptions.types` 为 `node`；`package.json` 增加 `prepack: "npm run build"`；CI 矩阵覆盖 `ubuntu-latest` 与 `windows-latest`；`README.md` 克隆分支为 `main`，测试数为 19。
- `scripts/smoke.mjs` 与 `scripts/contract.mjs` 在收尾检查适配器退出 code/signal；临时退出码 23 场景均被判为失败，没有打印成功结果。
- `docs-ai/README.md` 索引已指向本条目。未修改 `package-lock.json` registry、`TESTING.md` Required cases、Lody provider 或 manifest。

已执行：

- `npm test -- test/server.test.ts`：6 tests passed。
- `npm run check`：类型检查通过；2 个测试文件、19 tests passed。
- `npm run build`：通过。
- 删除生成的 `dist/` 后执行 `npm pack --dry-run`：先触发 `prepack` 构建，打包清单为 15 个文件。
- `omp --version`：`omp/18.8.4`。`npm run smoke`：隔离 profile initialize/new/load 通过，未发 prompt。
- `npm run contract`：真实 OMP 18.8.4 配合 loopback 合成模型的 contract 通过。
- 临时适配器以 code 23 退出：`npm run smoke -- /tmp/acp-omp-nonzero-adapter.mjs` 抛出 `ACP adapter exited unsuccessfully (23)`；`node scripts/contract.mjs /tmp/acp-omp-nonzero-adapter.mjs` 断言退出 code 必须为 0。临时文件已移除。

## 相对计划的偏差

无已知偏差。POSIX 生命周期测试通过仅用于观测实际启动的子进程并确认 PID；平台选择未被改写，Windows 分支留给 Windows CI 执行。

## 未验证的问题

- 本地环境不是 Windows；`windows-latest` 上的 CI workflow 尚未执行，因此 Windows 运行结果仍待 CI 证据。
- 本次 contract 仅覆盖 OMP 18.8.4 和隔离 loopback 合成模型；其他版本、真实 provider 故障矩阵及发布兼容性未验证，也未据此宣告支持。
