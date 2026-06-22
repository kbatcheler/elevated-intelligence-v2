# Phase AO: priority connectors (opens the Robustness and Magic wave)

Phase id: AO. Name: priority connectors. Milestone: no (a gated per-phase stop). Phase AO is the FIRST phase
of the Robustness and Magic wave, a post-AN follow-on wave (AO through AS) that reopens the Elevated
Intelligence V2 build, closed at the Phase AN milestone, to harden the platform and sharpen its surface. The
wave runs each phase in strict order, each independently committed, each leaving typecheck, build, and test
green and the long-dash sweep zero on both source and data, and each writing its drift records.

Phase AO turns six of the connector catalogue's previously declared-only entries into real, zero-SDK HTTP
runtimes against the uniform connector contract. Each runs in the in-client edge agent, speaks to its
provider's public REST or JSON API over the Node global fetch (no SDK, no client library, no new
dependency), and reduces that API to ONLY the declared catalogue signals for its family. No raw client
field ever enters a signal; the derive-and-discard boundary holds by construction and is proven by test.
Zero new npm dependencies; ASCII hyphen only in source and in data; no fabricated telemetry, health, or
output (a figure is computed from an actually-observed population or it is omitted as a dash, never a zero
and never an understated partial sum).

## The six connectors

Each connector imports only `@workspace/db/contracts` (never the db root that opens the app pool), resolves
its credential through `ctx.resolveSecret(scope.authRef)` and sends it as a bearer (or the provider's own
auth header), builds its signal set with `buildSignalSet`, and returns it through `assertDerivedSignalSet`,
so a reversible field can never be projected. Each is mapped to its catalogue family and its four declared
signals:

- salesforce (crm-sales, oauth2): `pipeline_coverage_ratio`, `win_rate_pct`, `sales_cycle_days`, and
  `stage_distribution` from Salesforce SOQL AGGREGATE queries (server-side GROUP BY counts and sums) plus
  one bounded, date-only projection for the sales cycle. No opportunity name, owner, account, or id is read.
- hubspot (crm-sales, oauth2): the same four crm-sales signals from a bounded paged walk of deal PROPERTIES
  (stage, amount, created and close dates, the closed and closed-won flags). No deal id, associated contact,
  name, or email is touched.
- quickbooks-online (accounting-erp, oauth2): `gross_margin_pct`, `revenue_trend_delta`,
  `ar_days_outstanding`, and `expense_ratio` from the QBO Reports API (the Profit and Loss summary totals
  for the current and prior windows, and the Aged Receivables total). Only the numeric totals in each report
  summary are read; the customer name and realm id never enter a signal.
- google-analytics-4 (marketing-web-analytics, oauth2): `conversion_rate_pct`, `cac_trend_delta`,
  `channel_mix_distribution`, and `engagement_index` from the GA4 Data API runReport totals. The channel
  labels order the channel-mix distribution and are then discarded; only the session counts and metric
  totals leave the boundary.
- shopify (commerce-pos-inventory, oauth2): `sell_through_rate_pct`, `inventory_turns`, `aov_trend_delta`,
  and `stockout_ratio` from the REST Admin order and product feeds with Link-header cursor pagination,
  reading only order totals, line-item quantities, and variant inventory quantities. No customer, order
  name, product title, or variant id enters a signal.
- zendesk (support-customer, oauth2): `csat_index`, `first_response_hours`, `ticket_volume_trend_delta`, and
  `resolution_rate_pct` from the search/count endpoint (server-side aggregate counts only, no records) plus
  a bounded sample mean for the first response time. No ticket subject, requester, or assignee is read.

## The shared HTTP substrate

`lib/connectors/src/httpJson.ts` is the one place a connector touches a provider over HTTP, so the timeout,
throttle, and error discipline is uniform and provable in one place:

- It uses the Node global fetch and adds nothing to the dependency tree.
- Every request is bounded by a timeout (default 15s) via an `AbortController`.
- On an HTTP 429 it throws a typed `ConnectorThrottleError` carrying any `Retry-After` hint and does NOT
  retry internally: the runtime owns retries (the boundary refresh runtime retries it with backoff; the
  in-client edge runner fails the cycle honestly until its next tick), so retrying here would double the
  backoff and hide the throttle from the runtime meant to manage it. The class lives in the connectors
  package so the connector that throws it and the api-server runtime that catches it share one class
  identity.
