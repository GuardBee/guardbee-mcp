import { closeSync, openSync, statSync } from "fs";
import { ByteSource } from "./byteSource.js";
import type { Finding } from "./scanner.js";

const GGUF_MAGIC = 0x46554747; // "GGUF" read little-endian
const MAX_KV = 1_000_000;
const MAX_TENSORS = 1_000_000;
const MAX_STRING_BYTES = 256 * 1024 * 1024;
const MAX_TEXT_CHECK_BYTES = 1024 * 1024;
const GGML_MAX_DIMS = 4;
const GGML_MAX_NAME = 64;
const MAX_REPORTED_TENSORS = 5;

/** Fixed byte size of each GGUF metadata value type; 8 (string) and 9 (array) are variable. */
const VALUE_SIZE: Record<number, number> = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };

/** ggml tensor types still in use: [elements per block, bytes per block]. */
const GGML_TYPES: Record<number, [number, number]> = {
  0: [1, 4], 1: [1, 2], 2: [32, 18], 3: [32, 20], 6: [32, 22], 7: [32, 24], 8: [32, 34], 9: [32, 36],
  10: [256, 84], 11: [256, 110], 12: [256, 144], 13: [256, 176], 14: [256, 210], 15: [256, 292],
  16: [256, 66], 17: [256, 74], 18: [256, 98], 19: [256, 50], 20: [32, 18], 21: [256, 110], 22: [256, 82],
  23: [256, 136], 24: [1, 1], 25: [1, 2], 26: [1, 4], 27: [1, 8], 28: [1, 8], 29: [256, 56], 30: [1, 2],
  34: [256, 54], 35: [256, 66], 39: [32, 17],
};

function mk(id: string, name: string, category: string, severity: Finding["severity"], recommendation: string, file: string, match = "", context = ""): Finding {
  return { patternId: id, patternName: name, category, severity, recommendation, file, line: 1, column: 1, match, context };
}

class Malformed extends Error {}

