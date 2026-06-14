import { eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { db, edgeAgentsTable } from "@workspace/db";
import {
  parseAgentToken,
  spendDummyVerify,
  verifyAgentSecret,
} from "../lib/agent/agentCredential";

// The in-client agent identity attached to a request once requireAgent has run.
// It is always loaded fresh from edge_agents, so revoking an agent takes effect
// on its very next call.
export interface AuthedAgent {
  id: string;
  tenantId: string;
  label: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      agent?: AuthedAgent;
    }
  }
}

// Gate the agent surface on the per-tenant agent credential, and only that. The
// credential is a bearer token the in-client agent holds; it is the sole proof
// of identity here. We deliberately never read any proxy-injected client
// certificate header (X-SSL-Client-Cert, X-Client-Verify, and the like): an
// upstream hop can forge those, so trusting them would let anything that reaches
// the proxy impersonate any tenant's agent. mTLS is terminated and verified by
// the proxy in front of this server; this layer's trust root is the credential,
// checked against the stored scrypt hash.
export async function requireAgent(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = parseAgentToken(req.headers.authorization);
    if (!parsed) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const rows = await db
      .select()
      .from(edgeAgentsTable)
      .where(eq(edgeAgentsTable.id, parsed.agentId))
      .limit(1);
    const agent = rows[0];
    if (!agent || agent.status !== "active") {
      // Spend the same scrypt time on the miss path so timing does not leak
      // whether the agent id exists or is merely revoked.
      await spendDummyVerify(parsed.secret);
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const ok = await verifyAgentSecret(parsed.secret, agent.tokenHash);
    if (!ok) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    await db
      .update(edgeAgentsTable)
      .set({ lastSeenAt: new Date() })
      .where(eq(edgeAgentsTable.id, agent.id));
    req.agent = { id: agent.id, tenantId: agent.tenantId, label: agent.label };
    next();
  } catch (err) {
    next(err);
  }
}
