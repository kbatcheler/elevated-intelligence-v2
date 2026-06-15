import { inflateRawSync, inflateSync } from "node:zlib";
import { z } from "zod/v4";
import type { DerivedSignalSet } from "@workspace/connectors";
import { getExtractionRuntime } from "@workspace/cortex";
import { readZipEntries, readZipMemberText } from "./zip";

// One derived signal, taken straight off the contract so there is one source of
// truth for the shape (key, kind, finite numeric value, optional window/unit).
type DerivedSignal = DerivedSignalSet["signals"][number];

// Manual upload derivation (Phase AE, ingestion path 3). A spreadsheet or a
// contract document is parsed entirely in memory, numeric math is derived, and
// the bytes are discarded by the caller; nothing here writes a file or returns
// the raw artifact. Spreadsheets (csv, xlsx) yield deterministic per-column
// aggregates. Contracts (pdf, docx) have their text extracted in memory and
// handed to the in-boundary extraction seat, which returns only numeric contract
// metrics, never the text. Parsing uses Node built-ins only: no new dependency.

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type UploadKind = "spreadsheet" | "contract";

export interface UploadInput {
  filename: string;
  mime: string;
  bytes: Buffer;
  targetLayer: string;
}

export interface DiscardedFacts {
  filename: string;
  bytes: number;
  // Exactly one of these is set, describing the raw shape that was parsed then
  // thrown away. They quantify what was discarded without holding any of it.
  rawRows?: number;
  rawTextChars?: number;
  note: string;
}

export interface UploadDerivation {
  kind: UploadKind;
  fileType: "csv" | "xlsx" | "docx" | "pdf";
  signals: DerivedSignal[];
  // A human-readable, non-identifying account of what was derived, for the
  // portal's derived-vs-discarded trust panel. Each entry is "key = value".
  derivedSummary: string[];
  discarded: DiscardedFacts;
}

// A loud, mapped failure. The route turns code+status into an honest response and
// always discards the bytes; a failure never persists a raw artifact.
export class UploadError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

// Extension drives the parser; the MIME is checked against a per-type allow-list.
// Browser and client MIME labels are unreliable, so the generic octet-stream and
// empty values are tolerated, but a clearly wrong type (an image, say) is refused.
const TYPE_BY_EXT: Record<string, { fileType: UploadDerivation["fileType"]; mimes: string[] }> = {
  ".csv": {
    fileType: "csv",
    mimes: ["text/csv", "application/csv", "application/vnd.ms-excel", "text/plain"],
  },
  ".xlsx": {
    fileType: "xlsx",
    mimes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  },
  ".docx": {
    fileType: "docx",
    mimes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  },
  ".pdf": { fileType: "pdf", mimes: ["application/pdf"] },
};

const TOLERATED_MIME = new Set(["application/octet-stream", "binary/octet-stream", ""]);

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot).toLowerCase();
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

// One numeric column becomes five honest aggregates under a GENERIC positional
// key ("column_<n>", 1-based), so a raw header is never echoed into a stored
// signal key. The transient summary uses the human header so the operator's
// derived-versus-discarded panel stays readable, but that label rides in the
// HTTP response only and is never persisted. A non-finite, mixed, or empty
// column emits nothing rather than a fabricated zero.
function aggregateColumn(
  columnIndex: number,
  headerLabel: string,
  nums: number[],
): { signals: DerivedSignal[]; summary: string[] } {
  const key = "column_" + columnIndex;
  const display = headerLabel.trim() !== "" ? headerLabel.trim() : key;
  const sum = nums.reduce((a, b) => a + b, 0);
  const mean = sum / nums.length;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const signals: DerivedSignal[] = [
    { key: key + ".count", kind: "count", value: nums.length },
    { key: key + ".sum", kind: "aggregate", value: sum },
    { key: key + ".mean", kind: "aggregate", value: mean },
    { key: key + ".min", kind: "aggregate", value: min },
    { key: key + ".max", kind: "aggregate", value: max },
  ];
  const summary = [
    display + ".count = " + String(nums.length),
    display + ".sum = " + String(sum),
    display + ".mean = " + String(mean),
    display + ".min = " + String(min),
    display + ".max = " + String(max),
  ];
  return { signals, summary };
}