const SSTI = /__(?:class|mro|subclasses|globals|builtins|import|init|base|bases|getattribute|dict|reduce|reduce_ex|code)__|_TemplateReference__context|\bos\.(?:system|popen)\b|\bsubprocess\b|\b(?:eval|exec)\s*\(|\bimport\s+os\b/;
const HIDDEN_CHARS = /[​-‏‪-‮⁠-⁤﻿]|[\u{E0000}-\u{E007F}]/u;
const INJECTED = /\bignore (?:all |any )?(?:previous|prior|above|earlier) (?:instructions|messages|rules)|\bdisregard (?:the |all |any )?(?:previous|prior|above|system) |\bdo not (?:tell|reveal|mention|inform) (?:the user|anyone)|\bwithout (?:telling|informing|notifying) the user|\bexfiltrat|\breveal (?:the |your )?(?:system prompt|api key|password|secret)|\bsend (?:all|the|any|every) .{0,60}? to https?:\/\//i;
const URL = /\bhttps?:\/\/[^\s"'{}<>]+/;

/**
 * Checks a chat template or other metadata text that is rendered into every
 * prompt: Jinja sandbox escapes (CVE-2024-34359 ran code through an
 * unsandboxed template), hidden characters and instructions aimed at the
 * model rather than at formatting messages.
 */
export function checkTemplateText(key: string, text: string, file: string, isTemplate: boolean): Finding[] {
  const out: Finding[] = [];
  const sample = text.slice(0, MAX_TEXT_CHECK_BYTES);
  const ssti = isTemplate ? SSTI.exec(sample) : null;
  if (ssti) {
    out.push(mk("gguf_chat_template_ssti", "Chat template reaches Python internals (Jinja sandbox escape)", "code-execution", "critical",
      "The template uses Python object internals or process functions. Rendered by a Jinja environment without a sandbox (as llama-cpp-python did before 0.2.72, CVE-2024-34359), this runs code on the machine loading the model. Do not load this file; replace the chat template.", file, ssti[0], key));
  }
  const hidden = HIDDEN_CHARS.exec(sample);
  if (hidden) {
    out.push(mk("gguf_metadata_hidden_characters", "Invisible or bidirectional Unicode characters in model metadata", "prompt-injection", "high",
      "Zero-width, bidi-override or Unicode tag characters hide text from people reviewing the metadata while the model still receives it. Inspect the raw bytes of this value.", file, `U+${hidden[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`, key));
  }
  const injected = INJECTED.exec(sample);
  if (injected) {
    out.push(mk("gguf_metadata_injected_instructions", isTemplate ? "Chat template carries instructions for the model" : "Model metadata carries instructions for the model", "prompt-injection", "high",
      "A template formats messages; text that tells the model to ignore instructions, keep secrets from the user or send data somewhere is injected into every conversation. Review the template before use.", file, injected[0].slice(0, 120), key));
  }
  const url = isTemplate ? URL.exec(sample) : null;
  if (url) {
    out.push(mk("gguf_chat_template_url", "Chat template contains a URL", "prompt-injection", "low",
      "URLs are unusual in a chat template and can steer the model towards an attacker-controlled site. Check that it belongs there.", file, url[0].slice(0, 200), key));
  }
  return out;
}

/**
 * GGUF (llama.cpp and every runtime built on it): a header, typed key/value
 * metadata and tensor descriptors, then aligned tensor data. Loaders that
 * trust the counts, lengths and offsets in the header have had heap
 * overflows from crafted files, so each is checked against the file itself.
 */
export function scanGgufSource(src: ByteSource, file: string): Finding[] {
  const findings: Finding[] = [];
  let pos = 0;
  const need = (n: number): Buffer => {
    const b = src.slice(pos, n);
    if (!b) throw new Malformed(`needs ${n} bytes at offset ${pos}, past the end of the file`);
    pos += n;
    return b;
  };
  const u32 = () => need(4).readUInt32LE(0);
  const u64 = (): bigint => need(8).readBigUInt64LE(0);
  const str = (keep: boolean): string | null => {
    const len = u64();
    if (len > BigInt(MAX_STRING_BYTES) || pos + Number(len) > src.length) throw new Malformed(`string length ${len} at offset ${pos - 8} exceeds the file`);
    const n = Number(len);
    if (!keep) {
      pos += n;
      return null;
    }
    return need(n).toString("utf8");
  };
  const skipValue = (type: number, depth: number): void => {
    if (type === 8) str(false);
    else if (type === 9) {
      if (depth > 2) throw new Malformed("arrays nested deeper than two levels");
      const inner = u32();
      const count = u64();
      if (inner in VALUE_SIZE) {
        const bytes = count * BigInt(VALUE_SIZE[inner]);
        if (bytes > BigInt(src.length - pos)) throw new Malformed(`array of ${count} elements at offset ${pos - 12} exceeds the file`);
        pos += Number(bytes);
      } else if (inner === 8 || inner === 9) {
        if (count > BigInt(src.length - pos) / 8n) throw new Malformed(`array of ${count} elements at offset ${pos - 12} exceeds the file`);
        for (let i = 0n; i < count; i++) skipValue(inner, depth + 1);
      } else throw new Malformed(`unknown array element type ${inner}`);
    } else if (type in VALUE_SIZE) need(VALUE_SIZE[type]);
    else throw new Malformed(`unknown metadata value type ${type}`);
  };

  if (src.length < 24 || need(4).readUInt32LE(0) !== GGUF_MAGIC) {
    return [mk("gguf_bad_magic", "File has a .gguf extension but no GGUF header", "format-integrity", "high",
      "The file does not start with the GGUF magic. It may be a different format renamed to look like a GGUF model; verify it before loading.", file)];
  }
  const versionBytes = need(4);
  const version = versionBytes.readUInt32LE(0);
  if (version === 1 || (version > 0xffff && versionBytes.readUInt32BE(0) <= 3)) {
    return [mk("gguf_not_parsed", version === 1 ? "GGUF version 1 file (not parsed)" : "Big-endian GGUF file (not parsed)", "format-integrity", "low",
      "This scanner checks little-endian GGUF v2/v3. The file's header and metadata were not validated.", file, `version ${version}`)];
  }

  try {
    if (version !== 2 && version !== 3) throw new Malformed(`unsupported version ${version}`);
    const tensorCount = u64();
    const kvCount = u64();
    if (tensorCount > BigInt(MAX_TENSORS)) throw new Malformed(`tensor count ${tensorCount}`);
    if (kvCount > BigInt(MAX_KV)) throw new Malformed(`metadata count ${kvCount}`);

    let alignment = 32;
    for (let i = 0; i < Number(kvCount); i++) {
      const key = str(true)!;
      const type = u32();
      if (key === "general.alignment") {
        if (type !== 4) throw new Malformed(`general.alignment has type ${type}, expected uint32`);
        alignment = u32();
        if (alignment === 0 || (alignment & (alignment - 1)) !== 0) throw new Malformed(`general.alignment ${alignment} is not a power of two`);
      } else if (type === 8 && !key.startsWith("tokenizer.ggml.")) {
        const value = str(true)!;
        findings.push(...checkTemplateText(key, value, file, key.startsWith("tokenizer.chat_template")));
      } else {
        skipValue(type, 0);
      }
    }

    const names = new Set<string>();
    const tensors: Array<{ name: string; offset: bigint; bytes: bigint | null; type: number }> = [];
    for (let i = 0; i < Number(tensorCount); i++) {
      const nameLen = src.slice(pos, 8)?.readBigUInt64LE(0);
      const name = str(true)!;
      if (nameLen !== undefined && nameLen >= BigInt(GGML_MAX_NAME)) throw new Malformed(`tensor name of ${nameLen} bytes (llama.cpp allows ${GGML_MAX_NAME - 1})`);
      const nDims = u32();
      if (nDims === 0 || nDims > GGML_MAX_DIMS) throw new Malformed(`tensor ${name} has ${nDims} dimensions`);
      let elements = 1n;
      const dims: bigint[] = [];
      for (let d = 0; d < nDims; d++) {
        const dim = u64();
        if (dim > BigInt(Number.MAX_SAFE_INTEGER)) throw new Malformed(`tensor ${name} dimension ${dim}`);
        dims.push(dim);
        elements *= dim;
      }
      if (elements > (1n << 62n)) throw new Malformed(`tensor ${name} has ${elements} elements`);
      const type = u32();
      const offset = u64();
      const layout = GGML_TYPES[type];
      let bytes: bigint | null = null;
      if (layout) {
        const [block, size] = layout;
        if (dims[0] % BigInt(block) !== 0n) throw new Malformed(`tensor ${name} row of ${dims[0]} is not a multiple of its block size ${block}`);
        bytes = (elements / BigInt(block)) * BigInt(size);
      }
      if (names.has(name)) {
        findings.push(mk("gguf_duplicate_tensor", "Two tensors share a name", "format-integrity", "medium",
          "Loaders look tensors up by name; a duplicate decides which data is used depending on the loader. Legitimate exports never contain duplicates.", file, name));
      }
      names.add(name);
      tensors.push({ name, offset, bytes, type });
    }

    const dataStart = BigInt(Math.ceil(pos / alignment) * alignment);
    const fileSize = BigInt(src.length);
    const oob = tensors.filter((t) => t.bytes !== null && dataStart + t.offset + t.bytes > fileSize);
    const misaligned = tensors.filter((t) => t.offset % BigInt(alignment) !== 0n);
    const unknownTypes = [...new Set(tensors.filter((t) => t.bytes === null).map((t) => t.type))];
    if (oob.length > 0) {
      findings.push(mk("gguf_tensor_out_of_bounds", "Tensor data extends past the end of the file", "format-integrity", "high",
        "A tensor's offset and size point outside the file. Loaders that do not check this read out of bounds; a correctly exported or fully downloaded model never does this.", file,
        oob.slice(0, MAX_REPORTED_TENSORS).map((t) => t.name).join(", ") + (oob.length > MAX_REPORTED_TENSORS ? ` and ${oob.length - MAX_REPORTED_TENSORS} more` : "")));
    }
    if (misaligned.length > 0) {
      findings.push(mk("gguf_tensor_misaligned", "Tensor offset not aligned to general.alignment", "format-integrity", "medium",
        `Tensor offsets must be multiples of ${alignment}; llama.cpp refuses such files. A writer bug or a hand-edited file.`, file,
        misaligned.slice(0, MAX_REPORTED_TENSORS).map((t) => t.name).join(", ")));
    }
    if (unknownTypes.length > 0) {
      findings.push(mk("gguf_unknown_tensor_type", "Tensor type this scanner does not know", "format-integrity", "low",
        "The bounds of these tensors were not checked. The type may be newer than this scanner or removed from ggml.", file, `type ${unknownTypes.join(", ")}`));
    }
  } catch (e) {
    if (!(e instanceof Malformed)) throw e;
    findings.push(mk("gguf_malformed_header", "Malformed GGUF header or metadata", "format-integrity", "high",
      "A count, length or type in the header is inconsistent with the file. Crafted values like these have caused heap overflows in GGUF loaders (several reported against llama.cpp in 2024); do not load the file with an unpatched runtime.", file, e.message));
  }
  return findings;
}

export function scanGgufFile(filePath: string): Finding[] {
  const fd = openSync(filePath, "r");
  try {
    return scanGgufSource(new ByteSource(fd, statSync(filePath).size), filePath);
  } finally {
    closeSync(fd);
  }
}
