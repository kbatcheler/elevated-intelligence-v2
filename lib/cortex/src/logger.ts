// A minimal logger contract so the pure engine never imports an application
// logger. Callers may inject their own; the engine defaults to silence inside
// tests and to the console elsewhere only when explicitly asked.

export type LogFields = Record<string, unknown>;

export interface Logger {
  info: (fields: LogFields, msg: string) => void;
  warn: (fields: LogFields, msg: string) => void;
  error: (fields: LogFields, msg: string) => void;
}

export const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export const consoleLogger: Logger = {
  info: (fields, msg) => console.log(JSON.stringify({ level: "info", msg, ...fields })),
  warn: (fields, msg) => console.warn(JSON.stringify({ level: "warn", msg, ...fields })),
  error: (fields, msg) => console.error(JSON.stringify({ level: "error", msg, ...fields })),
};
