import { Router, type Request, type Response, type NextFunction } from "express";
import { and, eq } from "drizzle-orm";
import {
  assessmentSubmissionsTable,
  db,
  type AssessmentDimensionScores,
} from "@workspace/db";
import { stripDashes } from "@workspace/cortex";
import { createRateLimiter } from "../middleware/rateLimit";
import { logger } from "../lib/logger";
import {
  publicQuestionBank,
  validateAnswers,
  validateQualification,
} from "../lib/assessment/questions";
import { computeScores } from "../lib/assessment/scoring";
import { assembleReport, assembleResult } from "../lib/assessment/report";
import { mintAssessmentToken, resolveAssessmentToken } from "../lib/assessment/shareTokens";
import { sendAssessmentReportEmail } from "../lib/assessment/email";
import { runAssessmentDiagnosis } from "../lib/assessment/diagnosisRunner";

// The Intelligence Gap Assessment public funnel (Phase AT). Unauthenticated and
// top-of-funnel: a cold prospect answers ten scored questions plus three
// qualification questions, sees a free on-screen result, and only when they want
// the forwardable report do they leave a contact. The optional outside_in
// diagnosis is triggered ONLY at contact (friction before spend) and is bounded
// by a strict per-IP limit on that endpoint, by the budget governor, and by the
// degrade-on-thin-footprint runner. Every endpoint is per-IP rate limited; the
// contact endpoint, the only one that can cost a model call, is the tightest.
export const assessmentRouter: Router = Router();

const ipKey = (req: Request): string => req.ip ?? "unknown";

// The catalogue read is cheap and cacheable; a generous limit.
const questionsLimit = createRateLimiter({
  name: "assessment-questions",
  windowMs: 60_000,
  max: 60,
  keyFn: ipKey,
});

// Submitting answers is pure compute and a single insert; moderate.
const submitLimit = createRateLimiter({
  name: "assessment-submit",
  windowMs: 60_000,
  max: 20,
  keyFn: ipKey,
});

// The contact endpoint is the only one that can trigger a billed model call, so
// it is the tightest: a handful per minute per IP. This is the strict per-IP
// limit on the diagnosis, stacked on top of the budget governor.
const contactLimit = createRateLimiter({
  name: "assessment-contact",
  windowMs: 60_000,
  max: 5,
  keyFn: ipKey,
});

// A forwarded report is opened a handful of times by a human and hammered by a
// scraper; tight, mirroring the public diagnosis limit.
const reportLimit = createRateLimiter({
  name: "assessment-report",
  windowMs: 60_000,
  max: 30,
  keyFn: ipKey,
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Normalise every persisted public string at the write boundary: trim, and
// stripDashes any en or em dash a prospect typed (or an autocorrect inserted)
// down to an ASCII hyphen, so the database-wide long-dash sweep reads zero. This
// mirrors the model-field cleaning in the diagnosis runner: a public input is no
// more trusted than a model output.
function cleanString(raw: unknown, maxLen: number): string | null {
  if (typeof raw !== "string") return null;
  const t = stripDashes(raw).trim();
  if (t === "" || t.length > maxLen) return null;
  return t;
}

// The public question bank, with option scores withheld so the prospect answers
// honestly about behaviour rather than against a visible weighting.
assessmentRouter.get("/questions", questionsLimit, (_req: Request, res: Response) => {
  res.json({ questions: publicQuestionBank() });
});

// Score a submission and return the FREE on-screen result. The scores are
// computed deterministically, persisted for render stability, and the result is
// returned in full with no contact required. An optional company url is stored
// but no diagnosis runs until the prospect chooses to leave a contact.
assessmentRouter.post(
  "/submit",
  submitLimit,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const answers = validateAnswers(body.answers);
      if (!answers.ok) {
        res.status(400).json({ error: "invalid_answers", detail: answers.error });
        return;
      }
      const qualification = validateQualification(body.qualification);
      if (!qualification.ok) {
        res.status(400).json({ error: "invalid_qualification", detail: qualification.error });
        return;
      }
      const companyUrl = cleanString(body.companyUrl, 300);

      const scores = computeScores(answers.value);
      const dimensionScores: AssessmentDimensionScores = {
        dimensions: scores.dimensions.map((d) => ({ key: d.key, score: d.score, band: d.band })),
        overall: scores.overall,
      };

      const [row] = await db
        .insert(assessmentSubmissionsTable)
        .values({
          answers: answers.value,
          dimensionScores,
          qualification: qualification.value,
          companyUrl,
        })
        .returning({ id: assessmentSubmissionsTable.id });

      const result = await assembleResult({
        answers: answers.value,
        qualification: qualification.value,
      });

      res.json({ submissionId: row!.id, result });
    } catch (err) {
      next(err);
    }
  },
);

