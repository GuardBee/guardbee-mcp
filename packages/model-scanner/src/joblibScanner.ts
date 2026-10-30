import { closeSync, openSync, readSync, statSync } from "fs";
import { gunzipSync, inflateSync } from "zlib";
import { ByteSource } from "./byteSource.js";
import { findingsForGlobals } from "./pickleScanner.js";
import type { GlobalRef } from "./pickleScanner.js";
import { dictGet, isGlobal, isObj, runPickle, tupleItems } from "./pickleVm.js";
import type { PValue } from "./pickleVm.js";
import type { Finding } from "./scanner.js";

const MAX_DECOMPRESSED_BYTES = 512 * 1024 * 1024;

function info(id: string, name: string, severity: Finding["severity"], recommendation: string, file: string, match = ""): Finding {
  return { patternId: id, patternName: name, category: "format-integrity", severity, recommendation, file, line: 1, column: 1, match, context: "" };
}

/** Item size and object-ness of a pickled numpy.dtype, from its reduce args and state tuple. */
export function dtypeLayout(dtype: PValue | undefined): { itemsize: number; hasObject: boolean } | null {
  if (!isObj(dtype)) return null;
  const descr = tupleItems(dtype.args)?.[0];
  if (typeof descr !== "string") return null;
  const m = /^[<>|=]?([A-Za-z?])(\d*)/.exec(descr);
  if (!m) return null;
  const [, kind, digits] = m;
  const state = tupleItems(dtype.state);
  const elsize = state && typeof state[5] === "number" && state[5] > 0 ? state[5] : null;
  const flags = state && typeof state[state.length - 1] === "number" ? (state[state.length - 1] as number) : 0;
  const hasObject = kind === "O" || (flags & 1) === 1;
  let itemsize: number;
  if (elsize !== null) itemsize = elsize;
  else if (kind === "U" || kind === "w") itemsize = 4 * Number(digits || 0);
  else if (kind === "?") itemsize = 1;
  else if (kind === "M" || kind === "m") itemsize = 8;
  else itemsize = Number(digits || 0);
  return { itemsize, hasObject };
}

function isArrayWrapper(cls: PValue): boolean {
  return isGlobal(cls) && cls.name === "NumpyArrayWrapper" && /(^|\.)numpy_pickle$/.test(cls.module);
}

/**
 * joblib.dump writes NumPy arrays outside the pickle: after each
 * NumpyArrayWrapper is built come either the raw array bytes (with an
 * alignment padding byte since joblib 1.2) or, for object arrays, a whole
 * nested pickle. Walking those is what lets every pickle opcode in the file,
 * including the nested ones, be checked.
 */
export function scanJoblibSource(src: ByteSource, filePath: string, note?: string): { findings: Finding[]; complete: boolean } {
  const globals: GlobalRef[] = [];
  let skipError: string | undefined;
  const run = runPickle(src, 0, {
    onBuild(obj, next, sub) {
      if (!isArrayWrapper(obj.cls)) return next;
      const shape = tupleItems(dictGet(obj.state, "shape"));
      const layout = dtypeLayout(dictGet(obj.state, "dtype"));
      if (!shape || !layout || shape.some((d) => typeof d !== "number" || d < 0)) {
        skipError = "a NumpyArrayWrapper without a readable shape/dtype";
        return null;
      }
      if (layout.hasObject) {
        const nested = sub(next);
        globals.push(...nested.globals);
        return nested.stopped ? nested.end : null;
      }
      let pos = next;
      const align = dictGet(obj.state, "numpy_array_alignment_bytes");
      if (typeof align === "number" && align > 0) {
        const pad = src.u8(pos);
        if (pad === null) return null;
        pos += 1 + pad;
      }
      const nbytes = (shape as number[]).reduce((a, b) => a * b, 1) * layout.itemsize;
      if (!Number.isSafeInteger(nbytes) || pos + nbytes > src.length) {
        skipError = "an array whose size runs past the end of the file";
        return null;
      }
      return pos + nbytes;
    },
  });
  globals.unshift(...run.globals);
  const findings = findingsForGlobals(globals, filePath, note ? `joblib, ${note}` : "joblib");
  if (!run.stopped) {
    findings.push(info(
      "joblib_partial_scan",
      "joblib file could not be walked to the end",
      "low",
      `Parsing stopped (${skipError ?? run.error ?? "unknown reason"}) at byte ${run.end}. Globals after that point were not checked; load this file only from a trusted source.`,
      filePath
    ));
  }
  return { findings, complete: run.stopped };
}

export function scanJoblibFile(filePath: string): Finding[] {
  const size = statSync(filePath).size;
  const fd = openSync(filePath, "r");
  try {
    const head = Buffer.alloc(Math.min(size, 6));
    readSync(fd, head, 0, head.length, 0);
    const lzmaAlone = head[0] === 0x5d && head[1] === 0x00;
    if (!lzmaAlone && [0x80, 0x28, 0x63, 0x7d, 0x5d].includes(head[0])) {
      return scanJoblibSource(new ByteSource(fd, size), filePath).findings;
    }
    const isZlib = head[0] === 0x78 && [0x01, 0x5e, 0x9c, 0xda].includes(head[1]);
    const isGzip = head[0] === 0x1f && head[1] === 0x8b;
    if (isZlib || isGzip) {
      if (size > MAX_DECOMPRESSED_BYTES) {
        return [info("joblib_compressed_too_large", "Compressed joblib file too large to decompress for scanning", "medium", "The file is compressed and larger than the scan limit, so its pickle stream was not checked. Load it only from a trusted source.", filePath)];
      }
      const raw = Buffer.alloc(size);
      readSync(fd, raw, 0, size, 0);
      let data: Buffer;
      try {
        data = isZlib ? inflateSync(raw, { maxOutputLength: MAX_DECOMPRESSED_BYTES }) : gunzipSync(raw, { maxOutputLength: MAX_DECOMPRESSED_BYTES });
      } catch {
        return [info("joblib_decompress_failed", "Compressed joblib file could not be decompressed", "medium", "The file is zlib/gzip-compressed but did not decompress within the scan limit (corrupt, or larger than 512 MB uncompressed). Its pickle stream was not checked.", filePath)];
      }
      return scanJoblibSource(ByteSource.fromBuffer(data), filePath, isZlib ? "zlib-compressed" : "gzip-compressed").findings;
    }
    const codec = head.subarray(0, 3).toString("latin1") === "BZh" ? "bz2"
      : head.subarray(0, 6).equals(Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) ? "xz"
      : head.readUInt32LE(0) === 0x184d2204 ? "lz4"
      : lzmaAlone ? "lzma"
      : null;
    if (codec) {
      return [info("joblib_compressed_unsupported", `joblib file compressed with ${codec}`, "medium", `This scanner decompresses zlib and gzip only, so the pickle inside this ${codec}-compressed file was not checked. Re-save it uncompressed or with compress=("zlib", 3) to scan it, or load it only from a trusted source.`, filePath, codec)];
    }
    return [info("joblib_unrecognized", "File does not start like a joblib/pickle stream", "medium", "The extension says joblib but the content is neither a pickle nor a zlib/gzip/bz2/xz/lz4/lzma stream. Verify what this file really is before loading it.", filePath)];
  } finally {
    closeSync(fd);
  }
}
