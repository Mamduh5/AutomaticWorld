# External economy and resource model v2

The kernel supplies laws, persistence, constraints and capabilities. Inhabitants choose their purposes. There are no economic goals, jobs, investment advice, reproduction drives, conservation scripts, death timers, or population targets.

## Four distinct quantities

| Quantity | Meaning | Accounting |
| --- | --- | --- |
| External Capital | Verified real-world monetary ownership | Safe integer minor units, explicit uppercase three-letter currency, no FX |
| Cognition Credits | Capacity for external intelligence | One credit per valid successful logical cognition opportunity |
| Local Compute | Sandboxed CPU/runtime capacity | Existing bounded execution cost formula; durable maximum reservation |
| Storage | Persistent filesystem usage and quota | Existing byte accounting, mutation journal and quota |

Money does not become cognition or execution capacity automatically. The payment instrument, provider routing and credentials remain kernel infrastructure. A zero currency holding is represented by an absent currency row and reads as zero; `WORLD_TREASURY` and every existing `AGENT:<UUID>` are valid capital owners independently of whether they have any currency holdings. Currency is never inferred or converted.

New genesis creates zero cognition and capital. The configured `initialLocalCompute` sandbox allowance enters through recorded Owner injections. Migration grants no new cognition or capital. There is no passive regeneration. New descendant contributions may be zero: the old minimum-contribution, child-viability and creation-overhead settings are retired for v2. `WORLD_MAX_ACTIVE_INHABITANTS` remains a neutral capacity ceiling. Previously consented legacy operations retain their recorded overhead and exact endowment.

## Authoritative journal and accounts

`EconomyService` in `packages/resources/src/economy.ts` is the kernel value boundary. `value_accounts` separates `RESOURCE` units (`COGNITION_CREDIT`, `LOCAL_COMPUTE`) from `CAPITAL` units (currencies). Resource accounts are `WORLD_RESERVE` and `AGENT:<UUID>`; capital accounts are `WORLD_TREASURY` and `AGENT:<UUID>`.

`value_ledger` records transaction ID, kind/unit, integer amount, source/destination, committed world tick, creation timestamp, category, initiator, idempotency key, payload fingerprint and bounded factual references/attribution. A null source is authoritative external supply; a null destination is consumed capacity or externally settled expenditure. Internal transfers always have both accounts. Balances are caches verified against the immutable journal. Money addition/subtraction uses BigInt, with safe-integer checks before persistence. Resource aggregate overflow is rejected as well as account overflow. Historical rows cannot be updated or deleted: SQLite triggers enforce immutability. Corrections create `COMPENSATION` transactions linked to the original, with at most one compensation per original transaction.

`value_reservations` contains current holds. Immutable `reservation_journal` entries contain reservation identity, account, unit, purpose, amount and each transition. The cached account equation is `available = total - reserved`. Every transfer, allocation, investment, revenue record, hold resolution, descendant settlement and purchase settlement is transactional. Failed operations roll back accounts, journals and events together. Idempotency keys are global across the value ledger; identical authoritative retries return the original result, and conflicting payloads are rejected.

`resource_purchase_requests` stores the pending external request and its decision/settlement. `resource_model` marks the explicit version. `cognition_opportunities` stores the frozen prepared context, stable action ID and valid output for recovery. `action_outcomes` commits economic effects together with their durable action result; a resumed logical opportunity cannot repeat a transfer, request or proposal. `execution_outcomes` commits an actual sandbox result together with its debit so recovery can publish the result without running CPU again. `resource_run_snapshots` records separate resource totals/ceilings and ledger boundaries for reports. All these tables live in `world.sqlite`, with no additional external store.

## Cognition, holds and scheduling

Before the provider is called, reserve one available Cognition Credit under the stable identity `cognition:<world UUID>:<target tick>:<agent UUID>`. Short HTTP retries happen inside that logical opportunity. Durable timeout, transport, rate-limit and eligible HTTP suspensions retain the same hold and exact prepared context. Restart uses that identity and context again.

A valid output, observation-cursor advancement, credit consumption and durable successful output are committed together. Recovery after this commit reuses the output without another provider call or debit. Terminal provider failure or invalid provider output releases the hold and leaves observation delivery unconsumed. Provider input/output/total tokens and attempts remain separate operational metrics. They do not determine the billing law.

