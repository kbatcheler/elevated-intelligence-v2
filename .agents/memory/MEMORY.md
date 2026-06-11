# Memory Index

- [EI V2 greenfield build](ei-v2-build.md): V1 reference repo location, the resume rule (INDEX.md is source of truth, never restart from Phase A), and the easy-to-violate non-negotiables.
- [EI V2 foundations gotchas](ei-v2-foundations.md): non-obvious build-environment lessons (zod v4 uuid variant bits, esbuild workspace bundling).
- [EI V2 cortex and seed gotchas](ei-v2-cortex.md): live three-model cortex + grounded seeding lessons (grounded JSON, prompt skeletons, schema tolerance, rate limits, resumability).
- [Replit secret isolation](replit-secret-isolation.md): runtime secrets reach workflow processes only, not the agent shell or code sandbox; verify secret-dependent flows via tests, not curl.
