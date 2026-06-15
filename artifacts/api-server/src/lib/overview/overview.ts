import { and, asc, eq } from "drizzle-orm";
import { db, layersTable, tenantLayersTable } from "@workspace/db";
import { buildOverviewItem, type OverviewItem, type OverviewRow } from "./overviewProjection";

// The single overview query (Phase AB extraction). It left-joins the layer
// registry to this tenant's generated content so every registered layer appears,
// generated or not, in registry sort order, and projects each joined row through
// the pure buildOverviewItem. The authed /overview route and the public
// shareable diagnosis both call this, so neither can select a different column
// set or null a field differently from the other.
export async function loadTenantOverview(tenantId: string): Promise<OverviewItem[]> {
  const rows = await db
    .select({
      key: layersTable.key,
      name: layersTable.name,
      archetype: layersTable.archetype,
      ownerPersona: layersTable.ownerPersona,
      moduleGroup: layersTable.moduleGroup,
      sortOrder: layersTable.sortOrder,
      diagnosticQuestion: layersTable.diagnosticQuestion,
      feeds: layersTable.feeds,
      content: tenantLayersTable.content,
      heroPanel: tenantLayersTable.heroPanel,
      voiceQuality: tenantLayersTable.voiceQuality,
      generatedAt: tenantLayersTable.generatedAt,
      generatorModel: tenantLayersTable.generatorModel,
    })
    .from(layersTable)
    .leftJoin(
      tenantLayersTable,
      and(
        eq(tenantLayersTable.layerKey, layersTable.key),
        eq(tenantLayersTable.tenantId, tenantId),
      ),
    )
    .orderBy(asc(layersTable.sortOrder));

  return (rows as OverviewRow[]).map(buildOverviewItem);
}
