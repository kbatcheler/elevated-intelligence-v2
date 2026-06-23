---
name: Headless browser tests under zero-new-dependency
description: How to drive a real browser for layout/overflow assertions in this repo without adding Playwright/puppeteer.
---

# Driving a real browser from the test suite (zero deps)

The repo has NO Playwright/puppeteer in node_modules and forbids new npm deps, but
the platform exposes a chromium binary at the env var
`REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE` (present in BOTH the agent shell and the
`test` workflow process - verified by a full suite run). Anything that needs a real
layout engine (e.g. `document.documentElement.scrollWidth <= window.innerWidth`
overflow checks - jsdom returns 0 for scrollWidth, so it cannot measure layout)
drives that binary directly over the Chrome DevTools Protocol using Node built-ins:
`child_process.spawn` the binary headless with `--remote-debugging-port=0`, scrape the
`ws://...` url from stderr, connect with the global `WebSocket`, and route flat
(sessionId-tagged) command responses by `id`. No SDK, no dependency.

**Why:** it is the only faithful way to assert rendered layout in a zero-dep repo, and
it reuses the same browser the manual 375px audits used.

**How to apply (the working recipe, see `portalOverflow.integration.test.ts`):**
- Useful chrome flags: `--headless=new --no-sandbox --disable-gpu
  --disable-dev-shm-usage --hide-scrollbars`. `--hide-scrollbars` removes the
  scrollbar gutter so innerWidth is deterministic.
- Set the viewport with `Emulation.setDeviceMetricsOverride`
  ({width,height,deviceScaleFactor:1,mobile:false}) BEFORE navigating; `mobile:false`
  gives `innerWidth === width` (375). `mobile:true`/`deviceScaleFactor:0` did NOT take.
- Isolate personas with `Target.createBrowserContext` (own cookie jar + localStorage),
  then `Target.createTarget`+`attachToTarget {flatten:true}` for a sessionId.
- Auth: log in over HTTP to get the `ei_session` cookie value, then plant it with CDP
  `Network.setCookie {name:'ei_session', value, url:base, httpOnly:true}`. Select the
  tenant with `Page.addScriptToEvaluateOnNewDocument` setting `localStorage['ei.tenantId']`.
- Data arrives async and reflows the page, so after `Page.navigate` POLL
  `Runtime.evaluate` every ~250ms until the SPA mounted AND scrollWidth is stable for
  two reads (cap ~12s), then assert.
- Serve the REAL portal: build it fresh into a temp dir (`pnpm exec vite build --outDir
  <tmp>`, NODE_ENV=production) so the guard tests CURRENT css, set `PORTAL_DIST_DIR` to
  it, and boot `app` (single-container model serves the SPA + /api on one origin).
- Lives in the api-server vitest suite (single-fork, shared dev DB); seed/login/cleanup
  follow `functional-e2e-auth.md`. Build+browser add ~40s to the suite.
