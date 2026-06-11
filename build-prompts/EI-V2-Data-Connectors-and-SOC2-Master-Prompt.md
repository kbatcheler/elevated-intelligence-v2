# MASTER BUILD PROMPT · V2 ADDENDUM
## Different Day · Elevated Intelligence · Data Connectors and the SOC 2 Production Architecture

This addendum extends the V2 Master Build Prompt. It adds the production data-connection layer: how Elevated Intelligence moves from grounding a diagnosis on a public homepage to grounding it on a client's own systems, without becoming the kind of data warehouse that fails an audit. Read the V2 Master Build Prompt first. Everything there still holds: the gated phases, the regression contract, the three-model cortex, and the em-dash ban. Never use a long em-dash anywhere, in code, copy, seed data, schema comments, or your own status messages. Use a comma, colon, or full stop.

These phases slot in after Phase G. Execute them gated, one at a time, stopping for confirmation after each.

---

## 0 · THE GOVERNING PRINCIPLE (this shapes every connector)

The connectors are not the risk. The risk is letting connectors turn this system into a warehouse that ingests and stores everything a client has, which would put a large volume of sensitive data permanently inside our environment and inside the scope of every audit, breach question, and deletion request we ever face.

The design rule for the entire connector layer is data minimization by default: ingest the least possible, persist less, and export only what cannot be reversed into the original data. We keep behaving like an outside-in system even when the data is internal. We touch client data, derive insight from it, and discard it. We do not hoard it. Our store holds math, not their records.

This is not a brake on the roadmap, it is part of the pitch. The discipline that makes Elevated Intelligence interesting, forming a view without needing the keys to the building, is the same discipline that keeps our audit surface small and clears us through a client's own security review faster than any competitor that hoards.

A direct consequence you must respect in code: every external service we send client data to, including our model providers, is a subprocessor. The connector architecture is designed so that subprocessors only ever see de-identified, aggregated, non-reversible material.

A second principle, learned from building HIPAA and GDPR systems in the medical world: there is no single true view at a single time. Signals change constantly. So connected diagnosis is refresh-on-demand and ephemeral, not a stored snapshot we keep current. We accept that a connected refresh may take many minutes rather than seconds, because the alternative, a persistent live mirror of client data, is exactly the data-at-rest liability we are avoiding. Latency is the price of staying out of the SOC 2 data-at-rest scope, and it is worth paying.

---

## 1 · WHAT "ALL THE CONNECTORS" ACTUALLY MEANS

You will not hand-build fifty brittle one-off integrations. That is the wrong engineering and it does not scale. You will build:

1. A connector framework: one uniform contract every connector implements, plus a registry.
2. A full connector catalogue: every connector declared in the registry with its metadata, mapped to the 14 layers, even where the runtime is not yet implemented.
3. Reference connectors: at least two fully working connectors per family, proven end to end through the derive-and-discard path, so the framework is demonstrably real and the rest are a known quantity to add.

Anything declared in the catalogue but not yet implemented renders in the portal as "available, not connected" and never silently fakes data.

### The connector families and the layers they feed

- **Accounting and ERP** (QuickBooks Online, Xero, NetSuite, Sage Intacct, Microsoft Dynamics): feeds `finance`, `receivables`, `business-performance`, `pricing-margin`.
- **CRM and sales** (Salesforce, HubSpot, Pipedrive, Dynamics CRM): feeds `sales-pipeline`, `customer-intelligence`, `business-performance`.
- **Marketing and web analytics** (Google Analytics 4, Google Search Console, Google Ads, Meta Ads, LinkedIn Ads, HubSpot Marketing, Marketo): feeds `marketing-performance`, `demand-intelligence`, `brand-social`.
- **Commerce, POS and inventory** (Shopify, Square, Lightspeed, Cin7, NetSuite): feeds `demand-intelligence`, `supply-chain`, `pricing-margin`, `receivables`.
- **Supply chain and logistics** (ERP modules, ShipStation, Flexport, EDI or SFTP feeds): feeds `supply-chain`.
- **HRIS and ATS** (Workday, BambooHR, Gusto, Rippling, Greenhouse, Lever): feeds `people-operations`, `talent-hr`.
- **Contracts and documents** (DocuSign or Ironclad CLM, Google Drive, SharePoint, Box): feeds `contract-management`.
- **Support and customer** (Zendesk, Intercom, Gainsight): feeds `customer-intelligence`, `brand-social`.
- **Reputation and social** (G2, Trustpilot, Google Reviews, social listening): feeds `brand-social`, `competitive-intelligence`.
- **Warehouse and BI** (Snowflake, BigQuery, Databricks, Redshift, plus a generic SQL credential): the bring-your-own-warehouse path, can feed any layer.

