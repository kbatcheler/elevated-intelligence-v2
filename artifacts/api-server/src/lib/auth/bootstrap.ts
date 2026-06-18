import { eq } from "drizzle-orm";
import { db, orgsTable, usersTable } from "@workspace/db";
import { logger } from "../logger";
import { getSecretStore } from "../secrets/secretStore";
import { hashPassword, verifyPassword } from "./password";

// Guarantee the configured owner can always log in. On boot, if OWNER_EMAIL and
// OWNER_PASSWORD are set, reconcile the owner that those secrets describe: create
// it (and the provider org) when no user holds the email, or repair an existing
// row whose role, status, or password has drifted from the configured secret.
// This is what makes a freshly provisioned production database self-heal: the
// publish flow copies pre-existing rows (an owner with an older password hash)
// but does not re-copy a later development password reset, so the deployed owner
// would otherwise be locked out. Only the user matching OWNER_EMAIL is ever
// touched; other owners are never modified, and nothing is written when the row
// already matches. A missing secret is logged and tolerated rather than crashing
// the server, matching the lazy throw-if-missing contract. The password is never
// logged.
export async function ensureProviderOrgAndOwner(): Promise<void> {
  const store = getSecretStore();
  const email = ((await store.get("OWNER_EMAIL")) ?? "").trim().toLowerCase();
  const password = (await store.get("OWNER_PASSWORD")) ?? "";
  if (!email || !password) {
    logger.warn(
      {},
      "owner bootstrap skipped: set OWNER_EMAIL and OWNER_PASSWORD to provision the owner",
    );
    return;
  }

  const existing = (
    await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1)
  )[0];

  if (existing) {
    const updates: Partial<typeof usersTable.$inferInsert> = {};
    if (existing.role !== "provider-owner") updates.role = "provider-owner";
    if (existing.status !== "active") updates.status = "active";
    const passwordMatches = await verifyPassword(password, existing.passwordHash);
    if (!passwordMatches) updates.passwordHash = await hashPassword(password);

    if (Object.keys(updates).length > 0) {
      await db.update(usersTable).set(updates).where(eq(usersTable.id, existing.id));
      logger.info({ email }, "owner bootstrap reconciled the provider owner");
    }
    return;
  }

  let providerOrg = (
    await db.select().from(orgsTable).where(eq(orgsTable.type, "provider")).limit(1)
  )[0];
  if (!providerOrg) {
    providerOrg = (
      await db.insert(orgsTable).values({ name: "Different Day", type: "provider" }).returning()
    )[0];
  }

  const passwordHash = await hashPassword(password);
  const inserted = await db
    .insert(usersTable)
    .values({
      email,
      displayName: "Owner",
      passwordHash,
      role: "provider-owner",
      status: "active",
      orgId: providerOrg.id,
    })
    .onConflictDoNothing({ target: usersTable.email })
    .returning({ id: usersTable.id });

  if (inserted.length === 0) {
    logger.warn({ email }, "owner bootstrap skipped: a user already holds OWNER_EMAIL");
    return;
  }
  logger.info({ email }, "owner bootstrap created the provider owner");
}
