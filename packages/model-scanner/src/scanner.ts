import { statSync, readdirSync, openSync, readSync, closeSync } from "fs";
import { join, relative, extname } from "path";
import { scanPickleBuffer } from "./pickleScanner.js";
import { scanSafetensorsFile } from "./safetensorsScanner.js";
import { scanH5File } from "./h5Scanner.js";
import { scanOnnxFile } from "./onnxScanner.js";
import { readZipEntries, extractZipEntry } from "./zip.js";

export interface Finding {
  patternId: string;
  patternName: string;
  category: string;
  severity: "critical" | "high" | "medium" | "low";
  recommendation: string;
  file?: string;
  /** Model files are binary — line/column are always 1, kept for SARIF/CLI parity with GuardBee's other scanners. */
  line: number;
  column: number;
  match: string;
  context: string;
}

export interface ScanResult {
  scannedFiles: number;
  skippedFiles: number;
  totalFindings: number;
  findings: Finding[];
  durationMs: number;
}

const MAX_PICKLE_SCAN_BYTES = 10 * 1024 * 1024;
const MAX_ZIP_ENTRY_BYTES = 50 * 1024 * 1024;

const MODEL_EXTENSIONS = new Set([
  ".pkl", ".pickle", ".pt", ".pth", ".ckpt", ".bin",
  ".safetensors", ".h5", ".hdf5", ".keras", ".onnx",
]);

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".svn", "dist", "build", ".next",
  "__pycache__", ".mypy_cache", ".pytest_cache", "venv", ".venv",
  "coverage", ".nyc_output",
]);

function readPrefix(filePath: string, maxBytes: number): { buf: Buffer; fileSize: number } {
  const fileSize = statSync(filePath).size;
  const toRead = Math.min(fileSize, maxBytes);
  const buf = Buffer.alloc(toRead);
  const fd = openSync(filePath, "r");
  try {
    readSync(fd, buf, 0, toRead, 0);
  } finally {
    closeSync(fd);
  }
  return { buf, fileSize };
}

function infoFinding(id: string, name: string, recommendation: string, filePath: string, severity: Finding["severity"] = "low"): Finding {
  return { patternId: id, patternName: name, category: "format-integrity", severity, recommendation, file: filePath, line: 1, column: 1, match: "", context: "" };
}

function scanZipModel(filePath: string): { findings: Finding[]; skipped: boolean; format: string } {
  const fileSize = statSync(filePath).size;
  const fd = openSync(filePath, "r");
  try {
    const entries = readZipEntries(fd, fileSize);
    const dataPkl = entries.find((e) => e.name === "data.pkl" || e.name.endsWith("/data.pkl"));

    if (!dataPkl) {
      return {
        findings: [infoFinding(
          "zip_no_data_pkl",
          "Zip archive with no recognized data.pkl entry",
          "This doesn't match the standard PyTorch zip checkpoint layout (an <archive>/data.pkl entry). Not scanned as a pickle — verify manually if this is meant to be a model checkpoint.",
          filePath
        )],
        skipped: false,
        format: "zip-unrecognized",
      };
    }

    if (dataPkl.uncompressedSize > MAX_ZIP_ENTRY_BYTES) {
      return {
        findings: [infoFinding(
          "zip_data_pkl_too_large",
          "data.pkl entry exceeds the scan size limit",
          `data.pkl is normally a small metadata pickle; this one claims to decompress to over ${MAX_ZIP_ENTRY_BYTES / 1024 / 1024}MB, which is unusual and was not extracted to avoid a decompression-bomb risk. Investigate manually.`,
          filePath,
          "medium"
        )],
        skipped: false,
        format: "zip-suspicious",
      };
    }

    const extracted = extractZipEntry(fd, dataPkl);
    if (!extracted) {
      return {
        findings: [infoFinding(
          "zip_data_pkl_extract_failed",
          "Could not extract data.pkl (unsupported compression method or corrupt archive)",
          "Only STORED and DEFLATE compression are supported by this scanner. Investigate manually with a full Python toolchain.",
          filePath,
          "medium"
        )],
        skipped: false,
        format: "zip-unreadable",
      };
    }

    const { findings } = scanPickleBuffer(extracted, filePath, `inside zip entry ${dataPkl.name}`);
    return { findings, skipped: false, format: "pytorch-zip" };
  } finally {
    closeSync(fd);
  }
}

