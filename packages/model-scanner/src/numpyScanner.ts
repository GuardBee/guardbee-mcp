import { closeSync, openSync, readSync, statSync } from "fs";
import { scanPickleBuffer } from "./pickleScanner.js";
import type { Finding } from "./scanner.js";
import { extractZipEntryPrefix, readZipEntries } from "./zip.js";

const NPY_MAGIC = Buffer.from([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59]); // \x93NUMPY
const MAX_PICKLE_BYTES = 10 * 1024 * 1024;
const MAX_NPZ_ENTRIES = 10_000;
const PICKLE_FIRST_BYTES = [0x80, 0x28, 0x63, 0x7d, 0x5d];

function mk(id: string, name: string, category: string, severity: Finding["severity"], recommendation: string, file: string, match = "", context = ""): Finding {
  return { patternId: id, patternName: name, category, severity, recommendation, file, line: 1, column: 1, match, context };
}

export interface NpyHeader {
  version: number;
  descr: string;
  dataOffset: number;
}

export function parseNpyHeader(buf: Buffer): NpyHeader | null {
  if (buf.length < 10 || !buf.subarray(0, 6).equals(NPY_MAGIC)) return null;
  const major = buf[6];
  const wide = major >= 2;
  const headerLen = wide ? (buf.length >= 12 ? buf.readUInt32LE(8) : -1) : buf.readUInt16LE(8);
  const start = wide ? 12 : 10;
  if (headerLen < 0 || start + headerLen > buf.length) return null;
  const header = buf.toString(major >= 3 ? "utf8" : "latin1", start, start + headerLen);
  const m = /['"]descr['"]\s*:\s*(.*?)\s*,\s*['"](?:fortran_order|shape)['"]/s.exec(header);
  return { version: major, descr: m ? m[1] : "", dataOffset: start + headerLen };
}

/** An object dtype ('O') anywhere in the descr, including inside structured fields. */
export function descrHasObject(descr: string): boolean {
  return /['"][<>|=]?O\d*['"]/.test(descr);
}

/**
 * A .npy holding Python objects stores them as a pickle after the header;
 * np.load unpickles it when allow_pickle=True. A file that is not .npy at all
 * but a bare pickle is unpickled by np.load(allow_pickle=True) too.
 */
export function scanNpyBuffer(buf: Buffer, file: string, where: string): Finding[] {
  const header = parseNpyHeader(buf);
  if (!header) {
    if (buf.length > 0 && PICKLE_FIRST_BYTES.includes(buf[0])) {
      const { findings } = scanPickleBuffer(buf, file, where);
      return [
        mk("numpy_disguised_pickle", "NumPy file is a plain pickle", "deserialization", "high",
          "This file has a NumPy extension but no \\x93NUMPY header; np.load(..., allow_pickle=True) falls back to pickle.load for such files and runs whatever it references. Treat it as an untrusted pickle.", file, where),
        ...findings,
      ];
    }
    return [mk("numpy_bad_header", "NumPy file without a valid .npy header", "format-integrity", "medium",
      "The file does not start with the \\x93NUMPY magic and a readable header. Verify what it really is before loading.", file, where)];
  }
  if (!descrHasObject(header.descr)) return [];
  const pickle = buf.subarray(header.dataOffset);
  const { findings } = scanPickleBuffer(pickle, file, `${where}, object array data`);
  return [
    mk("numpy_object_array", "NumPy array with object dtype (pickled data)", "deserialization", "medium",
      "Object arrays are stored as a pickle and need np.load(..., allow_pickle=True), which runs any code the pickle references. Prefer numeric dtypes; keep allow_pickle=False for files from outside your organisation.", file, `descr ${header.descr}`, where),
    ...findings,
  ];
}

export function scanNpyFile(filePath: string): Finding[] {
  const size = statSync(filePath).size;
  const buf = Buffer.alloc(Math.min(size, MAX_PICKLE_BYTES));
  const fd = openSync(filePath, "r");
  try {
    readSync(fd, buf, 0, buf.length, 0);
  } finally {
    closeSync(fd);
  }
  return scanNpyBuffer(buf, filePath, "npy");
}

export function scanNpzFile(filePath: string): Finding[] {
  const size = statSync(filePath).size;
  const fd = openSync(filePath, "r");
  try {
    const entries = readZipEntries(fd, size).filter((e) => !e.name.endsWith("/"));
    if (entries.length === 0) {
      return [mk("numpy_npz_unreadable", "NumPy .npz archive has no readable entries", "format-integrity", "medium",
        "The archive's central directory could not be read. Verify the file before loading it.", filePath)];
    }
    const findings: Finding[] = [];
    for (const entry of entries.slice(0, MAX_NPZ_ENTRIES)) {
      const where = `npz entry ${entry.name}`;
      const data = extractZipEntryPrefix(fd, entry, MAX_PICKLE_BYTES);
      if (!data) {
        findings.push(mk("numpy_npz_entry_unreadable", "Could not read an .npz entry", "format-integrity", "low",
          "Only STORED and DEFLATE entries are supported. This entry was not checked.", filePath, entry.name));
        continue;
      }
      findings.push(...scanNpyBuffer(data, filePath, where));
    }
    if (entries.length > MAX_NPZ_ENTRIES) {
      findings.push(mk("numpy_npz_partial_scan", `Only the first ${MAX_NPZ_ENTRIES} .npz entries were checked`, "format-integrity", "low",
        "The archive has more entries than the scan limit.", filePath, `${entries.length} entries`));
    }
    return findings;
  } finally {
    closeSync(fd);
  }
}
