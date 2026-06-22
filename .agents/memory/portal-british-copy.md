---
name: Portal British copy vs American data-contract identifiers
description: The split that user-visible portal copy is British English while data-contract identifiers stay American verbatim.
---

# Portal copy: British UI, American identifiers

The rule for the `artifacts/portal/**` UI: user-visible copy (labels, headings,
subtitles, button text) is plain professional British English (realised,
unrealised, organisation, recognised, prioritise). But data-contract identifiers
are American and MUST be preserved byte-for-byte:

- enum values/keys (e.g. the outcome status `"realized"`),
- field names (`realizedValueUsd`, `valueRealizedUsd`),
- catalog/registry keys and any API identifier the server or schema owns.

Only the display *label* maps an American value to a British word; never the
value itself.

**Why:** a phase-AS architect evaluate_task FAILED once on leftover American UI
copy. The symmetric failure is just as bad: anglicising an enum key or field name
silently breaks the portal/server contract (the server, schema, and tests still
emit/expect the American spelling). The two are different layers.

**How to apply:** when editing portal copy, anglicise the visible strings and
leave every identifier alone. After a copy pass, grep the diff for renamed
identifiers (e.g. `realised` appearing in a key, type, or field position) to
confirm only labels changed.