Local cognition context/request preparation or recovery faults pause the unfinished tick rather than becoming a provider failure or inhabitant WAIT. Before durable opportunity creation no credit is reserved. Once created, the existing opportunity/context and hold remain unchanged for corrected explicit recovery; a consumed successful output is reused without another debit. Local faults do not consume cursors or increment provider failure/cooldown counters.

Awake active inhabitants with no available credits and no existing opportunity are skipped before context construction or provider calls. They select no autonomous action and produce no repeated `ACTION_FAILED` events. World time can progress; addressed messages and resource movements persist. Credit receipt permits the next normal scheduled opportunity. Credit transfer does not itself force an immediate turn or change sleep/eligibility dates. Direct messages retain their existing wake rule.

Dormancy is derived from usable cognition capacity: available credits plus a hold for an already pending cognition opportunity. Credits reserved for descendants cannot fund cognition. A pending opportunity can retry using its own hold. `COGNITION_DORMANT` and `COGNITION_RESTORED` are emitted only at real capacity transitions, with no transient reserve/release noise during a logical cognition turn. Dormancy is reversible; lifecycle remains `active`, and permanent death is outside these laws.

Both direct tick/run execution and continuous runners require exclusive renewable runner ownership. This prevents two processes from releasing or consuming the same live opportunity.

## Local execution and storage

Only `EXECUTE_PROGRAM` and `INVOKE_TOOL` debit Local Compute. Each reserves `executionMaxCost = 100` before sandbox dispatch. `PROGRAM_EXECUTION_STARTED` and `TOOL_INVOKED` are emitted only after this admission, immediately before calling the sandbox. They include `boundary: sandbox_dispatch`; Docker image verification may still fail before container launch. Historical earlier STARTED/admission-failure sequences remain readable and immutable. Rejection creates no execution/outcome row, reservation or debit. Its ordinary failed action/result exposes `{reason: "insufficient_local_compute", resource: "LOCAL_COMPUTE", requiredReservation: 100, available: 10}` for an available balance of 10. These are neutral capacity facts, with no prescribed inhabitant response, provider/payment data or fabricated price. Actual recorded consumption is capped at that reservation: base cost plus rounded runtime and output size. Unused reservation capacity becomes available again; bad programs, nonzero exits and timeouts still consume actual execution. If execution throws or the process loses the outcome, recovery conservatively consumes the full hold. Recovery runs only when no other active lease exists or under the recovering runner's exclusive lease. No uncertain execution is automatically refunded as if it never ran.

`WAIT`, messages, file reads/listing/writes/appends, directory creation, search, self/world/inhabitant inspection, tool publication/listing/metadata inspection, resource/capital transfers, purchase requests and descendant negotiation have no Local Compute charge. Their autonomous selection has already used cognition. Files remain subject to the original byte limits, storage accounting and privacy rules. Storing bytes neither consumes cognition nor local execution capacity.

## Inhabitant economic capabilities and public facts

```text
TRANSFER_RESOURCE {resource: COGNITION_CREDIT|LOCAL_COMPUTE, amount, to: AGENT:<UUID>|WORLD_RESERVE}
TRANSFER_CAPITAL {currency, amount: minor units, to: AGENT:<UUID>|WORLD_TREASURY}
REQUEST_RESOURCE_PURCHASE {resource, amount, reason, fundingAccount?, currency?, maxSpend?}
PROPOSE_DESCENDANT {coParentAgentId, proposedName, localComputeContribution, cognitionContribution}
RESPOND_DESCENDANT_PROPOSAL {proposalId, response: ACCEPT|REJECT, localComputeContribution?, cognitionContribution?}
```

Transfers derive the source from the authenticated acting inhabitant. They cannot debit another inhabitant, create value, convert currency, or use a reserved balance. Capital transfer changes internal ownership only; it performs no external payment. Purchase requests may name only the caller's own funding account. Both currency and maximum spend are supplied together, or omitted for a request without authorized monetary spending. Request creation spends nothing and mints nothing.

