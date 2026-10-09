# 001 — 运行时生命周期与可复现检查：计划

| | |
| --- | --- |
| **状态** | 已实现 |
| **锚点日期** | 2026-10-08 |
| **规格核对** | `PlanSpecReviewerApproved` 独立复核两轮（2026-10-08）；目标、非目标、Windows 进程所有权、验收证据均通过，允许实现。 |
| **相关** | `AGENTS.md`、`docs-ai/README.md`、`TESTING.md`、`RELEASE.md` |

## 背景

从最新 `main` 创建的审查分支在当前干净依赖安装后，`npm test` 的 18 个测试通过，但 `npm run check` 和 `npm run build` 都被项目目录上级自动发现的 `@types/inquirer` 声明错误阻断。显式传入 `--types node` 后，生产源码的 TypeScript 检查通过；现有 `tsconfig.json` 没有限制全局类型发现，因此结果会随工作区祖先目录变化。

`src/server.ts` 的子进程关闭逻辑在非 Windows 平台会在宽限期后杀死 OMP 进程组，但 Windows 分支只结束 stdin 并等待，子进程不退出时不会强制终止。ACP 连接关闭后，OMP 可能继续运行并持有资源或继续处理工作。

`README.md` 的协作克隆命令仍指向已经完成合并的 `feat/initial-omp-adapter`，与当前 `main` 基线不一致。

## 目标

1. 让项目的 TypeScript 检查只加载项目明确需要的 Node 类型，避免上级工作区的无关 `@types` 污染，同时不使用 `skipLibCheck` 掩盖真正的声明错误。
2. 在所有支持的平台上，ACP 连接关闭后，OMP 子进程最多经过既有宽限期就被终止；保留 POSIX 进程组清理，并为 Windows 直接子进程增加强制终止路径。
3. 为子进程忽略 stdin EOF 的情况增加跨平台生命周期回归测试，证明关闭后进程已经退出，且不捕获会话、凭据或提供商数据。
4. 让 CI 在 `ubuntu-latest` 与 `windows-latest` 上运行该合成生命周期测试，使 Windows 强杀分支有实际执行证据。
5. 让 `npm pack` 在干净 checkout 或陈旧 `dist/` 时先构建当前源码，并让 smoke/contract runner 检查适配器最终退出状态。
6. 修正 README 的克隆示例和回归测试数量，使其与当前 `main` 基线一致。

### 非目标

本条目不改变 OMP 的真实兼容性声明；真实 OMP 矩阵和真实子进程故障矩阵仍按 `TESTING.md` 单独记录。

- 不宣告新的 OMP 版本或 ACP 能力，不改变 `sessionFile`、取消、用量或 MCP 边界。
- 不实现 Lody provider、runtime manifest、托管运行时解析或 Lody 专用测试。
- 不更换 `package-lock.json` 的 registry 来源；当前仓库没有批准镜像策略，贸然改写全部锁定 URL 会扩大供应链决策范围。
- 不把 `docs-ai/`、`.omp/skills/` 或 OMP 可执行文件加入 npm 制品。


## 方案

1. 修改 `tsconfig.json` 的 `compilerOptions`，增加 `types: ["node"]`。不采用 `skipLibCheck`，因为它会把依赖声明错误变成未检查区域。
2. 在 `src/server.ts` 的 `close` 宽限期后保留现有 POSIX 进程组 `SIGKILL`，并在 Windows 使用已拥有的 `ChildProcess` 对象调用直接终止；终止后继续等待一次退出事件。为 `serve` 增加仅供合成测试使用的可选 `spawnProcess` 注入，默认仍为 `spawn`，生产路径继续精确执行 `omp --mode rpc` 且不启用 shell。
3. 扩展 `test/server.test.ts` 的合成 OMP 夹具：POSIX 默认使用现有 shebang 文件；Windows 测试通过 `spawnProcess` 注入直接启动同目录 Node runner，避免 `.cmd`/`cmd.exe` 子树造成所有权歧义；测试统一使用 `path.delimiter` 组装 PATH。增加一个忽略 stdin EOF、记录 PID 的场景，关闭 ACP 服务后验证该 PID 已退出。测试使用临时目录和合成进程，失败时也清理残留进程。
4. 修改 `.github/workflows/ci.yml` 的矩阵，让现有 Node 版本在 `ubuntu-latest` 和 `windows-latest` 上执行 `npm ci`、`npm run check`、`npm run build` 和 `npm pack --dry-run`，实际执行 Windows 的强制终止分支。
5. 为 `package.json` 增加 `prepack: "npm run build"`，并让 `scripts/smoke.mjs`、`scripts/contract.mjs` 在最终适配器退出时检查非零 code 或 signal，避免收尾故障假绿。
6. 将 `README.md` 的克隆示例改为 `main`，并把新增生命周期用例后的回归测试数量从 18 更新为 19；其余能力与发布声明不改写。

