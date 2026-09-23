import { openSync, readSync, closeSync, statSync } from "fs";
import type { Finding } from "./scanner.js";

const MAX_SCAN_BYTES = 10 * 1024 * 1024;
const HDF5_MAGIC = Buffer.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);

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
 * HDF5 is a complex binary format (a B-tree of typed groups/datasets/attributes);
 * fully parsing it is out of scope here. Instead this does a bounded text-pattern
 * search — the same approach other lightweight model scanners use — for the one
 * well-known Keras RCE vector: a Lambda layer, whose serialized config embeds a
 * marshalled Python code object that older Keras versions execute on load.
 */
export function scanH5File(filePath: string): Finding[] {
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

  if (!buf.subarray(0, 8).equals(HDF5_MAGIC)) {
    findings.push(mkFinding(
      "h5_extension_mismatch",
      "File has an .h5/.hdf5/.keras extension but does not start with the HDF5 file signature",
      "format-integrity",
      "high",
      "This is not a valid HDF5 file despite its extension — could be a renamed pickle or another disguised format. Verify the real format before loading.",
      filePath
    ));
    return findings;
  }

  const text = buf.toString("latin1");

  if (/"class_name"\s*:\s*"Lambda"/.test(text)) {
    findings.push(mkFinding(
      "keras_lambda_layer",
      "Model config contains a Keras Lambda layer",
      "code-execution",
      "critical",
      "Older Keras versions serialize a Lambda layer's function as a marshalled Python code object, deserialized and executed on load. Rebuild the model with a named/registered layer instead of Lambda, or fully trust this file's provenance before loading it.",
      filePath
    ));
  }

  if (/marshal\.loads|__lambda_func|py_function/.test(text)) {
    findings.push(mkFinding(
      "keras_marshal_reference",
      "Model config references marshal-based function deserialization",
      "code-execution",
      "high",
      "This pattern is associated with executable-code-carrying layer configs (Lambda / custom py_function). Review the model config before loading.",
      filePath
    ));
  }

  if (toRead < fileSize) {
    findings.push(mkFinding(
      "h5_partial_scan",
      `Only scanned the first ${(toRead / 1024 / 1024).toFixed(1)}MB of a ${(fileSize / 1024 / 1024).toFixed(1)}MB file`,
      "format-integrity",
      "low",
      "This scanner does a bounded text-pattern heuristic rather than full HDF5 structural parsing. A clean result here is not a full guarantee.",
      filePath
    ));
  }

  return findings;
}
