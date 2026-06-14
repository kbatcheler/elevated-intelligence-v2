import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ConnectorContext, ExtractionScope } from "../contract";
import { genericSqlConnector, redshiftConnector } from "./warehouse";

const { Pool } = pg;

// A throwaway schema in the same Postgres stands in for a client warehouse.
// Postgres is the honest stand-in here: Redshift speaks the Postgres wire
// protocol and generic-sql targets any Postgres-wire-compatible warehouse, so
// this exercises the real driver and real aggregate SQL, not a mock.
const SCHEMA = `conn_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const TABLE = `"${SCHEMA}".invoices`;
const warehouse = new Pool({ connectionString: process.env.DATABASE_URL });

// Capability-minimal context: it resolves the warehouse credential and nothing
// else. No database handle to our store, no filesystem.
const ctx: ConnectorContext = {
  async resolveSecret() {
    return process.env.DATABASE_URL as string;
  },
  tokenize: (value) => "tok_" + Buffer.from(value).toString("hex").slice(0, 12),
  now: () => new Date(),
  log: () => {},
};

function scope(measures: unknown, connectorKey = "generic-sql"): ExtractionScope {
  return { tenantId: randomUUID(), connectorKey, authRef: "warehouse-conn", config: { measures } };
}

beforeAll(async () => {
  await warehouse.query(`CREATE SCHEMA "${SCHEMA}"`);
  await warehouse.query(
    `CREATE TABLE ${TABLE} (
      id serial primary key,
      customer_email text not null,
      status text not null,
      amount numeric not null
    )`,
  );
  const rows: Array<[string, string, number]> = [
    ["ada@acme.example", "paid", 1200],
    ["grace@acme.example", "paid", 800],
    ["alan@acme.example", "unpaid", 450],
    ["edsger@acme.example", "unpaid", 975],
    ["donald@acme.example", "paid", 1500],
  ];
  for (const [customerEmail, status, amount] of rows) {
    await warehouse.query(
      `INSERT INTO ${TABLE} (customer_email, status, amount) VALUES ($1, $2, $3)`,
      [customerEmail, status, amount],
    );
  }
});

afterAll(async () => {
  await warehouse.query(`DROP SCHEMA "${SCHEMA}" CASCADE`);
  await warehouse.end();
});

const countMeasure = { key: "invoice_count", kind: "count", table: TABLE, term: { fn: "count" } };

describe("warehouse reference connectors", () => {
  it("derives only math from a real SQL warehouse", async () => {
    const set = await genericSqlConnector.extractSignals(
      scope([
        countMeasure,
        {
          key: "paid_ratio",
          kind: "ratio",
          table: TABLE,
          ratio: {
            numerator: { fn: "count", where: [{ column: "status", op: "=", value: "paid" }] },
            denominator: { fn: "count" },
          },
        },
        {
          key: "amount_by_status",
          kind: "distribution",
          table: TABLE,
          term: { fn: "sum", column: "amount" },
          groupBy: "status",
        },
      ]),
      ctx,
    );

    expect(set.source).toBe("generic-sql");
    const byKey = Object.fromEntries(set.signals.map((s) => [s.key, s.value]));
    expect(byKey.invoice_count).toBe(5);
    expect(byKey.paid_ratio).toBeCloseTo(3 / 5);
    expect(Array.isArray(byKey.amount_by_status)).toBe(true);
    expect((byKey.amount_by_status as number[]).length).toBe(2);
  });

  it("never returns raw client records", async () => {
    const set = await genericSqlConnector.extractSignals(scope([countMeasure]), ctx);
    const serialized = JSON.stringify(set);
    expect(serialized).not.toContain("@");
    expect(serialized).not.toContain("acme.example");
  });

  it("writes nothing to our store during extraction", async () => {
    const countOurStore = async () => {
      const res = await warehouse.query<{ c: number }>(
        "SELECT count(*)::int AS c FROM derived_signals",
      );
      return res.rows[0]!.c;
    };
    const before = await countOurStore();
    await genericSqlConnector.extractSignals(scope([countMeasure]), ctx);
    const after = await countOurStore();
    expect(after).toBe(before);
  });

  it("has no free-form SQL path: a raw column cannot be projected", async () => {
    // There is no query field on a measure. The only way to reference a column is
    // through an aggregate function, so a raw row value can never be selected. A
    // measure carrying a free-form query is simply ignored: the validated shape
    // has no such field, and with no term or ratio the measure is rejected.
    await expect(
      genericSqlConnector.extractSignals(
        scope([
          {
            key: "leak",
            kind: "score",
            table: TABLE,
            query: `SELECT customer_email AS v FROM ${TABLE} LIMIT 1`,
          },
        ]),
        ctx,
      ),
    ).rejects.toThrow(/measures plan|invalid/i);
  });

  it("rejects an aggregate over a non-numeric column as non-math", async () => {
    // min over a text column is a valid aggregate but returns text. The numeric
    // cast on the projection rejects it at the SQL boundary (and the numeric guard
    // would reject it after), so even an aggregate cannot leak a raw string.
    await expect(
      genericSqlConnector.extractSignals(
        scope([
          { key: "min_email", kind: "score", table: TABLE, term: { fn: "min", column: "customer_email" } },
        ]),
        ctx,
      ),
    ).rejects.toThrow(/non-numeric|only math|double precision|invalid input/i);
  });

  it("rejects an unknown aggregate function", async () => {
    await expect(
      genericSqlConnector.extractSignals(
        scope([{ key: "x", kind: "count", table: TABLE, term: { fn: "first", column: "amount" } }]),
        ctx,
      ),
    ).rejects.toThrow(/measures plan|invalid/i);
  });

  it("rejects an aggregate that requires a column but is given none", async () => {
    await expect(
      genericSqlConnector.extractSignals(
        scope([{ key: "x", kind: "aggregate", table: TABLE, term: { fn: "sum" } }]),
        ctx,
      ),
    ).rejects.toThrow(/measures plan|invalid/i);
  });

  it("treats a filter value as a bound parameter, never as SQL", async () => {
    // An injection attempt in a predicate value is bound as data, so it simply
    // matches no rows; it is never executed as SQL and never errors.
    const set = await genericSqlConnector.extractSignals(
      scope([
        {
          key: "matches_injection",
          kind: "count",
          table: TABLE,
          term: {
            fn: "count",
            where: [{ column: "status", op: "=", value: "paid'; drop table invoices; --" }],
          },
        },
      ]),
      ctx,
    );
    expect(set.signals[0]!.value).toBe(0);
    // The table is untouched: a follow-up count still sees every row.
    const still = await warehouse.query<{ c: number }>(`SELECT count(*)::int AS c FROM ${TABLE}`);
    expect(still.rows[0]!.c).toBe(5);
  });

  it("requires a measures plan and never invents one", async () => {
    await expect(
      genericSqlConnector.extractSignals(
        { tenantId: randomUUID(), connectorKey: "generic-sql", authRef: "warehouse-conn" },
        ctx,
      ),
    ).rejects.toThrow(/measures plan/i);
  });

  it("runs the redshift connector through the same engine", async () => {
    const set = await redshiftConnector.extractSignals(scope([countMeasure], "redshift"), ctx);
    expect(set.source).toBe("redshift");
    expect(set.signals[0]!.value).toBe(5);
  });

  it("exposes no database or filesystem capability on the context", () => {
    expect("db" in ctx).toBe(false);
    expect("writeFile" in ctx).toBe(false);
    expect("fs" in ctx).toBe(false);
  });
});
