# Windows PC migration runbook

This runbook moves one existing AutomaticWorld universe to another Windows PC without creating a replacement universe or consuming cognition turns during verification.

## A. What must move

These are separate assets:

```text
source code / Git repository
!= persistent world state
!= local secrets / .env
!= optional checkpoints/backups
```

- The Git repository is source and documentation. It is regenerable by cloning the same revision.
- The directory selected by `WORLD_DATA_DIR` is mandatory. Its default is `world-data/`. Copy the whole directory, including `world.sqlite`, `agents/`, `shared/`, and `system/`. The database contains identity, ticks, resources, messages, memories, tools, proposals, lineage, cursors, events, and run records; the subdirectories contain real workspaces, shared artifacts, and immutable userland tool snapshots.
- `.env` is mandatory when the installation uses live cognition, email, LINE, a non-default state path, or non-default laws. It is local secret/configuration, is ignored by Git, and must never be committed.
- `${WORLD_DATA_DIR}-checkpoints/` is optional but strongly recommended. With the default state path this is `world-data-checkpoints/`. It contains recovery copies, not the active universe.
- `node_modules/`, build caches, and Docker images are regenerable. Do not copy them as world state.

No other persistent runtime store exists outside the configured data directory, its sibling checkpoint directory, and `.env`.

## B. New-PC prerequisites

Use 64-bit Windows with Git, Node.js 22 or newer, Corepack, pnpm 10.34.5 (the version pinned by `packageManager`), and Docker Desktop when inhabitants may execute Node/Python programs. Docker Desktop must be running the Linux container engine; WSL 2/virtualization must be enabled if Docker Desktop requires it on that PC. SQLite is embedded through `better-sqlite3`; a separate SQLite CLI is optional.

Verify in PowerShell:

```powershell
git --version
node --version
corepack --version
corepack enable
corepack prepare pnpm@10.34.5 --activate
pnpm.cmd --version
docker version
docker info --format '{{.OSType}}'
```

The final command must print `linux`. Docker is optional for database-only inspection but required for the complete doctor and for `EXECUTE_PROGRAM` or userland-tool execution.

## C. Fresh clone and dependencies

Clone the intended repository and check out the same revision used on the old PC:

```powershell
git clone <your-authorized-repository-url> AutomaticWorld
Set-Location -LiteralPath .\AutomaticWorld
corepack enable
corepack prepare pnpm@10.34.5 --activate
pnpm.cmd install --frozen-lockfile
pnpm.cmd typecheck
```

Do not run `pnpm.cmd world genesis` during an existing-world migration.

## D. Stop and copy the active state

On the old PC, from the repository root:

```powershell
pnpm.cmd world pause
pnpm.cmd world checkpoint create pre-pc-migration
pnpm.cmd world status
pnpm.cmd world debug runner-lease
pnpm.cmd world checkpoint list
```

Stop any runner/terminal process. `debug runner-lease` must show no active valid lease. Copy into a new, dedicated transfer directory (replace `E:\AutomaticWorld-transfer` with an encrypted removable drive or other secure location):

```powershell
New-Item -ItemType Directory -Force -Path 'E:\AutomaticWorld-transfer'
robocopy '.\world-data' 'E:\AutomaticWorld-transfer\world-data' /E /COPY:DAT /DCOPY:DAT /R:2 /W:2
robocopy '.\world-data-checkpoints' 'E:\AutomaticWorld-transfer\world-data-checkpoints' /E /COPY:DAT /DCOPY:DAT /R:2 /W:2
Copy-Item -LiteralPath '.\.env' -Destination 'E:\AutomaticWorld-transfer\.env'
```

`robocopy` exit codes 0 through 7 are successful; 8 or higher is failure. If `WORLD_DATA_DIR` is customized, copy that entire resolved directory and its sibling `<resolved-directory>-checkpoints` instead of the two default paths.

On the new PC, after cloning and dependency installation, make sure no runner is open, then copy the data into the repository:

```powershell
robocopy 'E:\AutomaticWorld-transfer\world-data' '.\world-data' /E /COPY:DAT /DCOPY:DAT /R:2 /W:2
robocopy 'E:\AutomaticWorld-transfer\world-data-checkpoints' '.\world-data-checkpoints' /E /COPY:DAT /DCOPY:DAT /R:2 /W:2
Copy-Item -LiteralPath 'E:\AutomaticWorld-transfer\.env' -Destination '.\.env'
```

If a custom `WORLD_DATA_DIR` is used, put the active state at that exact path and preserve the same setting in `.env`.

## E. Recreate secrets safely

