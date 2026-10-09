# 002.004 — 适配器进程级的真实信号测试

## 背景

[003-independent-review.md](003-independent-review.md) 把 SIG-005 记为延期：信号回收只有注入替身的测试，`src/index.ts` 的接线以及 Node 默认的信号退出都没有自动证据。理由是 `npm run check` 在构建之前运行，测试拿不到可执行的入口。第 3 轮审核指出，这个理由只说明当时的实现方式受限，并不说明这件事不可测。

## 变更

- 新增 `test/signal.test.ts`，只在 POSIX 上运行。
  - `beforeAll` 用本地 `typescript/bin/tsc` 把 `src/` 编译到仓库内的临时目录 `.signal-test-*`。放在仓库内，是为了让产物里的 `../package.json` 和 `node_modules` 与 `dist/` 的解析方式一致。
  - 每个用例用真实 `node` 进程启动编译出的 `index.js`，配合合成 `omp` 完成 initialize 和 session/new，再对适配器进程分别发送 `SIGTERM`、`SIGINT`、`SIGHUP`。断言适配器以同一信号退出（code 为 null），且合成 OMP 进程已经不存在。
  - `afterAll` 删除临时构建目录和夹具目录。`.gitignore` 增加 `.signal-test-*/`，以防进程中断后残留。
- 这些测试由 `npm run check` 执行，CI 的步骤不变。
- `README.md` 的回归测试数量改为 30：connection 13、server 14、signal 3。其中 4 项只在 POSIX 上运行。
- `src/` 没有改动。

已执行（Darwin 27.0.0 arm64，Node `v26.10.0`）：

| 命令 / 场景 | 结果 |
| --- | --- |
| 暂时删掉 `src/index.ts` 中的 `closeOnSignals(server.close)` 后运行 `npx vitest run test/signal.test.ts` | FAIL（预期 RED）：3 项都在「合成 OMP 已不存在」这一断言失败，对应修复前的孤儿进程。之后用 `git checkout -- src/index.ts` 恢复 |
| 恢复后运行同一命令 | PASS：3 项 |
| `npm run check` | PASS：类型检查通过；3 个测试文件、30 项；临时构建目录没有残留 |

## 当前状态

- SIG-005 关闭。
- SIG-010 同时闭合：[003-independent-review.md](003-independent-review.md) 末尾说「本轮修改了测试和文档，还没有被再次审核」，那批修改（`fb06836`）已在第 3 轮独立审核中复核，没有发现 P1 或 P2。
- 本文件对应的改动还没有被独立审核。
- Windows 上真实的信号行为仍然没有证据。
