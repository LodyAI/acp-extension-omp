# Release checklist

This repository is the canonical source for the standalone adapter. Release
only after independent review and the approved real-contract matrix; do not
publish artifacts or update Lody's manifest from an unreviewed branch.

## Before the first release

- [x] Confirm canonical repository ownership and maintainer permissions.
- [x] Keep the adapter independent from Lody's workspace and use a released,
      pinned `acp-extension-core` dependency.
- [ ] Pass synthetic tests and the approved OMP version matrix.
- [ ] Review every advertised ACP capability against real-contract evidence.
- [x] Run the build in a clean environment with a locked dependency graph.
- [x] Inspect the npm archive file list for generated caches, sessions and
      `node_modules`; independently install and smoke it.
- [ ] Have an independent reviewer inspect source, tests, and release bytes.


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