### The connector framework choice

Use a connector framework for the OAuth and token brokerage and the connector scaffolding. Nango is the known and acceptable choice. But the brief's logic is binding here: a hosted connector aggregator that proxies raw client records through its own cloud is a subprocessor that sees raw data, which is exactly the audit surface we are minimizing. So the rule is: the framework may broker authorization, but raw client records must not transit a third-party aggregator's cloud. Either self-host the framework inside the deployment boundary, or use it only for the OAuth handshake and run the actual extraction through the in-client agent in Part 3. Document which path each connector uses in its registry entry.

---

## 2 · THE UNIFORM CONNECTOR CONTRACT (the heart of the design)

Every connector, regardless of family, implements one interface. Define it once in a new package or module (`lib/connectors` or `artifacts/api-server/src/lib/connectors`):

```
interface Connector {
  key: string;                 // stable id, e.g. "quickbooks-online"
  family: ConnectorFamily;
  layers: LayerKey[];          // which of the 14 layers it feeds
  authMethod: "oauth2" | "apiKey" | "warehouseCredential" | "file";
  deployment: "edge" | "boundary";  // edge = in-client agent, boundary = self-hosted in our VPC
  signalsProduced: SignalKey[];      // the derived signals it can emit, declared up front
  // The only data path. Computes derived signals from raw client data and
  // returns ONLY math. Raw records never appear in the return value.
  extractSignals(scope: ExtractionScope, ctx: ConnectorContext): Promise<DerivedSignalSet>;
}
```

`DerivedSignalSet` is the contract that keeps us compliant. It carries only: scores, ratios, distributions, counts, aggregates over a window, trend deltas, and non-reversible embeddings. It must not carry raw rows, names, account numbers, emails, free-text records, or anything that can be reversed into a person or account. Enforce this with a Zod schema that rejects fields outside the allowed shape, and a lint or runtime guard in `extractSignals` that fails the run if a connector tries to return raw content. The diagnosis runs on features, not on the client's records.

`extractSignals` must be ephemeral and headerless. Any raw data it reads is processed in memory, never written to disk or database, and discarded when the function returns. Identifiers and routing metadata are stripped at the boundary. Where a thread of identity must be preserved across a run, replace identifiers with tokens before processing, with the token mapping held inside the client boundary, never in our store. A breach of our store must yield tokens that are meaningless without the client-held vault.

---

## 3 · THE THREE-TIER PRODUCTION ARCHITECTURE

Build these as the brief sequences them. The order buys the most safety per unit of effort.

### Tier 1: Shrink what we hold (build first)

- **Derived-signals-only ingestion.** Implemented by the connector contract in Part 2. Our store holds the `DerivedSignalSet` output, never the source records.
- **In-client extraction agent.** A lightweight connector runtime that runs inside the client's own cloud or network. It reaches their systems, runs `extractSignals` locally, and sends out only the derived output. The raw data never enters our environment. To a client security team, the headline is that their data does not leave their building, which removes most objections before they arise. This is the single strongest move available. Build it as a deployable agent (container image plus a one-command install) that registers with our API using a per-tenant agent credential, pulls its connector config, runs on a schedule or on demand, and posts back signals over mutual TLS. Connectors marked `deployment: "edge"` run only inside this agent.
- **Ephemeral, headerless processing.** Enforced in the contract. Add a hard guard: the extraction path has no database handle and no filesystem write capability. Prove it in a test.

### Tier 2: Move the processing boundary (build second)

- **Split the pipeline by sensitivity.** This is the most important change to the cortex, and it connects directly to the three-model cortex from the master prompt. Split the run into two zones:
  - **In-boundary extraction zone.** The sensitive extraction stage (Cortex Lens, in connected mode) runs inside the deployment boundary or the in-client agent, on raw client data, using a self-hosted or open model, or deterministic code where no model is needed. Its output is the de-identified, aggregated `DerivedSignalSet`.
  - **External synthesis zone.** Only the synthesis and adversarial stages call external providers. Synthesist (Claude Sonnet) and Confounder plus Challenger (Gemini) receive only the already de-identified, aggregated signals. The providers never see raw client material. Their zero-retention and no-train enterprise terms are layered on top, and confirmed as current and contractual, not assumed.
  - Add a `localModelAdapter` seat to the cortex config so connected mode can route the extraction seat to an in-boundary model while leaving the external seats unchanged. Outside-in demo mode keeps using the external models throughout, because public data is not sensitive.
- **Confidential computing for the sensitive stage (later, prestige control).** Architect the extraction zone so it can later run inside a trusted execution environment, data encrypted even in use, with attestation that only approved code touched the data. Do not build the TEE now. Leave a clean seam so it can be added when a marquee client requires it.

