# Autonomous AI World

A local-first, persistent world kernel with Mam and Toey as its stable founders. The world supplies capabilities, causal constraints, finite resources, and audit history. It supplies no professions, goals, quests, economy, civilization stages, population targets, or scripted conversations.

## Setup

Requires Node.js 22+, pnpm 10+, SQLite (embedded), and optionally Docker Engine/Desktop for `EXECUTE_PROGRAM`.

```bash
pnpm install
pnpm check
pnpm world genesis
pnpm world resume
pnpm world tick
pnpm world status
pnpm world doctor
pnpm world doctor --live
```

State and real artifacts persist below `world-data/` by default. `WORLD_DATA_DIR` selects another Owner-controlled root. Genesis is idempotent and upgrades capabilities without replacing stable identities.

> Migrating an existing universe is different from fresh setup. A Git clone does not contain the world database, artifacts, or secrets. **Do not run genesis on the new PC when migrating an existing world.** Follow the complete [Windows PC migration runbook](docs/WINDOWS-MIGRATION.md) before any live cognition.

## CLI

```text
pnpm world genesis
pnpm world status
pnpm world pause
pnpm world resume
pnpm world tick
pnpm world run --ticks 10
pnpm world run --continuous --tick-ms 5000
pnpm world run --continuous --ticks 100 --compute-ceiling 1000
pnpm world checkpoint create genesis-live-001-before
pnpm world experiment --live --label genesis-live-001 --ticks 25 --max-cognition-turns 50 --max-input-tokens 250000 --max-output-tokens 50000 --compute-ceiling 1000 --execution-limit 20 --wall-ms 900000
pnpm world runs
pnpm world run-report <run-id>
pnpm world experiment-report <run-id-or-label>
pnpm world agents
pnpm world debug descendant-proposals
pnpm world debug lineage <agent-id-or-name>
pnpm world debug runner-lease
pnpm world debug cognition-context <agent-id-or-name>
pnpm world inspect Mam
pnpm world memories Mam --query "python error"
pnpm world messages Mam
pnpm world executions Mam
pnpm world files Mam
pnpm world files Mam --shared
pnpm world events
pnpm world activity --last 50
pnpm world message Mam "Owner to Mam"
pnpm world tools Mam
pnpm world tool inspect Mam <version-id>
pnpm world owner-outbox
pnpm world gateway dispatch --console
pnpm world gateway line-listen --port 8787
pnpm world run --ticks 5 --live
```

A paused world performs no cognition/action cycle. `resume` changes persistent status but never starts a background process. Continuous mode holds a renewable SQLite lease, completes an in-flight tick on Ctrl+C, persists the tick, releases the lease, and exits.

## Descendants

`PROPOSE_DESCENDANT`, `RESPOND_DESCENDANT_PROPOSAL`, and `CANCEL_DESCENDANT_PROPOSAL` expose a neutral two-parent capability. A proposal reserves the proposer's stated compute; rejection or cancellation releases that reservation. Acceptance atomically consumes both contributions, consumes `DESCENDANT_CREATION_OVERHEAD`, and gives the remainder to a new autonomous inhabitant. Defaults are a minimum 250 compute per parent, 1,000 initial child compute after 100 overhead, and a ceiling of 50 active inhabitants. Configure these laws with `DESCENDANT_MIN_PARENT_CONTRIBUTION`, `DESCENDANT_MIN_INITIAL_COMPUTE`, `DESCENDANT_CREATION_OVERHEAD`, and `WORLD_MAX_ACTIVE_INHABITANTS`.

Proposal details and lineage are private to the involved inhabitants and Owner/kernel diagnostics. Public presence and birth consequences expose only UUID, name, generation, and status. Newborn workspaces, memories, messages, executions, and private tools start empty; existing shared culture remains available normally. A child created during tick N becomes cognition-eligible at tick N+1. The current SQLite identity schema requires case-insensitive unique inhabitant names, so names are labels but duplicate labels are rejected explicitly; UUIDs remain canonical in proposal and lineage operations.

The CLI loads ignored local `.env` configuration when present. Live cognition supports the intended `COGNITION_PROVIDER=openrouter` configuration and an independent optional `openai` configuration through one provider-compatible transport. Provider identity, model identifier, endpoint, attribution, run limits, token usage, and latency never enter agent observations. See [Live Experiments](docs/LIVE-EXPERIMENTS.md).

