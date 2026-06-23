#!/bin/bash
set -euo pipefail

# Post-merge reconciliation for the EI V2 pnpm monorepo.
# Runs automatically after a task merge. Must be idempotent and non-interactive
# (stdin is closed). Keep it fast and fail loud.

# 1) Install/relink workspace dependencies (no-op when nothing changed).
pnpm install --frozen-lockfile=false

# 2) Sync the Drizzle schema into the database so newly merged tables/columns
#    exist before any code or integration test touches them.
pnpm --filter @workspace/db run push-force
