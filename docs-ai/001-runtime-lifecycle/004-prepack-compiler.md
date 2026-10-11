# 001.004 — prepack 直接调用本地 TypeScript 编译器

## 背景

发布前审查发现，[002-review-fixes.md](002-review-fixes.md) 中的 `scripts/prepack.mjs` 用 `node "$npm_execpath" run build` 重建 `dist/`。在 bun 这类包管理器下，`npm_execpath` 指向的不是 Node 能执行的 npm CLI 脚本，`prepack` 会失败；变量缺失时也会直接拒绝打包。

## 变更

- `scripts/prepack.mjs` 仍先删除整个 `dist/`，再通过 `createRequire` 解析本地 `typescript/bin/tsc`，用当前 Node 执行 `tsc -p tsconfig.json`。这和 `npm run build` 的命令相同，但不再依赖 `npm_execpath`。编译失败、被信号终止或进程启动失败仍会抛错，阻断打包。
- `README.md` 拆开了证据表述：OMP 18.3.1 / Node 22.22.3 是真实 contract 证据，合成回归测试不依赖 OMP（当前数量见 [../002-signal-shutdown/002-signal-fallback.md](../002-signal-shutdown/002-signal-fallback.md)）。同时补上关闭时强杀和 POSIX 信号回收的行为说明。这属于根文档措辞修正，不改变能力声明。

已执行（Darwin 27.0.0 arm64，Node `v26.10.0`）：

| 命令 / 场景 | 结果 |
| --- | --- |
| 预置 `dist/obsolete.js`，去掉 `npm_execpath` 后执行 `node scripts/prepack.mjs` | PASS：`dist/` 重建，只剩 8 个编译产物 |
| 再预置 `dist/obsolete.js` 后执行 `npm pack --dry-run` | PASS：触发 `prepack`，制品 15 个文件，`obsolete.js` 已被删除 |

## 当前状态

`prepack` 不再依赖 `npm_execpath`。没有在 bun、pnpm 或 yarn 下实际执行打包；Windows 仍待 CI 证据。
