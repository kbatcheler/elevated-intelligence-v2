---
name: GitHub push from Replit (workflow scope + locks)
description: Why pushes to GitHub get "rejected" from Replit and how to actually fix it (OAuth workflow scope, stale .git locks, agent git block).
---

# GitHub push from Replit

Three separate things make a GitHub push "fail" from a Replit repl, and they look
alike in the Git pane (a generic "PUSH_REJECTED / remote has commits"). Diagnose in
this order.

## 1. The real blocker is usually the `workflow` OAuth scope, not divergence
Replit's built-in GitHub connection is an OAuth App that does NOT hold the `workflow`
scope. GitHub then refuses ANY push whose commits add or modify a file under
`.github/workflows/*`, with: `refusing to allow an OAuth App to create or update
workflow ... without 'workflow' scope`. The push transfers every object first, then
the ref update is rejected at the very end, so it looks like a network/divergence
problem but is not.

**Fix that works now:** push from the user's own Shell with a Personal Access Token
(classic) carrying `repo` + `workflow` scopes, bypassing the OAuth connection:
`GIT_ASKPASS= GIT_TERMINAL_PROMPT=1 git -c credential.helper= push https://github.com/<owner>/<repo>.git main`
(username = GitHub user, password = the PAT). Clearing `GIT_ASKPASS` and
`credential.helper` is required or git silently reuses Replit's scope-limited token.

**Why it recurs:** the Replit Git PANE keeps using the scope-limited connection, so it
will reject every future push that touches a workflow file. Durable options: keep
pushing workflow changes from the Shell with a token, OR remove the workflow file
(needs a history rewrite if it is deep in history, e.g. added in the foundational
commit), OR grant the connection the workflow scope if/when that becomes possible.

## 2. The main agent cannot do git at all
Any git ref operation (`fetch`/`merge`/`push`/`commit`) AND even `rm` of a file under
`.git/` is hard-blocked for the main agent (guard returns exit 254, points at
project_tasks). **How to apply:** do not burn cycles retrying — have the USER run git
in their own Shell (their shell is not guarded), pasting commands you provide.

## 3. Stale `.git/**/*.lock` files fake a divergence
A blocked agent git attempt can leave `.git/refs/.../*.lock` and
`.git/objects/maintenance.lock`. These make both the pane and the CLI report "Another
git process seems to be running" and a phantom "remote has commits you don't have"
(the cached `origin/main` stays stale because no real fetch lands). **How to apply:**
have the user `rm -f` the stale `*.lock` files in their Shell, then a real
`git fetch origin` + `git rev-list --left-right --count main...origin/main` shows the
true ahead/behind. If behind is 0, there is no divergence and the only remaining
reason for rejection is #1.
