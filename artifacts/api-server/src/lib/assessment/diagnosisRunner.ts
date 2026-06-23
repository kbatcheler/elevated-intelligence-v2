// The optional outside_in diagnosis for the Intelligence Gap Assessment
// (Phase AT), Approach B: it NEVER creates a tenant. It reuses the pure cortex
// primitives directly - fetchHomepageContext (SSRF-hardened) then runProfile -
// records any billed model usage with tenantId=null, and stores only a narrow
// profile projection plus honest fetch metadata, never raw HTML or a model
// snippet. It is fired only AFTER contact capture (friction before spend), is
// bounded by assertSeedWithinBudget, and degrades gracefully: a thin or
// unreachable public footprint resolves to "unavailable" WITHOUT any model call,
// so the cost ceiling is the single profile call at most.

import { eq } from "drizzle-orm";
import {
  assessmentSubmissionsTable,
  db,
  type AssessmentDiagnosisSnapshot,
  type AssessmentDiagnosisStatus,
} from "@workspace/db";
import { fetchHomepageContext, runProfile, stripDashes, type Logger } from "@workspace/cortex";
import { logger } from "../logger";
import { assertSeedWithinBudget, BudgetExceededError } from "../pipeline/budget";
import { recordModelUsageSafe } from "../pipeline/usage";

// Best-effort cleaned domain for the pre-fetch degrade paths, where no
// HomepageContext exists yet. ASCII only.
function domainOf(rawUrl: string): string {
  return (
    rawUrl
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split("/")[0]
      ?.toLowerCase() ?? ""
  );
}

async function setStatus(submissionId: string, status: AssessmentDiagnosisStatus): Promise<void> {
  await db
    .update(assessmentSubmissionsTable)
    .set({ diagnosisStatus: status })
    .where(eq(assessmentSubmissionsTable.id, submissionId));
}

async function setSnapshot(
  submissionId: string,
  status: AssessmentDiagnosisStatus,
  snapshot: AssessmentDiagnosisSnapshot,
): Promise<void> {
  await db
    .update(assessmentSubmissionsTable)
    .set({ diagnosisStatus: status, diagnosis: snapshot })
    .where(eq(assessmentSubmissionsTable.id, submissionId));
}

// Run the bounded diagnosis for one submission. Never throws to its caller (it
// is void-fired from the contact route); any unexpected error lands the status
// on failed. The status transitions are the honest record: pending (set by the
// route) -> in_progress -> ready | unavailable | failed.
export async function runAssessmentDiagnosis(
  submissionId: string,
  rawUrl: string,
  log: Logger = logger,
): Promise<void> {
  const requestedAt = new Date().toISOString();
  try {
    // Budget gate BEFORE any spend. A ceiling degrades to unavailable with no
    // model call, so the assessment funnel can never blow the global budget.
    try {
      await assertSeedWithinBudget({ tenantId: null, log });
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        await setSnapshot(submissionId, "unavailable", {
          requestedAt,
          completedAt: new Date().toISOString(),
          url: rawUrl,
          domain: domainOf(rawUrl),
          finalUrl: rawUrl,
          homepage: { ok: false, status: 0, bytesFetched: 0, bytesExtracted: 0, durationMs: 0 },
          profile: null,
          provenance: "unavailable",
          telemetry: null,
        });
        log.info({ submissionId }, "assessment diagnosis skipped: budget ceiling");
        return;
      }
      throw err;
    }

    await setStatus(submissionId, "in_progress");

    const ctx = await fetchHomepageContext(rawUrl, log);
    const homepage = {
      ok: ctx.ok,
      status: ctx.status,
      bytesFetched: ctx.bytesFetched,
      bytesExtracted: ctx.bytesExtracted,
      durationMs: ctx.durationMs,
    };

    // A failed or empty public footprint degrades to the self assessment alone,
    // WITHOUT a model call: this is the cost bound and the honesty boundary.
    if (!ctx.ok) {
      await setSnapshot(submissionId, "unavailable", {
        requestedAt,
        completedAt: new Date().toISOString(),
        url: rawUrl,
        domain: ctx.domain,
        finalUrl: ctx.finalUrl,
        homepage,
        profile: null,
        provenance: "unavailable",
        telemetry: null,
      });
      log.info(
        { submissionId, domain: ctx.domain },
        "assessment diagnosis unavailable: homepage fetch failed",
      );
      return;
    }

    const res = await runProfile(rawUrl, ctx, log);
    const t = res.telemetry;
    // Record usage with no tenant identity. recordModelUsageSafe writes a row
    // ONLY when the call was actually billed; a no-call failure is never costed.
    await recordModelUsageSafe(
      {
        tenantId: null,
        runId: null,
        stage: "profile",
        layerKey: null,
        telemetry: {
          seat: t.seat,
          model: t.model,
          inputTokens: t.inputTokens,
          outputTokens: t.outputTokens,
          billed: t.billed,
        },
      },
      log,
    );
    const telemetry = {
      model: t.billed ? t.model : null,
      inputTokens: t.inputTokens ?? 0,
      outputTokens: t.outputTokens ?? 0,
      billed: t.billed ?? false,
    };

    if (!res.ok) {
      await setSnapshot(submissionId, "failed", {
        requestedAt,
        completedAt: new Date().toISOString(),
        url: rawUrl,
        domain: ctx.domain,
        finalUrl: ctx.finalUrl,
        homepage,
        profile: null,
        provenance: "unavailable",
        telemetry,
      });
      log.warn(
        { submissionId, reason: res.reason },
        "assessment diagnosis failed: profile did not validate",
      );
      return;
    }

    const out = res.output;
    // stripDashes every model-generated field before it is persisted: the model
    // can emit an en or em dash, and the database-wide long-dash sweep must read
    // zero. The narrative and cost copy are hardcoded ASCII and need no stripping.
    await setSnapshot(submissionId, "ready", {
      requestedAt,
      completedAt: new Date().toISOString(),
      url: rawUrl,
      domain: ctx.domain,
      finalUrl: ctx.finalUrl,
      homepage,
      profile: {
        name: stripDashes(out.name),
        sector: out.sector ? stripDashes(out.sector) : null,
        tagline: out.tagline ? stripDashes(out.tagline) : null,
        url: out.url ? stripDashes(out.url) : ctx.finalUrl,
      },
      provenance: "verified",
      telemetry,
    });
    log.info({ submissionId, domain: ctx.domain }, "assessment diagnosis ready");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.error({ submissionId, reason }, "assessment diagnosis crashed");
    try {
      await setStatus(submissionId, "failed");
    } catch {
      // swallow: the loop must never crash the process on a status write failure
    }
  }
}
