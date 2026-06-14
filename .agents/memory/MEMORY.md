# Memory Index

- [Local KMS keyring](local-kms-keyring.md) — local KEK material lives in its own durable Postgres table, NOT the app SecretStore; keep app secrets and crypto keys separate.
- [Crypto-shred read integrity](crypto-shred-read-integrity.md) — destroy key material before advertising it gone; on read trust the active key, not the blob's own key ref.
- [Replit secret isolation](replit-secret-isolation.md) — owner secrets absent from agent shell, sandbox, AND the testing runtime; verify via integration tests, DB state, or a seeded throwaway owner.
- [Long-dash gate](dash-sweep-gate.md) — ASCII hyphen only across source + DB; per-phase emDashGuard + row-cast DB sweep; even box-drawing comment separators get flagged.
- [Measured perf on real path](measured-perf-on-real-path.md) — gate perf figures must measure the real production path (not the stub), assert real output, frame as local-Postgres-wire floor not WAN, throwaway-and-delete the script.
