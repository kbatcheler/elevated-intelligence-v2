---
name: Measured perf numbers on the real path
description: When a gate requires a measured latency/throughput figure, measure the real production code path and frame it honestly, not the stub.
---

When a verification gate or build report requires a measured performance number
(for example the connected-refresh latency that Part 8 item 11 asks to put on
record), measure it on the REAL production code path, not the stubbed integration
seam, and frame the result honestly.

**Rule:**
- Drive the actual entry point the product uses (e.g. `refreshConnectedTenant` ->
  `warehouse.ts` -> encrypted `persistSignals.ts`), against a real Postgres-wire
  warehouse, with a realistic disposable dataset. Discard a warmup run, time the
  next few, and report median plus range.
- Verify the output is real (e.g. assert every persisted value is an AES-256-GCM
  envelope and a provenance root exists), so the timing is of genuine work, not a
  no-op.
- Frame what the number is and is NOT: a local Postgres-wire measurement is an
  in-boundary processing FLOOR, not client wide-area-network latency. Say so.
- Use a throwaway script that seeds and then drops its disposable tenant/table,
  prints the timings and the verification, and DELETE it after the run. Record the
  figures and the reproduction method in the docs; do not commit the script.

**Why:** the architect explicitly flagged "measure the REAL refresh path, not the
stub" during planning. A stub seam would have produced a meaningless number, and an
unframed local figure could be misread as WAN performance. Honest, reproducible
measurement is the whole point of the gate.

**How to apply:** any future phase that must report a perf figure (refresh,
seed, query latency) follows this same pattern: real path, real output assertion,
honest framing, throwaway-and-delete script, recorded reproduction note.
