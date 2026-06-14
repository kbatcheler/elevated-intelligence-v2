import type { UserRole } from "@workspace/db";
import { db, invitePinsTable } from "@workspace/db";
import { generatePinCode, hashPinCode } from "./pin";
import { requireSecret } from "../secrets/secretStore";

// The single audited path that mints an invite PIN. Both the owner Access console
// and the client-admin onboarding surface mint through here, so the collision
// retry, the keyed-hash storage and the "plaintext returned exactly once"
// contract live in one place and cannot drift apart. The CALLER owns scope
// authorization; this helper trusts the scope it is handed.

export interface MintInvitePinInput {
  label: string | null;
  maxUses: number;
  expiresInDays: number;
  scopeOrgId: string | null;
  scopeRole: UserRole | null;
  createdBy: string;
}

export interface MintedInvitePin {
  id: string;
  code: string;
  label: string | null;
  maxUses: number;
  useCount: number;
  expiresAt: Date;
  scopeOrgId: string | null;
  scopeRole: UserRole | null;
  createdAt: Date;
}

export async function mintInvitePin(input: MintInvitePinInput): Promise<MintedInvitePin> {
  const secret = await requireSecret("SESSION_SECRET");
  const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);

  // codeHash is unique. A collision is astronomically unlikely, but retry a few
  // times rather than surfacing a 500 in that one-in-many-lifetimes case.
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generatePinCode();
    const codeHash = hashPinCode(code, secret);
    try {
      const inserted = await db
        .insert(invitePinsTable)
        .values({
          codeHash,
          label: input.label,
          maxUses: input.maxUses,
          expiresAt,
          createdBy: input.createdBy,
          scopeOrgId: input.scopeOrgId,
          scopeRole: input.scopeRole,
        })
        .returning();
      const pin = inserted[0]!;
      return {
        id: pin.id,
        code, // shown once, never stored or returned again
        label: pin.label,
        maxUses: pin.maxUses,
        useCount: pin.useCount,
        expiresAt: pin.expiresAt,
        scopeOrgId: pin.scopeOrgId,
        scopeRole: pin.scopeRole,
        createdAt: pin.createdAt,
      };
    } catch (err) {
      const code23505 =
        (err as { code?: string })?.code === "23505" ||
        (err as { cause?: { code?: string } })?.cause?.code === "23505";
      if (!code23505) throw err;
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("failed to mint a unique PIN");
}