function summarize(signals: DerivedSignal[]): string[] {
  return signals.map((s) => {
    const v = Array.isArray(s.value) ? "[" + s.value.length + " values]" : String(s.value);
    return s.key + " = " + v + (s.unit ? " " + s.unit : "");
  });
}

// A minimal RFC 4180 CSV parser: quoted fields, doubled-quote escapes, CRLF or
// LF rows. It returns a rectangular-ish grid of trimmed-on-read strings.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawAny = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      sawAny = true;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      sawAny = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
      sawAny = true;
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      sawAny = false;
    } else if (c === "\r") {
      // Swallow; a following \n closes the row.
    } else {
      field += c;
      sawAny = true;
    }
  }
  if (sawAny || field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// Derive aggregates over the numeric columns of a parsed grid. A column counts as
// numeric only when every non-empty data cell parses as a finite number, so a
// label column never produces fabricated stats.
function deriveGrid(
  header: string[],
  dataRows: string[][],
): { signals: DerivedSignal[]; summary: string[]; numericColumns: number } {
  const signals: DerivedSignal[] = [];
  const summary: string[] = [];
  let numericColumns = 0;
  const width = header.length;
  for (let c = 0; c < width; c += 1) {
    const nums: number[] = [];
    let nonEmpty = 0;
    for (const r of dataRows) {
      const cell = (r[c] ?? "").trim();
      if (cell === "") continue;
      nonEmpty += 1;
      const n = Number(cell);
      if (Number.isFinite(n)) nums.push(n);
    }
    if (nums.length > 0 && nums.length === nonEmpty) {
      numericColumns += 1;
      const col = aggregateColumn(c + 1, header[c] ?? "", nums);
      signals.push(...col.signals);
      summary.push(...col.summary);
    }
  }
  return { signals, summary, numericColumns };
}

function deriveCsv(input: UploadInput): UploadDerivation {
  const text = input.bytes.toString("utf8");
  const grid = parseCsv(text);
  if (grid.length < 2) {
    throw new UploadError("empty_spreadsheet", "the CSV has no header and data rows", 400);
  }
  const header = grid[0]!;
  const dataRows = grid.slice(1);
  const { signals, summary, numericColumns } = deriveGrid(header, dataRows);
  if (numericColumns === 0) {
    throw new UploadError("no_numeric_columns", "no numeric columns were found to derive from", 422);
  }
  return {
    kind: "spreadsheet",
    fileType: "csv",
    signals,
    derivedSummary: summary,
    discarded: {
      filename: input.filename,
      bytes: input.bytes.length,
      rawRows: dataRows.length,
      note: "the CSV rows were parsed in memory and discarded; only the column math above was stored",
    },
  };
}

// ----- XLSX (a ZIP of XML) ---------------------------------------------------

function colLetterToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml))) {
    const inner = m[1] ?? "";
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let t: RegExpExecArray | null;
    let s = "";
    while ((t = tRe.exec(inner))) s += t[1] ?? "";
    out.push(decodeXmlEntities(s));
  }
  return out;
}

interface XlsxCell {
  row: number;
  col: number;
  type: string;
  raw: string;
}

function parseWorksheet(xml: string): XlsxCell[] {
  const cells: XlsxCell[] = [];
  const cRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m: RegExpExecArray | null;
  while ((m = cRe.exec(xml))) {
    const attrs = m[1] ?? "";
    const body = m[2] ?? "";
    const rMatch = /\br="([A-Z]+)(\d+)"/.exec(attrs);
    if (!rMatch) continue;
    const col = colLetterToIndex(rMatch[1]!);
    const row = parseInt(rMatch[2]!, 10);
    const tMatch = /\bt="([^"]+)"/.exec(attrs);
    const type = tMatch ? tMatch[1]! : "n";
    let raw = "";
    if (type === "inlineStr") {
      const isRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
      let t: RegExpExecArray | null;
      while ((t = isRe.exec(body))) raw += t[1] ?? "";
    } else {
      const vMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
      raw = vMatch ? (vMatch[1] ?? "") : "";
    }
    cells.push({ row, col, type, raw });
  }
  return cells;
}

