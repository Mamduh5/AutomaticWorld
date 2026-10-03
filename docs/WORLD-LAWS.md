# World Laws

> We build the world and its laws. The inhabitants decide what civilization becomes.

> Capabilities are provided by the world. Purposes are not.

## Kernel laws

- Identity, state, messages, memories, executions, events, and artifacts persist.
- Observations are explicit and partial; inhabitants never receive the database or secrets.
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
- Cognition Credits, Local Compute, Storage and External Capital are distinct. One valid logical cognition consumes one reserved credit; retries reuse the hold and terminal failure releases it. Zero cognition is reversible dormancy, not death. There is no passive regeneration.
- Ordinary kernel primitives use no Local Compute. Programs/tools reserve bounded execution capacity; failed workloads still consume execution. Storage retains its own byte accounting.
- Resource and same-currency capital transfers debit only owned available value. Reserved balances cannot be transferred. Internal capital ownership gives no external payment credentials or authority.
- External resource/capital/revenue supply requires an authoritative Owner or trusted gateway event with immutable ledger provenance and idempotency. Agent claims create no money. Purchase requests move no value; controlled settlement records actual cost/capacity atomically, with zero-cost external capacity permitted and no fixed exchange rate.
- Descendants receive only separately escrowed cognition/local resources. Zero-credit children are permitted. No hidden starter allocation or reproduction incentive exists.
- Legacy compute migrates only to Local Compute, 1:1, through an explicit paused Owner migration. Migration supplies zero new cognition/capital and preserves storage/history.
- WAIT is scheduling only. It may defer cognition for up to 100 ticks; a direct message wakes the recipient.
- Paused worlds perform no autonomous cycle. Resume does not implicitly launch a process.
- External delivery is finite: three messages per inhabitant per world-hour (60 ticks), 100 queued globally, and 4,000 bytes each by default.
- Owner gateways can deliver only a durable message to `owner:external`; they are not inhabitant Internet access.
- Owner ingress accepts only an authenticated configured transport identity and explicit direct recipient; it never broadcasts by guess.
- Events are immutable history. Memory may consolidate duplicates without deleting history.

## Emergent civilization deliberately undefined

The kernel defines no job, profession, company, salary, market behavior, government, school, family culture, morality, religion, technology tree, age, quest, achievement, XP, level, productivity score, assigned life goal, or reproductive directive. Agent statements do not become kernel identity fields or authoritative revenue automatically. The economic substrate supplies ownership and transfer laws without money-making purposes. See [resource/economy laws](RESOURCES-ECONOMY.md).
