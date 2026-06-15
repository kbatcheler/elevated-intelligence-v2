import { inflateRawSync } from "node:zlib";

// A minimal, read-only ZIP reader built on Node's zlib only (Phase AE). XLSX and
// DOCX are ZIP containers of XML, so reading a named member back to text needs a
// central-directory walk plus a raw-deflate inflate. No dependency is added; this
// reads, it never writes an archive. It is deliberately small: it understands the
// store (0) and deflate (8) methods that office files actually use, refuses
// anything else loudly, and bounds decompression so a crafted member cannot blow
// up memory.

const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

// A hard ceiling on any single inflated member. Office XML parts are small; a
// member that claims to expand past this is treated as hostile and refused.
const MAX_MEMBER_BYTES = 64 * 1024 * 1024;

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

// The End Of Central Directory record sits at the tail, after an optional comment
// of up to 65535 bytes. Scan backward from the earliest legal position.
function findEocd(buf: Buffer): number {
  const minPos = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= minPos; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

export function readZipEntries(buf: Buffer): ZipEntry[] {
  if (buf.length < 22) throw new Error("not a zip archive (too short)");
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error("not a zip archive (no end of central directory)");
  const total = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < total; i += 1) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== CDH_SIG) {
      throw new Error("corrupt zip central directory");
    }
    const method = buf.readUInt16LE(off + 10);
    const compressedSize = buf.readUInt32LE(off + 20);
    const uncompressedSize = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localHeaderOffset = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// Read one member's bytes. Sizes come from the central directory (the local
// header may zero them when a data descriptor follows); the local header is read
// only to skip its variable-length name and extra fields to the data start.
export function readZipFile(buf: Buffer, entry: ZipEntry): Buffer {
  const o = entry.localHeaderOffset;
  if (o + 30 > buf.length || buf.readUInt32LE(o) !== LFH_SIG) {
    throw new Error("corrupt zip local header");
  }
  if (entry.uncompressedSize > MAX_MEMBER_BYTES) {
    throw new Error("zip member exceeds the maximum inflated size");
  }
  const nameLen = buf.readUInt16LE(o + 26);
  const extraLen = buf.readUInt16LE(o + 28);
  const dataStart = o + 30 + nameLen + extraLen;
  const data = buf.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) {
    return inflateRawSync(data, { maxOutputLength: MAX_MEMBER_BYTES });
  }
  throw new Error("unsupported zip compression method " + entry.method);
}

// Read a single named member back to UTF-8 text, or null when it is absent.
export function readZipMemberText(buf: Buffer, name: string): string | null {
  const entry = readZipEntries(buf).find((e) => e.name === name);
  if (!entry) return null;
  return readZipFile(buf, entry).toString("utf8");
}
