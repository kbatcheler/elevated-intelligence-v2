---
name: Live seeding operations
description: How to run the live demo-tenant seed reliably (execution model, concurrency, failure semantics).
---

# Running live seeds (lib/pipeline seed engine)

## Execution model
Run multi-minute seeds as a managed Replit **workflow** (console outputType, no waitForPort),
NOT a bash-background `nohup ... &` job. Detached bash processes are reaped after ~5 minutes on
this platform, which silently kills a long seed mid-run (losing buffered output too). Workflows
are platform-managed and run to completion, and their logs are captured reliably. Note `pnpm run
<script>` buffers child stdout through its own pipe and loses it on kill, so prefer the workflow
(or `pnpm --filter <pkg> exec tsx ...`) when you need to watch output.

## Concurrency: keep LAYER_CONCURRENCY=2 for live seeds
**Why:** two compounding constraints make higher concurrency risky.
1. The Anthropic integration rate-limits hard. At LAYER_CONCURRENCY=5 the seed hits a 429 storm
   (continuous "Anthropic 429, backing off"); at 2 there are zero 429s. Gemini stages
   (confound/challenge) stagger the Anthropic load, so effective Anthropic concurrency is below
   the LAYER_CONCURRENCY value.
2. The seed queue marks any layer that returns status="error" as a TERMINAL job - there is no
   job-level retry (only a crashed worker's lease-expiry, 15 min, reclaims a job). One errored
   layer sets the whole tenant status="failed". So a 429 that exhausts the in-call backoff
   (~4 attempts) fails the entire tenant.

**How to apply:** for live seeding set LAYER_CONCURRENCY=2. Higher values trade reliability for
speed and risk failed tenants. Each layer is inherently slow (priority layers ~6-8 min; the
narrate stage ~127s and perceive ~75s with web search dominate), so a full 14-layer seed is
~30-50 min at concurrency 2 and a 4-tenant run runs into multiple hours - plan around that.
Re-running the idempotent driver resumes: it skips tenants already at status "ready" and the
seed resumes layers already persisted.

## Express vs full seeding economics
Express mode (skip confound+challenge on the non-priority layers, full chain on the 5 priority
layers) is ~11-17 percent faster end to end than a full seed. But express optimizes TIME TO
FIRST READY, not total cost to full depth: an express seed plus a later express->full upgrade
takes longer in total than one direct full seed, because the upgrade rebuilds the reduced
layers. The upgrade is efficient about the rest: a full re-seed of an express tenant rebuilds
ONLY the reduced layers (per-layer resume skips the already-full priority layers, so they are
not re-charged - the upgrade's "built" count equals the number of previously-reduced layers).

## Upgrade timing comes from the step clock, not the DB run rows
An upgraded layer reuses the express run's tenant_pipeline_run row, so its started_at is stale;
a DB delta overstates upgrade time. Use the orchestrator/driver step duration for upgrade
timing. Fresh full-seed run-row deltas are valid.
