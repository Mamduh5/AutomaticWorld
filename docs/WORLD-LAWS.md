# World Laws

> We build the world and its laws. The inhabitants decide what civilization becomes.

> Capabilities are provided by the world. Purposes are not.

## Kernel laws

- Identity, state, messages, memories, executions, events, and artifacts persist.
- Observations are explicit and partial; inhabitants never receive the database or secrets.
- Private storage belongs to one inhabitant. Shared storage is readable/writable by both under the same path, quota, audit, and optimistic-concurrency laws.
- Links, junctions, reparse traversal, absolute paths, traversal paths, and redirections are forbidden.
- Writes stage, flush, and rename before accounting and event publication.
- Interrupted file mutations are reconciled by durable before/after hashes; one committed mutation yields one quota delta, revision, and event.
- Code executes only in permitted isolated containers, never through host `eval` or a host shell.
- Execution has no network and finite time, CPU, memory, processes, input, output, and compute cost.
- Userland tools are immutable versioned world content, not kernel permissions. They run with the same sandbox and bounded JSON stdin.
- Private tools remain publisher-only; shared tools are discoverable and invocable without exposing the publisher's private memory or workspace.
- Text search is bounded, text-only, and limited to the caller's selected authorized private or shared space.
- Compute and storage are physical constraints, not currency. An agent at zero compute persists but cannot initiate costly actions; addressed Owner messages still persist in its inbox.
- WAIT is scheduling only. It may defer cognition for up to 100 ticks; a direct message wakes the recipient.
- Paused worlds perform no autonomous cycle. Resume does not implicitly launch a process.
- External delivery is finite: three messages per inhabitant per world-hour (60 ticks), 100 queued globally, and 4,000 bytes each by default.
- Owner gateways can deliver only a durable message to `owner:external`; they are not inhabitant Internet access.
- Owner ingress accepts only an authenticated configured transport identity and explicit direct recipient; it never broadcasts by guess.
- Events are immutable history. Memory may consolidate duplicates without deleting history.

## Emergent civilization deliberately undefined

The kernel defines no job, profession, company, economy, money, salary, market, government, school, family culture, morality, religion, technology tree, age, quest, achievement, XP, level, productivity score, assigned life goal, or reproductive directive. Agent statements do not become kernel identity fields automatically.
