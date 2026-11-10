import { finding } from "./finding.js";
import type { Finding } from "./finding.js";

// Hermes bytecode (React Native): the header, string table and function names.
//
// Layout checked against hermesc from the hermes-compiler npm package
// (bytecode version 98), which uses 12-byte function headers. The string table
// is found by trying 12- and 16-byte headers. Function names are read for
// versions that share the same 12-byte small-header name encoding as v98
// (React Native's common hermesc range); others stay notes-only.

export const HERMES_MAGIC = Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f]);

const HEADER_SIZE = 128;
/** Inclusive range of bytecode versions whose 12-byte small function headers match the v98 name layout. */
export const NAME_LAYOUT_VERSION_MIN = 84;
export const NAME_LAYOUT_VERSION_MAX = 100;
const OVERFLOWED = 1 << 29; // third word of a 12-byte small function header
const MIN_NAMED_FUNCTIONS = 50;
const MINIFIED_SHORT_RATIO = 0.15;

export function hermesNameLayoutSupported(version: number, headerSize: number): boolean {
  return headerSize === 12 && version >= NAME_LAYOUT_VERSION_MIN && version <= NAME_LAYOUT_VERSION_MAX;
}

export interface HermesBytecode {
  version: number;
  functionCount: number;
  strings: string[];
  /** Names of functions whose header could be read; "" for anonymous ones. null when this version's layout is unknown. */
  functionNames: string[] | null;
}

const align4 = (n: number) => (n + 3) & ~3;

export function isHermes(buf: Buffer): boolean {
  return buf.subarray(0, 8).equals(HERMES_MAGIC);
}

export function parseHermes(buf: Buffer): HermesBytecode | null {
  if (buf.length < HEADER_SIZE || !isHermes(buf)) return null;
  const u32 = (p: number) => (p + 4 <= buf.length ? buf.readUInt32LE(p) : -1);
  const version = u32(8);
  const functionCount = u32(40);
  const stringKindCount = u32(44);
  const identifierCount = u32(48);
  const stringCount = u32(52);
  const overflowStringCount = u32(56);
  const stringStorageSize = u32(60);
  if ([functionCount, stringKindCount, identifierCount, stringCount, overflowStringCount, stringStorageSize].some((n) => n < 0 || n > buf.length)) return null;

  // The string kinds (run lengths of plain strings and identifiers) follow the
  // function headers; they must add up to the header's counts.
  let headerSize = 0;
  let p = 0;
  for (const size of [12, 16]) {
    p = align4(HEADER_SIZE + functionCount * size);
    let total = 0;
    let ids = 0;
    for (let i = 0; i < stringKindCount; i++) {
      const e = u32(p + i * 4);
      if (e < 0) break;
      total += e & 0x7fffffff;
      if (e >>> 31) ids += e & 0x7fffffff;
    }
    if (total === stringCount && ids === identifierCount) {
      headerSize = size;
      break;
    }
  }
  if (!headerSize) return null;

  p = align4(p + stringKindCount * 4);
  p = align4(p + identifierCount * 4); // identifier hashes
  const small = p;
  const overflow = align4(small + stringCount * 4);
  const storage = align4(overflow + overflowStringCount * 8);
  if (storage + stringStorageSize > buf.length) return null;

  const strings: string[] = [];
  for (let i = 0; i < stringCount; i++) {
    const e = u32(small + i * 4);
    const utf16 = e & 1;
    let offset = (e >>> 1) & 0x7fffff;
    let length = e >>> 24;
    if (length === 0xff) {
      const at = overflow + offset * 8;
      offset = u32(at);
      length = u32(at + 4);
    }
    const start = storage + offset;
    const end = start + (utf16 ? length * 2 : length);
    if (offset < 0 || length < 0 || end > storage + stringStorageSize) return null;
    strings.push(buf.subarray(start, end).toString(utf16 ? "utf16le" : "latin1"));
  }

  let functionNames: string[] | null = null;
  if (hermesNameLayoutSupported(version, headerSize)) {
    functionNames = [];
    for (let i = 0; i < functionCount; i++) {
      const at = HEADER_SIZE + i * 12;
      // Small header: offset:25 paramCount:7 | bytecodeSize:14 functionName:8 ... An index that
      // does not fit overflows it into a full header (offset, paramCount, bytecodeSize, flags, functionName, ...).
      const name = u32(at + 8) & OVERFLOWED ? u32((u32(at) & 0x1ffffff) + 16) : (u32(at + 4) >>> 14) & 0xff;
      if (name >= 0 && name < strings.length) functionNames.push(strings[name]);
    }
  }
  return { version, functionCount, strings, functionNames };
}

/**
 * Metro's minifier renames functions to one- or two-letter names before
 * hermesc compiles the bundle; without it the bytecode keeps the source's
 * names, which hermes-dec and hbctool print back. Measured on one bundle
 * (lodash + zod + app code) compiled with hermesc -O both ways: 1% of the
 * named functions have names that short unminified and 57% minified.
 */
export function assessHermesNames(bc: HermesBytecode): { named: number; short: number; minified: boolean; sample: string[] } | null {
  if (!bc.functionNames) return null;
  const named = bc.functionNames.filter((n) => n !== "" && n !== "global");
  if (named.length < MIN_NAMED_FUNCTIONS) return null;
  const short = named.filter((n) => n.length <= 2).length;
  const sample = [...new Set(named.filter((n) => n.length >= 8))].slice(0, 5);
  return { named: named.length, short, minified: short / named.length >= MINIFIED_SHORT_RATIO, sample };
}

/** Findings and notes for a React Native bundle that is Hermes bytecode. */
export function analyzeHermes(buf: Buffer, display: string): { findings: Finding[]; notes: string[] } {
  const bc = parseHermes(buf);
  if (!bc) return { findings: [], notes: ["React Native bundle is Hermes bytecode"] };
  const label = `React Native bundle is Hermes bytecode (version ${bc.version}, ${bc.functionCount} functions)`;
  const verdict = assessHermesNames(bc);
  if (!verdict) return { findings: [], notes: [`${label}; function names not judged for this bytecode version or size`] };
  const summary = `${verdict.named} named functions, ${((100 * verdict.short) / verdict.named).toFixed(0)}% with 1–2 letter names`;
  if (verdict.minified) return { findings: [], notes: [`${label}; names are minified (${summary})`] };
  const match = verdict.sample.length > 0 ? `${summary}; e.g. ${verdict.sample.join(", ")}` : summary;
  return { findings: [finding("hermes_names_not_minified", display, { match })], notes: [label] };
}
