// sanitize:dashes
//
// One-off, idempotent remediation: normalize any long dash (em U+2014, en
// U+2013) that a model emitted into persisted tenant content, replacing it with
// ASCII per the long-dash ban. Generation now enforces this at the persist
// boundaries in the orchestrator (deepStripDashes on the tenant profile, the
// tenant_layers row, and the tenant_pipeline_runs sub-stage outputs), so freshly
// seeded rows are already clean; this script cleans rows that were seeded before
// that enforcement existed. Re-running it is a no-op.
//
//   pnpm --filter @workspace/api-server exec tsx src/scripts/sanitizeStoredDashes.ts

import { eq } from "drizzle-orm";
import {
  pool,
  db,
  tenantLayersTable,
  tenantPipelineRunsTable,
  pipelineJobsTable,
  tenantProfileTable,
  tenantsTable,
} from "@workspace/db";
import { deepStripDashes, stripDashes } from "@workspace/cortex";

const LONG_DASH = /[\u2013\u2014]/;

// True when the serialized value contains a long dash anywhere.
function hasDash(value: unknown): boolean {
  return LONG_DASH.test(JSON.stringify(value ?? null));
}

function cleanString(value: string | null): string | null {
  return value === null ? null : stripDashes(value);
}

async function main(): Promise<void> {
  let layerRows = 0;
  const layers = await db.select().from(tenantLayersTable);
  for (const row of layers) {
    const dirty =
      hasDash(row.content) ||
      hasDash(row.heroPanel) ||
      hasDash(row.peerBenchmark) ||
      hasDash(row.supplementBlocks) ||
      hasDash(row.confounders) ||
      hasDash(row.verifiedClaims) ||
      hasDash(row.modelledClaims);
    if (!dirty) continue;
    await db
      .update(tenantLayersTable)
      .set({
        content: deepStripDashes(row.content),
        heroPanel: deepStripDashes(row.heroPanel),
        peerBenchmark: deepStripDashes(row.peerBenchmark),
        supplementBlocks: deepStripDashes(row.supplementBlocks),
        confounders: deepStripDashes(row.confounders),
        verifiedClaims: deepStripDashes(row.verifiedClaims),
        modelledClaims: deepStripDashes(row.modelledClaims),
      })
      .where(eq(tenantLayersTable.id, row.id));
    layerRows += 1;
  }

  let runRows = 0;
  const runs = await db.select().from(tenantPipelineRunsTable);
  for (const row of runs) {
    if (!hasDash(row.subStages) && !hasDash(row.error)) continue;
    await db
      .update(tenantPipelineRunsTable)
      .set({ subStages: deepStripDashes(row.subStages), error: cleanString(row.error) })
      .where(eq(tenantPipelineRunsTable.id, row.id));
    runRows += 1;
  }

  let jobRows = 0;
  const jobs = await db.select().from(pipelineJobsTable);
  for (const row of jobs) {
    if (!hasDash(row.lastError)) continue;
    await db
      .update(pipelineJobsTable)
      .set({ lastError: cleanString(row.lastError) })
      .where(eq(pipelineJobsTable.id, row.id));
    jobRows += 1;
  }

  let profileRows = 0;
  const profiles = await db.select().from(tenantProfileTable);
  for (const row of profiles) {
    if (!hasDash(row.profile) && !hasDash(row.briefOverrides)) continue;
    await db
      .update(tenantProfileTable)
      .set({
        profile: deepStripDashes(row.profile),
        briefOverrides: deepStripDashes(row.briefOverrides),
      })
      .where(eq(tenantProfileTable.tenantId, row.tenantId));
    profileRows += 1;
  }

  let tenantRows = 0;
  const tenants = await db.select().from(tenantsTable);
  for (const t of tenants) {
    const fields = [t.name, t.sector, t.hqCity, t.hqState, t.revenueBand, t.ownership, t.tagline];
    if (!fields.some((f) => f !== null && LONG_DASH.test(f))) continue;
    await db
      .update(tenantsTable)
      .set({
        name: stripDashes(t.name),
        sector: cleanString(t.sector),
        hqCity: cleanString(t.hqCity),
        hqState: cleanString(t.hqState),
        revenueBand: cleanString(t.revenueBand),
        ownership: cleanString(t.ownership),
        tagline: cleanString(t.tagline),
      })
      .where(eq(tenantsTable.id, t.id));
    tenantRows += 1;
  }

  console.log(
    `sanitize:dashes: updated ${layerRows} layer row(s), ${runRows} run row(s), ${jobRows} job row(s), ${profileRows} profile row(s), ${tenantRows} tenant row(s).`,
  );
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    return pool.end().finally(() => process.exit(1));
  });
