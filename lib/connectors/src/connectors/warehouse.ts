import pg from "pg";
import { z } from "zod/v4";
import { SIGNAL_KINDS, assertDerivedSignalSet } from "@workspace/db/contracts";
import type { DerivedSignalSet, SignalKind } from "@workspace/db/contracts";
import { getDescriptor } from "../catalogue";
import type { Connector, ConnectorContext, ExtractionScope } from "../contract";

const { Pool } = pg;

// Signal kinds whose value is a numeric array rather than a single number.
const VECTOR_KINDS = new Set<string>(["distribution", "embedding"]);
const SIGNAL_KIND_SET = new Set<string>(SIGNAL_KINDS);

// The aggregate functions a warehouse measure may use. This allow-list is what
// makes the connector aggregate-only by construction: there is no free-form SQL
// path, so a measure can never project a raw row column. Every one of these
// collapses many rows into a single number, and the deliberately omitted
// row-returning aggregates (array_agg, string_agg, json_agg, and friends) cannot
// be expressed at all.
const AGG_FNS = ["count", "count_distinct", "sum", "avg", "min", "max"] as const;
const aggFnSchema = z.enum(AGG_FNS);

// A single SQL identifier (column or unquoted name). Validated so it can be
// safely quoted and interpolated; it never carries a value.
const identifierSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_$]*$/, "invalid SQL identifier");

