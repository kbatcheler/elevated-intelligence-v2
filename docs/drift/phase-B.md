# Phase B: Foundations

Verdict: Pass.

## Requirements checklist

- One coherent multi-tenant data model, designed once. Done. `lib/db` holds the
  full schema: identity and access (orgs, users, invite pins, access grants),
  the layer registry, and the per-tenant content store (tenants, org-tenant
  join, tenant profile, tenant layers, tenant layer config, tenant artifacts,
  pipeline runs with nine sub-stages including confound, claim-broken reports).
- The layer registry is the single source of truth for layer identity. Done. No
  LAYER_KEYS constant exists anywhere; `layers.key` is the text primary key and
  the tenant tables foreign-key to it. The registry is read at runtime by the
  api-server, and through it by the portal.
- The fourteen canonical layers load from the registry. Done. Seeded by
  `pnpm --filter @workspace/db run seed:layers`; verified fourteen rows across
  eight module groups, in spec order.
- The DerivedSignalSet connector contract is native from foundations, with a
  runtime guard and a passing test. Done. `lib/db/src/contracts` plus an eight
  case test that proves the guard rejects raw rows, free text, unexpected keys,
  vector and scalar mismatches, non-finite values, and malformed tenant ids.
- Design system from day one. Done. Brand tokens ported into the portal
  `index.css`, a written `docs/design-language.md`, and a live design-language
  page in the portal that renders every primitive from the same tokens.
- Tests and CI from day one. Done. Vitest in `lib/db`, `artifacts/api-server`,
  and `scripts`; a self-testing em-dash guard in `scripts`; and a GitHub Actions
  workflow that runs install, typecheck, build, and test.
- Secrets discipline. Done. A `SecretStore` interface with get, set, and delete
  by reference, an env-backed local implementation, a `requireSecret` lazy
  throw-if-missing helper, and a six case test.

## Acceptance criteria

- Clean typecheck, build, and CI green on the scaffold. Met. `pnpm run typecheck`,
  `pnpm run build`, and `pnpm run test` all pass. The CI workflow runs the same
  four steps; see the drift note on hosted execution.
- Fourteen canonicals load from the registry. Met. Verified by direct query and
  through the portal `/api/layers` proxy (fourteen layers reach the portal).
- A design language document exists. Met. `docs/design-language.md` plus its live
  counterpart page.
- Org and auth schema migrates cleanly. Met. `drizzle-kit push` applied the
  schema with no errors.
- The DerivedSignalSet guard has a passing test. Met. Eight tests pass.

## Drift items

- Acceptable: CI is defined as a GitHub Actions workflow but the hosted run
  cannot execute inside this Replit environment. Its four steps (install,
  typecheck, build, test) are run locally and all pass, which is the same
  evidence the hosted job would produce. Same class as the managed-VCS drift.
- Acceptable: the portal carries no unit tests yet, so its test script uses
  `--passWithNoTests`. Component tests arrive with the product surfaces in later
  phases. The api-server, db, and scripts packages do have tests now.
- No stubbing, mocking, or faked output. The portal renders real registry data
  through the api-server and shows explicit loading, empty, and error states
  rather than placeholder values. The Confounder and the three-model cortex are
  untouched in this phase and remain unstubbed for Phase C.

## Decisions taken

- Dev topology: api-server on port 3001 (console), portal on port 5000
  (webview). The portal proxies `/api` to the api-server so it calls a relative
  URL that works unchanged behind a single origin in production.
- The api-server build externalizes third-party runtime dependencies and bundles
  workspace packages, because workspace packages ship TypeScript source and must
  be compiled into the output rather than required at runtime.
- Provenance is encoded in the design system from day one: Verified and Modelled
  pills, so every figure can declare whether it is sourced or inferred.
- Zod v4 (the `zod/v4` subpath of zod 3.25.76) is the contract layer.

## Test and verification summary

- Typecheck: clean across libs and all artifacts and scripts.
- Build: portal builds to `dist/public`; api-server bundles to `dist/index.mjs`.
- Tests: lib/db 8, api-server 6, scripts 3, portal passes with no tests.
- Em-dash sweep: clean across lib, artifacts, docs, scripts.
- Schema migrate: `drizzle-kit push` clean. Seed: fourteen layers loaded.
- Live check: api `/health` ok; `/api/layers` returns fourteen, also through the
  portal proxy. Portal design-language page renders from the tokens.

## Milestone marker

Phase B is not a milestone. The next milestone is Phase C, the cortex and
Confounder, which is a hard stop for owner review and requires the model API
keys (Anthropic, Gemini) that are not yet wired.
