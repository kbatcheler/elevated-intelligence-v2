---
name: Content/typography bans must be enforced at DB write sinks, not only source
description: Why a source-only guard misses model-generated persisted data, and how to enforce and audit such a rule across the whole database.
---

# A source-only content guard cannot see generated data in the database

**Rule:** when a project bans a character or pattern "everywhere including data"
(here: no em-dash U+2014 or en-dash U+2013, ASCII hyphen only), a guard that scans
authored source files is necessary but not sufficient. Enforce the rule with a
deterministic sanitizer at EVERY database sink that stores model-generated text,
and audit ALL tables, not just the obvious content ones.

**Why:** the source guard physically cannot see text the models generate and the
app persists; that text exists only after a write. The easiest sink to miss is the
pipeline run table, whose sub-stage column persists the raw per-stage model output
(the reasoning strip reads it back). It looks like internal telemetry, so a content
audit that checks only the tenant and layer tables can pass while the run table and
the job queue's last-error column are still dirty.

**How to apply:**
- Sanitize at write time, ideally inside the single function each table is written
  through, so all callers are covered (the profile, the assembled layer row, the run
  sub-stages, the run error, and the job queue last-error).
- Audit every table with `(to_jsonb(<table>)::text) ~ U&'[\2013\2014]'`, including
  the run and job tables, not just the content tables.
- Strengthen, never weaken, the source guard so it catches both dashes.
- The normalization is canonicalization (em-dash to spaced ASCII hyphen, en-dash to
  plain ASCII hyphen, numbers and identifiers untouched), not an exact round-trip,
  so do not rely on it preserving a verbatim quotation.
