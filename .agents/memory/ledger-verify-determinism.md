---
name: Ledger chain-verify determinism in tests
description: Why tests must never assert a GLOBAL provenance-chain verification result, only owned-tenant sub-chains.
---

# The rule

When testing anything that walks the provenance ledger, assert chain integrity only over your
OWN seeded tenant's sub-chain (`verifyLedgerEntries` over rows you control), never over a global
`chainVerified === true`.

**Why:** the Vitest suite shares one Postgres database across test files that run in parallel
processes. `provenance/ledger.test.ts` intentionally UPDATEs a field and DELETEs a row in its
own tenant's `provenance_ledger` rows to prove tamper-evidence. Any operation that walks the
WHOLE ledger (e.g. `runRestoreDrill`, `exportLedgerArchive`) can therefore observe a transiently
broken chain through no fault of its own, so a global `chainVerified === true` assertion is
flaky.

**How to apply:** `verifyLedgerEntries` is order-independent (it finds genesis via a
byPrevHash map), so it works on a single tenant's rows in isolation. In `runRestoreDrill` the
deterministic proof is to restore into the scratch schema, read your own tenant's rows back out
of that scratch schema, and verify just those. The drill's own production code re-walks every
restored tenant from the restored scratch rows (correct for production); the TEST just must not
assert the global result is true.
