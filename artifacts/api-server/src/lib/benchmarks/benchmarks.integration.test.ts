import { and, eq, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  benchmarkCohortsTable,
  benchmarkConsentEventsTable,
  benchmarkStatsTable,
  db,
  derivedSignalsTable,
  tenantsTable,
} from "@workspace/db";
import { encryptSignalValue } from "../security/signalCrypto";
import { ensureActiveTenantKey, revokeTenantKey } from "../security/tenantKeyService";
import { runBenchmarkRecompute, type BenchmarkLogger } from "./benchmarks";
import { segmentKeyFor } from "./benchmarkMath";

// The recompute persists real cohort and stat rows derived from real per-tenant
// encrypted signals, so this runs against a real database. Throwaway tenants own
// everything; deleting them cascades to their signals and consent events, so the
// suite is safe to run repeatedly. A unique per-run segment keeps these fixtures
// from colliding with any other data, and the recompute is global so each test
// re-derives the whole benchmark before asserting on its own segment.
const RUN = `bench-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const SECTOR_A = `saas-${RUN}`;
const BAND_A = `series-b-${RUN}`;
const SECTOR_B = `infra-${RUN}`;
const BAND_B = `seed-${RUN}`;
const SEGMENT_A = segmentKeyFor(SECTOR_A, BAND_A)!.segmentKey;
const SEGMENT_B = segmentKeyFor(SECTOR_B, BAND_B)!.segmentKey;

const LAYER = "revenue";
const SIGNAL = "gross_margin_pct";

const log: BenchmarkLogger = { info() {}, error() {} };

const createdTenantIds: string[] = [];
const tenantsA: string[] = [];
const tenantsB: string[] = [];

// Seed one opted-in tenant in a segment, carrying a single encrypted scalar
// signal. The value is sealed under the tenant's own active key exactly as the
// real persistence path does, so the recompute exercises the genuine in-boundary
// machine decrypt, not a shortcut.
async function seedTenant(sector: string, band: string, value: number): Promise<string> {
  const inserted = await db
    .insert(tenantsTable)
    .values({
      name: `t-${RUN}-${createdTenantIds.length}`,
      url: `https://t-${RUN}-${createdTenantIds.length}.example.com`,
      sector,
      revenueBand: band,
      benchmarkOptIn: true,
    })
    .returning({ id: tenantsTable.id });
  const tenantId = inserted[0]!.id;
  createdTenantIds.push(tenantId);

  const { kmsKeyRef } = await ensureActiveTenantKey(tenantId);
  const envelope = await encryptSignalValue(value, kmsKeyRef);
  await db.insert(derivedSignalsTable).values({
    tenantId,
    layerKey: LAYER,
    signalKey: SIGNAL,
    value: envelope,
    window: null,
    sourceConnectorKey: "test-benchmark",
    provenanceRef: "test",
  });
  return tenantId;
}

async function setOptIn(tenantId: string, optIn: boolean): Promise<void> {
  await db.update(tenantsTable).set({ benchmarkOptIn: optIn }).where(eq(tenantsTable.id, tenantId));
}

async function statForSegmentA(): Promise<typeof benchmarkStatsTable.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(benchmarkStatsTable)
    .where(
      and(
        eq(benchmarkStatsTable.cohortSegmentKey, SEGMENT_A),
        eq(benchmarkStatsTable.layerKey, LAYER),
        eq(benchmarkStatsTable.signalKey, SIGNAL),
      ),
    );
  return rows[0];
}

async function cohortMemberCount(segmentKey: string): Promise<number | undefined> {
  const rows = await db
    .select({ memberCount: benchmarkCohortsTable.memberCount })
    .from(benchmarkCohortsTable)
    .where(eq(benchmarkCohortsTable.segmentKey, segmentKey));
  return rows[0]?.memberCount;
}

const baseDeps = {
  minCohort: 5,
  noiseBand: 5,
  authority: { userId: null, role: "system" },
  log,
};

beforeAll(async () => {
  // Six readable opted-in tenants in segment A with a clean distribution, and two
  // in the sub-k segment B.
  for (const v of [10, 20, 30, 40, 50, 60]) {
    tenantsA.push(await seedTenant(SECTOR_A, BAND_A, v));
  }
  for (const v of [15, 25]) {
    tenantsB.push(await seedTenant(SECTOR_B, BAND_B, v));
  }
});

afterAll(async () => {
  for (const id of createdTenantIds) {
    await db.delete(tenantsTable).where(eq(tenantsTable.id, id));
  }
  // Leave the global benchmark tables consistent for any later reader: a final
  // recompute supersedes our now-deleted fixtures out of the cohorts and stats.
  await runBenchmarkRecompute({ now: new Date(), ...baseDeps });
});