function deriveXlsx(input: UploadInput): UploadDerivation {
  let entries;
  try {
    entries = readZipEntries(input.bytes);
  } catch {
    throw new UploadError("invalid_xlsx", "the file is not a readable xlsx workbook", 400);
  }
  const sharedXml = readZipMemberText(input.bytes, "xl/sharedStrings.xml");
  const shared = sharedXml ? parseSharedStrings(sharedXml) : [];
  const sheetName = entries
    .map((e) => e.name)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort()[0];
  if (!sheetName) {
    throw new UploadError("invalid_xlsx", "the workbook has no worksheet", 400);
  }
  const sheetXml = readZipMemberText(input.bytes, sheetName) ?? "";
  const cells = parseWorksheet(sheetXml);
  if (cells.length === 0) {
    throw new UploadError("empty_spreadsheet", "the worksheet has no cells", 400);
  }

  const valueOf = (cell: XlsxCell): { num?: number; str?: string } => {
    if (cell.type === "s") {
      const idx = parseInt(cell.raw, 10);
      return { str: shared[idx] ?? "" };
    }
    if (cell.type === "inlineStr" || cell.type === "str") return { str: decodeXmlEntities(cell.raw) };
    if (cell.type === "b") return { num: cell.raw === "1" ? 1 : 0 };
    if (cell.type === "e") return {};
    const n = Number(cell.raw);
    return Number.isFinite(n) ? { num: n } : {};
  };

  const headers: Record<number, string> = {};
  for (const c of cells.filter((x) => x.row === 1)) {
    const v = valueOf(c);
    headers[c.col] = v.str ?? (v.num != null ? String(v.num) : "");
  }
  const lastRow = Math.max(...cells.map((c) => c.row));
  const dataRows = lastRow - 1;
  const cols = Array.from(new Set(cells.map((c) => c.col))).sort((a, b) => a - b);

  const signals: DerivedSignal[] = [];
  const summary: string[] = [];
  let numericColumns = 0;
  for (const col of cols) {
    const nums: number[] = [];
    let nonEmpty = 0;
    for (const c of cells) {
      if (c.col !== col || c.row < 2) continue;
      const v = valueOf(c);
      if (v.num == null && (v.str == null || v.str.trim() === "")) continue;
      nonEmpty += 1;
      if (v.num != null) nums.push(v.num);
    }
    if (nums.length > 0 && nums.length === nonEmpty) {
      numericColumns += 1;
      const label = headers[col] && headers[col]!.trim() !== "" ? headers[col]! : "";
      const agg = aggregateColumn(col + 1, label, nums);
      signals.push(...agg.signals);
      summary.push(...agg.summary);
    }
  }
  if (numericColumns === 0) {
    throw new UploadError("no_numeric_columns", "no numeric columns were found to derive from", 422);
  }
  return {
    kind: "spreadsheet",
    fileType: "xlsx",
    signals,
    derivedSummary: summary,
    discarded: {
      filename: input.filename,
      bytes: input.bytes.length,
      rawRows: dataRows > 0 ? dataRows : 0,
      note: "the worksheet cells were parsed in memory and discarded; only the column math above was stored",
    },
  };
}

// ----- DOCX (a ZIP of XML) ---------------------------------------------------

function extractDocxText(bytes: Buffer): string {
  let xml: string | null;
  try {
    xml = readZipMemberText(bytes, "word/document.xml");
  } catch {
    throw new UploadError("invalid_docx", "the file is not a readable docx document", 400);
  }
  if (!xml) throw new UploadError("invalid_docx", "the docx has no document body", 400);
  const lines: string[] = [];
  for (const para of xml.split(/<\/w:p>/)) {
    const tRe = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
    let m: RegExpExecArray | null;
    let line = "";
    while ((m = tRe.exec(para))) line += decodeXmlEntities(m[1] ?? "");
    if (line.trim() !== "") lines.push(line.trim());
  }
  return lines.join("\n");
}

// ----- PDF (narrow, honest text extraction) ----------------------------------

