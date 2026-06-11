import { Router } from "express";
import { LAYER_STAGES, SEATS, STAGE_CONFIG } from "@workspace/cortex";

export const architectureRouter: Router = Router();

// The intelligence architecture: the fixed three-seat, nine-stage shape of the
// cortex. This is engine configuration, identical for every tenant, so it is
// deliberately not tenant-scoped. Model identifier strings live ONLY in the
// cortex config; exposing them here keeps the portal free of any hardcoded model
// string and free of a cortex dependency. The Intelligence Architecture page
// renders this alongside the per-tenant run telemetry from /tenants/:id/runs.
architectureRouter.get("/architecture", (_req, res) => {
  const stages = LAYER_STAGES.map((name) => {
    const cfg = STAGE_CONFIG[name];
    const seat = SEATS[cfg.seat];
    return {
      name,
      seat: cfg.seat,
      role: cfg.role,
      provider: seat.provider,
      model: seat.model,
      webSearch: cfg.webSearch ?? false,
      grounding: cfg.grounding ?? false,
    };
  });
  res.json({ seats: SEATS, stages });
});
