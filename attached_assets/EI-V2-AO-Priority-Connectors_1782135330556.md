# Phase AO: Priority Connectors (Salesforce, HubSpot, QuickBooks, GA4, Shopify, Zendesk)

## Objective

Move the connected pipeline from "provable only against a customer warehouse" to
"running on the customer's actual operating systems". Implement six priority
connectors as real, zero SDK HTTP adapters that honour the existing uniform
connector contract and the derive and discard rule, and flip them to
`implemented: true` in the catalogue. After this phase a tenant can connect a live
SaaS source and the cortex grounds on derived signals from it.

## Ownership boundary

This phase owns `lib/connectors/**` and the connector registration points under
`artifacts/api-server/src/lib/connectors/**` and
`artifacts/api-server/src/lib/ingestion/**` strictly where a new connector must be
registered. It does not touch `lib/cortex`, `artifacts/portal`, or `infra`. It is
the sole owner of `lib/connectors/src/catalogue.ts` and
`lib/connectors/src/registry.ts`.

## Invariants (restated)

Zero new npm dependencies: every connector is built on the Node global `fetch`,
exactly as `gcpSecretStore` and the warehouse connector are, never a vendor SDK.
ASCII hyphen only in source and data. Never fabricate a signal: a derived figure
is computed from a real provider response or it is not emitted. Available, not
connected on missing credentials or config. Full suite green and long dash sweep
zero before close.

## The contract you are implementing against

Every connector implements `Connector.extractSignals(scope, ctx)` and returns an
`ExtractionResult`, which is either a `DerivedSignalSet` or `{ set, nextWatermark }`.
Raw records never appear in a return value and are never persisted. The connector
receives only an `authRef` through the scope and resolves the credential through
`ctx.resolveSecret`; it never reads `process.env` at the call site. It uses
`ctx.tokenize` for any identifier that must remain stable but non reversible, and
`ctx.now` and `ctx.log` for time and telemetry. There is no database handle and no
filesystem capability in the context, by design: the connector cannot persist
anything itself.

Mirror the warehouse connector's discipline: the output is aggregate math only.
Where a source returns rows, the connector reduces them in memory to counts,
sums, ratios, distributions, and trend deltas, then discards the rows before
returning. No raw row, no customer name, no line item ever leaves the boundary.

## The six connectors and the signals each emits

Use the representative signal keys already declared for each family in
`catalogue.ts`. Do not invent new signal kinds; reuse the declared shapes so the
layer mapping and the portal grouping stay in lock step.

1. `salesforce` (crm-sales, oauth2). Query the Salesforce REST and SOQL endpoints
   with aggregate SOQL only (`COUNT()`, `SUM()`, `AVG()`, `GROUP BY`), never a row
   projecting SELECT. Emit `pipeline_coverage_ratio`, `win_rate_pct`,
   `sales_cycle_days`, `stage_distribution`. Resolve the access token through the
   existing OAuth refresh path; the instance URL is non secret config on the
   connection, not a credential.
2. `hubspot` (crm-sales, oauth2). Use the CRM search and analytics endpoints,
   reducing to the same four crm-sales signals. Where HubSpot has no native
   aggregate, page the minimum necessary, reduce in memory, and discard.
3. `quickbooks-online` (accounting-erp, oauth2). Use the Reports API
   (ProfitAndLoss, AgedReceivables) which already returns aggregates. Emit
   `gross_margin_pct`, `revenue_trend_delta`, `ar_days_outstanding`,
   `expense_ratio`. Never pull the transaction list.
4. `google-analytics-4` (marketing-web-analytics, oauth2). Use the Data API
   `runReport` with metric aggregations only, no user level dimensions. Emit
   `conversion_rate_pct`, `cac_trend_delta` where a cost source is present
   otherwise omit it honestly, `channel_mix_distribution`, `engagement_index`.
5. `shopify` (commerce-pos-inventory, oauth2). Use the Admin GraphQL aggregate
   queries. Emit `sell_through_rate_pct`, `inventory_turns`, `aov_trend_delta`,
   `stockout_ratio`. Reduce orders to the aggregate in memory; never return an
   order.
6. `zendesk` (support-customer, oauth2 or apiKey per the catalogue entry). Use the
   ticket metrics and satisfaction endpoints. Emit `csat_index`,
   `first_response_hours`, `ticket_volume_trend_delta`, `resolution_rate_pct`.

## Ordered tasks

1. Add a small shared HTTP helper in `lib/connectors/src/` (for example
   `httpJson.ts`) over the Node global `fetch`: typed JSON request and response,
   a bounded timeout, a single retry that honours `Retry-After`, and integration
   with the existing per connection token bucket and quota profile. No new
   dependency. This is the only new shared module; every connector uses it.
2. Implement each connector in its own module under
   `lib/connectors/src/connectors/`, one file per source, each exporting a
   `Connector`. Reuse the warehouse connector's structure: validate config shape
   with the already present `zod`, resolve the credential through `ctx.resolveSecret`,
   call the provider through the HTTP helper, reduce to the declared signals,
   assert the result with `assertDerivedSignalSet`, return only math. Support
   incremental extraction with a watermark where the provider exposes a modified
   since cursor; otherwise declare `incremental.supported = false` and do a full
   derive, the honest fallback.
3. Register each connector in `registry.ts` and flip its catalogue entry to
   `implemented: true`. Leave every other catalogue entry exactly as it is:
   unimplemented connectors must keep rendering as available, not connected.
4. Wire OAuth credential resolution through the existing
   `oauthRefresh.ts` and `connectedRefresh.ts` paths. The connection stores only
   the `authRef` and non secret config (instance URL, account id, property id),
   never a token value.
5. Write a unit test per connector that drives extraction against a recorded,
   in repository fixture of a provider aggregate response (no network in tests),
   asserting the exact derived signals and that no raw field survives into the
   output. Add one boundary test per connector proving that a row projecting
   request shape is rejected or impossible to express, mirroring the warehouse
   aggregate only proof.
6. Add an integration test that registers all six, runs a derive against fixtures
   for each, and confirms the registry, the catalogue `implemented` flags, and the
   family to layer mapping stay consistent.

## What you must not do

Do not add a vendor SDK or any npm dependency. Do not return, log, or persist a
raw record, an identifier, a customer name, or a line item. Do not read
`process.env` at a call site; resolve every secret through the store seam. Do not
edit any cortex, portal, or infra file. Do not flip any catalogue entry other than
the six to implemented.

## Acceptance gate

All six connectors implemented, registered, and marked implemented; every other
entry untouched and still honestly available, not connected. Per connector unit
and boundary tests pass and prove no raw field escapes. `typecheck`, `build`, and
`test` green. Long dash sweep zero in source and data. Drift records written for
phase AO: `docs/drift/phase-AO.md`, the build report appended, the INDEX and
rollup advanced to AO.
