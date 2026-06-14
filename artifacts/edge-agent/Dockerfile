# In-client edge agent image. The agent writes nothing to disk and needs no
# database access, so it runs as a non-root user on a read-only filesystem.
#
# One-command build, from the repository root:
#   docker build -f artifacts/edge-agent/Dockerfile -t ei-edge-agent .
#
# Run it read-only and non-root (a writable tmpfs covers the runtime cache):
#   docker run --rm --read-only --tmpfs /tmp \
#     -e EI_API_BASE_URL=https://proxy.example.com \
#     -e EI_AGENT_TOKEN=... \
#     -e EI_AGENT_TOKENIZE_SALT=... \
#     -v /path/to/certs:/certs:ro \
#     -e EI_AGENT_TLS_CERT=/certs/client.crt \
#     -e EI_AGENT_TLS_KEY=/certs/client.key \
#     -e EI_AGENT_TLS_CA=/certs/ca.crt \
#     ei-edge-agent
FROM node:22-bookworm-slim
ENV NODE_ENV=production
ENV TSX_DISABLE_CACHE=1
RUN corepack enable
WORKDIR /app

# Manifests first so installs cache across source changes. Only the agent and the
# two workspace packages it needs are copied; the agent never depends on the
# application database root, only on the connectors package and the contracts
# subpath it re-exports.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY lib/db/package.json lib/db/package.json
COPY lib/connectors/package.json lib/connectors/package.json
COPY artifacts/edge-agent/package.json artifacts/edge-agent/package.json
RUN pnpm install --frozen-lockfile --filter "@workspace/edge-agent..."

# Source for the agent and its workspace dependencies.
COPY tsconfig.base.json tsconfig.base.json
COPY lib/db lib/db
COPY lib/connectors lib/connectors
COPY artifacts/edge-agent artifacts/edge-agent

USER node
ENTRYPOINT ["pnpm", "--filter", "@workspace/edge-agent", "start"]
