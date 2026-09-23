import { openSync, readSync, closeSync, statSync } from "fs";
import type { Finding } from "./scanner.js";

const MAX_SCAN_BYTES = 10 * 1024 * 1024;

function mkFinding(
  id: string,
  name: string,
  category: string,
  severity: "critical" | "high" | "medium" | "low",
  recommendation: string,
  file?: string
): Finding {
  return { patternId: id, patternName: name, category, severity, recommendation, file, line: 1, column: 1, match: name, context: "" };
}

/**
 * ONNX is a protobuf format; a full parse is out of scope here. Instead this
 * does a bounded text-pattern search for the one well-documented ONNX loader
 * risk that's greppable without a protobuf schema: an `external_data` tensor
 * reference whose relative path escapes the model's own directory.
 */
export function scanOnnxFile(filePath: string): Finding[] {
  const findings: Finding[] = [];
  const fileSize = statSync(filePath).size;
  const toRead = Math.min(fileSize, MAX_SCAN_BYTES);
  const buf = Buffer.alloc(toRead);

  const fd = openSync(filePath, "r");
  try {
    readSync(fd, buf, 0, toRead, 0);
  } finally {
    closeSync(fd);
  }

  const text = buf.toString("latin1");

  const extDataRegex = /external_data[\s\S]{0,40}?location[\s\S]{0,4}([^\x00-\x1f]{1,200})/g;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = extDataRegex.exec(text)) !== null) {
    const candidate = m[1];
    if (candidate && candidate.includes("..") && !seen.has(candidate)) {
      seen.add(candidate);
      findings.push(mkFinding(
        "onnx_external_data_path_traversal",
        "external_data location path contains a '..' traversal segment",
        "filesystem",
        "high",
        "ONNX models can reference tensor data in an external file by relative path. A path containing '..' can escape the model's directory and read an arbitrary file when a loader resolves it naively. Reject or sanitize this path before loading.",
        filePath
      ));
    }
  }

  if (toRead < fileSize) {
    findings.push(mkFinding(
      "onnx_partial_scan",
      `Only scanned the first ${(toRead / 1024 / 1024).toFixed(1)}MB of a ${(fileSize / 1024 / 1024).toFixed(1)}MB file`,
      "format-integrity",
      "low",
      "This scanner does a bounded text-pattern heuristic on a size-limited prefix rather than a full protobuf parse. A clean result here is not a full guarantee.",
      filePath
    ));
  }

  return findings;
}