- A response body is NEVER logged or attached to an error: a provider error body can echo the request, and
  the request can carry the sensitive query that derives a client signal, so only the status leaves the
  module.
- `httpRequestJson` returns the response headers and status alongside the parsed body so a Link-paginated
  connector (Shopify) can follow the cursor without a second request shape; `nextLink` parses an RFC 5988
  Link header for the next page; `httpJson` is the body-only common case.

## Registration and the catalogue

The six connectors are added to `IMPLEMENTED_CONNECTORS` in `lib/connectors/src/registry.ts` and flipped to
`implemented: true` in `lib/connectors/src/catalogue.ts`. Every other catalogue entry is untouched and still
returns the honest "available, not connected" error through `getConnector`, and the two
bring-your-own-warehouse reference connectors from Phases H and I (generic-sql, redshift) are unchanged. The
catalogue now marks eight connectors implemented (the two warehouse plus the six priority). OAuth
connections continue to refresh through the existing `oauthRefresh` and connected-refresh paths; AO adds no
new auth machinery.

## The honesty boundary, carried through the reduction

The honesty rule is enforced at two depths. First, a per-connector signal ALLOWLIST: a draft whose key the
connector did not declare for its family is rejected, so an extraction can never widen its own surface.
Second, and the substance of AO's two architect remediation rounds, a figure is OMITTED (rendered later as a
dash) rather than fabricated whenever its population is incompletely observed:

- The ordinary missing-field case: an open deal or opportunity carrying no finite amount, a receivables line
  carrying no finite total, an order carrying no finite total price, a line item or variant carrying no
  finite quantity. A coverage or aggregate that would be computed over a partial population is omitted, not
  understated, while a genuine zero population (no open deals at all) stays a true zero.
- The partial-observability case, where a paged walk is truncated at its record cap. HubSpot tracks a
  `truncated` flag (the cap reached while the provider still has a `paging.next.after`) and omits ALL four
  crm-sales signals when truncated, because each would otherwise be computed over an arbitrary partial
  sample of the window. Shopify folds order-feed truncation into its revenue and units completeness (so
  AOV/trend, sell-through, and turns omit) and product-feed truncation into its on-hand completeness (so
  stockout, sell-through, and turns omit).
- The nested-malformed case in QuickBooks: aged-receivables completeness is accumulated once over the report
  tree (`accumulateLeafTotals` always returns whether ANY finite leaf was seen AND whether EVERY customer
  line carried a finite total), so a wholly malformed NESTED receivables section beside a finite sibling
  still propagates its incompleteness to the parent and `ar_days_outstanding` is omitted rather than
  silently understated.

## Tests

`lib/connectors/src/connectors/priorityConnectors.test.ts` (34) drives every connector over a `node:http`
loopback harness that mirrors each provider's response shape (pagination cursors, a 429 with a Retry-After
header, and missing, partial, and truncated payloads):

- Per-connector DERIVATION of the four declared signals from a faithful aggregate or paged response.
- The no-raw-field BOUNDARY for each connector: no opportunity id or stage label (salesforce), deal id or
  contact email (hubspot), customer name or realm id (quickbooks), channel label or property id (ga4),
  product title or id (shopify), or ticket id or requester email (zendesk) escapes into a signal.
- Honest OMISSION: no figure is shown as a zero when its field is absent, as a partial sum when only some
  rows carry the field, or as a partial-sample figure when the walk is truncated at `maxRecords` (the
  HubSpot full-truncation, Shopify order- and product-truncation, and QuickBooks nested-malformed cases).
- The THROTTLE path: an HTTP 429 is surfaced as a `ConnectorThrottleError` carrying the Retry-After hint.
- The CREDENTIAL resolved by `authRef` and sent as a bearer header.

A signal-allowlist guard test pair proves a draft with an undeclared key is rejected and a declared key
admitted, and a registry integration test pair proves all six priority connectors are marked, registered,
and resolved while the warehouse pair and the rest of the catalogue stay untouched. The connectors suite
moves from 29 to 63.

