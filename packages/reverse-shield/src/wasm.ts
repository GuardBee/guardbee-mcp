import { finding } from "./finding.js";
import type { Finding } from "./finding.js";

// WebAssembly modules: what is left beside the code is in custom sections
// (id 0). `name` maps function indices to names, `.debug_*` is DWARF (source
// files, lines, variables), `sourceMappingURL` points at a source map.

const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d]);

export function isWasm(buf: Buffer): boolean {
  return buf.length >= 8 && buf.subarray(0, 4).equals(WASM_MAGIC);
}

function readLeb(buf: Buffer, p: number): { value: number; next: number } {
  let value = 0;
  let mul = 1;
  for (let i = 0; i < 5; i++) {
    if (p >= buf.length) throw new Error("truncated LEB128");
    const b = buf[p++];
    value += (b & 0x7f) * mul;
    if (!(b & 0x80)) return { value, next: p };
    mul *= 128;
  }
  throw new Error("LEB128 too long");
}

export interface WasmCustomSection {
  name: string;
  start: number;
  end: number;
}

/** Custom sections of a module, in order. Sections are skipped by size, so this is linear. */
export function wasmCustomSections(buf: Buffer): WasmCustomSection[] {
  const out: WasmCustomSection[] = [];
  let p = 8;
  try {
    while (p < buf.length) {
      const id = buf[p++];
      const size = readLeb(buf, p);
      const end = size.next + size.value;
      if (end > buf.length) break;
      if (id === 0) {
        const len = readLeb(buf, size.next);
        out.push({ name: buf.toString("utf8", len.next, len.next + len.value), start: len.next + len.value, end });
      }
      p = end;
    }
  } catch {
    // A truncated module still reports what was read before the damage.
  }
  return out;
}

/** Function names from the `name` section's function subsection (id 1). */
export function wasmFunctionNames(buf: Buffer, section: WasmCustomSection, limit = Infinity): { count: number; names: string[] } {
  const names: string[] = [];
  let p = section.start;
  try {
    while (p < section.end) {
      const id = buf[p++];
      const size = readLeb(buf, p);
      const end = size.next + size.value;
      if (id === 1) {
        const count = readLeb(buf, size.next);
        let q = count.next;
        for (let i = 0; i < count.value && names.length < limit; i++) {
          q = readLeb(buf, q).next; // function index
          const len = readLeb(buf, q);
          names.push(buf.toString("utf8", len.next, len.next + len.value));
          q = len.next + len.value;
        }
        return { count: count.value, names };
      }
      p = end;
    }
  } catch {
    // Malformed subsection: report what was read.
  }
  return { count: names.length, names };
}

export function analyzeWasm(buf: Buffer, file: string): Finding[] {
  if (!isWasm(buf)) return [];
  const findings: Finding[] = [];
  const sections = wasmCustomSections(buf);

  const dwarf = sections.filter((s) => s.name.startsWith(".debug_"));
  if (dwarf.length > 0) {
    const bytes = dwarf.reduce((n, s) => n + s.end - s.start, 0);
    findings.push(finding("wasm_debug_info", file, { match: `${dwarf.map((s) => s.name).join(", ")} (${(bytes / 1024).toFixed(0)} KiB)` }));
  }

  const name = sections.find((s) => s.name === "name");
  if (name) {
    const { count, names } = wasmFunctionNames(buf, name, 3);
    if (count > 0) findings.push(finding("wasm_name_section", file, { match: `${count} function names, e.g. ${names.join(", ")}` }));
  }

  const mapUrl = sections.find((s) => s.name === "sourceMappingURL");
  if (mapUrl) {
    try {
      const len = readLeb(buf, mapUrl.start);
      findings.push(finding("sourcemap_reference", file, { match: buf.toString("utf8", len.next, Math.min(len.next + len.value, mapUrl.end)) }));
    } catch {
      // Truncated section: nothing to point at.
    }
  }
  return findings;
}
