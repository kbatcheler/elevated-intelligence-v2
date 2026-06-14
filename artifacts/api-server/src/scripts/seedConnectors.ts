import { sql } from "drizzle-orm";
import { CATALOGUE } from "@workspace/connectors";
import { connectorsTable, db, pool } from "@workspace/db";

// Idempotent upsert of the full connector catalogue from the registry into the
// connectors table. Run with `pnpm --filter @workspace/api-server run
// seed:connectors`. The registry in lib/connectors is the single source of
// truth; this projects its declared surface (key, name, family, layers, auth
// method, deployment, declared signals, status) into the table the portal reads.
// No tenant connections and no outputs are created here, only the catalogue.
// Re-running refreshes content without duplicates, since key is the primary key.
export async function seedConnectors(): Promise<number> {
  for (const connector of CATALOGUE) {
    const row = {
      name: connector.name,
      family: connector.family,
      layers: connector.layers,
      authMethod: connector.authMethod,
      deployment: connector.deployment,
      signalsProduced: connector.signalsProduced,
      status: connector.status,
    };
    await db
      .insert(connectorsTable)
      .values({ key: connector.key, ...row })
      .onConflictDoUpdate({ target: connectorsTable.key, set: row });
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(connectorsTable);
  return count;
}

async function main(): Promise<void> {
  const count = await seedConnectors();
  console.log("Connector catalogue seeded. Table now holds " + count + " connectors.");
  await pool.end();
}

const invokedDirectly = process.argv[1]?.includes("seedConnectors");
if (invokedDirectly) {
  main().catch((err) => {
    console.error("Seeding connector catalogue failed:", err);
    process.exit(1);
  });
}
