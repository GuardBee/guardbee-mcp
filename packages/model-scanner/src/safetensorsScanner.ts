import { openSync, readSync, closeSync, statSync } from "fs";
import type { Finding } from "./scanner.js";

const MAX_HEADER_SIZE = 100 * 1024 * 1024; // sanity cap — real headers are KB-sized

const VALID_DTYPES = new Set([
  "F64", "F32", "F16", "BF16", "I64", "I32", "I16", "I8",
  "U64", "U32", "U16", "U8", "BOOL", "F8_E4M3", "F8_E5M2",
]);

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

interface TensorInfo {
  dtype?: string;
  shape?: number[];
  data_offsets?: [number, number];
}

/**
 * Validates a .safetensors file's structure: an 8-byte little-endian header
 * length, followed by that many bytes of UTF-8 JSON describing each tensor's
 * dtype/shape/byte range. Unlike pickle, the format has no opcodes to execute —
 * the risk here is a malformed or adversarially crafted header confusing a
 * downstream parser (out-of-bounds offsets), or the extension being used to
 * disguise a different, executable format.
 */
export function scanSafetensorsFile(filePath: string): Finding[] {
  const findings: Finding[] = [];
  const fileSize = statSync(filePath).size;

  if (fileSize < 8) {
    findings.push(mkFinding(
      "safetensors_too_small",
      "File smaller than the mandatory 8-byte safetensors header length field",
      "format-integrity",
      "medium",
      "A valid safetensors file must be at least 8 bytes. Treat this file as invalid/corrupt.",
      filePath
    ));
    return findings;
  }

  const fd = openSync(filePath, "r");
  try {
    const lenBuf = Buffer.alloc(8);
    readSync(fd, lenBuf, 0, 8, 0);

    if (lenBuf[0] === 0x80 || (lenBuf[0] === 0x50 && lenBuf[1] === 0x4b)) {
      findings.push(mkFinding(
        "safetensors_disguised_binary",
        "File has a .safetensors extension but starts with a pickle or zip signature, not a header length",
        "format-integrity",
        "critical",
        "Renaming a pickle (or a PyTorch zip checkpoint) to .safetensors is a known technique to bypass tools/assumptions that treat safetensors as inherently safe. Re-scan this file as its real format, not by its extension.",
        filePath
      ));
      return findings;
    }

    const headerLen = Number(lenBuf.readBigUInt64LE(0));
    if (headerLen <= 0 || headerLen > MAX_HEADER_SIZE || 8 + headerLen > fileSize) {
      findings.push(mkFinding(
        "safetensors_invalid_header_length",
        `Declared header length (${headerLen}) is invalid or exceeds the file size`,
        "format-integrity",
        "high",
        "A corrupted or adversarially crafted header length can cause a naive parser to over-read or crash. Do not load this file with a parser that trusts the header length without bounds-checking.",
        filePath
      ));
      return findings;
    }

    const headerBuf = Buffer.alloc(headerLen);
    readSync(fd, headerBuf, 0, headerLen, 8);

    let header: Record<string, unknown>;
    try {
      header = JSON.parse(headerBuf.toString("utf8"));
    } catch {
      findings.push(mkFinding(
        "safetensors_invalid_json_header",
        "Safetensors header is not valid JSON",
        "format-integrity",
        "high",
        "The header must be a UTF-8 JSON object. An invalid header means this file will fail to load correctly with the reference implementation, or targets a different, more lenient parser.",
        filePath
      ));
      return findings;
    }

    const metadata = header["__metadata__"];
    if (metadata && typeof metadata === "object") {
      const metaStr = JSON.stringify(metadata);
      if (/\b(?:eval|exec|import\s+os|subprocess|__import__|os\.system)\b/.test(metaStr)) {
        findings.push(mkFinding(
          "safetensors_suspicious_metadata",
          "The __metadata__ field contains code-execution-related keywords",
          "format-integrity",
          "medium",
          "safetensors metadata is inert — the reference loader never evaluates it. But if it flows into some other downstream code path (e.g. a custom loader that eval()s a metadata field), this content is worth a manual look.",
          filePath
        ));
      }
    }

    const dataSectionSize = fileSize - 8 - headerLen;
    for (const [name, value] of Object.entries(header)) {
      if (name === "__metadata__") continue;
      const t = value as TensorInfo;

      if (t.dtype && !VALID_DTYPES.has(t.dtype)) {
        findings.push(mkFinding(
          "safetensors_unknown_dtype",
          `Tensor "${name}" declares an unrecognized dtype "${t.dtype}"`,
          "format-integrity",
          "low",
          "Not one of the standard safetensors dtypes. May be a newer dtype this scanner doesn't know about yet, but is also a way a hand-crafted header could target a specific downstream parser's edge cases.",
          filePath
        ));
      }

      if (Array.isArray(t.data_offsets) && t.data_offsets.length === 2) {
        const [start, end] = t.data_offsets;
        if (start < 0 || end < start || end > dataSectionSize) {
          findings.push(mkFinding(
            "safetensors_offset_out_of_bounds",
            `Tensor "${name}" declares data offsets [${start}, ${end}] outside the actual tensor data section (${dataSectionSize} bytes)`,
            "format-integrity",
            "high",
            "A parser that trusts these offsets without bounds-checking could read out-of-bounds file content. Reject this file rather than loading it as-is.",
            filePath
          ));
        }
      }
    }
  } finally {
    closeSync(fd);
  }

  return findings;
}