## 备选与决策
- **类型检查：限制 `types`，而不是 `skipLibCheck`。** 前者修复自动发现范围并保留项目依赖的真实类型检查；后者会隐藏可影响构建的声明错误。
- **Windows 测试启动：注入直接的 Node runner，而不是把 `.cmd` 包装器交给无 shell 的生产 `spawn`。** 这样测试能在 Windows 执行实际 `win32` 终止分支，生产仍只启动 `omp --mode rpc`，ChildProcess 仍是被适配器直接拥有的进程。
- **Windows 清理：直接终止已拥有的 `ChildProcess`，而不是引入 shell 命令。** 生产适配器不建立额外的 `cmd.exe` 子树；直接 API 不需要 shell、路径拼接或额外平台工具，风险和依赖最小。
- **制品与 runner：用 `prepack` 和退出码检查建立低成本安全门。** `prepack` 防止干净 checkout 发布缺少或陈旧的 `dist`；runner 检查最终 code/signal，防止无 pending 请求时的异常退出被当作成功。
- **验证方式：扩展现有 server 生命周期测试并增加 Windows CI，而不是新增外部 OMP 测试。** 该缺点是适配器拥有的子进程清理责任，合成夹具能确定性覆盖，真实 OMP 矩阵仍按 `TESTING.md` 单独运行。

## 验收

- `npm run check`：类型检查不再读取工作区上级的无关 `@types/inquirer`，并且现有测试加新增生命周期测试通过。
- `npm run build`：在同一工作区无 TypeScript 错误完成编译。
- `npm pack --dry-run`：从无预先构建 `dist` 的干净构建开始也能先编译当前源码，制品仍只包含既定 15 个文件，不包含 `docs-ai/`、`.omp/skills/`、`test/`、`scripts/` 或用户数据。
- 新生命周期测试：合成 OMP 忽略 stdin EOF 时，服务关闭在宽限期和强制终止后观察到子进程退出；POSIX 与 Windows runner 都执行各自的清理路径。
- runner 收尾检查：smoke/contract 在适配器无 pending 请求后以非零 code 或 signal 退出时失败，而不是打印通过。
- CI：`ubuntu-latest` 与 `windows-latest` 的 Node 矩阵完成 check、build 和 pack dry-run，并实际执行 Windows 的直接子进程终止分支。
- `README.md` 克隆命令与当前 `main` 基线一致，回归测试数量为 19；不据此宣告生产兼容性。
- `npm run smoke` 仅在 `omp --version` 的 stdout 以 `omp/` 开头时运行；本条目不把 smoke 通过写成生产支持。
- `npm run contract` 是独立的真实 OMP 门禁；若本机存在满足规则的 `omp`，实现后执行并记录实际结果；若不在 `PATH` 或未满足隔离条件，按 `AGENTS.md` 停止并在行动记录中写明未验证，不下载或捆绑 OMP。

## 修订记录

- 更新于 2026-10-09：第二轮修复强杀退出竞态，并以 21 项取代原 19 项数量验收 — 见 [003-review2-fixes.md](003-review2-fixes.md)
- 更新于 2026-10-09：prepack 改为直接调用本地 TypeScript 编译器 — 见 [004-prepack-compiler.md](004-prepack-compiler.md)
- 更新于 2026-10-08：第一轮 review 修复与补充证据（补登此行） — 见 [002-review-fixes.md](002-review-fixes.md)
- 更新于 2026-10-09：Windows CI 结果、eof 用例在 Windows 跳过，以及独立审核的处理 — 见 [005-windows-ci-review.md](005-windows-ci-review.md)
