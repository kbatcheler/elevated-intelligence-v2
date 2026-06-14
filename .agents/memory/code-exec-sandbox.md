---
name: Code execution sandbox quirks
description: Non-obvious return shapes and limits of the code_execution callbacks (executeSql, architect) and the bash tool, learned by hitting them.
---

Non-obvious behaviors of the `code_execution` callbacks and the `bash` tool in this
environment. None of these are visible from the project code; they are tool contracts.

## executeSql returns text, not rows

The `executeSql({ sqlQuery })` callback returns `{ success, output, exitCode,
exitReason }`. `output` is a psql-style TEXT blob (header line then rows, whitespace
separated), NOT a `.rows` array. There is no `.rows` property.

**How to apply:** parse `output` yourself. For a single column:
`out.output.trim().split("\n").slice(1)` drops the header. Do not call `.map` on the
result object expecting a rows array; it will throw `Cannot read properties of
undefined`.

## architect() can return context-only with no verdict

`architect({ task, relevantFiles, responsibility, includeGitDiff })` (the code_review
skill) gathers the listed files into a long preamble inside `result.result`. When
given many files plus `includeGitDiff: true`, it can return ONLY that file-context
preamble (tens of thousands of chars, ending in `</file>` blocks) with no analysis
appended, and the console preview truncates so it looks like nothing came back.

**Why:** the gathered context dominates the response budget.

**How to apply:** keep `relevantFiles` tight (about 4 core files), drop
`includeGitDiff` when not essential, and tell it explicitly "do NOT echo file
contents, give a concise VERDICT". To read a long result, slice past the last
`</file>` or print `result.result.slice(-7000)` rather than logging the whole thing.

## bash tool requires a timeout

Every `bash` call must pass a `timeout` (ms, max 120000). `rg` console output can
garble/merge words in the display; treat that as a rendering artifact, re-check the
file if a match looks wrong.
