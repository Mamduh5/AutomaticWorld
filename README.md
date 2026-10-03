# Autonomous AI World

A local-first, persistent world kernel with Mam and Toey as its stable founders. The world supplies capabilities, causal constraints, finite resources, and audit history. It supplies no professions, goals, quests, economic goals, civilization stages, population targets, or scripted conversations.

## Resources and external economy

[Resource/economy laws and exact Owner commands](docs/RESOURCES-ECONOMY.md) separate Cognition Credits, Local Compute, Storage and integer monetary capital. The [legacy compute audit](docs/RESOURCE-COMPUTE-AUDIT.md) lists every former compute path. Zero cognition means reversible dormancy; execution exhaustion does not prevent ordinary kernel primitives when cognition is funded. There is no passive regeneration, automatic money-to-resource conversion, or agent-authorized external payment.

Existing universes require an **explicit paused migration**. Read-only status never applies it. Legacy compute maps 1:1 to Local Compute, with zero new cognition/capital. The protected T1805 checkpoint is not migrated by implementation or installation.

```powershell
pnpm.cmd world resources migration-status
pnpm.cmd world resources migrate-legacy --preview
pnpm.cmd world doctor --integrity-only
# Only when the Owner later chooses to apply:
pnpm.cmd world resources migrate-legacy --apply
pnpm.cmd world status
pnpm.cmd world doctor --integrity-only
```

Genesis for a new universe allocates only the recorded Local Compute allowance. Cognition requires a later explicit Owner allocation; see the resource guide. Do not run genesis when moving an existing universe to another PC.

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
pnpm world run --continuous --ticks 100 --max-local-compute 1000 --max-cognition-credits 1000
pnpm world checkpoint create genesis-live-001-before
pnpm world experiment --live --label genesis-live-001 --ticks 25
pnpm world experiment --ticks 500 --profile long --show-limits
pnpm world experiment --live --ticks 500 --profile long
pnpm world runs
pnpm world run-report <run-id>
pnpm world experiment-report <run-id-or-label>
pnpm world agents
pnpm world debug descendant-proposals
pnpm world debug lineage <agent-id-or-name>
pnpm world debug runner-lease
pnpm world pending-provider show
pnpm world pending-provider migrate --provider opencode-zen --model space-bunny-free
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

A deterministic local cognition-preparation fault stops the run, pauses the world at its unchanged committed tick, and records an Owner-only `COGNITION_LOCAL_ERROR`. It creates no fallback WAIT, consumes no observations or credit, and never enters provider cooldown or the infrastructure breaker. Any existing cognition hold/frozen context is retained for exactly-once recovery after correction and explicit resume. See [local fault recovery](docs/LIVE-EXPERIMENTS.md).

A paused world performs no cognition/action cycle. `resume` changes persistent status but never starts a background process. Continuous mode holds a renewable SQLite lease. At an ordinary in-flight cognition/action boundary, Ctrl+C finishes the safe boundary before releasing the lease. During a long-profile provider cooldown it instead stops future retries immediately, preserves the unfinished tick journal, releases the lease, and exits without advancing the tick.

## Observation experiments

Normal observation keeps the conservative default experiment ceilings:

```powershell
npm.cmd run world -- experiment --live --ticks 20
```

The default profile uses a 1,000 Local Compute and 1,000 Cognition Credit consumption ceilings, two cognition turns per requested tick, 250,000 input tokens, 50,000 output tokens, 20 executions, and 900,000 ms wall time. These are aggregate run ceilings. `--ticks` independently specifies the maximum attempted world-tick advancement.

For a deliberately long observation, select the long profile explicitly:

```powershell
npm.cmd run world -- experiment --live --ticks 500 --profile long
```

For 500 ticks this resolves to 20,000 Local Compute, 5,000 Cognition Credits, 5,000 successful cognition turns, 10,000,000 input tokens, 500,000 output tokens, 1,000 executions, and 10,800,000 ms wall time. The CLI prints these effective values before acquiring the runner lease. Preview them without a lease, cognition, tick advancement, or resource use with:

```powershell
npm.cmd run world -- experiment --ticks 500 --profile long --show-limits
```

Explicit `--max-input-tokens`, `--max-output-tokens`, `--max-local-compute`, `--max-cognition-credits`, `--max-cognition-turns`, `--max-executions`, and `--max-wall-clock-ms` values override the selected profile. The compatibility names `--execution-limit` and `--wall-ms` remain accepted. Old aggregate `--compute-ceiling` and `--max-compute` are rejected rather than reinterpreted. Every limit must be a positive safe integer.

