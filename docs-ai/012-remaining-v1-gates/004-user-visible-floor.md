# 012.004 — V1 用户能体验到的底线

## 背景

只谈发布门禁时，开对话被写成剩余项之一。用户侧的要求不是这样：V1 必须能开对话，并且计费、fork、图片、换模型、改标题、子 agent 状态和后台终端都要能用。

## 变更

`000-plan.md` 的目标和非目标改成这份底线。图片、模型和标题不再是非目标。steering、embedded context、交互式扩展 UI、MCP 工具桥仍然不做。

开对话仍由 R-MCP 解开。其余体验放在新的 R-UX，全部未实现。OMP 当前 RPC 文档里能对上的命令是 `fork`、`prompt.images`、`get_available_models`、`set_model`、`set_session_name`，以及 `set_subagent_subscription` 打开的子 agent 帧。后台工作在 turn 让出后仍可继续，完成时才有 `session_settled`。这些名字来自上游 `docs/rpc.md` 的 main，不是 18.12.2 的实测。实现前要在 18.12.2 上核对，对不上就改命令，不臆造字段。

本文件不授权改 `src/`。

## 引用

基准正文是同目录的 `000-plan.md`。

## 当前状态

计划仍是「计划中」。Lody 里直接建会话仍会失败。文字对话和取消只在会话已经建立后可用。
