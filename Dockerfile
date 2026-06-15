# syntax=docker/dockerfile:1

# Elevated Intelligence V2 production image.
#
# One image runs the whole system: the api-server (the Express API plus every
# in-process loop) serves the built portal SPA at "/" when PORTAL_DIST_DIR is
# set. This is the single-container model the GCP Cloud Run and AWS App Runner
# targets in docs/migration-runbook.md deploy. The same image also carries the
# migration and seed tooling, so it can push the schema and run a demo seed.
#
# Twelve-factor: no secret is ever baked in. Every secret and every endpoint is
# supplied by the environment and resolved through the SecretStore at first use.

# One pinned base for every stage. The api-server bundle is compiled by esbuild
# for the node22 target, so the runtime Node major must match. pnpm is pinned to
# the version this repo is locked against so the install is reproducible.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.26.1 --activate
WORKDIR /app

# Build stage: a clean, frozen install of the whole workspace, then build the
# portal (vite to artifacts/portal/dist/public) and the api-server (esbuild to
# artifacts/api-server/dist/index.mjs). Dev dependencies live only in this stage.
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm run build

# Runtime stage. It carries the built workspace: the api-server bundle, the
# portal build, the resolved node_modules the bundle's externals load at run
# time, and the migration and seed tooling (drizzle-kit, tsx) so this one image
# can run the app, push the schema, and seed a demo. pnpm keeps its store under
# node_modules/.pnpm with relative symlinks, so the whole tree copies intact.
FROM base AS runtime
ENV NODE_ENV=production
# Most platforms (Cloud Run, App Runner) inject the listen port as PORT; 8080 is
# the conventional default. PORTAL_DIST_DIR makes the api-server serve the built
# portal SPA at "/", so the whole system runs from this one image.
ENV PORT=8080
ENV PORTAL_DIST_DIR=/app/artifacts/portal/dist/public
COPY --from=build /app /app
EXPOSE 8080

# Honest container liveness against the structured health route. A 503 (database
# or secret store unreachable) fails the probe; a 200 passes.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