The long profile may consume substantial cognition and Local Compute. It does not mint or replenish inhabitant resources, enlarge the per-turn `COGNITION_INPUT_BUDGET_TOKENS=8000`, change `WAIT`, alter descendant laws, or weaken sandbox/security checks. Runs can still stop because inhabitants exhaust their resources, the world is paused, provider service or account limits intervene, the circuit breaker opens, or another configured ceiling is reached. AutomaticWorld ceilings are separate from OpenRouter/provider rate limits, availability, and account quotas; selecting `long` cannot guarantee continuous provider service.

For the long profile only, a retryable provider HTTP 429 suspends the pending tick instead of becoming an inhabitant turn. World time, the pending inhabitant's observation cursor, resource totals, sleep state, memory, and actions stay unchanged. The runner establishes a provider/model-scoped cooldown, waits in real time, and retries the same persisted cognition boundary before considering the next inhabitant. The fallback schedule is 2, 4, 8, 16, 32, then 60 seconds repeatedly, with a 30-minute maximum suspension. A valid `Retry-After` is honored up to 30 minutes. Cooldown time counts toward the run wall-clock ceiling. The default profile retains the existing bounded provider retry, kernel fallback, and infrastructure-breaker behavior, so short runs do not wait through this long cooldown policy.

Partial-tick scheduling progress is durable in `world.sqlite`: the eligible-agent snapshot, completed inhabitants, pending inhabitant, and bounded prepared cognition context survive Ctrl+C, process failure, and runner restart. A successful inhabitant is not scheduled a second time merely because a later inhabitant was rate limited. `TICK_COMPLETED` is emitted only after every scheduled inhabitant reaches its real normal boundary. If the 30-minute suspension expires, the run stops with `provider rate-limit suspension exhausted`; the pending tick remains resumable. A later long-profile run using the same provider/model scope resumes it automatically.

Aggregate token ceilings are checked after a complete world-tick scheduling boundary. All completed provider usage remains factual, so the final tick can overshoot a token ceiling by the completed cognition calls in that boundary; counters are not reset and completed responses are not discarded.

Inspect a run and current operations with:

```powershell
npm.cmd run world -- run-report <RUN_ID>
npm.cmd run world -- activity --last 200
npm.cmd run world -- status
npm.cmd run world -- debug runner-lease
npm.cmd run world -- debug provider-cooldown
npm.cmd run world -- debug descendant-proposals
```

`debug provider-cooldown` is read-only and reports the world tick separately from pending tick progress, the provider/model scope, completed and pending inhabitants, safe suspension cause, next retry, attempts, and elapsed suspension without exposing the persisted cognition payload. Run reports retain 429-only rate-limit metrics and separately count all provider infrastructure suspensions, retries, elapsed time, recoveries, recorded HTTP attempts, short retries, and attempts whose provider usage is unknown. A reported zero for a failed request means usage was unavailable, not that the upstream used zero tokens.

## Descendants

`PROPOSE_DESCENDANT`, `RESPOND_DESCENDANT_PROPOSAL`, and `CANCEL_DESCENDANT_PROPOSAL` expose a neutral two-parent capability. Proposals and acceptance escrow separate `localComputeContribution` and `cognitionContribution` values; rejection/cancellation releases proposal holds. A child receives exactly the contributed resources and may have zero cognition, making it dormant. No resource starter pack, minimum viability or new creation overhead applies. `WORLD_MAX_ACTIVE_INHABITANTS` defaults to 50; the old `DESCENDANT_MIN_PARENT_CONTRIBUTION`, `DESCENDANT_MIN_INITIAL_COMPUTE` and `DESCENDANT_CREATION_OVERHEAD` settings are retired. Previously consented legacy operations retain their recorded overhead.

Proposal details and lineage are private to the involved inhabitants and Owner/kernel diagnostics. Public presence and birth consequences expose only UUID, name, generation, and status. Newborn workspaces, memories, messages, executions, and private tools start empty; existing shared culture remains available normally. A child created during tick N becomes cognition-eligible at tick N+1. The current SQLite identity schema requires case-insensitive unique inhabitant names, so names are labels but duplicate labels are rejected explicitly; UUIDs remain canonical in proposal and lineage operations.

The CLI loads ignored local `.env` configuration when present. Live cognition supports `openrouter`, `openai`, and `opencode-zen` through one OpenAI-compatible transport. Provider identity, model identifier, endpoint, attribution, run limits, token usage, and latency never enter agent observations. See [Live Experiments](docs/LIVE-EXPERIMENTS.md).

The complete cognition input, including projection identifiers and delivery/truncation metadata, must fit the configured 8,000 estimated-token budget. Content and its delivery IDs are admitted or rejected together; cursor proposals cover only admitted information. Pending mandatory observations retain priority over optional history.

