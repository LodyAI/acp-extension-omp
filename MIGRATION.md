# Repository boundary

This repository owns only the standalone `acp-extension-omp` adapter. Lody
consumes a reviewed, pinned runtime artifact; it does not import this package
through its workspace.

## Adapter repository owns

- ACP/OMP protocol translation in `src/`;
- adapter tests and isolated smoke in `test/` and `scripts/`;
- the standalone package, lockfile, CI, compatibility policy, and release docs.

## Lody repository owns

The builtin provider registration, runtime manifest, managed-runtime resolver,
CLI settings, executable override, MCP policy, artifact packaging, and
Lody-specific tests stay in the main Lody repository. They are not adapter
package source files.

## Integration order

1. Review the adapter boundary and capability claims independently.
2. Run synthetic checks and the approved real-contract matrix.
3. Build and inspect a reproducible immutable runtime artifact.
4. Prove Lody's refresh/install path against a temporary mirror and throwaway
   manifest.
5. Publish through the maintainer-approved immutable artifact channel.
6. Read back public bytes, size, and SHA-256.
7. Only then update Lody's tracked runtime manifest.

OMP remains user-installed. No credential, cookie, token, provider configuration,
user session, or OMP executable belongs in this repository or its artifacts.
