# Security

All cognition output and agent-created content is untrusted.

- Zod discriminated unions reject unknown, malformed, oversized, or unsupported actions.
- Paths must be relative and are resolved against a private or shared capability root.
- Resolved paths must remain under that exact root; traversal and absolute paths are rejected and logged.
- One inhabitant has no action that names another inhabitant's private root.
- File content is limited to 64 KiB and aggregate charged storage is finite.
- Agent text is never interpolated into shell commands. Raw host execution does not exist.
- The execution abstraction is disabled by default and exposes no environment.
- SQLite parameters are bound rather than interpolated.
- Addressed messages and memories are queried by recipient/owner agent ID.

Milestone limitations: OS-level adversarial isolation is not claimed, symlink creation is not exposed but pre-existing malicious symlinks are not yet hardened with handle-level checks, shared-space accounting is intentionally simple, and the future Docker execution adapter is not implemented.
