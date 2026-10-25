# OMP ACP adapter

Standalone Apache-2.0 `acp-extension-omp` adapter for a user-installed Oh My
Pi (OMP) runtime. It translates OMP's `omp --mode rpc` process into ACP. It
does not bundle OMP, inspect credentials, or persist user session data.

## Collaboration status

这是一个可运行的协作分支，不是已发布的 Lody provider，也不是 OMP 兼容性发布。
本地验证覆盖 macOS arm64 上的 OMP 18.2.8（Node 22.22.3，完整记录见 `TESTING.md`）、
OMP 18.3.1（Node 22.22.3）和 OMP 18.8.4（Node 26.10.0 和 22.15.0），
使用仅限回环地址的合成模型运行真实 OMP 合同测试。
`npm run check` 中的合成回归测试不使用 OMP，
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
`newSession`, `prompt`, `cancel`, `loadSession`, `resumeSession`,
`setSessionConfigOption`, and `unstable_forkSession` (`session/fork`), plus exact
native session identity and Core usage accumulation.

明确 `agentInvoked:false` 的本地完成或原生 prompt command 拒绝，在原完成边界
以单次 `get_session_stats` 核实精确原 `sessionFile`；不同或无法核实则失败并失效
旧身份，不采用返回的新文件，其他 stats 字段不参与计量，同文件时保留原结果／错误。

`newSession`、`loadSession`、`resumeSession` 和 `session/fork` 接受宿主给的 MCP
列表（包括 `lody` stdio），但丢弃配置，不转发给 OMP、不宣告 MCP 能力，也不提供工具桥。

基本 full fork 会验证并精确打开源 `sessionFile`，在空闲状态调用原生 `fork`，
再读取并验证不同、非空的持久新文件，以该原样身份继续会话。
不支持历史切点 `forkAtTurn.turnId` 或非空 `additionalDirectories`；
普通 `_meta.lody.turnId` 不是历史切点。原生准备或变更后失败须重新准备会话。

模型目录与选择走标准 `session/set_config_option`、`category:'model'`。
new／load／resume／fork 等待真实目录及最终同文件 state 后才交付配置；value 按当次
目录映射到原始 provider／id，不拆斜杠，拼接冲突拒绝。切换须核对 native Model 返回
及最终实际模型，完整配置通知排空后才响应；不确定失败失效旧身份，须显式重新准备，
不重试／rollback，也不重置计费 scope。无 model 的真实状态不发明默认 selector。

显式标题 T1 入口仅为单个 text block 起首精确 `/rename` 后接空白与非空标题，内部调用现有
`set_session_name`，不再发 native prompt、不调用原生 card 生成或 input hook。
只有单次 stats 核实原文件、最终 `get_state` 真实读回同一精确 file／清洗后 sessionName，
才推标准 `session_info_update` 的 `titleSource:'explicit'`，稳定排空后完成控制 prompt；
同名也推 explicit，不合成 assistant。最终身份失败失效旧 A，明确同 A 仅名称错误则保留身份。
局部取消不发 native abort；成功通知提交后的 late cancel 只等原排空。
无参、混合内容或非 literal 形式仍走原普通路径，未知 native 标题帧不偷标 explicit。
这不提供双向 UI setter，也不宣告 Core `sessionTitle` 自动生成 ownership。

`prompt` 已翻译内联图片：保留文字的双换行拼接，按原顺序转发图片
`data`／`mimeType`，支持 image-only；不读取 `uri`、不添加模型／MIME／编码
预判。含未支持内容块时整请求拒绝；原生拒绝不重试纯文字。
steering 与 interactions 等未实现控制仍不宣告。

Load, resume, usage, basic fork, and images remain unadvertised in ACP initialize:
fork capability is absent and `promptCapabilities.image` remains false. These
implemented translation paths are not a production support promise; basic fork,
images, model configuration, and explicit titles still require the real target matrix and
independent R3 review before claiming support. Future OMP versions are not assumed compatible from their
version alone.

The adapter launches only `omp --mode rpc`. OMP diagnostics go to stderr; ACP
and OMP RPC traffic remain separate. Transport failure and child-process exit
fail the ACP connection rather than synthesizing a successful prompt result.

ACP 文本、用量、模型配置或显式标题通知发送失败时，适配器立即关闭 RPC／ACP 连接并回收 OMP，
不等待 prompt ACK 或 native terminal；缓慢但成功的通知仍按顺序排空。

父输入正常 EOF、显式关闭与信号关闭保持原正常／按信号退出规则。未观察到正常关闭
来源的 SDK 断连、真实父输入读取错误或 ACP 输出故障先登记失败，非零退出并回收 OMP；
不靠错误文案猜 EOF。正常关闭先发生后的派生取消不误报失败，真正强制回收失败仍升级。

当前协议终态已确认 `sessionSettled: true`、但 host 通知仍在排空时，ACP
取消只等待排空，不再发送 `abort`；prompt 保留已验证的原生完成、取消或错误结果。
未结算或已发出 `abort` 的取消仍遵循原有结算与 ACK 规则。

已验证同 ID 初始 current result 的 `sessionSettled: false` 后，adapter 继续持有
ACP prompt，并吸收后续顶层真实 root `agent_end.yielded: true` 的最后 assistant
终态，优先级为 `error > aborted > completed`：error 拒绝，真实 aborted 在无 error
时返回 `cancelled`，后续 completed 不洗掉已知错误／中止。交付仍等待真实 settlement、
通知排空与适用的原 abort ACK；非 yielded 重试错误、child 包装或独立任务失败不参与。
这一路径目前有 synthetic 回归证据，不代表真实 OMP 后续 yield 已实跑，也不解决
idle Stop 无 aborted、R2 来源或完整后台任务合同。

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
