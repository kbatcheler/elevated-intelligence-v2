---
name: Async mint-then-deliver seams must re-fence access at delivery
description: Any seam that records something for a recipient now and acts on it later must re-check tenant access at BOTH the mint and the deliver boundary, not just at mint.
---

# Async mint-then-deliver seams must re-fence tenant access at delivery, not only at mint

When a feature RECORDS a row for a recipient in one pass and ACTS on it (delivers,
emails, posts to an external sink) in a later pass, fence tenant access at BOTH
boundaries. Checking access only at record time (or, worse, loading work by an
`enabled` flag alone) is broken access control: an `org_tenants` binding can be
revoked between the record pass and the act pass, and the later pass will then leak
the tenant's data to a recipient who has since lost access.

**Why:** in the proactive-push seam (Phase Z) a push rule whose tenant binding was
revoked after the rule was created still sat `enabled` in `push_rules`. The scheduled
pass would mint new events for it AND the drainer would deliver them to slack/email.
The architect `evaluate_task` returned FAIL on exactly this. The fix had to close BOTH
paths; fixing only the mint path still leaks already-pending rows at delivery.

**How to apply:**
- Mint path: before recording, intersect the loaded work with the set of (user,
  tenant) pairs reachable RIGHT NOW, not the historical enablement. The helpers are
  `accessPairKey` and `resolveAccessiblePairsForUsers` in
  `artifacts/api-server/src/lib/auth/tenantScope.ts` (only ACTIVE users resolve to
  pairs, so a disabled or downgraded seat resolves to none).
- Deliver path: re-resolve access for the claimed rows' owners and drop any row whose
  pair is no longer reachable. Fail it in place (a terminal status, visible in the
  center) WITHOUT handing it to a transport; never silently delete it.
- Guard it with a revocation regression test: bind, record, revoke the binding, new
  breach, re-run, then assert the unbound recipient mints nothing new and its stale
  pending row is failed-not-delivered while a still-bound recipient still delivers.
- This applies to future async seams too (challenge re-reasoning, shareable links,
  any digest/queue that fans work out across recipients over time).
