# Live Experiments

Live trials observe existing Mam and Toey without assigning work, changing the foundational instruction, resetting history, replenishing resources, or sending an Owner message. The intended configuration is `COGNITION_PROVIDER=openrouter` with `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, and the exact provider model slug in `OPENROUTER_MODEL`. Direct OpenAI remains an independent optional configuration. These values are ignored local infrastructure configuration; agents do not observe the provider, model, endpoint, attribution headers, token accounting, or credentials.

## Safe sequence

1. While paused, run `pnpm world checkpoint create <label>`.
2. Run the deterministic gate with `pnpm check`.
3. Resume the world, then run `pnpm world doctor --live`.
4. Start an explicitly bounded trial with `pnpm world experiment --live --label <label> --ticks <n>` plus cognition-turn, input-token, output-token, compute, execution, and wall-clock limits.
5. Inspect `pnpm world run-report <label>` and `pnpm world experiment-report <label>`.
6. Pause if no further run is intended and verify doctor/integrity state after restart.

The live doctor verifies the database, exact founder identities, population, running state, lease, Docker isolation, runtime image identity, compute, storage, reconciliation, tool-store integrity, secret isolation, provider selection/configuration/authentication connectivity, and configured Owner transports. Its authenticated readiness request consumes no inference tokens and does not establish that the account has usable inference credit. LINE is optional for cognition readiness; a partial LINE deployment is reported as a warning.

Every run stores factual preflight and postflight snapshots. Action attribution records run ID, tick, agent, action type, result, safe action metadata, provider usage, and latency. It does not store hidden reasoning. The stagnation report counts wait-only sequences, repeated action types, repeated/consolidated memories, and turns without artifact changes; it never changes behavior.

Checkpoints are disaster recovery references, not alternate worlds or automatic rollback. Only the Owner CLI can create one, and restoration remains an explicit future operation. Inhabitant mistakes are not a restoration reason.
