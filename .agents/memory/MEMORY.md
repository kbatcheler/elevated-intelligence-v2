# Memory Index

- [EI V2 greenfield build](ei-v2-build.md): V1 reference repo location, the resume rule (INDEX.md is source of truth, never restart from Phase A), and the easy-to-violate non-negotiables.
- [EI V2 foundations gotchas](ei-v2-foundations.md): non-obvious build-environment lessons (zod v4 uuid variant bits, esbuild workspace bundling).
- [EI V2 cortex and seed gotchas](ei-v2-cortex.md): live three-model cortex + grounded seeding lessons (grounded JSON, prompt skeletons, schema tolerance, rate limits, resumability).
- [Replit secret isolation](replit-secret-isolation.md): runtime secrets reach workflow processes only, not the agent shell or code sandbox; verify secret-dependent flows via tests, not curl.
- [Portal testing without DOM deps](portal-testing-without-dom-deps.md): no jsdom/testing-library installed; test the portal by extracting fetch/mapping logic into framework-free lib/*Api.ts and mocking global fetch in node env.
- [Phase E portal architecture](phase-e-portal.md): archetype-hero fan-out, real-data-only hero rule, perspective-lens substring matching, inconsistent persisted JSON, tenant-status data states.
- [Live seeding ops](seeding-ops.md): live seeds run via a managed workflow at LAYER_CONCURRENCY=2; one layer error fails the tenant (no job retry); Anthropic 429s storm above ~4 concurrent; express vs full economics.
- [Seed-data distinctness](seed-data-distinctness.md): judge tenant figures by a templating signature (overlap, >=2 shared specifics), not any single shared $ figure; same-scale real firms share real revenue.
