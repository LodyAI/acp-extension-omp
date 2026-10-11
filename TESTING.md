# Real-contract test plan

This suite is separate from synthetic frame tests. It must run with an explicitly
selected OMP executable and an isolated temporary home/profile. It must never
inherit the user's primary OMP profile or credentials and must not call a paid
provider unless the maintainer-approved test profile explicitly proves that the
endpoint is disposable and free.

## Required cases

1. `initialize`: protocol version and base agent information.
2. `new_session`: persistent native `sessionFile` is returned.
3. `prompt`: text delta conversion, completion, native error, and no fabricated
   success.
4. `cancel`: OMP acknowledges `abort`; ACP resolves only with `cancelled` after
   the native terminal result.
5. Exact `load` and `resume`: the requested native session is selected; a
   different or missing session fails.
6. Terminal ordering: every queued ACP `sessionUpdate` and usage notification is
   observed before the terminal `prompt_result` response.
7. Per-model usage: terminal assistant usage is deduplicated by message id,
   attributed to the correct provider/model, and missing cost stays unknown.
8. Restart scope: after adapter restart, accounting identity and counters are
   restored only when the native source proves they are restored; otherwise a
   new accounting scope is used.
9. Child failure: RPC EOF, malformed output, spawn failure, and unexpected child
   exit close the ACP connection unsuccessfully.

## Required test record

For each matrix row, record the OMP version, executable digest if policy permits,
Node version, operating system, adapter commit, Core version, test profile name
(non-secret), and pass/fail result. Do not record environment dumps, tokens,
headers, cookies, model prompts, or raw provider responses.

## Local evidence

Node 22.22.3, macOS arm64, Core 0.1.8; all evidence below is from the current
uncommitted source tree.

- `npm run check`: 46 tests passed across 3 files; `npm run build` passed.
- `npm run smoke`: installed OMP 18.3.1 initialize/new/load passed in an isolated
  profile; no prompt was sent.
- Real contracts passed for OMP 18.2.8, 18.3.1, 18.8.6, and 18.8.7 using a
  credential-free temporary HOME/profile and loopback-only synthetic model.
  Each covered prompt/cancel/exact load/resume/usage/restart/order/error.
- Cancel waits for the synthetic endpoint's observable HTTP response close after
  OMP aborts its upstream request, before accepting ACP `cancelled`. This is not a
  claim about abort behavior at a production provider.
- Every initial-prompt `session/update` and usage notification was observed
  before its terminal response on each real-version contract.
- Final candidate size/SHA-256 and its repository-external Lody mirror digest are
  recorded in the non-packaged `docs-ai/003-review-findings/001-action.md`.
  Embedding the archive's own digest would be self-referential.
- OMP 18.2.8 fresh real-contract evidence: official `omp-darwin-arm64` release asset
  (`omp/18.2.8`, 193,484,176 bytes, SHA-256
  `cf8d34a7fe6f60de1acbe74f29c82026e4c07888e9d89f7ebceeb922159e5787`), Node
  22.22.3, macOS arm64, Core 0.1.8, isolated temporary HOME/profile `contract`,
  loopback-only synthetic model. The complete executable was persisted outside
  `/tmp` at `/Users/tommywu/.cache/acp-extension-omp/omp-18.2.8-darwin-arm64`,
  rechecked against the release digest, and passed
  `npm run contract -- dist/index.js
  /Users/tommywu/.cache/acp-extension-omp/omp-18.2.8-darwin-arm64`, including
  legacy `agent_end`, provider error, and `message.responseId` usage. Tested
  source was an uncommitted worktree based on adapter commit
  `4fd87e3135631bef634230bf2e1c155910e831ee`; that commit does not identify the
  exact tested source tree.
- OMP 18.8.7 latest stable (as of 2026-10-10): official macOS arm64
  `omp-darwin-arm64` asset (200,152,352 bytes, SHA-256
  `cf0227bdefca0c486bd2aed1771de3ab98930266883eb69d341caf5665caee14`),
  persisted at `/Users/tommywu/.cache/acp-extension-omp/omp-18.8.7-darwin-arm64`.
  `npm run contract -- dist/index.js
  /Users/tommywu/.cache/acp-extension-omp/omp-18.8.7-darwin-arm64` passed
  ACP prompt/cancel/exact load/resume/usage/restart/order/error with Node 22.22.3,
  macOS arm64, Core 0.1.8, isolated `contract` HOME/profile and a loopback-only
  synthetic model. The tested adapter is an uncommitted worktree based on
  `4fd87e3135631bef634230bf2e1c155910e831ee`, not that commit alone.
- OMP 18.8.6 previous stable: official macOS arm64 asset id `622733471`
  (212,684,064 bytes, SHA-256
  `31faa0ee8420a13a783f4ca56d98f974e4a9f9081d269057a099f7eb618d1133`),
  persisted at `/Users/tommywu/.cache/acp-extension-omp/omp-18.8.6-darwin-arm64`.
  `npm run contract -- dist/index.js
  /Users/tommywu/.cache/acp-extension-omp/omp-18.8.6-darwin-arm64` passed
  the same V1 cases on Node 22.22.3 / macOS arm64 / Core 0.1.8 with the isolated
  `contract` HOME/profile and loopback-only model. The latest/previous rows
  remain local evidence only; they do not complete the cross-OS release matrix.
- The final candidate's production-install and Lody manager evidence are recorded
  in the non-packaged action record. The local manager run does not validate the
  tracked manifest or production acceptance.
- Actual executable failure smoke: missing OMP, exit, RPC EOF, and malformed
  output each produced adapter exit code 1; fixture child processes did not survive.
- Synthetic delayed `prompt_result`/`session_settled` tests cover the adapter's
  ordering boundary, but no controlled real OMP scenario exercised native
  background work or compaction. Those behaviors remain unverified and are not
  compatibility or production claims.

## Remaining gates

The OMP 18.2.8 minimum baseline, installed 18.3.1, 18.8.7 latest stable, and
18.8.6 previous stable have local macOS arm64 evidence. Other target OSes and
native background/compaction behavior remain unverified.

Independent maintainer review, reproducible release packaging, and public
artifact SHA-256/size read-back remain separate gates. The local Lody manager
test used an external runtime root and throwaway mirror; it does not validate
Lody's tracked manifest or production acceptance.
