// Zero-dependency AWS Signature Version 4 request signer, over node:crypto and
// the Node global fetch only, with no AWS SDK. It is the shared signing core for
// every "available, not connected" AWS adapter in this codebase (the S3 archive
// store and the AWS Secrets Manager secret store), mirroring the GCP adapters'
// zero-SDK-over-fetch pattern.
//
// The implementation follows the documented SigV4 algorithm exactly: it is
// pinned in sigv4.test.ts against AWS's own published IAM ListUsers example, so
// a regression in the canonicalisation or the signing-key derivation turns a
// test red rather than producing a silently invalid signature.
//
// Credentials and tokens are never logged. The signer returns only the headers a
// caller attaches to its fetch request; the Host header is intentionally omitted
// because the runtime derives it from the URL, and signing host against the same
// URL keeps the two in lockstep.
import { createHash, createHmac } from "node:crypto";

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  // A temporary-credential session token, signed as x-amz-security-token when
  // present. Long-lived IAM user keys do not carry one.
  sessionToken?: string;
}

export interface SignRequestInput {
  method: string;
  // The full request URL including any query string. The query is canonicalised
  // from its parsed search params, so the caller does not pre-sort it.
  url: string;
  region: string;
  // The AWS service id, for example "s3" or "secretsmanager". S3 has a distinct
  // canonical-URI rule (single path encoding), handled below.
  service: string;
  credentials: AwsCredentials;
  // Extra headers to sign and send (for example Content-Type, X-Amz-Target, or
  // If-None-Match). Header names are matched case-insensitively.
  headers?: Record<string, string>;
  // The raw request body bytes. An empty buffer (the default) hashes to the
  // well-known empty-payload digest, which is correct for a bodyless GET.
  payload?: Buffer;
  // When true, add x-amz-content-sha256 (the hex payload hash) to both the
  // signed and the sent headers. Required by S3 and harmless elsewhere; off by
  // default so the published IAM test vector can be reproduced exactly.
  addContentSha256Header?: boolean;
  // Injectable clock for deterministic tests. Defaults to the current time.
  now?: Date;
}

export interface SignedRequest {
  // The headers to attach to the fetch request (caller headers plus the signed
  // x-amz-date, optional x-amz-security-token and x-amz-content-sha256, and the
  // Authorization header). Host is deliberately not included.
  headers: Record<string, string>;
  authorization: string;
  signedHeaders: string;
  signature: string;
  amzDate: string;
  credentialScope: string;
  canonicalRequest: string;
  payloadHash: string;
}

const ALGORITHM = "AWS4-HMAC-SHA256";
const UNRESERVED = /[A-Za-z0-9\-_.~]/;

function sha256Hex(input: Buffer | string): string {
  return createHash("sha256").update(input).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

// RFC 3986 percent-encoding, byte by byte, encoding everything that is not an
// unreserved character. The forward slash is preserved when encodeSlash is
// false, which is how path segments are handled.
function uriEncode(str: string, encodeSlash: boolean): string {
  let out = "";
  for (const byte of Buffer.from(str, "utf8")) {
    const ch = String.fromCharCode(byte);
    if (UNRESERVED.test(ch)) {
      out += ch;
    } else if (ch === "/" && !encodeSlash) {
      out += "/";
    } else {
      out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
    }
  }
  return out;
}

// The canonical URI. Every service except S3 encodes each path segment twice;
// S3 encodes once. An empty path canonicalises to "/".
function canonicalUri(pathname: string, service: string): string {
  const segments = pathname.split("/").map((seg) => {
    const once = uriEncode(seg, false);
    return service === "s3" ? once : uriEncode(once, false);
  });
  const uri = segments.join("/");
  return uri === "" ? "/" : uri;
}

// The canonical query string: each key and value URI-encoded, then sorted by
// encoded key and value, joined with ampersands.
function canonicalQuery(params: URLSearchParams): string {
  const pairs: Array<[string, string]> = [];
  for (const [k, v] of params.entries()) pairs.push([k, v]);
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return pairs.map(([k, v]) => uriEncode(k, true) + "=" + uriEncode(v, true)).join("&");
}

// YYYYMMDDTHHMMSSZ and its YYYYMMDD date stamp, both in UTC.
function amzDateStamp(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = now.toISOString().replace(/[:-]/g, "").replace(/\.\d{3}/, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

export function signRequestV4(input: SignRequestInput): SignedRequest {
  const { method, url, region, service, credentials } = input;
  const payload = input.payload ?? Buffer.alloc(0);
  const now = input.now ?? new Date();
  const parsed = new URL(url);
  const { amzDate, dateStamp } = amzDateStamp(now);
  const payloadHash = sha256Hex(payload);

  // Normalise caller header names to lower case and collapse internal
  // whitespace, per the canonicalisation rules.
  const signed: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers ?? {})) {
    signed[name.toLowerCase()] = String(value).trim().replace(/\s+/g, " ");
  }
  signed["host"] = parsed.host;
  signed["x-amz-date"] = amzDate;
  if (credentials.sessionToken) signed["x-amz-security-token"] = credentials.sessionToken;
  if (input.addContentSha256Header) signed["x-amz-content-sha256"] = payloadHash;

  const sortedHeaderNames = Object.keys(signed).sort();
  const canonicalHeaders = sortedHeaderNames.map((name) => name + ":" + signed[name] + "\n").join("");
  const signedHeaders = sortedHeaderNames.join(";");

  const canonicalRequest = [
    method,
    canonicalUri(parsed.pathname, service),
    canonicalQuery(parsed.searchParams),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = dateStamp + "/" + region + "/" + service + "/aws4_request";
  const stringToSign = [ALGORITHM, amzDate, credentialScope, sha256Hex(Buffer.from(canonicalRequest, "utf8"))].join("\n");

  const kDate = hmac("AWS4" + credentials.secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  const authorization =
    ALGORITHM +
    " Credential=" +
    credentials.accessKeyId +
    "/" +
    credentialScope +
    ", SignedHeaders=" +
    signedHeaders +
    ", Signature=" +
    signature;

  // Build the headers to send: the caller's own headers, then the amz headers we
  // added, then Authorization. Host is omitted on purpose.
  const headers: Record<string, string> = { ...(input.headers ?? {}) };
  headers["X-Amz-Date"] = amzDate;
  if (credentials.sessionToken) headers["X-Amz-Security-Token"] = credentials.sessionToken;
  if (input.addContentSha256Header) headers["X-Amz-Content-Sha256"] = payloadHash;
  headers["Authorization"] = authorization;

  return {
    headers,
    authorization,
    signedHeaders,
    signature,
    amzDate,
    credentialScope,
    canonicalRequest,
    payloadHash,
  };
}

// Resolve AWS credentials from the standard environment variables, or throw a
// precise "not configured" error. The two adapters call this lazily on first
// use, never at construction, so an unconfigured deployment never crashes the
// boot and only surfaces when an AWS path is actually exercised.
export function resolveAwsCredentials(override?: Partial<AwsCredentials>): AwsCredentials {
  const accessKeyId = override?.accessKeyId ?? process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = override?.secretAccessKey ?? process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "AWS credentials are not configured: set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY to connect it.",
    );
  }
  const sessionToken = override?.sessionToken ?? process.env.AWS_SESSION_TOKEN ?? undefined;
  return { accessKeyId, secretAccessKey, sessionToken };
}