### Tier 3: Contain and prove (build third)

- **Per-tenant cryptographic isolation with customer-managed keys.** Each tenant's stored signals are encrypted with a key the client controls in their own key store. Our store holds a key reference, never the key. Revoking the key crypto-shreds that tenant's data instantly, turning "prove you deleted everything" into a one-step, evidenceable action. This replaces the demo's logical-only separation with real isolation.
- **No standing human access, break-glass only.** The demo's single shared admin login cannot survive contact with production client data. The PIN-gated multi-user auth from the master prompt is the front door. On top of it, default to zero standing access to any tenant's signals. Any human read of connected-tenant data requires a time-boxed, owner-approved, fully logged break-glass grant that expires automatically. Members never have standing data access.
- **Provenance ledger that doubles as the product feature.** Upgrade the existing verified-versus-modelled claims panel into an immutable, tamper-evident record of which source produced each claim. Store references and content hashes, not raw data: each ledger entry chains to the previous one by hash so tampering is detectable. The same ledger is our Processing Integrity evidence for the audit. We build the trust feature and the compliance artifact once. This extends the current `claims` route and the VerifiedPill UI, it does not replace them.

---

## 4 · SCHEMA ADDITIONS (add to `lib/db/src/schema/`, then push)

Match the existing file style and add Drizzle insert and select schemas for each.

- `connectors`: catalogue, mostly static. `key text pk`, `name`, `family`, `layers text[]`, `authMethod`, `deployment`, `signalsProduced text[]`, `status` (`available`, `beta`). This can be seeded from the registry rather than hand-written rows.
- `tenant_connections`: `id uuid pk`, `tenantId uuid not null`, `connectorKey text not null`, `status text not null default 'disconnected'` (`disconnected`, `connected`, `error`), `authRef text` (a pointer into the secret vault, never the secret itself), `scopeConfig jsonb`, `deploymentMode text` (`edge`, `boundary`), `lastRunAt`, `createdAt`.
- `connector_runs`: `id uuid pk`, `tenantConnectionId uuid not null`, `startedAt`, `finishedAt`, `status`, `signalsCount integer`, `provenanceRootHash text`. No raw data, ever.
- `derived_signals`: `id uuid pk`, `tenantId uuid not null`, `layerKey text not null`, `signalKey text not null`, `value jsonb` (numeric, ratio, distribution, or embedding only), `window text`, `computedAt`, `sourceConnectorKey text`, `provenanceRef text`. This is the "math, not records" store. Encrypted per tenant in Tier 3.
- `provenance_ledger`: append-only, never updated or deleted. `id uuid pk`, `tenantId uuid`, `claimPath text`, `sourceRef text`, `contentHash text not null`, `prevHash text`, `createdAt`. Enforce append-only at the application layer and document the intent to enforce it at the database layer.
- `tenant_keys`: `tenantId uuid pk`, `kmsKeyRef text not null` (a reference to the client-managed key, not the key), `status text` (`active`, `revoked`), `revokedAt`.
- `access_grants`: break-glass. `id uuid pk`, `userId uuid not null`, `tenantId uuid not null`, `grantedBy uuid not null`, `reason text not null`, `grantedAt`, `expiresAt not null`, `revokedAt`. Every grant and every access under a grant is logged.

Add a `dataMode` column to `tenants`: `outside_in` (default, the demo behaviour) or `connected` (production, grounded on derived signals). This is the switch that decides how the `ground` stage behaves.

---

## 5 · WIRING IT INTO THE PIPELINE

The pipeline's `ground` stage currently fetches public homepage context through `homepageContext.ts`. Branch it on `tenant.dataMode`:

- `outside_in`: unchanged. Fetch homepage context, ground on public signal. This keeps the entire demo and the regression contract working exactly as before.
- `connected`: ground on the tenant's `derived_signals`, refreshed on demand. A connected refresh triggers the in-client agent or the boundary runtime to run the tenant's connected `extractSignals` calls, write only the resulting `DerivedSignalSet` to `derived_signals`, and then run the normal layer reasoning over those signals. Ephemeral: the raw extraction is discarded, only the derived signals persist, and only until the next refresh supersedes them.

The split-pipeline rule from Part 3 Tier 2 applies in connected mode: extraction runs in-boundary on the local model adapter, and only the de-identified signals flow to the external Synthesist and adversarial seats.

The provenance ledger is written during `narrate` and `score`: every claim the Synthesist emits records its source reference and content hash to `provenance_ledger`, chained to the prior entry. The verified-versus-modelled split in the UI reads from the ledger.

---

## 6 · PORTAL UI

