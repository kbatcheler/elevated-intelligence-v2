---
name: Local KMS keyring placement
description: Where the local KMS emulation stores per-tenant KEK material and why it must stay off the app SecretStore.
---

# Local KMS keyring placement

The `LocalKmsRuntime` (api-server `lib/security/kms.ts`) stores per-tenant KEK
material in a dedicated durable Postgres table (`kms_local_keys`), NOT in the
application `SecretStore`.

**Why:** App secrets (third-party API keys) and crypto KEK material are different
concerns. The app `SecretStore` is legitimately swapped/mocked for app-secret
control in tests and code paths (e.g. an integration test installs a no-op
`testStore` whose `set()` does nothing). When the KEK rode on that same seam, any
such swap silently broke tenant crypto (provision wrote nothing, the immediate
wrap read null and threw a crypto-shred error). Separately, `EnvSecretStore` is
process.env-only (non-durable), so durable `tenant_keys` rows would point at KEKs
that vanish on every restart, accidentally crypto-shredding all connected tenants.

**How to apply:** Keep KEK material out of `SecretStore`. `tenant_keys` holds only
the reference (`kmsKeyRef`); the material lives behind the KMS seam. The local
keyring table is a documented stand-in for an external KMS; in production a
`CustomerKmsRuntime` adapter holds the key and the table is unused. Never log key
material. Crypto-shred = delete the keyring row so wrapped DEKs are permanently
unopenable.
