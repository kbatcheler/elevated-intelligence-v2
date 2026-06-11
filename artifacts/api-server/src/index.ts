import app from "./app";
import { ensureProviderOrgAndOwner } from "./lib/auth/bootstrap";
import { logger } from "./lib/logger";

const port = Number(process.env.PORT ?? "3001");

if (Number.isNaN(port) || port <= 0) {
  throw new Error('Invalid PORT value: "' + process.env.PORT + '"');
}

// Guarantee a way in before accepting traffic. Bootstrap is idempotent and
// log-and-continue: a missing secret or DB hiccup must not stop the server from
// serving the rest of the API.
async function start(): Promise<void> {
  try {
    await ensureProviderOrgAndOwner();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err: message }, "owner bootstrap failed");
  }

  app.listen(port, () => {
    logger.info({ port }, "api-server listening");
  });
}

void start();
