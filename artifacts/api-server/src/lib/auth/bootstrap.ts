import { eq } from "drizzle-orm";
import { db, orgsTable, usersTable } from "@workspace/db";
import { logger } from "../logger";
import { getSecretStore } from "../secrets/secretStore";
import { hashPassword } from "./password";

// Guarantee there is always exactly one way in. On boot, if no provider-owner
// exists and both OWNER_EMAIL and OWNER_PASSWORD are configured, create the
// provider org and its owner. This is idempotent and non-destructive: if an
// owner already exists, or a user already holds the email, it does nothing and
// never overwrites. A missing secret is logged and tolerated rather than
// crashing the server, matching the lazy throw-if-missing contract. The
// password is never logged.
export async function ensureProviderOrgAndOwner(): Promise<void> {
  const existingOwner = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.role, "provider-owner"))
    .limit(1);
  if (existingOwner.length > 0) return;

  const store = getSecretStore();
  const email = ((await store.get("OWNER_EMAIL")) ?? "").trim().toLowerCase();
  const password = (await store.get("OWNER_PASSWORD")) ?? "";
  if (!email || !password) {
    logger.warn(
      {},
      "owner bootstrap skipped: set OWNER_EMAIL and OWNER_PASSWORD to create the first owner",
    );
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
