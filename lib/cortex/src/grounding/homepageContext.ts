// Fetch a tenant's homepage and extract a compact, model-friendly ground-truth
// snippet (title, meta description, og tags, headings, first paragraphs). This
// is the empirical anchor for the profile stage: without it the model guesses
// from training memory and hallucinates on anything that is not a household
// name.
//
// Design constraints:
// - No HTML-parsing dependency. Native fetch plus regex extraction is enough.
// - Hard timeout so a slow site cannot block a request indefinitely.
// - Size cap on returned context so it does not blow up the prompt.
// - Best-effort: a failed fetch returns ok:false and lets the caller decide.
//
// Security (SSRF-hardened, the URL is arbitrary user input):
// - Accept only http/https with a real DNS hostname, never a raw IP.
// - Resolve the hostname and reject any private, loopback, link-local or
//   reserved address (v4 and v6, including the cloud metadata address).
// - Follow redirects manually (up to 3 hops) and re-validate every hop, so a
//   redirect to an internal address cannot win the race.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { silentLogger, type Logger } from "../logger";

export interface HomepageContext {
  ok: boolean;
  // The cleaned domain the request was sent to (no protocol, no path).
  domain: string;
  // The final URL after redirects, or the requested URL if the fetch failed.
  finalUrl: string;
  // HTTP status of the final response, or 0 if the request never completed.
  status: number;
  // Bytes of raw HTML received (pre-extraction).
  bytesFetched: number;
  // Bytes of extracted text passed to the model.
  bytesExtracted: number;
  durationMs: number;
  // The compact extract. Always a string, empty if extraction failed.
  snippet: string;
  // If ok is false, the reason. For logs only, never user-facing.
  errorReason?: string;
}

const FETCH_TIMEOUT_MS = 6000;
const MAX_HTML_BYTES = 600_000;
const MAX_SNIPPET_LEN = 6000;
const MAX_REDIRECTS = 3;
const USER_AGENT = "ElevatedIntelligenceBot/2.0 (+executive-intelligence; tenant grounding)";

