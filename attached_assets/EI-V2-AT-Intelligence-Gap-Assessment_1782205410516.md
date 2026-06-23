# Phase AT: The Intelligence Gap Assessment (top of funnel self qualification)

## Objective

Elevated Intelligence is hard to take in, and the product does not yet sell its
own value to a cold prospect. This phase builds the top of funnel instrument that
fixes that. It is a short self assessment that makes a prospect realise, by their
own honest answers, that they are flying blind in ways Elevated Intelligence
closes, and it leads them onto a slick, forwardable report that names the gap,
translates it into the specific EI layers that fix it, and teaches the one idea
they currently cannot grasp. The assessment qualifies the client to themselves,
and quietly qualifies them for Different Day at the same time.

It runs after the AS signature wave has landed, so it consumes the design system,
the provenance primitives, and the share token pattern that already exist rather
than building any of them again.

## Ownership boundary

This phase owns new files only, plus two explicitly scoped additive
registrations:

- `lib/db/src/schema/` new tables for the assessment (responses, scores, captured
  contact, optional diagnosis reference). New files.
- `artifacts/api-server/src/lib/assessment/**` the scoring and report assembly,
  and `artifacts/api-server/src/routes/assessment.ts` the public route. New files.
  The single shared edit is one route registration line in the API app entry,
  same discipline as the AQ nav line.
- `artifacts/portal/src/components/pages/` new public pages for the assessment
  flow and the report, with their API client. The single shared portal edit is an
  additive public route branch in the portal root, beside the existing `/d/:token`
  branch, reached before the auth provider exactly as the public diagnosis is.

It does not modify the cortex, the connectors, the design tokens, the shell, or
any existing page. Scoring is deterministic and model free, so this phase makes no
cortex change. The only model work it touches is the OPTIONAL outside_in diagnosis,
which it reaches through the existing public pipeline, never a rebuild.

## Invariants (restated)

Zero new npm dependencies. The downloadable report is a print optimised stylesheet
on the web report, so the browser produces a clean board ready PDF with no PDF
library added; if the workspace already carries a generator it may be used, but the
print styled web report is the zero dependency default. Email sending goes through
the existing notifier seam in available, not connected style: the contact is
captured and the share link is shown on screen immediately, and an email is sent
only when an email provider is connected, never a broken promise. ASCII hyphen only
in source and copy. Never fabricate a figure: the report is built from the
prospect's own answers and from real diagnosis output, and any cost framing is
qualitative or derived from their own stated inputs, never an invented number. All
copy is plain professional British English, no Oxford commas, no Americanisms, no
emoji. Full suite green and long dash sweep zero before close.

## The assessment design

The mechanism is the gap. Every question is a small mirror. The questions ask
about concrete behaviour and timing, never opinion, so the honest answer is
slightly uncomfortable and the discomfort is the realisation. Hold the scored set
to about ten questions.

Four scoring dimensions, because these are the four things EI improves and they
map onto the provenance brand:

- Visibility. Do they even have the signal.
- Speed. How fast they know once it exists.
- Foresight. Do they see it coming or only react.
- Confidence. Do they trust their numbers and know what is verified versus guessed.

Each scored question targets one dimension and is tagged to one or more of the
fourteen canonical layers, so a weak answer can be translated into the specific
layers that close it. Answer options run from flying blind to ahead of it, each
mapped to a dimension score. For example, a foresight question on customer risk
offers "we find out after they have left", "when the renewal comes up", and "we
see the signal weeks ahead"; a confidence question on reporting offers "we trust
the headline number", "we know roughly", and "we know exactly what is measured
versus modelled".

Two or three further questions are qualification, not gap: sector, revenue band,
and the core systems they run. These do not score the gap. They route and qualify
the lead for Different Day and they let the report name the prospect's likely
systems when it maps gaps to layers.

The scoring is honest by design. A genuinely sharp operation scores well, because
an instrument that fails everyone reads as manipulative and a savvy buyer sees
through it at once. The prospects with real gaps feel them precisely because the
ones who deserve to pass do pass. For a strong scorer the report flips its message:
you are ahead, EI institutionalises that edge and scales it past the few people who
currently hold it in their heads.

## The report

