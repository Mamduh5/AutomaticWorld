# Autonomous AI World

A local-first, persistent, auditable world kernel whose genesis inhabitants are exactly **Mam** and **Toey**. The kernel supplies capabilities, constraints, resources, persistence, and consequences. It does not assign purposes, professions, quests, or a civilization script.

## Requirements and setup

- Node.js 22+
- pnpm 10+

```bash
pnpm install
pnpm check
pnpm world genesis
pnpm world status
pnpm world tick
pnpm world run --ticks 10
```

Data is stored under `world-data/` by default. Set `WORLD_DATA_DIR` to use another location. The SQLite database and artifact directories survive process restarts. Running Genesis repeatedly is safe and never duplicates the population.

## CLI

```text
pnpm world genesis
pnpm world status
pnpm world agents
pnpm world inspect Mam
pnpm world tick
pnpm world run --ticks 10
pnpm world events
pnpm world memories Mam
pnpm world files Mam
pnpm world message Mam "Hello Mam"
pnpm world run --ticks 5 --live
```

Normal runs use deterministic WAIT cognition and never call an LLM. `--live` is explicit and requires `OPENAI_API_KEY`; `OPENAI_BASE_URL` and `OPENAI_MODEL` configure an OpenAI-compatible endpoint. Live output is schema-validated before execution.

## Repository boundaries

- `apps/world-cli`: human inspection and control surface
- `packages/world`: deterministic cycle and laws
- `packages/agents`: identity and future birth seam
- `packages/cognition`: provider-independent cognition
- `packages/memory`: agent-specific memory boundary
- `packages/resources`: resource rules boundary
- `packages/tools`: validated action protocol
- `packages/sandbox`: safe filesystem and future execution abstraction
- `packages/persistence`: typed SQLite state and immutable events
- `packages/messaging`: internal/external gateway seam
- `packages/shared`: domain records and bootstrap text
- `world-data`: mutable civilization content and state (gitignored)

See [Architecture](docs/ARCHITECTURE.md), [World Laws](docs/WORLD-LAWS.md), [Lifecycle](docs/AGENT-LIFECYCLE.md), [Security](docs/SECURITY.md), and [Future Evolution](docs/FUTURE-EVOLUTION.md).