// Capture a contact to unlock the forwardable report, mint a share link, attempt
// a best-effort email, and (once only, when a company url was supplied) trigger
// the bounded outside_in diagnosis. The link is ALWAYS returned regardless of
// the email outcome; the diagnosis runs fire-and-forget so the response is fast.
assessmentRouter.post(
  "/submissions/:id/contact",
  contactLimit,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = String(req.params.id);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const email = cleanString(body.email, 254);
      if (!email || !EMAIL_RE.test(email)) {
        res.status(400).json({ error: "invalid_email" });
        return;
      }
      const name = cleanString(body.name, 120);
      const company = cleanString(body.company, 200);

      const existing = await db
        .select({
          id: assessmentSubmissionsTable.id,
          companyUrl: assessmentSubmissionsTable.companyUrl,
        })
        .from(assessmentSubmissionsTable)
        .where(eq(assessmentSubmissionsTable.id, id))
        .limit(1);
      const submission = existing[0];
      if (!submission) {
        res.status(404).json({ error: "not_found" });
        return;
      }

      // Capture the contact. Idempotent under a duplicate post: it only rewrites
      // the same contact fields and never touches the diagnosis status.
      await db
        .update(assessmentSubmissionsTable)
        .set({
          contactName: name,
          contactEmail: email,
          contactCompany: company,
          contactCapturedAt: new Date(),
        })
        .where(eq(assessmentSubmissionsTable.id, id));

      // Trigger the diagnosis at most once, race-safe. The conditional update is
      // the atomic claim: only the writer that flips not_requested to pending wins
      // a row back and spawns the bounded runner, so two concurrent contact posts
      // can never both start a (billable) profile call. companyUrl is immutable
      // after submit, so reading it from the row above is safe.
      let willDiagnose = false;
      if (submission.companyUrl != null) {
        const claimed = await db
          .update(assessmentSubmissionsTable)
          .set({ diagnosisStatus: "pending" as const })
          .where(
            and(
              eq(assessmentSubmissionsTable.id, id),
              eq(assessmentSubmissionsTable.diagnosisStatus, "not_requested"),
            ),
          )
          .returning({ id: assessmentSubmissionsTable.id });
        willDiagnose = claimed.length > 0;
      }

      const minted = await mintAssessmentToken({ submissionId: id });
      const reportUrl = `${req.protocol}://${req.get("host") ?? ""}${minted.reportPath}`;

      if (willDiagnose && submission.companyUrl) {
        const url = submission.companyUrl;
        void runAssessmentDiagnosis(id, url, logger).catch((err: unknown) => {
          logger.error(
            { submissionId: id, err: err instanceof Error ? err.message : String(err) },
            "assessment diagnosis fire-and-forget failed",
          );
        });
      }

      const email_status = (
        await sendAssessmentReportEmail({ to: email, name, reportUrl }, logger)
      ).status;

      res.json({
        reportPath: minted.reportPath,
        reportUrl,
        expiresAt: minted.expiresAt,
        emailStatus: email_status,
        diagnosisRequested: willDiagnose,
      });
    } catch (err) {
      next(err);
    }
  },
);

// Resolve a forwardable token to its full report. The diagnosis is read honestly
// from its status, so an in-progress, unavailable or failed taste reads as such
// rather than as a fabricated result. A non-match (expired, revoked or unknown)
// is a uniform 404.
assessmentRouter.get(
  "/report/:token",
  reportLimit,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const resolved = await resolveAssessmentToken(String(req.params.token));
      if (!resolved) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const rows = await db
        .select()
        .from(assessmentSubmissionsTable)
        .where(eq(assessmentSubmissionsTable.id, resolved.submissionId))
        .limit(1);
      const row = rows[0];
      if (!row) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const report = await assembleReport(row);
      res.json({ report });
    } catch (err) {
      next(err);
    }
  },
);