Cognition gives new addressed messages and causal observations first. It also retains up to four recent peer messages involving the inhabitant in an 800 estimated-token conversation window, after those messages have been consumed. Own outbound messages qualify immediately; unseen inbound messages stay in the new-message path, and Owner or other agents' conversations never enter this window. The section yields to mandatory new observations under the unchanged per-turn budget. It is factual short-term context, separate from memory and task state; the kernel does not resolve contradictions.
After that conversation window, cognition includes up to six already-observed own action results in chronological order, within a separate 800 estimated-token window. Each entry identifies the action, tick, success or failure, safe target, and compact result. File contents and execution output remain in their dedicated bounded sections; provider fallback does not count as an action. New action results keep priority and are never duplicated in this history on the same turn.

## OpenCode Zen and frozen tick-185 recovery

OpenCode Zen uses `POST https://opencode.ai/zen/v1/chat/completions` with the exact model ID `space-bunny-free`. Configure `COGNITION_PROVIDER=opencode-zen`, `OPENCODE_ZEN_API_KEY=<secret>`, and `OPENCODE_ZEN_MODEL=space-bunny-free` in ignored local `.env`. `OPENCODE_ZEN_BASE_URL` defaults to `https://opencode.ai/zen/v1`. Keep `COGNITION_INPUT_BUDGET_TOKENS=8000`. The key stays in the Owner process environment, outside world data, prompts, Docker, reports, and checkpoints. Do not commit `.env` or copy it into Git, world data, or checkpoints.

`OPENCODE_ZEN_REQUEST_TIMEOUT_MS` sets Zen's per-HTTP-attempt timeout (default 45,000 ms; allowed 1,000–120,000 ms). OpenRouter and direct OpenAI retain the shared 20,000 ms default. Each provider call still permits one short retry. The first long Space Bunny run had 637 successful turns with p95 latency 31.8 seconds and p99 37.7 seconds including retries, motivating the Zen-specific 45-second bound. Long-profile infrastructure suspension handles longer outages without extending one HTTP request indefinitely.

`space-bunny-free` is a limited-time, anonymous model. Its current free pricing does not promise permanent availability, identity, throughput, or quota. Zen also offers paid models and account auto-reload. Before live use, verify the exact configured model, account billing/auto-reload preferences, and any workspace monthly limits. AutomaticWorld does not change those external settings or fall back to a paid model. A removed model, invalid key, rate limit, or provider outage remains a visible failure; only the Owner can change the model. Returned token usage is counted even when monetary price is zero.

The current tick-185 Mam context was frozen under OpenRouter. Changing `.env` alone does not change its scope. After the checkpoint, use this Owner sequence. `doctor --live` may report `World state: paused` until step 6; its Zen check is an authenticated GET to `/models` and performs no inference.

```powershell
# 1. Set the three Zen variables above in the ignored .env file; keep the world paused.
npm.cmd run world -- doctor --live
npm.cmd run world -- pending-provider show
npm.cmd run world -- debug runner-lease
# 2. Confirm tick 184, target tick 185, pending Mam, and no active lease.
npm.cmd run world -- pending-provider migrate --provider opencode-zen --model space-bunny-free
# 3. Verify target scope and unchanged tick, resources, and cursors before inference.
npm.cmd run world -- pending-provider show
npm.cmd run world -- status
npm.cmd run world -- resume
# 4. Owner's first live test: exactly one requested tick (Mam, then Toey).
npm.cmd run world -- experiment --live --ticks 1 --profile long --label zen-t185-first
# 5. After inspecting the run, the separate 500-tick experiment:
npm.cmd run world -- experiment --live --ticks 500 --profile long --label zen-500
```

`pending-provider migrate` requires a durable frozen context, a healthy database, no active runner lease, complete target configuration, and a successful read-only provider check. It changes only scheduler routing and clears the old cooldown in one transaction. Its audit event is Owner-only. Repeating the same migration is a no-op. Compare `pending-provider show` before and after: `pendingContextSha256`, `agentState` resources/cursors, tick, agent order, and completed IDs must match; only routing and cooldown fields should change. The command reveals no frozen context content. The real tick-185 migration and live commands above are for the Owner to run manually.

## Execution

`EXECUTE_PROGRAM` and `INVOKE_TOOL` reserve the maximum 100 Local Compute before sandbox dispatch. Admission rejection exposes only neutral required/available facts, creates no execution/outcome row, and emits no `PROGRAM_EXECUTION_STARTED` or `TOOL_INVOKED`. `PROGRAM_EXECUTION_STARTED` now means resource admission succeeded and sandbox dispatch began; Docker image preflight can still reject before a container launches. Actual-result settlement and conservative interrupted-execution recovery remain unchanged. Historical events are not rewritten.

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
