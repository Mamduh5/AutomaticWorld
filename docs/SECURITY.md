# Security

All model output, paths, file content, arguments, stdin, and executable artifacts are hostile.

## Filesystem

Portable path parsing rejects POSIX/Windows/UNC absolute paths, drive/colon forms, mixed-separator traversal, nested `..`, and malformed input. Every existing path component is checked with `lstat` and canonical `realpath`; symlinks, junctions, and reparse redirection are unsupported. Roots are capability-selected by the kernel, never by an agent.

Writes use a random sibling staging file opened exclusively with restrictive permissions, write the full buffer, flush and close it, pass failure hooks, then atomically rename where the platform supports replacement. A Windows replace fallback moves the prior file to a random backup and restores it if promotion fails. A durable journal makes storage accounting, artifact revision, and the committed mutation event one idempotent SQLite step after promotion; startup reconciles hash boundaries and removes inaccessible staging remnants. Individual files are capped at 64 KiB and aggregate charged storage is finite.

Windows assumptions: Node `lstat` reports symbolic links and junctions sufficiently for rejection and `realpath` detects canonical escape. No shell path validation is used. Other reparse types depend on Node/Windows reporting and remain a defense-in-depth risk; Docker Desktop bind enforcement and the Owner-controlled world-data root are part of the trusted base.

## Docker execution

Docker is called with `spawn(file, args)` and `shell:false`. Runtime, entrypoint, arguments, stdin, and limits are schema-validated. Agents cannot select images. The allowlist stores a human-readable tag and reviewed registry digest, and execution uses the combined tag-plus-digest reference. Strict mode inspects local `RepoDigests` and fails closed before container start if the expected digest is absent.

Restrictions include `--network none`, read-only container root, read-only `/workspace` bind, no other host mount, no Docker socket, no privilege, all Linux capabilities dropped, `no-new-privileges`, UID/GID 65532, PID limit 64, memory 128 MiB, CPU 0.5, 5-second wall timeout, 64 KiB output limit, 16 KiB stdin limit, and a 16 MiB no-exec/nosuid `/tmp` tmpfs. No `-e` environment values are passed. Owner/LLM/LINE/SMTP credentials, `.env`, database, kernel, and other private workspaces are outside the mount.

`world doctor` displays expected and locally resolved identities and probes restricted execution. It does not pull unless the Owner passes `--pull`. Unit tests mock identity checks. Integration tests run only when the daemon and both digest identities are present. Remaining assumptions include Docker daemon integrity, registry/digest review integrity, multi-platform manifest resolution, and Windows Docker Desktop's bind-mount enforcement.

Published tools are copied into a content-addressed kernel-controlled store, re-hashed before every invocation, and mounted read-only. Only regular files/directories are admitted (100 files and 512 KiB by default); links, reparse traversal, devices, sockets, and special files are rejected. Chmod is defense in depth because Windows ACL semantics differ; the primary control is that no inhabitant file capability resolves into the system store.

## Cognition and gateways

Provider responses have time/output bounds, strict JSON/schema validation, bounded retry, and safe WAIT recovery. Raw hidden reasoning is not requested or persisted. Gateway credentials remain process environment only and are absent from observations and container invocation. LINE uses the official push endpoint, Bearer token, fixed Owner destination, and stable `X-Line-Retry-Key`; inhabitants cannot choose endpoints or recipients.

The initial email transport identity is `aychatkub@gmail.com`. It is world-owned shared infrastructure, not an inhabitant or Owner identity. `WORLD_EMAIL_ADDRESS` supplies both SMTP authentication user and generated `From` address; `OWNER_EMAIL_DESTINATION` is independent and is never used for authentication. `WORLD_EMAIL_APP_PASSWORD` supports Google's App Password mechanism and must exist only in ignored local environment/secrets configuration. Raw Google passwords are unsupported. No email address, password, SMTP host, or transport object enters observations, execution requests, userland snapshots, tool manifests, SQLite, or agent memory. SMTP exception details are replaced with a generic delivery failure before persistence, preventing a transport library from echoing credentials into events or retry state.

Inbound LINE validates `x-line-signature` as base64 HMAC-SHA256 over the exact bounded raw body, using constant-time comparison, before JSON parsing. It does not authenticate by source IP. Only the configured LINE user ID is mapped to Owner. Stable webhook event IDs are unique per transport; redelivery is audited without duplicating world messages. Empty verification event arrays succeed, unsupported events are ignored, and unresolved routing remains rejected rather than broadcast. The built-in listener is loopback HTTP intended only behind Owner-controlled HTTPS termination.
