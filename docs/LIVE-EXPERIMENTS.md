# Live Experiments

Live trials observe existing Mam and Toey without assigning work, changing the foundational instruction, resetting history, replenishing resources, or sending an Owner message. The intended configuration is `COGNITION_PROVIDER=openrouter` with `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, and the exact provider model slug in `OPENROUTER_MODEL`. Direct OpenAI remains an independent optional configuration. These values are ignored local infrastructure configuration; agents do not observe the provider, model, endpoint, attribution headers, token accounting, or credentials.

## Safe sequence

1. While paused, run `pnpm world checkpoint create <label>`.
2. Run the deterministic gate with `pnpm check`.
3. Resume the world, then run `pnpm world doctor --live`.
4. Start an explicitly bounded trial with `pnpm world experiment --live --label <label> --ticks <n>`. This uses the conservative default profile. Select `--profile long` only for a deliberate long observation, or supply explicit cognition-turn, input-token, output-token, compute, execution, and wall-clock overrides. On Windows, the standard long command is `npm.cmd run world -- experiment --live --ticks 500 --profile long`.
5. Inspect `pnpm world run-report <label>` and `pnpm world experiment-report <label>`.
6. Pause if no further run is intended and verify doctor/integrity state after restart.

The live doctor verifies the database, exact founder identities, population, running state, lease, Docker isolation, runtime image identity, compute, storage, reconciliation, tool-store integrity, secret isolation, provider selection/configuration/authentication connectivity, and configured Owner transports. Its authenticated readiness request consumes no inference tokens and does not establish that the account has usable inference credit. LINE is optional for cognition readiness; a partial LINE deployment is reported as a warning.

Every run stores factual preflight and postflight snapshots. Action attribution records run ID, tick, agent, action type, result, safe action metadata, provider usage, and latency. It does not store hidden reasoning. The stagnation report counts wait-only sequences, repeated action types, repeated/consolidated memories, and turns without artifact changes; it never changes behavior.

Experiment token ceilings are aggregate AutomaticWorld accounting limits, distinct from the fixed per-cognition context budget and from provider rate limits, availability, or account quotas. Limits are evaluated after a complete world-tick scheduling boundary. Consequently, a completed boundary may produce bounded overshoot equal to the provider usage of the cognition calls completed in that boundary; usage is never reset, hidden, or discarded.

For `--profile long`, a retryable HTTP 429 pauses simulation progress, backs off in operational real time, retries the same pending cognition boundary, and resumes only after a valid provider response. The provider/model scope is cooled globally for that tick, so another inhabitant using that same scope is not called immediately into the known limit. The exponential defaults are 2s, 4s, 8s, 16s, 32s, then 60s; valid `Retry-After` values are honored up to the 30-minute maximum suspension. No fallback WAIT, autonomous action, cognition/action compute charge, cursor advancement, memory, sleep change, or `TICK_COMPLETED` is produced solely by cooldown. The ordinary profile keeps the conservative pre-existing failure/fallback behavior.

The unfinished scheduler boundary is stored in the authoritative database. If another inhabitant already completed its part of the tick, that completion is retained and is not run twice after restart. Ctrl+C during cooldown cancels future retries promptly, marks the cooldown aborted, preserves the pending journal, and releases the lease. Resume with the same long command and provider/model configuration. Suspension time counts toward `maxWallClockMs`; reaching that ceiling or the maximum suspension stops cleanly without advancing world time. The lease heartbeat continues on timer turns throughout the wait.

Use `pnpm world debug provider-cooldown` to inspect the read-only cooldown and durable tick progress, and `pnpm world debug runner-lease` to inspect lease health. Operational `PROVIDER_COOLDOWN_STARTED`, `PROVIDER_COOLDOWN_RETRY`, `PROVIDER_COOLDOWN_RECOVERED`, and `PROVIDER_COOLDOWN_ABORTED` events and run-report metrics are Owner-only kernel facts; they are not delivered as inhabitant knowledge. The ordinary infrastructure circuit breaker remains active for non-handled failures, while handled long-profile 429 retries do not count as failed world turns.

Checkpoints are disaster recovery references, not alternate worlds or automatic rollback. Only the Owner CLI can create one, and restoration remains an explicit future operation. Inhabitant mistakes are not a restoration reason.