describe("runBenchmarkRecompute", () => {
  it("publishes a verified distribution at or above k and gives a sub-k cohort no stat", async () => {
    for (const id of tenantsA) await setOptIn(id, true);
    for (const id of tenantsB) await setOptIn(id, true);

    const outcome = await runBenchmarkRecompute({ now: new Date(), ...baseDeps });
    expect(outcome.skippedTenantCount).toBe(0);

    const stat = await statForSegmentA();
    expect(stat).toBeDefined();
    expect(stat!.sampleCount).toBe(6);
    expect(stat!.noised).toBe(false);
    // [10,20,30,40,50,60]: p25=22.5, p50=35, p75=47.5 (numeric returns a string).
    expect(Number(stat!.p25)).toBeCloseTo(22.5, 6);
    expect(Number(stat!.p50)).toBeCloseTo(35, 6);
    expect(Number(stat!.p75)).toBeCloseTo(47.5, 6);

    expect(await cohortMemberCount(SEGMENT_A)).toBe(6);

    // Segment B is a real cohort of two, but below k it gets no distribution.
    expect(await cohortMemberCount(SEGMENT_B)).toBe(2);
    const statsB = await db
      .select()
      .from(benchmarkStatsTable)
      .where(eq(benchmarkStatsTable.cohortSegmentKey, SEGMENT_B));
    expect(statsB).toHaveLength(0);
  });

  it("drops a metric below k when tenants opt out, and the consent change is logged", async () => {
    for (const id of tenantsA) await setOptIn(id, true);
    for (const id of tenantsB) await setOptIn(id, true);

    // Two of the six opt out; record the consent change as the routes will.
    const optedOut = [tenantsA[0]!, tenantsA[1]!];
    for (const id of optedOut) {
      await setOptIn(id, false);
      await db.insert(benchmarkConsentEventsTable).values({
        tenantId: id,
        action: "opt_out",
        authorityUserId: null,
        authorityRole: "tenant_admin",
        reason: "integration test opt-out",
      });
    }

    await runBenchmarkRecompute({ now: new Date(), ...baseDeps });

    expect(await statForSegmentA()).toBeUndefined(); // four contributors, below k
    expect(await cohortMemberCount(SEGMENT_A)).toBe(4);

    const consent = await db
      .select()
      .from(benchmarkConsentEventsTable)
      .where(eq(benchmarkConsentEventsTable.action, "opt_out"));
    const loggedFor = new Set(consent.map((c) => c.tenantId));
    for (const id of optedOut) expect(loggedFor.has(id)).toBe(true);
  });

  it("skips an unreadable tenant, counts it, and still publishes the rest", async () => {
    for (const id of tenantsA) await setOptIn(id, true);
    for (const id of tenantsB) await setOptIn(id, false);

    // Crypto-shred one contributor: its key is destroyed, so its signals can
    // never be read again. The recompute must skip it, not fail the whole run.
    await revokeTenantKey(tenantsA[5]!);

    const outcome = await runBenchmarkRecompute({ now: new Date(), ...baseDeps });
    expect(outcome.skippedTenantCount).toBeGreaterThanOrEqual(1);

    // Five readable contributors remain, so the distribution still publishes, and
    // the unreadable tenant is not a cohort member.
    const stat = await statForSegmentA();
    expect(stat).toBeDefined();
    expect(stat!.sampleCount).toBe(5);
    expect(await cohortMemberCount(SEGMENT_A)).toBe(5);
  });

  it("applies disclosed privacy noise to a small-but-eligible cohort", async () => {
    // minCohort 3, noiseBand 6: with five readable contributors the cohort is
    // eligible (>=3) but inside the noise band (<6), so it is published noised.
    for (const id of tenantsA) await setOptIn(id, true);
    for (const id of tenantsB) await setOptIn(id, false);

    const outcome = await runBenchmarkRecompute({
      now: new Date(),
      minCohort: 3,
      noiseBand: 6,
      authority: { userId: null, role: "system" },
      log,
      rng: () => 0.5, // centered: zero net jitter, but the noised flag still set
    });
    expect(outcome.statCount).toBeGreaterThanOrEqual(1);

    const stat = await statForSegmentA();
    expect(stat).toBeDefined();
    expect(stat!.noised).toBe(true);
  });

  it("never gives the cohort or stat tables a tenant reference", async () => {
    const columnsOf = async (table: string): Promise<string[]> => {
      const rows = await db.execute(
        sql`select column_name from information_schema.columns where table_name = ${table}`,
      );
      return (rows.rows as { column_name: string }[]).map((r) => r.column_name);
    };

    for (const table of ["benchmark_cohorts", "benchmark_stats"]) {
      const cols = await columnsOf(table);
      expect(cols.length).toBeGreaterThan(0);
      for (const col of cols) {
        expect(col.toLowerCase()).not.toContain("tenant");
      }
    }

    // And no row we ever wrote leaked a tenant id into a text column either.
    const leaked = await db
      .select({ n: sql<number>`count(*)` })
      .from(benchmarkCohortsTable)
      .where(like(benchmarkCohortsTable.segmentKey, `%${tenantsA[2]!}%`));
    expect(Number(leaked[0]!.n)).toBe(0);
  });
});