// Decode the text inside a content stream's parenthesised string operators.
// Movement operators (Td, TD, T*) become line breaks. This recovers the actual
// drawn text; it never invents content, and an empty result is surfaced loudly.
function extractPdfTextOps(content: string): string {
  let out = "";
  const n = content.length;
  let i = 0;
  while (i < n) {
    const ch = content[i]!;
    if (ch === "(") {
      let depth = 1;
      i += 1;
      let str = "";
      while (i < n && depth > 0) {
        const c = content[i]!;
        if (c === "\\") {
          const next = content[i + 1] ?? "";
          if (next === "n") str += "\n";
          else if (next === "r") str += "\r";
          else if (next === "t") str += "\t";
          else if (next === "b") str += "\b";
          else if (next === "f") str += "\f";
          else if (next === "(" || next === ")" || next === "\\") str += next;
          else if (next >= "0" && next <= "7") {
            let oct = "";
            let k = i + 1;
            while (k < n && oct.length < 3 && content[k]! >= "0" && content[k]! <= "7") {
              oct += content[k];
              k += 1;
            }
            str += String.fromCharCode(parseInt(oct, 8));
            i = k;
            continue;
          } else {
            str += next;
          }
          i += 2;
          continue;
        }
        if (c === "(") {
          depth += 1;
          str += c;
        } else if (c === ")") {
          depth -= 1;
          if (depth > 0) str += c;
        } else {
          str += c;
        }
        i += 1;
      }
      out += str;
      continue;
    }
    if (ch === "T") {
      const op = content.slice(i, i + 2);
      if (op === "T*" || op === "Td" || op === "TD") {
        out += "\n";
        i += 2;
        continue;
      }
    }
    i += 1;
  }
  return out;
}

function extractPdfText(bytes: Buffer): string {
  if (bytes.indexOf(Buffer.from("/Encrypt")) !== -1) {
    throw new UploadError(
      "unsupported_pdf_text_extraction",
      "encrypted PDF text extraction is not supported",
      422,
    );
  }
  const STREAM = Buffer.from("stream");
  const ENDSTREAM = Buffer.from("endstream");
  const chunks: string[] = [];
  let pos = 0;
  while (true) {
    const s = bytes.indexOf(STREAM, pos);
    if (s === -1) break;
    let dataStart = s + STREAM.length;
    if (bytes[dataStart] === 0x0d && bytes[dataStart + 1] === 0x0a) dataStart += 2;
    else if (bytes[dataStart] === 0x0a) dataStart += 1;
    const e = bytes.indexOf(ENDSTREAM, dataStart);
    if (e === -1) break;
    let dataEnd = e;
    if (bytes[dataEnd - 1] === 0x0a) dataEnd -= 1;
    if (bytes[dataEnd - 1] === 0x0d) dataEnd -= 1;
    const streamBytes = bytes.subarray(dataStart, dataEnd);
    let content: Buffer;
    try {
      content = inflateSync(streamBytes);
    } catch {
      try {
        content = inflateRawSync(streamBytes);
      } catch {
        content = streamBytes;
      }
    }
    chunks.push(extractPdfTextOps(content.toString("latin1")));
    pos = e + ENDSTREAM.length;
  }
  const text = chunks
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.replace(/\s/g, "").length < 8) {
    throw new UploadError(
      "unsupported_pdf_text_extraction",
      "no text could be extracted from this PDF; it may be scanned or use an unsupported encoding",
      422,
    );
  }
  return text;
}

// ----- Contract metrics via the in-boundary extraction seat ------------------

// Strict, numeric-only contract metrics. Nullable means "not found in the text":
// an absent metric is omitted from the signal set, never coerced to a fabricated
// zero. No field can carry a name, a party, or any free text.
const contractMetricsSchema = z.object({
  parties_count: z.number().int().min(0).max(1000).nullable(),
  term_months: z.number().min(0).max(12000).nullable(),
  total_value: z.number().min(0).nullable(),
  obligations_count: z.number().int().min(0).max(100000).nullable(),
  auto_renew: z.union([z.literal(0), z.literal(1)]).nullable(),
  days_to_expiry: z.number().int().min(-100000).max(100000).nullable(),
});

const CONTRACT_SYSTEM =
  "You are a contract metrics extractor inside a data boundary. Read the contract text and return ONLY the numeric metrics defined by the JSON schema. " +
  "Never return names, parties, clauses, or any free text. If a metric is not stated, return null for it. " +
  "auto_renew is 1 when the contract auto-renews and 0 otherwise. term_months is the contract term length in months. " +
  "total_value is the total contract value as a number with no currency symbol. days_to_expiry is whole days from today to the expiry date. " +
  "Respond with a single JSON object and nothing else.";