Approval reserves the requested maximum capital spend. Denial releases any approved hold. Settlement records actual resource obtained, actual cost and an external reference; it releases the hold, debits the actual cost and injects the actual capacity in one transaction. A request without authorized spending can settle at cost zero. No exchange rate is a world law, and no payment-provider integration exists.

Descendant proposal holds cover separate resource amounts. Acceptance reserves the acceptor's amounts before filesystem work; both parents' resources remain protected through interruption. Child identity, lineage, endowments, proposal resolution and journal movements commit together after the private workspace is prepared. No starter resources or parent memories are copied. Existing storage-allocation semantics are unchanged: the child starts with zero usage and the existing per-inhabitant quota. This milestone adds no separate transferable storage pool.

`INSPECT_SELF` exposes safe self state, resource totals/reserved/available, storage usage/quota, capital by currency and lineage. `LIST_INHABITANTS` exposes active identity/name/generation/lifecycle, cognition dormancy, resource totals/reserved/available and capital by currency. These public economic facts are a deliberate visibility change. Private files, private tools, hidden memories, messages, internal metadata, parent data and provider/payment configuration are excluded from public listings. Foundational context contains only compact factual resource wording; the 8000-token default budget and mandatory-observation priority remain unchanged. Capability identifiers are listed once alongside their structured action descriptions, without duplicated schemas in self state.

## Owner operations

Use `pnpm.cmd` on Windows. Names in `--to`/`--from` resolve to founder/inhabitant UUID accounts; canonical account identifiers also work. Amounts are integers, capital amounts are minor units. `--key` must be a stable, non-secret external/idempotency reference. Keep provider names, endpoints, payment credentials and access tokens out of reference/memo fields. Service metadata is bounded and rejects secret-looking text and configured credential values.

```powershell
pnpm.cmd world economy status
pnpm.cmd world economy ledger
pnpm.cmd world economy invest --to WORLD_TREASURY --currency THB --amount 2500 --key owner-investment-001 --memo "Owner allocation"
pnpm.cmd world economy invest --to Mam --currency USD --amount 1000 --key mam-investment-001
pnpm.cmd world economy record-revenue --to Mam --currency USD --amount 1000 --reference receipt-001 --key revenue-001 --agent Mam --artifact project/main.js
pnpm.cmd world economy transfer --from Mam --to Toey --currency USD --amount 200 --key owner-transfer-001
pnpm.cmd world resources status
pnpm.cmd world resources ledger
pnpm.cmd world resources inject --to Mam --resource COGNITION_CREDIT --amount 500 --source provider_free_allowance --key allowance-001 --reference allowance-allocation-001
pnpm.cmd world resources inject --to WORLD_RESERVE --resource LOCAL_COMPUTE --amount 500 --source owner_resource_injection --key sandbox-001
pnpm.cmd world resources transfer --from WORLD_RESERVE --to Toey --resource LOCAL_COMPUTE --amount 100 --key allocation-001
pnpm.cmd world resources requests
pnpm.cmd world resources requests --all
pnpm.cmd world resources request show <request-id>
pnpm.cmd world resources request approve <request-id>
pnpm.cmd world resources request deny <request-id>
pnpm.cmd world resources request settle <request-id> --amount 100 --cost 200 --reference external-receipt-001 --key settlement-001
# Free external capacity still requires approval and a factual external reference:
pnpm.cmd world resources request settle <request-id> --amount 100 --cost 0 --reference free-allocation-001 --key free-settlement-001
pnpm.cmd world economy compensate --transaction <transaction-id> --key correction-001 --reference correction-record-001
pnpm.cmd world resources compensate --transaction <transaction-id> --key correction-002 --reference correction-record-002
```

Owner CLI and future trusted gateways are authoritative entry points. Inhabitant-authored claims such as "I earned USD 100" are evidence or communication; they never create ledger value. Credentials and payment instruments are kernel-controlled, even when an inhabitant owns capital. The economy service has no network, payment, message-dispatch or provider-calling capability.

## Explicit legacy migration

Opening a legacy world does not initialize the resource economy or reinterpret compute. Execution commands (`resume`, `tick`, `run`, `experiment`, `genesis` on an existing legacy universe) refuse until explicitly migrated. Read-only status, doctor, history, checkpoints and preview remain available. Read-only CLI paths skip schema writes, capability upgrades, filesystem reconciliation and lease write probes.