// A table reference: an optionally-quoted name, optionally schema-qualified
// (schema.table). Quoted parts may contain anything but a quote. Validated as a
// shape only; never a value.
const IDENT_PART = `(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const tableSchema = z
  .string()
  .regex(new RegExp(`^${IDENT_PART}(?:\\.${IDENT_PART})?$`), "invalid table reference");

// A filter predicate. Comparisons bind their value as a query parameter, so a
// value is always data and never SQL. Null checks take no value. Predicates are
// the only filtering surface; there is no free-form WHERE string to break out of.
const predicateSchema = z
  .strictObject({
    column: identifierSchema,
    op: z.enum(["=", "!=", "<", "<=", ">", ">=", "is_null", "is_not_null"]),
    value: z.union([z.number(), z.string(), z.boolean()]).optional(),
  })
  .refine(
    (p) =>
      p.op === "is_null" || p.op === "is_not_null" ? p.value === undefined : p.value !== undefined,
    "comparison predicates require a value; null checks take none",
  );

// One aggregate term: a function over an optional column with an optional inline
// FILTER. count needs no column; every other function does.
const termSchema = z
  .strictObject({
    fn: aggFnSchema,
    column: identifierSchema.optional(),
    where: z.array(predicateSchema).max(20).optional(),
  })
  .refine((t) => t.fn === "count" || t.column !== undefined, "this aggregate requires a column");

// One measure the client declares. It is computed as either a single aggregate
// term or a ratio of two terms; never as free-form SQL. A vector kind
// (distribution, embedding) groups by one column and returns the aggregate per
// group, never the group key itself, so nothing identifying leaves the boundary.
const measureSchema = z
  .strictObject({
    key: z.string().min(1).max(120),
    kind: z.string().refine((k) => SIGNAL_KIND_SET.has(k), "unknown signal kind"),
    table: tableSchema,
    term: termSchema.optional(),
    ratio: z.strictObject({ numerator: termSchema, denominator: termSchema }).optional(),
    where: z.array(predicateSchema).max(20).optional(),
    groupBy: identifierSchema.optional(),
    window: z.string().min(1).max(60).optional(),
    unit: z.string().max(40).optional(),
  })
  .refine(
    (m) => (m.term ? 1 : 0) + (m.ratio ? 1 : 0) === 1,
    "each measure needs exactly one of term or ratio",
  )
  .refine(
    (m) => !VECTOR_KINDS.has(m.kind) || m.groupBy !== undefined,
    "a vector-kind measure requires groupBy",
  )
  .refine(
    (m) => VECTOR_KINDS.has(m.kind) || m.groupBy === undefined,
    "groupBy is only valid for a vector-kind measure",
  );

const warehouseConfigSchema = z.strictObject({
  measures: z.array(measureSchema).min(1).max(500),
});

export type WarehouseMeasure = z.infer<typeof measureSchema>;
type Term = z.infer<typeof termSchema>;
type Predicate = z.infer<typeof predicateSchema>;

function quoteIdentifier(id: string): string {
  return '"' + id.replace(/"/g, '""') + '"';
}

// Quote a validated table reference part by part. An already-quoted part is kept
// verbatim; a bare part is quoted.
function quoteTable(table: string): string {
  return table
    .split(".")
    .map((part) => (part.startsWith('"') ? part : quoteIdentifier(part)))
    .join(".");
}

// Render a predicate list as parameterized SQL, pushing each bound value onto the
// shared params array so positional placeholders line up with execution order.
function buildPredicates(predicates: Predicate[], params: unknown[]): string {
  return predicates
    .map((p) => {
      const col = quoteIdentifier(p.column);
      if (p.op === "is_null") {
        return col + " is null";
      }
      if (p.op === "is_not_null") {
        return col + " is not null";
      }
      params.push(p.value);
      return col + " " + p.op + " $" + params.length;
    })
    .join(" and ");
}

function buildTerm(term: Term, params: unknown[]): string {
  const fnSql = term.fn === "count_distinct" ? "count" : term.fn;
  const arg =
    term.fn === "count"
      ? "*"
      : term.fn === "count_distinct"
        ? "distinct " + quoteIdentifier(term.column as string)
        : quoteIdentifier(term.column as string);
  let expr = fnSql + "(" + arg + ")";
  if (term.where && term.where.length > 0) {
    expr += " filter (where " + buildPredicates(term.where, params) + ")";
  }
  return expr;
}

function buildProjection(measure: WarehouseMeasure, params: unknown[]): string {
  if (measure.ratio) {
    const numerator = buildTerm(measure.ratio.numerator, params);
    const denominator = buildTerm(measure.ratio.denominator, params);
    return "(" + numerator + ")::float8 / nullif((" + denominator + ")::float8, 0)";
  }
  return "(" + buildTerm(measure.term as Term, params) + ")::float8";
}

// Construct the full, aggregate-only SELECT for a measure. The projection is
// always an aggregate expression aliased to v; the FROM is a validated table;
// every value is a bound parameter. There is no surface through which a raw row
// column could reach the result set.
function buildMeasureQuery(measure: WarehouseMeasure): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const projection = buildProjection(measure, params);
  let text = "select " + projection + " as v from " + quoteTable(measure.table);
  if (measure.where && measure.where.length > 0) {
    text += " where " + buildPredicates(measure.where, params);
  }
  if (measure.groupBy) {
    const group = quoteIdentifier(measure.groupBy);
    text += " group by " + group + " order by " + group;
  }
  return { text, params };
}

// Read only the numeric column "v" from each row and coerce it to a finite
// number. Any non-numeric value fails the run loudly rather than letting a value
// the aggregate produced from a text column (for example min over an email
// column) slip through. This is the second guarantee that only math leaves the
// boundary, after the aggregate-only construction and before the
// DerivedSignalSet guard runs as a third check.
function readNumber(row: Record<string, unknown>): number {
  if (!("v" in row)) {
    throw new Error("warehouse measure query must return a numeric column named \"v\"");
  }
  const raw = row.v;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error("warehouse measure returned a non-numeric value; only math may leave the boundary");
  }
  return n;
}

function coerceSignalValue(kind: string, rows: Array<Record<string, unknown>>): number | number[] {
  if (VECTOR_KINDS.has(kind)) {
    if (rows.length === 0) {
      throw new Error("warehouse measure of a vector kind returned no rows");
    }
    return rows.map(readNumber);
  }
  if (rows.length === 0) {
    throw new Error("warehouse measure of a scalar kind returned no rows");
  }
  return readNumber(rows[0]);
}

// Build a bring-your-own-warehouse connector. The same engine backs every SQL
// warehouse target. It opens its own read-only connection to the client
// warehouse (never our application database), runs the declared aggregate-only
// measures inside a read-only transaction, computes a DerivedSignalSet, and
// discards the connection. It holds no database handle to our store and writes
// nothing to disk.
export function createWarehouseConnector(key: string): Connector {
  const descriptor = getDescriptor(key);
  if (!descriptor) {
    throw new Error("No catalogue descriptor for warehouse connector: " + key);
  }

  return {
    key: descriptor.key,
    family: descriptor.family,
    layers: descriptor.layers,
    authMethod: descriptor.authMethod,
    deployment: descriptor.deployment,
    signalsProduced: descriptor.signalsProduced,
    async extractSignals(
      scope: ExtractionScope,
      ctx: ConnectorContext,
    ): Promise<DerivedSignalSet> {
      const parsed = warehouseConfigSchema.safeParse(scope.config);
      if (!parsed.success) {
        throw new Error(
          "warehouse connector requires a measures plan in scope.config; none configured or invalid",
        );
      }
      const { measures } = parsed.data;

      // The connection string for the client warehouse, resolved from the secret
      // vault by reference. It is never stored and never logged.
      const connectionString = await ctx.resolveSecret(scope.authRef);

      const pool = new Pool({
        connectionString,
        max: 2,
        idleTimeoutMillis: 5_000,
        connectionTimeoutMillis: 10_000,
        statement_timeout: 30_000,
      });

      const signals: Array<{
        key: string;
        kind: SignalKind;
        value: number | number[];
        window?: string;
        unit?: string;
      }> = [];

      try {
        const client = await pool.connect();
        try {
          await client.query("BEGIN TRANSACTION READ ONLY");
          for (const measure of measures) {
            const { text, params } = buildMeasureQuery(measure);
            const result = await client.query(text, params);
            const value = coerceSignalValue(measure.kind, result.rows);
            signals.push({
              key: measure.key,
              kind: measure.kind as SignalKind,
              value,
              ...(measure.window ? { window: measure.window } : {}),
              ...(measure.unit ? { unit: measure.unit } : {}),
            });
          }
          await client.query("COMMIT");
        } finally {
          client.release();
        }
      } finally {
        // Discard the connection. Nothing from the raw extraction survives.
        await pool.end();
      }

      ctx.log("warehouse.extract.complete", {
        connector: descriptor.key,
        signals: signals.length,
      });

      // Final guard at the boundary: reject anything reversible before it can be
      // returned, persisted, or sent onward.
      return assertDerivedSignalSet({
        source: descriptor.key,
        tenantId: scope.tenantId,
        generatedAt: ctx.now().toISOString(),
        ...(scope.window ? { windowStart: scope.window.start, windowEnd: scope.window.end } : {}),
        signals,
      });
    },
  };
}

// The two reference connectors for this phase. Redshift speaks the PostgreSQL
// wire protocol, so the same node-postgres driver connects; generic-sql targets
// any PostgreSQL-wire-compatible warehouse with a read-only credential. Both are
// genuine SQL extractions: real aggregate queries against a real warehouse,
// returning only derived math.
export const redshiftConnector = createWarehouseConnector("redshift");
export const genericSqlConnector = createWarehouseConnector("generic-sql");