function buildContractUser(text: string): string {
  const clipped = text.length > 24000 ? text.slice(0, 24000) : text;
  return "Contract text follows between the markers.\n<<<CONTRACT\n" + clipped + "\nCONTRACT>>>";
}

async function deriveContractSignals(text: string): Promise<DerivedSignal[]> {
  const runtime = getExtractionRuntime();
  if (!runtime) {
    throw new UploadError(
      "local_extraction_seat_not_connected",
      "contract extraction runs on the in-boundary model, which is available but not connected: set LOCAL_MODEL_BASE_URL and LOCAL_MODEL_MODEL",
      503,
    );
  }
  const res = await runtime.callJson({
    system: CONTRACT_SYSTEM,
    user: buildContractUser(text),
    schema: contractMetricsSchema,
    maxTokens: 512,
    context: "ingest:upload:contract",
  });
  if (!res.ok) {
    throw new UploadError(
      "contract_extraction_failed",
      "the in-boundary model did not return valid contract metrics: " + res.reason,
      502,
    );
  }
  const m = res.value;
  const signals: DerivedSignal[] = [];
  if (m.parties_count != null) signals.push({ key: "contract.parties_count", kind: "count", value: m.parties_count });
  if (m.term_months != null) signals.push({ key: "contract.term_months", kind: "aggregate", value: m.term_months, unit: "months" });
  if (m.total_value != null) signals.push({ key: "contract.total_value", kind: "aggregate", value: m.total_value });
  if (m.obligations_count != null) signals.push({ key: "contract.obligations_count", kind: "count", value: m.obligations_count });
  if (m.auto_renew != null) signals.push({ key: "contract.auto_renew", kind: "ratio", value: m.auto_renew });
  if (m.days_to_expiry != null) signals.push({ key: "contract.days_to_expiry", kind: "aggregate", value: m.days_to_expiry, unit: "days" });
  if (signals.length === 0) {
    throw new UploadError("contract_no_metrics", "no contract metrics could be derived from this document", 422);
  }
  return signals;
}

async function deriveContract(
  input: UploadInput,
  fileType: "pdf" | "docx",
): Promise<UploadDerivation> {
  const text = fileType === "pdf" ? extractPdfText(input.bytes) : extractDocxText(input.bytes);
  if (text.trim().length === 0) {
    throw new UploadError("empty_document", "the document had no extractable text", 422);
  }
  const signals = await deriveContractSignals(text);
  return {
    kind: "contract",
    fileType,
    signals,
    derivedSummary: summarize(signals),
    discarded: {
      filename: input.filename,
      bytes: input.bytes.length,
      rawTextChars: text.length,
      note: "the contract text was extracted in memory, interpreted in-boundary, and discarded; only the numeric metrics above were stored",
    },
  };
}

function validate(input: UploadInput): { ext: string; fileType: UploadDerivation["fileType"] } {
  if (input.bytes.length === 0) {
    throw new UploadError("empty_file", "the uploaded file is empty", 400);
  }
  if (input.bytes.length > MAX_UPLOAD_BYTES) {
    throw new UploadError("file_too_large", "the file exceeds the 10MB upload limit", 413);
  }
  const ext = extensionOf(input.filename);
  const spec = TYPE_BY_EXT[ext];
  if (!spec) {
    throw new UploadError(
      "unsupported_file_type",
      "only csv, xlsx, pdf, and docx uploads are accepted",
      400,
    );
  }
  const mime = (input.mime || "").split(";")[0]!.trim().toLowerCase();
  if (!TOLERATED_MIME.has(mime) && !spec.mimes.includes(mime)) {
    throw new UploadError(
      "mime_mismatch",
      "the file content type does not match a " + spec.fileType + " upload",
      400,
    );
  }
  return { ext, fileType: spec.fileType };
}

// The single entry point. Validates type and size, routes to the right parser,
// and returns the derived math plus an honest account of what was discarded. It
// never returns the raw bytes or text and never writes a file.
export async function deriveUpload(input: UploadInput): Promise<UploadDerivation> {
  const { fileType } = validate(input);
  if (fileType === "csv") return deriveCsv(input);
  if (fileType === "xlsx") return deriveXlsx(input);
  return deriveContract(input, fileType);
}