```powershell
pnpm.cmd world resources migration-status
pnpm.cmd world resources migrate-legacy --preview
pnpm.cmd world doctor --integrity-only
# Apply only after the Owner has reviewed the preview and preserved a checkpoint:
pnpm.cmd world resources migrate-legacy --apply
pnpm.cmd world status
pnpm.cmd world resources status
pnpm.cmd world economy status
pnpm.cmd world doctor --integrity-only
```

Before apply, `doctor --integrity-only` reports SQLite integrity and migration required; its exit code is 2 because the world is not ready for v2 execution. After apply it verifies journals/accounts/holds and succeeds for an intact world. It makes no provider or sandbox calls. Apply requires paused state, no runner lease (including stale lease rows), no pending scheduler, SQLite/foreign-key integrity and reconciled filesystem mutations. One SQLite transaction builds the economy, records Local Compute supply, reconstructs any legacy descendant hold, records the Owner audit event and version. Historical events, legacy compute columns, ticks, sleeps, files, memories, messages, tools and descendant identities are preserved. Retry reports already applied without duplicate value.

Expected protected T1805 preview:

```text
Mam:  legacy compute 2610 -> Local Compute 2610; Cognition Credits 0
      storage 36495 bytes; sleep until tick 1900
Toey: legacy compute 0    -> Local Compute 0;    Cognition Credits 0
      storage 47924 bytes
WORLD_RESERVE: cognition 0; local compute 0
WORLD_TREASURY, Mam, Toey: capital 0 (no currency holdings)
tick 1805; paused; population 2; descendants 0
```

Legacy available compute plus existing deducted descendant escrow becomes conserved Local Compute, with that escrow reserved. No Cognition Credits are created by migration. The protected founders therefore begin cognition-dormant after apply until an explicitly recorded external allocation. No allocation or live apply is implied by installing this code.

## Reporting, integrity and recovery

New run/experiment reports distinguish initial/remaining/consumed Cognition Credits and Local Compute, Local Compute reserved/released, capital journal changes, transfers, purchase requests/settlements and dormancy transitions. Provider token and retry/suspension metrics remain. `localCognitionFailures` counts new Owner-only local-fault events separately from `providerFailures` and `providerSuspensions`; old generic provider errors retain their recorded classification. Consumption is derived from ledger categories, so peer transfers and external injections do not masquerade as compute expenditure. Legacy runs retain their original `initialCompute`, `remainingCompute`, `computeConsumed` and compute ceiling. No historical event is rewritten or retroactively relabeled. Old mandatory SQLite run columns are retained as compatibility storage; new report/listing surfaces use the v2 resource snapshots.

New profiles have independent `--max-cognition-credits` and `--max-local-compute` ceilings. Default: 1000 of each. Long: 5000 cognition credits and 20000 Local Compute. Both are evaluated at a completed scheduling boundary, with at most that boundary's consumption as overshoot. `--max-compute` and `--compute-ceiling` are rejected for v2 rather than silently changing their historic aggregate meaning. Execution and wall-time compatibility flags remain. Tick, successful-turn and token ceilings remain separate.

Doctor verifies model version, SQLite/foreign keys, account non-negativity/integer bounds, journal-derived totals, journal-derived holds, immutable trigger presence, idempotency uniqueness, cognition opportunity/reservation consistency, approved purchase holds and agent account presence. Checkpoints copy the entire SQLite database, so accounts, value/reservation journals, purchase requests, successful/pending cognition contexts, version markers, idempotency keys and resource run snapshots are captured automatically. No new credential is stored there.

For PC migration, copy the complete stopped world directory and checkpoint directory separately from Git and `.env`, then inspect version and preview before any cognition. Confirm founder IDs using `world agents`; compare storage, sleep and tick to the source PC. The [Windows runbook](WINDOWS-MIGRATION.md) covers transport and restoring a pre-resource-migration checkpoint. Restoring is an explicit Owner filesystem operation while every runner is stopped, never an economy-ledger edit. A pre-v2 checkpoint remains v1 and requires an explicit new migration before current code can run it.