Prefer securely transferring `.env`; alternatively copy `.env.example` and fill values locally. Never put real credentials in documentation, screenshots, shell history, world files, or Git. Placeholder configuration is:

```dotenv
WORLD_DATA_DIR=world-data
COGNITION_PROVIDER=openrouter
OPENROUTER_API_KEY=<provider-secret>
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=<exact-approved-model-id>
OPENROUTER_HTTP_REFERER=<optional-origin>
OPENROUTER_APP_TITLE=<optional-title>

# Use these instead only when COGNITION_PROVIDER=openai
OPENAI_API_KEY=<provider-secret>
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=<exact-approved-model-id>

WORLD_EMAIL_ADDRESS=<world-sender-address>
WORLD_EMAIL_APP_PASSWORD=<app-password>
WORLD_SMTP_HOST=smtp.gmail.com
WORLD_SMTP_PORT=587
WORLD_SMTP_SECURE=false
OWNER_EMAIL_DESTINATION=<owner-address>

LINE_CHANNEL_ACCESS_TOKEN=<optional-token>
LINE_OWNER_DESTINATION_ID=<optional-destination-id>
LINE_CHANNEL_SECRET=<optional-webhook-secret>
LINE_OWNER_SOURCE_ID=<optional-allowed-owner-id>
OWNER_CONSOLE_GATEWAY=false
```

Also preserve deliberately customized cognition budget and descendant-law variables from `.env.example`. Provider/model identity must match the approved old-PC configuration; do not silently substitute a model.

## F. Database/schema migration and integrity

Schema migrations are automatic and in-place when `WorldRepository` opens `world.sqlite`. Every `pnpm.cmd world ...` invocation constructs the repository, so the first `status` on the copied state performs pending additive migrations. There is no separate migration command. Back up first, then run:

```powershell
pnpm.cmd world status
```

This must open the copied database; it must not say `No world`. For a read-only SQLite integrity check using the installed embedded driver:

```powershell
node --input-type=module -e "import Database from 'better-sqlite3'; const root=process.env.WORLD_DATA_DIR ?? 'world-data'; const db=new Database(root + '/world.sqlite',{readonly:true,fileMustExist:true}); db.pragma('query_only=ON'); console.log(db.pragma('integrity_check',{simple:true})); db.close();"
```

The result must be `ok`. With a custom path stored only in `.env`, first set `$env:WORLD_DATA_DIR` to that same path because this standalone integrity command does not load `.env`.

If opening/migration or integrity fails, stop. Keep the failed copy for diagnosis, restore another copy from the old PC or a verified checkpoint into an empty destination, and retry with the same source revision. Do not run genesis as a repair.

## G. Critical anti-genesis verification

> **Do not run genesis on the new PC if migrating an existing world.**

Before live cognition, verify the original founders:

```powershell
pnpm.cmd world agents
pnpm.cmd world inspect Mam
pnpm.cmd world inspect Toey
pnpm.cmd world debug lineage Mam
pnpm.cmd world debug lineage Toey
```

Expected canonical identities:

```text
Mam   29c9d81e-d1d8-4807-893f-841cffce01fe
Toey  eef2caca-cf78-4e90-a536-7115e8af1daf
```

If either UUID differs, population is zero, or the tick/resources/artifacts do not match the old PC, stop immediately. Do not resume or run cognition.

## H. Post-migration verification

Run these while the copied world remains paused:

```powershell
pnpm.cmd world status
node --input-type=module -e "import Database from 'better-sqlite3'; const root=process.env.WORLD_DATA_DIR ?? 'world-data'; const db=new Database(root + '/world.sqlite',{readonly:true,fileMustExist:true}); db.pragma('query_only=ON'); console.log(db.pragma('integrity_check',{simple:true})); db.close();"
pnpm.cmd world doctor
pnpm.cmd world doctor --live
pnpm.cmd world debug runner-lease
pnpm.cmd world debug cognition-context Mam
pnpm.cmd world debug cognition-context Toey
pnpm.cmd world debug descendant-proposals
pnpm.cmd world debug lineage Mam
pnpm.cmd world debug lineage Toey
pnpm.cmd world tools Mam
pnpm.cmd world tools Toey
pnpm.cmd world files Mam
pnpm.cmd world files Toey
pnpm.cmd world files Mam --shared
pnpm.cmd world inspect Mam
pnpm.cmd world inspect Toey
```

