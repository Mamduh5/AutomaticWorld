# Architecture

The world kernel owns time, observation construction, validated action dispatch, resource accounting, persistence, and audit. Cognition only proposes a structured action from information in an explicit observation. Tool handlers alone cause effects.

SQLite maintains practical state in `world`, `agents`, `messages`, and `memories`. The append-only `events` table is an audit/history stream, not the sole state store. Filesystem artifacts are real files below `world-data`; they are never replaced by achievement flags.

Dependencies point inward: CLI selects adapters; the world depends on interfaces and domain packages; cognition providers cannot directly access persistence, the host filesystem, environment variables, or tools. `OwnerGateway` and `ExecutionSandbox` are inactive adapter seams. A dashboard can later use the engine without changing domain rules.

The owner is `owner:external`, not an `Agent`. Owner messages share persistent messaging but remain distinguishable and carry no automatic obedience semantics.

## Kernel/content boundary

Source code, schemas, policies, quotas, and adapters are **WORLD KERNEL**, controlled by the owner/developer. Agent private workspaces, shared files, messages, memories, and other artifacts are **WORLD CONTENT**. No agent action targets kernel source.
