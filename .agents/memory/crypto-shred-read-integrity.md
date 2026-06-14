---
name: Crypto-shred revoke ordering and read-path key integrity
description: Two durable rules for any per-tenant envelope crypto path - destroy key material before advertising it gone, and trust the active key over the blob's own key reference.
---

# Crypto-shred revoke ordering and read-path key integrity

Two invariants for the per-tenant envelope crypto path, both added after an
architect review caught the gaps.

## Destroy the key material before committing the state that advertises it gone

A revoke must make the irreversible key-material destruction succeed first, then
persist the "revoked" state. If destruction fails it must throw before any state
change.

**Why:** the dangerous state is a key reported revoked while its material still
exists, so operators believe data is crypto-shredded when the ciphertext is still
openable. Destroy-first makes "revoked" a true claim or no claim at all.

**How to apply:** any revoke or rotate path orders the key-destruction effect
before the status write; prove it with a failure-injection test that the status
stays unchanged and data stays readable when destruction fails.

## On read, trust the active tenant key, never the envelope's own key reference

Decrypt only after confirming an active tenant key exists, and require the stored
envelope's key reference to equal that active key's reference before unwrapping.
Zero stored rows is empty; rows with no active key is a loud crypto-shred failure.

**Why:** the envelope carries its own key reference, but trusting it on read lets a
row sealed under a different or stale key be opened if that key still resolves. The
authority for "which key may open this tenant's data now" is the active key record,
not the value embedded in the stored blob. A mismatch is a loud typed failure, never
a silent fallback to whatever the envelope names.
