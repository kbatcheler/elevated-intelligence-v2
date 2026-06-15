// Some request paths carry a secret credential as a path segment. The public
// diagnosis share token is a bearer credential that lives in the URL itself
// (GET /api/public/diagnosis/:token). The unhandled-error handler attaches the
// request route to the observability aggregator, so the route MUST be scrubbed
// of any such credential before it can leave the process. This redaction is the
// single chokepoint that guarantees a share token never reaches an external
// service, even on an unexpected error deep in the public request.
const SECRET_PATH_PATTERNS: Array<{ re: RegExp; replacement: string }> = [
  // The trailing segment is the bearer share token. Collapse it to the route
  // template so the route shape is still useful for grouping errors.
  { re: /^(\/api\/public\/diagnosis\/)[^/]+/, replacement: "$1:token" },
];

export function redactRoute(path: string): string {
  let out = path;
  for (const { re, replacement } of SECRET_PATH_PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
}
