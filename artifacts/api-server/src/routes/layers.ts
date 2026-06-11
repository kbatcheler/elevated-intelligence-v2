import { asc } from "drizzle-orm";
import { Router } from "express";
import { db, layersTable } from "@workspace/db";

export const layersRouter: Router = Router();

// The registry is the single source of truth for layer identity. The portal,
// pipeline and prompts all read it; nothing branches on a hardcoded layer list.
// This endpoint exposes the registry to the portal.
layersRouter.get("/layers", async (_req, res, next) => {
  try {
    const layers = await db
      .select({
        key: layersTable.key,
        name: layersTable.name,
        description: layersTable.description,
        archetype: layersTable.archetype,
        heroDescription: layersTable.heroDescription,
        diagnosticQuestion: layersTable.diagnosticQuestion,
        ownerPersona: layersTable.ownerPersona,
        metricDefinitions: layersTable.metricDefinitions,
        rootCauses: layersTable.rootCauses,
        actions: layersTable.actions,
        gaps: layersTable.gaps,
        feeds: layersTable.feeds,
        moduleGroup: layersTable.moduleGroup,
        sortOrder: layersTable.sortOrder,
      })
      .from(layersTable)
      .orderBy(asc(layersTable.sortOrder));

    res.json({ layers });
  } catch (err) {
    next(err);
  }
});
