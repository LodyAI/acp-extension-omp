# Dust review brief — acp-extension-omp (2026-10-11)

请 Dust 对本分支做**独立**只读复审；本 brief 仅作上下文，不替代你的判断。

Please perform an **independent** read-only review of this branch. This brief is context only; do not treat prior rounds as clean.

## Goal / 目标

Bridge **Lody → `acp-extension-omp` → `omp --mode rpc`**: ACP server/adapter over OMP native RPC (hard contract: `omp --mode rpc`, not silent `--no-ui` changes).

Repo: `LodyAI/acp-extension-omp`  
Branch: `feat/initial-omp-adapter-wip-from-mac`  
Base: `main`

## Status / 状态

| Item | Value |
| --- | --- |
| Unit gate | **52/52** tests (3 files) on **Node 22.22.3** (cloud/Linux `npm run check`: typecheck + typecheck:test + vitest) |
| Clean? | **No** — not clean, not merge-ready, not release-ready |
| Prior rounds | Rounds 1–4 fixed Important/Minor items in-tree; independent Dust review still required |
| Overlap | Open PR #2 (`fix/main-audit-20261008`) may overlap lifecycle/docs — please reconcile |

Do **not** claim merge or release readiness from this brief or from local evidence alone.

## Round-4 Important / Minor fixes (in this WIP)

From `docs-ai/003-review-findings/` and connection/settlement work:

- **Prompt settlement**: drain-until-stable `finishPrompt`; RPC `agentInvoked:false` goes through `applyCurrentPromptSettlement` when new-style `status` / `sessionSettled` are present (fail-closed).
- **Legacy stop-reason allowlist**: plain-object inheritance fail-open (`constructor` / `toString` / `__proto__`) → `Set.has`.
- **Status coerce**: reject non-string status (e.g. `["completed"]`) via `typeof status === "string"` + `Set.has`.
- **Event discrimination**: read `yielded` / `isTerminal` / `messages` only after `hasOwn` (no prototype-chain `in`).
- Earlier Important work retained: notification drain before terminal reject, cancel vs native `stopReason`, session identity capture at enqueue, Windows kill-after-grace path in code (see gaps), lifecycle/host signal cleanup, contract runner isolation.

## Remaining gaps / 仍未关闭

1. **Windows kill path** — implemented; not executed on real Windows (macOS/Linux process-group covered only).
2. **`--no-ui` vs `rpc`** — Lody existing adapter flags may still say `omp --mode rpc --no-ui`; this repo’s hard contract is `omp --mode rpc`. Integration owner must decide; do not silently change.
3. **Multi-version / multi-OS matrix** — local macOS arm64 evidence for OMP 18.2.8 / 18.3.1 / 18.8.6 / 18.8.7 (earlier 46-test tree); today’s 52-test cloud check did **not** re-run smoke/real contracts/`npm pack`/Lody mirror.
4. **No merge claim** — independent review, packaging/read-back, and production acceptance remain open gates.

## Ask / 请求

Please review the full WIP on this branch (src, tests, scripts, docs-ai/003, TESTING/COMPATIBILITY/RELEASE) for correctness, fail-closed settlement, cancel/lifecycle races, and doc/evidence honesty. Flag any Critical/Important/Minor; do not rubber-stamp prior rounds.

Thank you.
