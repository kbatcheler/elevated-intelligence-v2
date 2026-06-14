---
name: Connectors derive-and-discard boundary
description: The two non-obvious rules that keep the connector extraction path inside the SOC 2 derive-and-discard guarantee.
---

# Connectors derive-and-discard boundary

## Rule 1: import the contract subpath, never the db root

Extraction-path code (the connectors package, and any future in-client edge agent)
imports the DerivedSignalSet contract from the side-effect-free
`@workspace/db/contracts` subpath ONLY. It must never import the `@workspace/db`
root.

**Why:** importing the db root constructs the application Postgres pool as an
import-time side effect, which would hand the extraction module a live handle to
OUR store. The derive-and-discard constraint requires the extraction path to have
no app-DB handle and no filesystem write: a connector touches raw client data,
returns only a DerivedSignalSet, and persists nothing reversible. A db-root import
silently breaks that even if the handle is never used.

**How to apply:** persist runs/signals in the caller, never inside a connector.
Keep the connector context capability-minimal (no db, no fs). A static
import-boundary test enforces this; it is the guarantee, not just documentation.

## Rule 2: aggregate-only must be by construction, not by SQL screening

A connector that accepts free-form SQL cannot prove its output is aggregated.
Keyword screens (read-only, single-statement, numeric column) do NOT stop
`SELECT salary AS v FROM employees LIMIT 1`, and a free-form WHERE string can break
out of the projection to add a raw column.

**Why:** the hard rule is that connectors store math, never raw records. The only
robust way to guarantee that is to remove free-form SQL entirely: the client
declares an aggregate function from an allow-list plus a column, the connector
builds the SELECT so the projection is always an aggregate, and all filter values
are bound parameters (never interpolated). Row-returning aggregates (array_agg,
string_agg, json_agg) are simply not in the allow-list, so they cannot be
expressed. Casting the projection to a numeric type is a second guard, and the
DerivedSignalSet boundary check is a third.

**How to apply:** any new extractor that pulls from a queryable source must offer a
structured, parameterized measure DSL, not a query string. If a value can carry
user/client input, bind it; never concatenate it into SQL.