// Derive the cleaned domain (no protocol, path or www) and the canonical URL to
// request from arbitrary user input. Shared by the live fetch and the sovereign
// no-fetch context so both describe the same target identically.
export function cleanHomepageTarget(rawUrl: string): { domain: string; tryUrl: string } {
  const domain = rawUrl
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./i, "")
    .toLowerCase();
  const tryUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${domain}`;
  return { domain, tryUrl };
}

// The honest sovereign homepage context. In sovereign mode the deployment must
// not reach the public web at all, so the homepage is deliberately NOT fetched:
// this returns the same shape a failed fetch would (ok:false, zero bytes, empty
// snippet) with an honest reason and performs no network IO. The profile stage
// then runs in-boundary on the local seat with no external grounding, and the
// seed is honestly recorded as ungrounded.
export function sovereignNoFetchHomepageContext(rawUrl: string): HomepageContext {
  const { domain, tryUrl } = cleanHomepageTarget(rawUrl);
  return {
    ok: false,
    domain,
    finalUrl: tryUrl,
    status: 0,
    bytesFetched: 0,
    bytesExtracted: 0,
    durationMs: 0,
    snippet: "",
    errorReason: "sovereign mode: public web fetch disabled",
  };
}

export async function fetchHomepageContext(rawUrl: string, log: Logger = silentLogger): Promise<HomepageContext> {
  const tStart = Date.now();
  const { domain: initialDomain, tryUrl } = cleanHomepageTarget(rawUrl);

  const empty = (status: number, reason: string, finalUrl = tryUrl, domain = initialDomain): HomepageContext => ({
    ok: false,
    domain,
    finalUrl,
    status,
    bytesFetched: 0,
    bytesExtracted: 0,
    durationMs: Date.now() - tStart,
    snippet: "",
    errorReason: reason,
  });

  // SSRF gate before any network IO. Hostname must be a real DNS name; raw IPs
  // are rejected outright because a tenant homepage would not be an IP literal.
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(tryUrl);
  } catch {
    return empty(0, "invalid URL");
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return empty(0, `unsupported protocol: ${parsedUrl.protocol}`);
  }
  if (isIP(parsedUrl.hostname)) {
    return empty(0, "URL must be a hostname, not a raw IP");
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);

  try {
    // Manual redirect walk so every hop is re-validated. redirect:"follow"
    // would let the platform silently chase a 302 to an internal address.
    let currentUrl = parsedUrl;
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const safety = await isHostnameSafe(currentUrl.hostname);
      if (!safety.ok) {
        return empty(0, `blocked by SSRF policy: ${safety.reason}`, currentUrl.toString(), currentUrl.hostname);
      }
      res = await fetch(currentUrl.toString(), {
        method: "GET",
        redirect: "manual",
        signal: ctl.signal,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          "accept-language": "en-US,en;q=0.9",
        },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return empty(res.status, "redirect without Location header", currentUrl.toString());
        let nextUrl: URL;
        try {
          nextUrl = new URL(loc, currentUrl);
        } catch {
          return empty(res.status, `redirect to invalid URL: ${loc.slice(0, 200)}`, currentUrl.toString());
        }
        if (nextUrl.protocol !== "http:" && nextUrl.protocol !== "https:") {
          return empty(res.status, `redirect to non-http protocol: ${nextUrl.protocol}`, currentUrl.toString());
        }
        if (isIP(nextUrl.hostname)) {
          return empty(res.status, "redirect to raw IP", nextUrl.toString());
        }
        currentUrl = nextUrl;
        try {
          await res.arrayBuffer();
        } catch {
          // ignore drain failure
        }
        continue;
      }
      break;
    }
    if (!res) return empty(0, "no response after redirect walk");
    if (res.status >= 300 && res.status < 400) {
      return empty(res.status, `exceeded ${MAX_REDIRECTS} redirects`, currentUrl.toString());
    }

    const finalDomain = currentUrl.hostname.replace(/^www\./, "").toLowerCase();

    if (!res.ok) {
      return empty(res.status, `non-2xx (${res.status})`, currentUrl.toString(), finalDomain);
    }
    const ctype = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!ctype.includes("html") && !ctype.includes("xml") && ctype !== "") {
      return empty(res.status, `non-html content-type: ${ctype}`, currentUrl.toString(), finalDomain);
    }

    // Stream-read with a byte cap so a hostile multi-megabyte response cannot
    // exhaust memory.
    const reader = res.body?.getReader();
    if (!reader) return empty(res.status, "no response body", currentUrl.toString(), finalDomain);
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      chunks.push(value);
      if (total >= MAX_HTML_BYTES) {
        void reader.cancel();
        break;
      }
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const html = buf.toString("utf8");

    const snippet = extractContext(html, finalDomain);
    return {
      ok: snippet.length > 0,
      domain: finalDomain,
      finalUrl: currentUrl.toString(),
      status: res.status,
      bytesFetched: buf.byteLength,
      bytesExtracted: Buffer.byteLength(snippet, "utf8"),
      durationMs: Date.now() - tStart,
      snippet,
      ...(snippet.length === 0 ? { errorReason: "extracted snippet empty" } : {}),
    };
  } catch (e) {
    const reason =
      e instanceof Error && e.name === "AbortError"
        ? `timeout after ${FETCH_TIMEOUT_MS}ms`
        : `fetch failed: ${e instanceof Error ? e.message : String(e)}`;
    log.warn({ domain: initialDomain, reason }, "homepageContext fetch failed");
    return empty(0, reason);
  } finally {
    clearTimeout(timer);
  }
}

// SSRF defence: resolve the hostname and reject any address that targets the
// host itself, the loopback interface, the link-local block (including the
// cloud metadata address 169.254.169.254), RFC1918 private networks, or the
// IPv6 equivalents. Called for every hop before a socket is opened.
export async function isHostnameSafe(
  hostname: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local") || lower === "metadata") {
    return { ok: false, reason: `hostname '${lower}' is a local alias` };
  }
  let addrs: { address: string; family: number }[];
  try {
    addrs = await lookup(hostname, { all: true, verbatim: true });
  } catch (e) {
    return { ok: false, reason: `DNS lookup failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (addrs.length === 0) return { ok: false, reason: "DNS returned no addresses" };
  for (const a of addrs) {
    if (isPrivateAddress(a.address)) {
      return { ok: false, reason: `resolved to non-public address ${a.address}` };
    }
  }
  return { ok: true };
}

