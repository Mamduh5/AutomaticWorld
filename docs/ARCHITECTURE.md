# Architecture

The kernel separates persistent state, cognition, observations, validated actions, filesystem effects, container execution, memory retrieval, resource accounting, messaging, and external Owner delivery.

SQLite stores practical state in `world`, `agents`, `messages`, `memories`, `executions`, `owner_outbox`, `owner_deliveries`, `owner_ingress`, `artifact_revisions`, `filesystem_operations`, `tools`, `tool_versions`, `tool_invocations`, `autonomy_runs`, and `runner_lease`. The append-only `events` table remains the historical audit stream rather than the only state store. Idempotent schema initialization adds tables in place and Genesis preserves existing founder identities and history.

An observation contains only self state, relevant event summaries, addressed messages, separately listed private/shared artifacts, recent self-owned executions, relevant self-owned memories, resources, structured kernel capability descriptions, and accessible userland-tool summaries. `LIST_INHABITANTS` exposes active inhabitants through only `id`, `name`, `generation`, and `status`; it does not expose their private state. Cognition has no repository, filesystem, environment, gateway, or Docker access. Tool discovery changes observations, never the foundational identity prompt.

The world validates a proposed action before tool dispatch. File tools cause real staged artifacts. `EXECUTE_PROGRAM` runs an existing private artifact through `ExecutionSandbox`; the Docker implementation mounts only that workspace. Actual exit status/stdout/stderr are persisted, exposed in later observations, and summarized as episodic evidence—not as an XP or skill claim.

`PUBLISH_TOOL` snapshots a bounded multi-file private source tree into `world-data/system/tool-store/<sourceHash>`. SQLite records the opaque inhabitant-selected name, publisher, runtime, manifest, version link, and store path. `INVOKE_TOOL` resolves and re-hashes that protected snapshot, checks private/shared access, sends bounded JSON on stdin, and persists the real execution and invocation. Output can influence later cognition, but untrusted code cannot mutate world state directly.

Filesystem mutation coordination journals the expected before/after hash and byte boundary before promotion. Startup reconciliation compares the durable target with those hashes: an unpromoted mutation is marked failed, a promoted mutation completes its one SQLite accounting/revision/event transaction, and an unexpected target is marked failed and audited. Database commits are idempotent, and orphan staging/backup files are recursively cleaned within authorized roots.

Agent-to-Owner messages first enter `owner_outbox`. `OwnerGatewayDispatcher` records success per transport, skips successful transports on retry, and marks the aggregate outbox delivered only when every enabled transport succeeds. Console, SMTP email, and LINE push are kernel-selected adapters. Email authentication and `From` use one kernel-owned world mailbox; the independently configured Owner destination is only the recipient.

Owner-to-agent CLI and LINE messages enter the transport-independent `OwnerIngressService`. Acceptance and external event identity are durable before asynchronous LINE routing. Only explicit recipient syntax is accepted; delivery becomes an ordinary persistent `owner:external` message and uses the existing direct-message wake rule.

Continuous operation uses a renewable SQLite lease. Status and process existence are distinct: `running` permits cycles, while an explicit CLI process performs them. A database status never auto-launches a runner.

Bounded continuous/live experiments create `autonomy_runs` records with a factual label, model identifier, preflight/postflight snapshots, event boundaries, cognition-turn/token/compute/execution/tick/wall limits, and termination reason. `COGNITION_TURN_COMPLETED`, `MEMORY_RETRIEVED`, and `AUTONOMY_ACTION` provide run/tick/agent/action/result attribution without storing hidden reasoning. The runner opens a circuit breaker for repeated provider or Docker-infrastructure failures, but not for an inhabitant program's ordinary nonzero exit. Reports derive factual counts from persisted events.

Owner-only checkpoints use SQLite's online backup API and regular-file copies of agent, shared, and system/tool-store artifacts. Database and artifact hashes plus the absolute backup reference are recorded; restoration is never automatic and checkpoint creation is not an inhabitant capability.

## Kernel/content boundary

Source, database, gateway configuration, credentials, Docker policy, quotas, protected tool storage, and adapters are **WORLD KERNEL**. Agent workspaces, shared artifacts, published tool metadata/snapshots, messages, memories, and execution results are **WORLD CONTENT**. World content stored behind the kernel boundary remains inaccessible to direct file actions.
