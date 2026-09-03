# Security

All model output, paths, file content, arguments, stdin, and executable artifacts are hostile.

## Filesystem

Portable path parsing rejects POSIX/Windows/UNC absolute paths, drive/colon forms, mixed-separator traversal, nested `..`, and malformed input. Every existing path component is checked with `lstat` and canonical `realpath`; symlinks, junctions, and reparse redirection are unsupported. Roots are capability-selected by the kernel, never by an agent.

Writes use a random sibling staging file opened exclusively with restrictive permissions, write the full buffer, flush and close it, pass failure hooks, then atomically rename where the platform supports replacement. A Windows replace fallback moves the prior file to a random backup and restores it if promotion fails. Accounting and mutation events occur only after promotion. Individual files are capped at 64 KiB and aggregate charged storage is finite.

## Docker execution

Docker is called with `spawn(file, args)` and `shell:false`. Runtime, entrypoint, arguments, stdin, and limits are schema-validated. Agents cannot select images.

Restrictions include `--network none`, read-only container root, read-only `/workspace` bind, no other host mount, no Docker socket, no privilege, all Linux capabilities dropped, `no-new-privileges`, UID/GID 65532, PID limit 64, memory 128 MiB, CPU 0.5, 5-second wall timeout, 64 KiB output limit, 16 KiB stdin limit, and a 16 MiB no-exec/nosuid `/tmp` tmpfs. No `-e` environment values are passed. Owner/LLM/LINE/SMTP credentials, `.env`, database, kernel, and other private workspaces are outside the mount.

Unit tests assert command construction and deterministic behavior without Docker. Integration tests execute pinned Node/Python images and timeout behavior when Docker is available. Remaining assumptions include Docker daemon integrity, container-image supply-chain integrity, Windows Docker Desktop's bind-mount enforcement, and tag mutability because images are version-pinned but not digest-pinned.

## Cognition and gateways

Provider responses have time/output bounds, strict JSON/schema validation, bounded retry, and safe WAIT recovery. Raw hidden reasoning is not requested or persisted. Gateway credentials remain process environment only and are absent from observations and container invocation. LINE uses the official push endpoint, Bearer token, fixed Owner destination, and stable `X-Line-Retry-Key`; inhabitants cannot choose endpoints or recipients.

Inbound LINE webhook handling remains an unimplemented seam. It must verify the `x-line-signature`, restrict the configured Owner source, persist/deduplicate before processing, and return quickly.