export function isPrivateAddress(addr: string): boolean {
  if (addr.includes(":")) {
    const lc = addr.toLowerCase();
    if (lc === "::" || lc === "::1") return true;
    if (lc.startsWith("fe80:") || lc.startsWith("fc") || lc.startsWith("fd")) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(addr);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  const parts = addr.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  // 0.0.0.0/8, 10.0.0.0/8, 127.0.0.0/8, link-local 169.254/16, 172.16-31/12,
  // 192.168/16, CGNAT 100.64/10, multicast and reserved 224/4 and up.
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

// Extraction is regex-driven because we deliberately avoid an HTML-parsing
// dependency. The goal is a high-signal text snippet, not a DOM tree.
function extractContext(html: string, domain: string): string {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");

  const title = pickText(/<title[^>]*>([\s\S]*?)<\/title>/i, stripped);
  const desc = pickAttr(/<meta\s+[^>]*name=["']description["'][^>]*>/i, "content", stripped);
  const ogTitle = pickAttr(/<meta\s+[^>]*property=["']og:title["'][^>]*>/i, "content", stripped);
  const ogDesc = pickAttr(/<meta\s+[^>]*property=["']og:description["'][^>]*>/i, "content", stripped);
  const ogSite = pickAttr(/<meta\s+[^>]*property=["']og:site_name["'][^>]*>/i, "content", stripped);
  const ogType = pickAttr(/<meta\s+[^>]*property=["']og:type["'][^>]*>/i, "content", stripped);

  const h1s = matchAllText(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, stripped, 4);
  const h2s = matchAllText(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, stripped, 10);
  const paras = matchAllText(/<p[^>]*>([\s\S]*?)<\/p>/gi, stripped, 30)
    .filter((p) => p.length >= 40 && p.length <= 600)
    .slice(0, 8);

  const lines: string[] = [];
  lines.push(`Source: ${domain}`);
  if (title) lines.push(`Page title: ${title}`);
  if (ogSite && ogSite !== title) lines.push(`Site name: ${ogSite}`);
  if (ogType) lines.push(`Page type: ${ogType}`);
  if (desc) lines.push(`Meta description: ${desc}`);
  if (ogDesc && ogDesc !== desc) lines.push(`OG description: ${ogDesc}`);
  if (ogTitle && ogTitle !== title) lines.push(`OG title: ${ogTitle}`);
  if (h1s.length) {
    lines.push("");
    lines.push("Main headings (H1):");
    for (const h of h1s) lines.push(`  - ${h}`);
  }
  if (h2s.length) {
    lines.push("");
    lines.push("Section headings (H2):");
    for (const h of h2s) lines.push(`  - ${h}`);
  }
  if (paras.length) {
    lines.push("");
    lines.push("Homepage paragraphs:");
    for (const p of paras) lines.push(`  ${p}`);
  }

  const out = lines.join("\n").slice(0, MAX_SNIPPET_LEN);
  return out.length > Math.min(60, `Source: ${domain}`.length + 1) ? out : "";
}

function pickText(re: RegExp, html: string): string {
  const m = re.exec(html);
  return m ? cleanText(m[1]) : "";
}
function pickAttr(tagRe: RegExp, attr: string, html: string): string {
  const m = tagRe.exec(html);
  if (!m) return "";
  const attrRe = new RegExp(attr + `\\s*=\\s*["']([^"']*)["']`, "i");
  const m2 = attrRe.exec(m[0]);
  return m2 ? cleanText(m2[1]) : "";
}
function matchAllText(re: RegExp, html: string, cap: number): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && out.length < cap) {
    const t = cleanText(m[1]);
    if (t.length > 0) out.push(t);
  }
  return out;
}
function cleanText(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}
