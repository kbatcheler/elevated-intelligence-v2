# Memory Index

- [Local KMS keyring](local-kms-keyring.md) — local KEK material lives in its own durable Postgres table, NOT the app SecretStore; keep app secrets and crypto keys separate.
- [Crypto-shred read integrity](crypto-shred-read-integrity.md) — destroy key material before advertising it gone; on read trust the active key, not the blob's own key ref.
