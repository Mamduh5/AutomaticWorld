# Architecture

The kernel separates persistent state, cognition, observations, validated actions, filesystem effects, container execution, memory retrieval, resource accounting, messaging, and external Owner delivery.

SQLite stores practical state in `world`, `agents`, `messages`, `memories`, `executions`, `owner_outbox`, `owner_deliveries`, `artifact_revisions`, and `runner_lease`. The append-only `events` table remains the historical audit stream rather than the only state store. Schema migration adds columns/tables in place and preserves Milestone 1 state.

An observation contains only self state, relevant event summaries, addressed messages, separately listed private/shared artifacts, recent self-owned executions, relevant self-owned memories, resources, and structured capability descriptions. Cognition has no repository, filesystem, environment, gateway, or Docker access.

The world validates a proposed action before tool dispatch. File tools cause real staged artifacts. `EXECUTE_PROGRAM` runs an existing private artifact through `ExecutionSandbox`; the Docker implementation mounts only that workspace. Actual exit status/stdout/stderr are persisted, exposed in later observations, and summarized as episodic evidence—not as an XP or skill claim.

Agent-to-Owner messages first enter `owner_outbox`. `OwnerGatewayDispatcher` records success per transport, skips successful transports on retry, and marks the aggregate outbox delivered only when every enabled transport succeeds. Console, SMTP email, and LINE push are kernel-selected adapters.

Continuous operation uses a renewable SQLite lease. Status and process existence are distinct: `running` permits cycles, while an explicit CLI process performs them. A database status never auto-launches a runner.

## Kernel/content boundary

Source, database, gateway configuration, credentials, Docker policy, quotas, and adapters are **WORLD KERNEL**. Agent workspaces, shared artifacts, messages, memories, and execution results are **WORLD CONTENT**. No action can target kernel source or world database paths.
