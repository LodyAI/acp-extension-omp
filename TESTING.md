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

- Node 22.22.3, macOS arm64, Core 0.1.8, installed OMP 18.3.1.
- `npm run smoke`: isolated initialize/new/load; no prompt.
- `npm run contract`: real OMP with a loopback-only OpenAI-compatible synthetic
  model, temporary HOME/profile and credential-free environment. Prompt text,
  completion, cancel, exact load/resume, missing/invalid session rejection,
  native HTTP error, model-specific usage, notification ordering, and distinct
  usage scopes after adapter restart passed.
- A temporary verification packed the npm archive, checked its 15 file entries,
  installed only production dependencies into an independent temporary directory,
  and ran both smoke and contract against the installed entry successfully.
- Actual executable failure smoke: missing OMP, exit, RPC EOF, and malformed
  output each produced adapter exit code 1; fixture child processes did not survive.
- Unit tests cover delayed native settlement and competing session/prompt
  requests; those boundaries are not claimed as real background-work evidence.

### Matrix record: OMP 18.8.4 (2026-10-09)

Local evidence, not a release declaration.

| Field | Value |
| --- | --- |
| OMP | 18.8.4, Homebrew `can1357/tap`, darwin-arm64 executable |
| OMP digest | SHA-256 `9d6f8b5be9d6b46562ee560a2fd90bc5b1f364da66adfc0f89ada82ee1367675`, 212453664 bytes |
| Node | 26.10.0 and 22.15.0 |
| OS | macOS (Darwin 27.0.0) arm64 |
| Adapter commit | `39d745a40de08edc7baf5d15b3048b7ecd3e2971` |
| Core | `acp-extension-core` 0.1.8 |
| Test profile | `contract` (smoke: per-run `lody-smoke-<pid>`), temporary HOME, loopback-only model |
| Entry under test | npm archive packed from a clean `git archive` export, installed with production dependencies only into an independent temporary directory |
| Result | Pass on both Node versions: `npm run smoke` and `npm run contract` |

- Required cases 1–8 ran against the real executable. Case 1 now compares the
  full `initialize` result with the reviewed capability set; a build that also
  advertised `loadSession` failed the runner.
- Case 9 (child failure) is covered by synthetic tests on Linux, macOS and
  Windows CI, not by this real-executable row.
- Two clean builds with Node 26.10.0 / npm 11.19.1 produced the same archive:
  18120 bytes, SHA-256
  `c7729e02a0394091b92b25c10d750783a01dac0f1dca014e743a759319c5f8a1`, 15 entries.
  Node 22.15.0 / npm 10.9.2 produced identical file contents and an identical
  uncompressed tar, but different gzip bytes (18111 bytes), so the release
  toolchain must be recorded with the digest.

## Remaining gates

OMP 18.2.8 and the stable-version matrix remain unverified. As of 2026-10-09 the
latest stable OMP release is 18.8.6 and the previous stable is 18.8.5; neither is
installed here, and agents must not download OMP. 18.8.4 above is neither row. Official release/npm
sources were found, but direct asset TLS failed, authenticated asset download
timed out with an incomplete digest, and isolated npm installation timed out.
The incomplete executable was not run. Required next evidence includes that
baseline, supported OS targets, and native background/compaction behavior.
Independent maintainer review, reproducible release packaging, and public
artifact SHA-256/size read-back are separate gates; npm package smoke is not
evidence that Lody's managed-runtime download/install pipeline has passed.
