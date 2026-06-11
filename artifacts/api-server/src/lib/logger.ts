// A deliberately small structured logger. The Phase B scaffold has no need for
// a full logging stack yet; this keeps log lines parseable and gives later
// phases a single seam to swap in a richer logger without touching call sites.
type Fields = Record<string, unknown>;

function emit(level: "info" | "warn" | "error", fields: Fields, msg: string): void {
  const line = { level, time: new Date().toISOString(), msg, ...fields };
  const text = JSON.stringify(line);
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);
}

export const logger = {
  info: (fields: Fields, msg: string) => emit("info", fields, msg),
  warn: (fields: Fields, msg: string) => emit("warn", fields, msg),
  error: (fields: Fields, msg: string) => emit("error", fields, msg),
};
