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

## Remaining gates

OMP 18.2.8 and the stable-version matrix remain unverified. Official release/npm
sources were found, but direct asset TLS failed, authenticated asset download
timed out with an incomplete digest, and isolated npm installation timed out.
The incomplete executable was not run. Required next evidence includes that
baseline, supported OS targets, and native background/compaction behavior.
Independent maintainer review, reproducible release packaging, and public
artifact SHA-256/size read-back are separate gates; npm package smoke is not
evidence that Lody's managed-runtime download/install pipeline has passed.
