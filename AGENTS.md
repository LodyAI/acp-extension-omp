# acp-extension-omp

Standalone Apache-2.0 ACP adapter for a user-installed Oh My Pi runtime. The
adapter owns the ACP boundary and launches OMP; neither OMP's executable nor
its credentials enter this package or Lody's configuration.

- Launch only `omp --mode rpc`; never use `omp acp` or unsupported flags.
- stdout is ACP/RPC only; pass OMP diagnostics to stderr.
- Native session identity is the exact OMP `sessionFile`. Refuse missing or changed identities; never create an empty fallback session.
- Terminal OMP abort maps to ACP cancellation. EOF/child exit fails active work; do not synthesize success or retry prompts.
- Usage derives only from terminal assistant `message.usage` events through `SessionUsageAccumulator`. Cost omission remains unknown.
- Do not advertise unimplemented controls. Reject MCP configurations until a protocol-proven host-tool bridge and reviewed Core capability exist.
- Tests and smoke use synthetic fixtures or an isolated profile/local endpoint. Never capture user sessions, credentials, or paid provider data.
