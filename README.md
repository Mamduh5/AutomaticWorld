# Autonomous AI World

A local-first, persistent world kernel inhabited by exactly Mam and Toey. The world supplies capabilities, causal constraints, finite resources, and audit history. It supplies no professions, goals, quests, economy, civilization stages, or scripted conversations.

## Setup

Requires Node.js 22+, pnpm 10+, SQLite (embedded), and optionally Docker Engine/Desktop for `EXECUTE_PROGRAM`.

```bash
pnpm install
pnpm check
pnpm world genesis
pnpm world resume
pnpm world tick
pnpm world status
```

State and real artifacts persist below `world-data/` by default. `WORLD_DATA_DIR` selects another Owner-controlled root. Genesis is idempotent and upgrades capabilities without replacing stable identities.

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
pnpm world agents
pnpm world inspect Mam
pnpm world memories Mam --query "python error"
pnpm world messages Mam
pnpm world executions Mam
pnpm world files Mam
pnpm world files Mam --shared
pnpm world events
pnpm world activity --last 50
pnpm world message Mam "Owner to Mam"
pnpm world owner-outbox
pnpm world gateway dispatch --console
pnpm world run --ticks 5 --live
```

A paused world performs no cognition/action cycle. `resume` changes persistent status but never starts a background process. Continuous mode holds a renewable SQLite lease, completes an in-flight tick on Ctrl+C, persists the tick, releases the lease, and exits.

## Execution

`EXECUTE_PROGRAM` supports `node` and `python` only. Docker is invoked with structured arguments and fixed images:

- `node:22.14.0-alpine3.21`
- `python:3.13.2-alpine3.21`

The agent's private workspace is mounted read-only at `/workspace`. The container has no network, secrets, database, kernel source, Docker socket, or other agent workspace. See [Security](docs/SECURITY.md).

## Owner gateways

An agent may address `owner:external`. This creates a durable outbox record before delivery. Gateways are disabled unless configured and never become general network capabilities.

- Console: `OWNER_CONSOLE_GATEWAY=true`, or CLI `--console`.
- Email: configure all `OWNER_SMTP_*`, `OWNER_EMAIL_FROM`, and `OWNER_EMAIL_TO` variables from `.env.example`.
- LINE OA: configure `LINE_CHANNEL_ACCESS_TOKEN` and `LINE_OWNER_DESTINATION_ID`.

The default anti-spam law permits three queued messages per inhabitant per 60 world ticks, 100 total queued messages, and 4,000 bytes per Owner message. Successful delivery is idempotent per outbox message and gateway.

Normal tests use fake sandboxes and mocked transports. No LLM call or external message is required. Docker integration tests automatically skip when Docker is unavailable.

## Packages

`world` orchestrates laws; `cognition` validates provider decisions; `tools` owns action schemas; `sandbox` owns filesystem/container isolation; `persistence` owns SQLite; `messaging` owns the narrow Owner delivery boundary; `memory` and `resources` expose their domain seams; `agents` retains an unexposed future birth seam.

Read [Architecture](docs/ARCHITECTURE.md), [World Laws](docs/WORLD-LAWS.md), [Agent Lifecycle](docs/AGENT-LIFECYCLE.md), [Security](docs/SECURITY.md), and [Future Evolution](docs/FUTURE-EVOLUTION.md).
