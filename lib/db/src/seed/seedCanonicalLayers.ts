import { sql } from "drizzle-orm";
import { db, pool } from "../index";
import { layersTable } from "../schema/layers";
import { CANONICAL_LAYERS } from "./canonicalLayers";

// Idempotent upsert of the 14 canonical layers into the registry. Run with
// `pnpm --filter @workspace/db run seed:layers`. Re-running refreshes content
// without creating duplicates, since key is the primary key.
export async function seedCanonicalLayers(): Promise<number> {
  for (const layer of CANONICAL_LAYERS) {
    await db
      .insert(layersTable)
      .values(layer)
      .onConflictDoUpdate({
        target: layersTable.key,
        set: {
          name: layer.name,
          description: layer.description,
          archetype: layer.archetype,
          heroDescription: layer.heroDescription,
          ownerPersona: layer.ownerPersona,
          diagnosticQuestion: layer.diagnosticQuestion,
          metricDefinitions: layer.metricDefinitions,
          rootCauses: layer.rootCauses,
          actions: layer.actions,
          gaps: layer.gaps,
          feeds: layer.feeds,
          moduleGroup: layer.moduleGroup,
          isCanonical: layer.isCanonical,
          sortOrder: layer.sortOrder,
          updatedAt: new Date(),
        },
      });
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(layersTable);
  return count;
}

async function main(): Promise<void> {
  const count = await seedCanonicalLayers();
  console.log("Canonical layers seeded. Registry now holds " + count + " layers.");
  await pool.end();
}

const invokedDirectly = process.argv[1]?.includes("seedCanonicalLayers");
if (invokedDirectly) {
  main().catch((err) => {
    console.error("Seeding canonical layers failed:", err);
    process.exit(1);
  });
}