export function scanModelFile(filePath: string): { findings: Finding[]; skipped: boolean; format: string } {
  const ext = extname(filePath).toLowerCase();
  if (!MODEL_EXTENSIONS.has(ext)) return { findings: [], skipped: true, format: "unsupported" };

  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    return { findings: [], skipped: true, format: "unreadable" };
  }
  if (!stat.isFile() || stat.size === 0) return { findings: [], skipped: true, format: "empty" };

  const { buf: sniff } = readPrefix(filePath, 4);
  if (sniff.length === 4 && sniff[0] === 0x50 && sniff[1] === 0x4b && sniff[2] === 0x03 && sniff[3] === 0x04) {
    return scanZipModel(filePath);
  }

  if (ext === ".safetensors") {
    return { findings: scanSafetensorsFile(filePath), skipped: false, format: "safetensors" };
  }
  if (ext === ".h5" || ext === ".hdf5" || ext === ".keras") {
    return { findings: scanH5File(filePath), skipped: false, format: "hdf5" };
  }
  if (ext === ".onnx") {
    return { findings: scanOnnxFile(filePath), skipped: false, format: "onnx" };
  }

  // Remaining candidates (.pkl/.pickle/.pt/.pth/.ckpt/.bin) are treated as a
  // raw (non-zip, legacy torch.save) pickle stream.
  const { buf, fileSize } = readPrefix(filePath, MAX_PICKLE_SCAN_BYTES);

  const looksLikePickle = buf.length > 0 && [0x80, 0x28, 0x63, 0x7d, 0x5d, 0x8c].includes(buf[0]);
  if (!looksLikePickle) {
    return { findings: [], skipped: true, format: "not-a-pickle" };
  }

  const note = fileSize > buf.length ? `scanned first ${(buf.length / 1024 / 1024).toFixed(1)}MB of ${(fileSize / 1024 / 1024).toFixed(1)}MB` : undefined;
  const { findings } = scanPickleBuffer(buf, filePath, note);

  if (note) {
    findings.push(infoFinding(
      "pickle_partial_scan",
      "Only scanned the first 10MB of a larger file",
      "Dangerous global references almost always appear early in a pickle stream (types must be referenced before their instances), but a bounded scan is not a full guarantee for adversarially unusual layouts.",
      filePath
    ));
  }

  return { findings, skipped: false, format: "pickle" };
}

export function scanDirectory(
  dirPath: string,
  options: { maxFiles?: number; include?: string[]; exclude?: string[] } = {}
): ScanResult {
  const start = Date.now();
  const { maxFiles = 2000, include, exclude } = options;
  const allFindings: Finding[] = [];
  let scannedFiles = 0;
  let skippedFiles = 0;

  function walk(dir: string) {
    if (scannedFiles + skippedFiles >= maxFiles) return;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        if (exclude?.some((ex) => entry.name === ex || fullPath.includes(ex))) continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        const relPath = relative(dirPath, fullPath);
        if (exclude?.some((ex) => relPath.includes(ex))) {
          skippedFiles++;
          continue;
        }
        if (include && !include.some((inc) => relPath.includes(inc))) {
          skippedFiles++;
          continue;
        }

        const { findings, skipped } = scanModelFile(fullPath);
        if (skipped) {
          skippedFiles++;
        } else {
          scannedFiles++;
          allFindings.push(...findings);
        }
      }
    }
  }

  walk(dirPath);

  return {
    scannedFiles,
    skippedFiles,
    totalFindings: allFindings.length,
    findings: allFindings,
    durationMs: Date.now() - start,
  };
}