- A **Connections** screen (owner and approved members): the connector catalogue grouped by family, each card showing the layers it feeds, its deployment mode, and a status of available, connected, or error. Connecting runs the auth handshake. Nothing on this screen ever displays raw client data, only connection status and the count and freshness of derived signals.
- A per-tenant **data mode** indicator in the top bar: "Outside-in" or "Connected", so it is always clear which grounding the current diagnosis used.
- The **provenance panel** upgrade: the existing VerifiedPill tooltip gains a "view provenance" action that shows the source reference and hash for that claim, and a chain-integrity check. Keep "report broken link".
- An owner-only **Security posture** view that surfaces, for the audit story and for client security reviews: which subprocessors are in scope, what is stored versus discarded, the per-tenant key status, and the break-glass access log. This is the screen you show a client's security team. It is also live SOC 2 evidence.
- A **break-glass** flow: a member requests access to a connected tenant's signals with a reason, the owner approves a time-boxed grant, and the grant and every access under it are logged and shown in the Security posture view.

---

## 7 · SOC 2 CONTROL MAPPING (build against this)

Every control below does double duty as a security measure and as audit evidence. Design each so its log or artifact is the evidence.

- Derived-signals-only ingestion: Confidentiality, Privacy.
- Ephemeral, headerless processing: Confidentiality, Privacy, Security.
- Tokenization at the edge: Confidentiality, Privacy.
- In-client extraction agent: Confidentiality, Security, Privacy.
- Split pipeline, local plus external model: Confidentiality, Privacy.
- Confidential computing, TEE (later): Security, Confidentiality.
- Per-tenant keys, crypto-shredding: Security, Confidentiality, Privacy.
- No standing access, break-glass: Security.
- Provenance ledger: Processing Integrity, Security.

This is the engineering that makes the controls cheap to satisfy. It is not the control framework itself and not legal advice. Final scope and specific controls, and whether they satisfy our commitments, are set by the auditor and security lead. Subprocessor and data-processing terms with clients and providers are contractual. Build the architecture the formal program sits on top of.

---

## 8 · VERIFICATION AND ACCEPTANCE

1. `pnpm run typecheck` and `pnpm run build` pass clean.
2. The connector registry lists the full catalogue from Part 1. At least two connectors per family run end to end.
3. A connector that attempts to return raw records in its `DerivedSignalSet` is rejected by the schema guard, and the run fails loudly. Prove it with a test.
4. The extraction path has no database or filesystem write capability. Prove it with a test.
5. `outside_in` tenants behave exactly as before. The full regression contract from the master prompt still holds.
6. A `connected` tenant grounds its diagnosis on `derived_signals` only, the raw extraction is discarded, and the external model seats receive only de-identified signals. Verify by inspecting what is sent to the external providers in connected mode: no raw client content.
7. Revoking a tenant key makes that tenant's signals unreadable immediately, and the Security posture view shows it as crypto-shredded.
8. No member has standing access to connected-tenant signals. Access requires an owner-approved, time-boxed, logged break-glass grant that expires on its own.
9. The provenance ledger is append-only, each entry chains to the prior by hash, and the UI can verify chain integrity for any claim.
10. Em-dash sweep returns zero hits in user-facing prose and data.
11. Append to `docs/build-report-v2.md`: the connector framework, the catalogue, which connectors are implemented versus declared, the new tables and routes, the split-pipeline change to the cortex, the subprocessor list, and the measured connected-refresh time so the latency tradeoff is on record.

---

## EXECUTION ORDER (gates, continuing from the master prompt)

- **Phase H.** Connector framework and registry: the uniform contract, the `DerivedSignalSet` schema and guard, the catalogue, and at least two reference connectors in the bring-your-own-warehouse family proven through the derive-and-discard path. Schema additions from Part 4. Stop and confirm.
- **Phase I.** Tier 1 in full: derived-signals-only ingestion wired into the `connected` ground branch, the in-client extraction agent, ephemeral headerless processing with the no-write guard. Stop and confirm.
- **Phase J.** Tier 2: split the pipeline, add the local model adapter seat to the cortex, route extraction in-boundary, leave the TEE seam. Stop and confirm.
- **Phase K.** Tier 3: per-tenant keys and crypto-shredding, no standing access and break-glass, the provenance ledger upgrade. Stop and confirm.
- **Phase L.** Portal: Connections screen, data-mode indicator, provenance panel upgrade, Security posture view, break-glass flow. Stop and confirm.
- **Phase M.** Full verification per Part 8 and the build-report append.

Begin with Phase H. Do not proceed past any gate without my explicit confirmation. Honour the governing principle in Part 0 on every decision: derive and discard, never hoard.