## Execution

`EXECUTE_PROGRAM` and userland tools support `node` and `python` only. Docker is invoked with structured arguments and kernel-owned immutable references:

- `node:22.14.0-alpine3.21@sha256:9bef0ef1e268f60627da9ba7d7605e8831d5b56ad07487d24d1aa386336d1944`
- `python:3.13.2-alpine3.21@sha256:323a717dc4a010fee21e3f1aac738ee10bb485de4e7593ce242b36ee48d6b352`

The agent's private workspace is mounted read-only at `/workspace`. The container has no network, secrets, database, kernel source, Docker socket, or other agent workspace. See [Security](docs/SECURITY.md).

`pnpm world doctor` checks the CLI, daemon, Linux engine, local image identity, restricted startup, both runtimes, network denial, timeout/output limits, filesystem isolation, and runner-lease health. It never pulls by default. `--pull` explicitly permits fetching the reviewed digest references. A missing daemon or image reports `Execution sandbox and runner lease: NOT OPERATIONALLY VERIFIED`.

## Userland tools

`PUBLISH_TOOL` copies a bounded regular-file source tree from the publisher's private workspace into kernel-controlled content-addressed storage. Published versions are immutable world content and run read-only through the same `ExecutionSandbox`; publication never grants network, host, database, secret, or container-selection access. The exact manifest records `name`, `description`, nullable `usage`, `visibility`, `runtime`, `entrypoint`, `inputProtocol: "json-stdin"`, `fileCount`, `totalBytes`, and `sourceHash`.

`PRIVATE` versions are visible only to their publisher. `SHARED` versions can be listed, inspected, and invoked by both inhabitants. Observations list kernel capabilities and accessible userland tools separately. New publication creates a new numbered version; previous snapshots and provenance remain addressable.

## Owner gateways

An agent may address `owner:external`. This creates a durable outbox record before delivery. Gateways are disabled unless configured and never become general network capabilities.

- Console: `OWNER_CONSOLE_GATEWAY=true`, or CLI `--console`.
- Email: `WORLD_EMAIL_ADDRESS` is the kernel-owned sending/authentication identity, initially `aychatkub@gmail.com`. Configure its Google App Password only through `WORLD_EMAIL_APP_PASSWORD`; configure the unrelated Owner inbox through `OWNER_EMAIL_DESTINATION`.
- LINE OA: configure `LINE_CHANNEL_ACCESS_TOKEN` and `LINE_OWNER_DESTINATION_ID`.

The default anti-spam law permits three queued messages per inhabitant per 60 world ticks, 100 total queued messages, and 4,000 bytes per Owner message. Successful delivery is idempotent per outbox message and gateway.

The world mailbox is shared transport infrastructure, not Mam's identity, Toey's identity, or an Owner credential. SMTP configuration remains outside world state and cognition. The email body frames the actual inhabitant message with the originating agent and world tick but does not rewrite that message.

Inbound CLI and LINE messages share `OwnerIngressService`. LINE must be exposed through Owner-controlled HTTPS termination; the local listener binds only `127.0.0.1`. Configure `LINE_CHANNEL_SECRET` and the single allowed `LINE_OWNER_SOURCE_ID`. The handler authenticates the exact raw body before parsing, bounds it, persists event identity for deduplication, and routes only explicit `Mam: ...` or `Toey: ...` text. No source-IP trust is used.

Normal tests use fake sandboxes and mocked transports. No LLM call or external message is required. Docker integration tests automatically skip unless the Linux daemon and both reviewed image identities are locally available. A live cognition experiment requires explicit `--live` plus bounded ticks; credentials are never stored in run records.

## Packages

`world` orchestrates laws; `cognition` validates provider decisions; `tools` owns action schemas; `sandbox` owns filesystem/container isolation; `persistence` owns SQLite; `messaging` owns the narrow Owner delivery boundary; `memory` and `resources` expose their domain seams; `agents` retains an unexposed future birth seam.

Read [Architecture](docs/ARCHITECTURE.md), [World Laws](docs/WORLD-LAWS.md), [Agent Lifecycle](docs/AGENT-LIFECYCLE.md), [Security](docs/SECURITY.md), and [Future Evolution](docs/FUTURE-EVOLUTION.md).
