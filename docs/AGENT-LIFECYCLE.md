# Agent Lifecycle

Genesis creates Mam and Toey with stable UUIDs, generation 0, no parents, active status, minimal metadata, finite resources, and the same primitive capability list. It is transactional and idempotent.

Each tick processes active agents in stable creation/name order:

1. Construct an observation from self, relevant events, visible artifacts, addressed messages, resources, and capabilities.
2. Retrieve recent memories belonging only to that agent.
3. Ask the selected cognition provider for a concise summary and one structured action.
4. Validate and execute that action through a world tool, or record failure.
5. Account for resources, append events, and store a reflection summary.
6. Advance world tick and simulated time after all inhabitants have had an opportunity to act.

An agent may WAIT. No conversation or project is seeded. Raw hidden chain-of-thought is neither requested nor persisted.

The future `AgentBirthService` is intentionally unavailable as an action. A descendant draft may later include parent IDs, generation, resource cost, partial cultural knowledge, mutable tendencies, and mutations. It must never copy complete parent memory automatically.
