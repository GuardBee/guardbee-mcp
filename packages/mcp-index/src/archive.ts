import zlib from "zlib";

/**
 * Source files out of a package archive, in memory: npm and sdist tarballs
 * (.tar.gz) and wheels (.zip). Bounded on every axis, since the archives come
 * from anyone who can publish a package: compressed and expanded size, file
 * count, per-file size. Only regular files under the size cap are returned;
 * links, devices and directories are skipped.
 */

export interface ArchiveFile {
  path: string;
  data: Buffer;
}

export interface ArchiveLimits {
  /** Expanded bytes in total; default 64 MB. */
  maxTotal?: number;
  /** Bytes per returned file; larger files are skipped; default 1 MB. */
  maxFile?: number;
  /** Returned files; default 5000. */
  maxFiles?: number;
  /** Which entries to keep (by path); default all. */
  keep?: (path: string) => boolean;
}

const DEFAULTS = { maxTotal: 64 * 1024 * 1024, maxFile: 1024 * 1024, maxFiles: 5000 };

/** A path that stays inside the archive: no absolute paths, no `..` segments. */
function safePath(name: string): string | undefined {
  const parts = name.replace(/\\/g, "/").split("/").filter((p) => p && p !== ".");
  if (name.startsWith("/") || parts.some((p) => p === "..")) return undefined;
  return parts.join("/");
}

const field = (block: Buffer, start: number, length: number) => {
  const raw = block.subarray(start, start + length);
  const nul = raw.indexOf(0);
  return raw.subarray(0, nul < 0 ? raw.length : nul).toString("utf8");
};
const octal = (block: Buffer, start: number, length: number) => parseInt(field(block, start, length).trim() || "0", 8);

export function readTarGz(archive: Buffer, limits: ArchiveLimits = {}): ArchiveFile[] {
  const { maxTotal, maxFile, maxFiles } = { ...DEFAULTS, ...limits };
  const tar = zlib.gunzipSync(archive, { maxOutputLength: maxTotal });
  const files: ArchiveFile[] = [];
  let offset = 0;
  let longName: string | undefined;
  let paxPath: string | undefined;
  while (offset + 512 <= tar.length && files.length < maxFiles) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    const prefix = field(header, 345, 155);
    const name = field(header, 0, 100);
    const body = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === "L") {
      longName = field(body, 0, body.length);
      continue;
    }
    if (type === "x") {
      paxPath = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString("utf8"))?.[1];
      continue;
    }
    if (type === "g") continue;
    const fullName = longName ?? paxPath ?? (prefix ? `${prefix}/${name}` : name);
    longName = paxPath = undefined;
    if (type !== "0" && type !== "\0" && type !== "7") continue;
    const p = safePath(fullName);
    if (!p || size > maxFile || (limits.keep && !limits.keep(p))) continue;
    files.push({ path: p, data: Buffer.from(body) });
  }
  return files;
}

export function readZip(archive: Buffer, limits: ArchiveLimits = {}): ArchiveFile[] {
  const { maxTotal, maxFile, maxFiles } = { ...DEFAULTS, ...limits };
  // End of central directory: the last 0x06054b50 within the trailing 64 KB comment window
  let eocd = -1;
  for (let i = archive.length - 22; i >= Math.max(0, archive.length - 22 - 65_535); i--) {
    if (archive.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip archive");
  const entries = archive.readUInt16LE(eocd + 10);
  let at = archive.readUInt32LE(eocd + 16);
  const files: ArchiveFile[] = [];
  let total = 0;
  for (let n = 0; n < entries && files.length < maxFiles; n++) {
    if (archive.readUInt32LE(at) !== 0x02014b50) throw new Error("corrupt zip central directory");
    const method = archive.readUInt16LE(at + 10);
    const compressed = archive.readUInt32LE(at + 20);
    const size = archive.readUInt32LE(at + 24);
    const nameLength = archive.readUInt16LE(at + 28);
    const extraLength = archive.readUInt16LE(at + 30);
    const commentLength = archive.readUInt16LE(at + 32);
    const local = archive.readUInt32LE(at + 42);
    const name = archive.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    at += 46 + nameLength + extraLength + commentLength;
    const p = safePath(name);
    if (!p || name.endsWith("/") || size > maxFile || (limits.keep && !limits.keep(p))) continue;
    if (archive.readUInt32LE(local) !== 0x04034b50) continue;
    const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    const raw = archive.subarray(start, start + compressed);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw, { maxOutputLength: maxFile });
    else continue;
    total += data.length;
    if (total > maxTotal) break;
    files.push({ path: p, data });
  }
  return files;
}