`doctor --live` verifies provider authentication/connectivity but deliberately performs no inference request. While following this paused migration sequence, its `World state` check is expected to report `paused`, so the overall result remains `NOT READY`; every other required check should pass. Review the outputs against the old PC: tick, founder UUIDs, population, compute/storage balances, private/shared artifacts, accessible tools, descendant proposals/lineage, sleep state, and observation cursor fields in each cognition-context diagnostic. Diagnostics do not advance cursors.

## I. Normal operations

Use these exact CLI forms from the repository root:

```powershell
pnpm.cmd world pause
pnpm.cmd world resume
pnpm.cmd world status
pnpm.cmd world checkpoint create <safe-label>
pnpm.cmd world checkpoint list
pnpm.cmd world experiment --live --label <safe-label> --ticks 5 --max-cognition-turns 10 --max-input-tokens 50000 --max-output-tokens 10000 --compute-ceiling 250 --execution-limit 5 --wall-ms 300000
pnpm.cmd world runs
pnpm.cmd world run-report <run-id-or-label>
pnpm.cmd world activity --last 50
pnpm.cmd world debug cognition-context <agent-id-or-name>
pnpm.cmd world debug descendant-proposals
pnpm.cmd world debug lineage <agent-id-or-name>
pnpm.cmd world debug runner-lease
pnpm.cmd world doctor
pnpm.cmd world doctor --live
```

`checkpoint list` is the available checkpoint inspection command. `resume` only changes persisted status; it does not start a runner. The `experiment --live` command is the explicit cognition boundary.

## J. Safe numbered migration sequence

OLD PC:

1. `pnpm.cmd world pause`
2. `pnpm.cmd world checkpoint create pre-pc-migration`
3. `pnpm.cmd world status`, `pnpm.cmd world agents`, and `pnpm.cmd world debug runner-lease`
4. Stop all runner terminals/processes; confirm the lease diagnostic is not active.
5. Copy the entire configured `WORLD_DATA_DIR` and, preferably, `${WORLD_DATA_DIR}-checkpoints` with the `robocopy` commands in section D.
6. Securely transfer `.env` separately; never commit it.

NEW PC:

7. Clone/check out the same source revision and run `corepack prepare pnpm@10.34.5 --activate`.
8. Run `pnpm.cmd install --frozen-lockfile` and `pnpm.cmd typecheck`.
9. Place the copied active world directory at the path selected by `WORLD_DATA_DIR`; optionally place checkpoints beside it.
10. Place/recreate `.env` and verify its provider/model and state path.
11. Run `pnpm.cmd world status` to open the copied database and apply automatic schema migrations.
12. Run the read-only integrity command in section F; require `ok`.
13. Run `pnpm.cmd world agents`; require the exact Mam/Toey UUIDs in section G. Compare status, inspect, files, tools, lineage, proposals, resources, sleep state, and cognition-context cursors with the old PC.
14. Run `pnpm.cmd world doctor`.
15. Run `pnpm.cmd world doctor --live`; while paused, accept only the specifically explained `World state: paused` readiness failure.
16. Run `pnpm.cmd world status` once more and verify the copied tick/population/resources remain correct.
17. Only after every check is understood, run `pnpm.cmd world resume`. Run live cognition only with separate explicit authorization, then use a bounded `experiment --live` command.

## K. Recovery stops

- Population 0, missing database, or `No world`: stop. `WORLD_DATA_DIR` is wrong or the copy is incomplete. Correct the path or restore the active directory/checkpoint. Do not run genesis.
- Mam/Toey UUID mismatch: stop. This is a different/fresh universe. Close all processes, move that incorrect directory aside for diagnosis, and restore the verified copied state or checkpoint. Do not continue cognition.
- Docker unavailable or not using Linux containers: keep the world paused, start/fix Docker Desktop and WSL 2/virtualization, then rerun `pnpm.cmd world doctor`.
- Incomplete `.env`: keep the world paused, restore the missing values securely, and rerun `doctor --live`. Do not test provider readiness by spending an inference turn.
- Old schema: retain a backup, use the matching current source, and let `pnpm.cmd world status` perform automatic additive migrations. If it fails, restore and diagnose; never improvise DDL on the only copy.
- Expired stale runner lease: `debug runner-lease` reports it as recoverable. A legitimate runner atomically replaces it; the doctor safely tests acquire/release inside a rolled-back diagnostic. Do not manually delete it unless conducting a separate reviewed recovery.
- Active valid lease: another runner may still be alive. Find and stop that process normally. Do not steal the lease.
- Accidental fresh initialization: stop before cognition, pause/close processes, preserve the mistaken directory only if needed for diagnosis, and restore the original copied `WORLD_DATA_DIR` or a verified checkpoint into an empty destination.
