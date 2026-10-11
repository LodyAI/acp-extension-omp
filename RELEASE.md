# Release checklist

This repository is the canonical source for the standalone adapter. Release
only after independent review and the approved real-contract matrix; do not
publish artifacts or update Lody's manifest from an unreviewed branch.

## Before the first release

- [x] Confirm canonical repository ownership and maintainer permissions.
- [x] Keep the adapter independent from Lody's workspace and use a released,
      pinned `acp-extension-core` dependency.
- [ ] Pass synthetic tests and the approved OMP version/OS matrix (46 tests and
      four macOS arm64 OMP versions passed on the current source; other OSes remain unverified).
- [ ] Review every advertised ACP capability against real-contract evidence.
- [x] The current candidate's allowlist, production install/smoke/contracts, and
      external Lody manager install/initialize passed after the inherited-key fix.
- [ ] Have an independent maintainer review source, tests, and final release bytes.

## Local candidate artifact evidence

- Record each candidate archive's exact size and SHA-256 in the non-packaged
  `docs-ai/003-review-findings/001-action.md`; do not embed a self-referential
  digest in packaged documents.
- The current candidate's 17-file allowlist, production install, smoke, and real
  contracts for OMP 18.2.8, 18.3.1, 18.8.6, and 18.8.7 passed. Its external zstd
  mirror also passed Lody manager download/integrity/extraction/install and ACP
  initialize against a loopback server.
- Candidate-specific evidence is byte-bound to the recorded archive digest. Local
  checks do not establish cross-OS support, public artifact read-back, tracked
  Lody manifest validity, or production acceptance.
- Rebuild and repeat all checks after any source or packaged-document change.
- Local checks do not establish cross-OS support, public artifact read-back,
  tracked Lody manifest validity, or production acceptance.
- No publication, public byte read-back, or Lody manifest update is authorized.

## Artifact acceptance

1. Build the adapter reproducibly from a tagged source revision.
2. Record the generated archive's exact byte size and SHA-256.
3. Publish only through the maintainer-approved immutable artifact channel.
4. Fetch the public artifact again and read back its actual bytes, size, and
   SHA-256.
5. Compare the public read-back with the generated values.
6. Only then update Lody's pinned runtime manifest.

OMP itself remains user-installed and is never included in the adapter artifact.
No credential, cookie, token, or provider configuration belongs in release
outputs or logs.