The report is the payoff and it does three jobs: it names the gap, it translates
the gap into the EI layers that close it, and it teaches the layer idea. Build it
from the AS primitives, honestly, with the four data states.

1. The shape. The four dimension profile drawn from their own scores, so the
   asymmetry is visible. Most operations read decent on visibility and poor on
   foresight and confidence, and seeing that shape is the moment they understand
   what is missing. The profile is computed from their answers, never rigged.
2. The gap narrative. A deterministic, templated read of where they are blind,
   written in the analyst voice. No model call, so it is instant and free and
   cannot fabricate.
3. Gap to layers. Their weak dimensions and answers mapped to the specific
   canonical layers that address them, named against their likely systems. This is
   the qualification made concrete: it tells them, and you, exactly where the value
   is.
4. The one line. Your software records what happened, Elevated Intelligence tells
   you what it means and what to do. One sentence, one quiet visual, so they leave
   knowing what EI is.
5. The cost framing. Qualitative, or derived from their own stated revenue band and
   answers, never an invented precise figure. The honesty is the selling point.
6. The optional taste. If the prospect supplies a company URL, the report folds in
   a small real outside_in diagnosis beside their self scored gaps, with verified
   and modelled provenance marked, so reflection and proof sit on the same page.
   This is rate limited and cost bounded, and degrades gracefully to the self
   assessment alone when the public footprint is thin.
7. The close. A single quiet call to talk to Different Day, a share token so the
   report is forwardable by link, a print stylesheet so it downloads board ready,
   and the contact capture that unlocks the downloadable and forwardable artefact.
   The on screen result is shown free the instant they finish; the email sits only
   on the downloadable report, so the realisation is never gated and completion is
   protected.

## Ordered tasks

1. Add the Drizzle schema for assessment responses, computed dimension scores,
   captured contact, and the optional diagnosis reference, reusing the share token
   pattern for the forwardable report.
2. Build the deterministic scoring and report assembly in
   `artifacts/api-server/src/lib/assessment/`, model free, with the four dimension
   computation, the gap to layer mapping against the canonical layer registry, and
   the templated narrative. Unit test the scoring, including that a strong set of
   answers scores well and a blind set scores poorly, so the honesty holds.
3. Build the public route `assessment.ts`, pre auth and rate limited through the
   existing limiter, with endpoints to submit answers, return the on screen
   result, capture contact to unlock the report, mint the share token, and
   optionally trigger the bounded outside_in diagnosis. Register it with one line
   in the API app entry.
4. Build the public assessment flow and report pages in the portal from the AS
   design system and primitives, with the four data states and the provenance
   pills on any diagnosis figure. Add the additive public route branch in the
   portal root beside `/d/:token`.
5. Wire contact capture and the forwardable link, with email delivery through the
   existing notifier seam in available, not connected style, and the print
   stylesheet for the board ready download.
6. Add an integration test that walks the whole funnel: submit answers, compute
   scores, render the result, capture contact, mint and resolve the share token,
   and confirm the optional diagnosis path is bounded and degrades gracefully.

## What you must not do

Do not add a dependency or a PDF or email SDK; use the print stylesheet and the
notifier seam. Do not invent a cost figure, a benchmark, or a precision the answers
do not support. Do not rig the scoring so everyone fails. Do not gate the on screen
result; gate only the downloadable report. Do not modify the cortex, the
connectors, the design tokens, the shell, or any existing page; consume what AS
built. Do not make the optional diagnosis mandatory or unbounded.

## Acceptance gate

A short, behavioural, four dimension self assessment of about ten questions plus a
few qualification questions; honest scoring that lets a strong operation pass; a
slick report that draws the four dimension shape, names the gap, maps it to
specific EI layers, teaches the one line, frames cost without inventing a figure,
optionally folds in a real provenance marked outside_in taste, and is forwardable
by share link and downloadable board ready by print stylesheet; the on screen
result free and the email only on the download; the whole thing pre auth, rate
limited, and built from the AS design system. `typecheck`, `build`, and `test`
green. Long dash sweep zero. Drift records written for phase AT:
`docs/drift/phase-AT.md`, the build report appended, the INDEX and rollup advanced
to AT.