Phase AO also relocates the `ConnectorThrottleError` class out of the api-server rate limiter
(`artifacts/api-server/src/lib/connectors/rateLimiter.ts`) into the shared connectors package, re-exported
from `rateLimiter.ts` for its existing callers, so the connector that raises a throttle over `httpJson` and
the runtime that catches it with an `instanceof` check share ONE class identity (a second copy would make the
check silently never match, surfacing a real throttle as a hard error instead of a retry).
`artifacts/api-server/src/lib/connectors/throttleIdentity.test.ts` (3) pins exactly that: the re-export is
the very class the connectors package raises, a connector-raised throttle is retried with backoff honouring
its Retry-After hint, and a genuine error is never retried. These 3 plus the 34 priority-connector tests are
AO's 37-test delta over the post-AN baseline of 1130.

## Verification

- Typecheck and build green across the workspace (exit 0 on both; portal built at 1771 modules, api-server
  bundled).
- Full suite green at 1167 tests (api-server 644, portal 327, cortex 111, connectors 63, edge-agent 10, db
  8, scripts 4). AO adds 37 tests over the post-AN baseline of 1130: 34 in `priorityConnectors.test.ts` (the
  connectors package moves from 29 to 63) and 3 in `throttleIdentity.test.ts` (the api-server throttle
  identity pins).
- Long-dash sweep zero on both sides: the source guard is green over authored source including this Phase AO
  Markdown, and a fresh database-wide row-cast over all 46 public tables reports zero hits (Phase AO writes
  no schema and no data, so the database side stays clean and is re-run fresh to claim zero honestly).
- Zero new npm dependencies (the connectors speak to providers through the Node global fetch via
  `httpJson.ts`; no SDK, no client library).

## Honest marking

What is TEST-PROVEN here: each connector's reduction of a mirrored provider response to its four declared
signals; the derive-and-discard boundary (no reversible field escapes, every return guarded by
`assertDerivedSignalSet`); the honest-omission rules including the truncation partial-observability class
and the QuickBooks nested-malformed propagation; the throttle surface (429 to a typed
`ConnectorThrottleError` with the Retry-After hint); the credential-by-authRef bearer; the signal allowlist
guard; and the registry marking and resolution with the warehouse pair and the rest of the catalogue
untouched.

What is the accepted boundary (logged drift): the six runtimes are proven against a `node:http` harness that
faithfully mirrors each provider's response shape, not against the live third-party API, which needs real
OAuth credentials and is exercised only when a real tenant connects. This mirrors how the warehouse
connectors were proven against a real Postgres-wire warehouse while the third-party wires cannot be reached
from the build environment. The derive-and-discard boundary, pagination, throttle handling, and the
completeness gating are all directly tested over the harness.

Nothing is fabricated: a figure is computed from an actually-observed population or it is omitted, a
truncated or partial walk yields an omission rather than an understated number, and a declared-only
connector still reports an honest "available, not connected" rather than stub data.

## Logged drift and deviations

- The six priority connectors are proven against a `node:http` response-shape harness, not the live
  third-party API (AO). The live provider wire is exercised only on a real tenant connection with real
  OAuth credentials, which the build environment cannot reach; the boundary, pagination, throttle, and
  completeness logic are directly tested over the harness, mirroring the warehouse connectors' real-Postgres
  proof. Accepted as logged drift; a future live-credential connection closes it.

## Gate

Phase AO passed its architect `evaluate_task` review (PASS) after two honesty remediation rounds. The first
closed a QuickBooks aged-receivables path that did not propagate incompleteness from a wholly malformed
NESTED receivables section, so a nested-only failure beside a finite sibling could silently understate
`ar_days_outstanding`; the fix accumulates completeness over the whole tree and omits the figure when any
customer line is unreadable. The second closed a HubSpot and Shopify partial-observability gap where a
population total could be shown over a truncated, partial sample; the fix tracks truncation at the record
cap and omits every aggregate computed over an incompletely walked population. The re-review confirmed the
truncation gating is honest (no understated or partial figure is ever shown, a missing figure renders as an
omission not a zero), that there is no remaining partial-observability path in these connectors, and that
the hard constraints hold (zero new dependencies, ASCII hyphen only in source and data, no fabricated
figure). The drift index, the rollup, and the V2 build report advance to "A through AO". Phase AO is gated
but not a milestone; the Robustness and Magic wave continues with Phase AP (the sovereign seat realisation).
