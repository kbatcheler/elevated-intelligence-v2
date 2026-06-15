import { desc } from "drizzle-orm";
import { Router } from "express";
import { backupEventsTable, db } from "@workspace/db";
import { getArchiveStore } from "../lib/backups/archiveStore";
import { getBackupArchiveIntervalMs } from "../lib/backups/backupLoop";
import { exportLedgerArchive } from "../lib/backups/ledgerArchive";
import { logger } from "../lib/logger";
import { requireOwner } from "../middleware/auth";

// The backups and disaster recovery surface (Phase U). Archiving the provenance
// ledger and reading the backup audit are provider-owner concerns, so this is
// owner-only: requireAuth is applied at the /api/backups mount and requireOwner
// gates each route here, the same shape as spend and operations. Status never
// returns a credential or a bucket name, only the store provider keyword and the
// honest connection state.
export const backupsRouter: Router = Router();

// Trigger a ledger archive now. Honest about the outcome: an unchanged or empty
// ledger returns status "skipped" with the reason and writes no object and no
// audit row.
backupsRouter.post("/ledger-archive", requireOwner, async (req, res, next) => {
  try {
    const user = req.user!;
    const result = await exportLedgerArchive({
      now: new Date(),
      authority: { userId: user.id, role: user.role },
      log: logger,
    });
    logger.info(
      {
        status: result.status,
        objectKey: result.objectKey,
        entryCount: result.entryCount,
        chainVerified: result.chainVerified,
        authorityUserId: user.id,
      },
      "manual ledger archive",
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Read the backup audit history (owner only).
backupsRouter.get("/events", requireOwner, async (_req, res, next) => {
  try {
    const events = await db
      .select()
      .from(backupEventsTable)
      .orderBy(desc(backupEventsTable.createdAt));
    res.json({ events });
  } catch (err) {
    next(err);
  }
});

// Backup subsystem status: the store provider and connection state, the archive
// cadence, and the most recent archive event. No secret, no bucket, no path.
backupsRouter.get("/status", requireOwner, async (_req, res, next) => {
  try {
    const store = getArchiveStore().describe();
    const last = await db
      .select()
      .from(backupEventsTable)
      .orderBy(desc(backupEventsTable.createdAt))
      .limit(1);
    res.json({
      store,
      archiveIntervalMs: getBackupArchiveIntervalMs(),
      lastArchive: last[0] ?? null,
    });
  } catch (err) {
    next(err);
  }
});
