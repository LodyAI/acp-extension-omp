# OMP ACP adapter

Standalone Apache-2.0 `acp-extension-omp` adapter for a user-installed Oh My
Pi (OMP) runtime. It translates OMP's `omp --mode rpc` process into ACP. It
does not bundle OMP, inspect credentials, or persist user session data.

## Collaboration status

这是一个可运行的协作分支，不是已发布的 Lody provider，也不是 OMP 兼容性发布。
本地验证覆盖 macOS arm64 上的 OMP 18.2.8（Node 22.22.3，完整记录见 `TESTING.md`）、
OMP 18.3.1（Node 22.22.3）和 OMP 18.8.4（Node 26.10.0 和 22.15.0），
使用仅限回环地址的合成模型运行真实 OMP 合同测试。
`npm run check` 中的 39 项合成回归测试不使用 OMP，
也不与该证据行绑定；其中一项 stdout-EOF 用例和八项适配器进程用例
仅在 POSIX 上运行，在 Windows 上跳过。不修改任何生产环境的
运行时清单。

发布前，必须通过稳定版本和操作系统矩阵（包括 18.2.8 在 macOS 以外的系统）、
独立维护者审核、可复现的运行时归档、公开校验和回读以及 Lody
端到端验收。这些门禁记录在 `TESTING.md` 和
`RELEASE.md` 中；可选的 load/resume/usage 能力宣告仍保持禁用。

改这个仓库的 agent 先读 `AGENTS.md`。能力与发布边界仍以 `README.md`、
`COMPATIBILITY.md`、`TESTING.md`、`RELEASE.md`、`MIGRATION.md` 为准；
`docs-ai/` 不是能力合同。

协作者可使用以下命令：

```sh
git clone --branch main https://github.com/LodyAI/acp-extension-omp.git
cd acp-extension-omp
npm ci --ignore-scripts
npm run check
npm run build
# 需要用户自行安装 OMP；不使用凭据或付费模型端点。
npm run contract
```

合并前请审核此分支；不要用它发布运行时或更新
Lody 的托管运行时清单。本分支不声称已获独立审核者批准。


```text
Lody → acp-extension-omp → 用户安装的 omp --mode rpc
```

## V1 contract

The implementation currently contains the translation paths for ACP
`newSession`, `prompt`, `cancel`, `loadSession`, and `resumeSession`, plus
exact native session identity and Core usage accumulation. MCP configuration,
images, steering, interactions, titles, and model mutation remain rejected or
unadvertised until their OMP primitives are verified.

Load, resume, and usage remain unadvertised in ACP initialize until the required
baseline matrix and independent review pass. Their implemented methods are
exercised explicitly by the contract runner; they are not a production support
promise. Future OMP versions are not assumed compatible from their version alone.

The adapter launches only `omp --mode rpc`. OMP diagnostics go to stderr; ACP
and OMP RPC traffic remain separate. Transport failure and child-process exit
fail the ACP connection rather than synthesizing a successful prompt result.

ACP 文本或用量通知发送失败时，适配器立即关闭 RPC／ACP 连接并回收 OMP，
不等待 prompt ACK 或 native terminal；缓慢但成功的通知仍按顺序排空。

当前协议终态已确认 `sessionSettled: true`、但 host 通知仍在排空时，ACP
取消只等待排空，不再发送 `abort`；prompt 保留已验证的原生完成、取消或错误结果。
未结算或已发出 `abort` 的取消仍遵循原有结算与 ACK 规则。

Closing the ACP connection sends SIGTERM to the OMP process group on POSIX, or
ends OMP stdin on Windows. After a one-second grace period the adapter
force-terminates the owned child; on POSIX the whole OMP process group must be
gone, so descendants still in that group are killed with it at the same
deadline. If any of them survives, close fails: the adapter writes the reason to
stderr, releases what it could not reap, and exits with code 1 instead of
waiting on it (or by the received signal, below). Once OMP is confirmed gone, its stdio
gets one more grace period to drain and is then released even if a descendant
still holds the pipes. Descendants
that left OMP's process group (for example via `setsid`), and all descendants on
Windows, are not reaped. Unreaped zombies still count as group members, so where
orphans are not reaped (for example a container whose PID 1 is not an init),
close can report this failure for a group that has already died.
On POSIX, SIGTERM, SIGINT, or SIGHUP sent to the adapter first runs the same
close, then the adapter exits by that signal. A second such signal during that
close immediately sends SIGKILL to the OMP process group (the owned child on
Windows) and the adapter exits by the second signal. SIGKILL cannot be intercepted.

## Validation

Run the locked dependency graph in a clean checkout:

```sh
npm ci
npm run check
npm run build
npm run smoke
npm run contract
npm pack --dry-run
```

Synthetic regressions cover native session identity, missing files, active
session admission, native settlement, usage deduplication, cancellation, and
notification ordering. Lifecycle tests await the actual SDK connection closure
after spawn failure, unexpected exit, EOF, and malformed RPC output. They also
force-terminate a synthetic child that ignores EOF and SIGTERM, and reap OMP
before re-raising a shutdown signal. On POSIX, a freshly compiled adapter process
is also signalled directly and must exit by that signal with OMP reaped, also
when a second signal arrives during the grace period while a grandchild ignores
SIGTERM; it must
exit with code 0 after stdin EOF, also when a grandchild ignores SIGTERM and
holds OMP's pipes, and with code 1 when OMP or that grandchild survives force
termination.

`npm run smoke` covers initialize/new/load without sending a prompt.
`npm run contract` drives real OMP through a loopback-only synthetic model, in a
temporary HOME/profile without inheriting credentials. It verifies text, prompt
completion, cancellation, exact load/resume, missing/invalid sessions, native
error, usage attribution, terminal ordering, and a new usage scope after restart.

Both runners accept a built or installed adapter entry path. The contract runner
also accepts an explicit OMP executable:

```sh
npm run contract -- /path/to/installed/dist/index.js /path/to/verified/omp
```

本地证据目前覆盖 macOS arm64 上的 OMP 18.2.8、18.3.1 和 18.8.4，包括一个独立安装的
npm tarball。18.2.8 真实合同已在 macOS arm64 / Node 22.22.3 上通过，其他 OS 目标仍未验证。
这些证据不证明自动 compaction、任意扩展或真实提供商的质量。剩余关卡见 `TESTING.md`。

Locally handled OMP prompts (`agentInvoked: false`) complete without waiting for
a terminal frame that will never arrive; `/help` completion is exercised by the
real contract runner. Native slash-command output and interactive extension UI
are not mapped to ACP by this adapter.

## Compatibility status

OMP 18.2.8 is the minimum real-contract baseline requested by Lody #930; it is
not the only intended supported version. See `COMPATIBILITY.md` and
`TESTING.md`. No OMP version is declared production-compatible until the
approved real-contract job records the required behavior.

## Release boundary

The adapter artifact must use a released fixed `acp-extension-core` version,
reproducible builds, immutable artifact bytes, and a public SHA-256/size
read-back before Lody pins it. OMP remains user-installed and is never bundled.
