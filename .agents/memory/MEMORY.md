# Memory index

- [Verification loop on this repo](verification-loop.md) - never run vitest directly in the agent shell (it gets killed); drive the `test`/`typecheck`/`build` workflows and read the flushed logs.
- [Drift protocol lockstep](drift-protocol-lockstep.md) - INDEX.md is the source of truth; every phase must move five docs in lockstep to the new last phase, and rollup.md has five internal spots that each need updating.
