// preflight <url> [url...]
//
// Confirm every URL is reachable and yields extractable homepage text BEFORE any
// model spend. fetchHomepageContext returns ok:false on a dead host rather than
// throwing, and the profile stage will still spend a model call on a degraded
// fetch, so the live seed is gated on this cheap HTTP-only check: if any URL is
// unreachable we abort before spending a cent.
//
//   pnpm --filter @workspace/api-server exec tsx src/scripts/preflight.ts <url> [url...]

import { fetchHomepageContext } from "@workspace/cortex";
import { logger } from "../lib/logger";

async function main(): Promise<void> {
  const urls = process.argv.slice(2);
  if (urls.length === 0) {
    console.error("usage: preflight <url> [url...]");
    process.exitCode = 1;
    return;
  }

  let anyBad = false;
  console.log("================ PRE-FLIGHT FETCH ================");
  for (const url of urls) {
    const ctx = await fetchHomepageContext(url, logger);
    const ok = ctx.ok && ctx.bytesExtracted > 0;
    if (!ok) anyBad = true;
    console.log(
      `${ok ? "[ok]  " : "[FAIL]"} ${url}  status=${ctx.status} extracted=${ctx.bytesExtracted}B final=${ctx.finalUrl}` +
        `${ctx.errorReason ? ` reason=${ctx.errorReason}` : ""}`,
    );
  }
  console.log("=================================================");

  if (anyBad) {
    console.log("PRE-FLIGHT FAILED: at least one URL is not fetchable. Aborting before any model spend.");
    process.exitCode = 1;
  } else {
    console.log("PRE-FLIGHT PASSED: all URLs reachable and extractable.");
  }
}

main().catch((e) => {
  logger.error({ err: e instanceof Error ? e.message : String(e) }, "preflight failed");
  process.exitCode = 1;
});
