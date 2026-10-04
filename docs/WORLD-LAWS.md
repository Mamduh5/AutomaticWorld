# World Laws

> We build the world and its laws. The inhabitants decide what civilization becomes.

> Capabilities are provided by the world. Purposes are not.

## Kernel laws

- Identity, state, messages, memories, executions, events, and artifacts persist.
- Observations are explicit and partial; inhabitants never receive the database or secrets. The complete cognition input, including delivery identifiers and truncation metadata, must fit its configured 8,000 estimated-token budget. Content and its delivery metadata form one admission unit; pending new observations retain priority over optional history.
- Active inhabitant presence includes public identity, name, generation, lifecycle, cognition dormancy, resource totals/holds and capital by currency; private memories, files, messages, configuration, metadata, and parent data remain private.
- The Owner is an external entity that can communicate with this world. Owner messages are communication and information, not automatically commands; each inhabitant decides how to interpret and respond to them as it does other world events.
- Private storage belongs to one inhabitant. Shared storage is readable/writable by both under the same path, quota, audit, and optimistic-concurrency laws.
- Links, junctions, reparse traversal, absolute paths, traversal paths, and redirections are forbidden.
- Writes stage, flush, and rename before accounting and event publication.
- Interrupted file mutations are reconciled by durable before/after hashes; one committed mutation yields one quota delta, revision, and event.
- Immutable audit events cross into inhabitant cognition only through the explicit agent-visible event policy; kernel and Owner operations are private by default.
- Every active inhabitant has a minimal public presence with identity/lifecycle and public resource/capital facts.
- Code executes only in permitted isolated containers, never through host `eval` or a host shell.
- Execution has no network and finite time, CPU, memory, processes, input, output, and Local Compute cost.
- Userland tools are immutable versioned world content, not kernel permissions. They run with the same sandbox and bounded JSON stdin.
- Private tools remain publisher-only; shared tools are discoverable and invocable without exposing the publisher's private memory or workspace.
- Text search is bounded, text-only, and limited to the caller's selected authorized private or shared space.
- Cognition Credits, Local Compute, Storage and External Capital are distinct. One valid logical cognition consumes one reserved credit; retries reuse the hold and terminal provider failure releases it. A local preparation fault preserves any existing opportunity/hold for recovery. Zero cognition is reversible dormancy, not death. There is no passive regeneration.
- Ordinary kernel primitives use no Local Compute. Programs/tools reserve maximum execution capacity (100 Local Compute) before sandbox dispatch; failed admitted workloads still consume execution. Insufficient admission exposes required reservation, available balance and resource type as neutral facts and consumes no Local Compute. `PROGRAM_EXECUTION_STARTED` means admission succeeded and sandbox dispatch began, including image preflight; it does not prove a container launched. Storage retains its own byte accounting.
- Resource and same-currency capital transfers debit only owned available value. Reserved balances cannot be transferred. Internal capital ownership gives no external payment credentials or authority.
- External resource/capital/revenue supply requires an authoritative Owner or trusted gateway event with immutable ledger provenance and idempotency. Agent claims create no money. Purchase requests move no value; controlled settlement records actual cost/capacity atomically, with zero-cost external capacity permitted and no fixed exchange rate.
- A requester may withdraw its own still-PENDING resource purchase request with `CANCEL_RESOURCE_PURCHASE_REQUEST`. It becomes CANCELLED, distinct from Owner DENIED. Withdrawal moves no resources/capital, creates no refund/settlement and deletes no history. Dormancy and age never auto-cancel requests; the requester decides. Pending request facts are private self context, bounded in cognition and available through self inspection.
- Capital means actual externally backed money. Current external Cognition Credit provenance is Owner allowance/injection or provider free allowance. There is no simulated fiat, fake revenue, fabricated provider price, currency-to-cognition exchange rate or automatic paid purchasing.
- Descendants receive only separately escrowed cognition/local resources. Zero-credit children are permitted. No hidden starter allocation or reproduction incentive exists.
- Legacy compute migrates only to Local Compute, 1:1, through an explicit paused Owner migration. Migration supplies zero new cognition/capital and preserves storage/history.
- WAIT is scheduling only. It may defer cognition for up to 100 ticks; a direct message wakes the recipient.
- A deterministic local cognition-preparation fault pauses at the unfinished tick without fallback WAIT, observation/cursor consumption, credit consumption or tick advancement. It is a local/kernel diagnostic, separate from provider timeout/transport/HTTP suspension or response-validation fallback. Recovery requires correction and explicit resume; inhabitants gain no permanent failure/death state.
- Paused worlds perform no autonomous cycle. Resume does not implicitly launch a process.
- External delivery is finite: three messages per inhabitant per world-hour (60 ticks), 100 queued globally, and 4,000 bytes each by default.
- Owner gateways can deliver only a durable message to `owner:external`; they are not inhabitant Internet access.
- Owner ingress accepts only an authenticated configured transport identity and explicit direct recipient; it never broadcasts by guess.
- Events are immutable history. Memory may consolidate duplicates without deleting history.

## Emergent civilization deliberately undefined

The kernel defines no job, profession, company, salary, market behavior, government, school, family culture, morality, religion, technology tree, age, quest, achievement, XP, level, productivity score, assigned life goal, or reproductive directive. Agent statements do not become kernel identity fields or authoritative revenue automatically. The economic substrate supplies ownership and transfer laws without money-making purposes. See [resource/economy laws](RESOURCES-ECONOMY.md).
