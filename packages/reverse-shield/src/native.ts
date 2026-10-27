import { finding } from "./finding.js";
import type { Finding } from "./finding.js";

export type NativeFormat = "elf" | "macho" | "fat-macho" | "pe";

export interface NativeResult {
  format: NativeFormat;
  /** "dotnet" when a PE carries a CLR header. */
  flavor?: "dotnet";
  findings: Finding[];
  notes: string[];
}

const MH_MAGIC_64 = 0xfeedfacf;
const MH_MAGIC = 0xfeedface;
const FAT_MAGIC = 0xcafebabe;
const FAT_MAGIC_64 = 0xcafebabf;

export function detectNativeFormat(prefix: Buffer): NativeFormat | null {
  if (prefix.length < 8) return null;
  if (prefix[0] === 0x7f && prefix.toString("latin1", 1, 4) === "ELF") return "elf";
  const le = prefix.readUInt32LE(0);
  if (le === MH_MAGIC_64 || le === MH_MAGIC) return "macho";
  const be = prefix.readUInt32BE(0);
  // Java class files share 0xCAFEBABE; there the next word is the class
  // version (>= 45), while a fat Mach-O holds a small architecture count.
  if ((be === FAT_MAGIC || be === FAT_MAGIC_64) && prefix.readUInt32BE(4) > 0 && prefix.readUInt32BE(4) < 20) return "fat-macho";
  if (prefix[0] === 0x4d && prefix[1] === 0x5a) return "pe";
  return null;
}

export function analyzeNative(buf: Buffer, file: string): NativeResult | null {
  const format = detectNativeFormat(buf);
  if (!format) return null;
  try {
    if (format === "elf") return analyzeElf(buf, file);
    if (format === "macho") return { format, ...analyzeMachO(buf, file) };
    if (format === "fat-macho") return analyzeFat(buf, file);
    return analyzePe(buf, file);
  } catch (err) {
    // A truncated or malformed header is not a finding about the developer's build.
    return { format, findings: [], notes: [`${file}: could not parse ${format} headers (${(err as Error).message})`] };
  }
}

// ── ELF ─────────────────────────────────────────────────────────────────────

const PT_INTERP = 3;
const PT_GNU_STACK = 0x6474e551;
const PT_GNU_RELRO = 0x6474e552;
const SHT_SYMTAB = 2;
const ET_EXEC = 2;
const ET_DYN = 3;

function analyzeElf(buf: Buffer, file: string): NativeResult {
  const is64 = buf[4] === 2;
  const le = buf[5] === 1;
  const u16 = (o: number) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const addr = (o: number) => (is64 ? Number(le ? buf.readBigUInt64LE(o) : buf.readBigUInt64BE(o)) : u32(o));

  const type = u16(16);
  const phoff = addr(is64 ? 32 : 28);
  const shoff = addr(is64 ? 40 : 32);
  const phentsize = u16(is64 ? 54 : 42);
  const phnum = u16(is64 ? 56 : 44);
  const shentsize = u16(is64 ? 58 : 46);
  const shnum = u16(is64 ? 60 : 48);
  const shstrndx = u16(is64 ? 62 : 50);

  const segments: Array<{ type: number; flags: number }> = [];
  for (let i = 0; i < phnum; i++) {
    const o = phoff + i * phentsize;
    if (o + phentsize > buf.length) break;
    segments.push({ type: u32(o), flags: u32(o + (is64 ? 4 : 24)) });
  }

  const sections: Array<{ name: string; type: number; offset: number; size: number; entsize: number }> = [];
  if (shoff > 0 && shoff + shnum * shentsize <= buf.length) {
    const raw = [];
    for (let i = 0; i < shnum; i++) {
      const o = shoff + i * shentsize;
      raw.push({
        nameOff: u32(o),
        type: u32(o + 4),
        offset: addr(o + (is64 ? 24 : 16)),
        size: addr(o + (is64 ? 32 : 20)),
        entsize: addr(o + (is64 ? 56 : 36)),
      });
    }
    const strtab = raw[shstrndx];
    for (const s of raw) {
      let name = "";
      if (strtab) {
        const start = strtab.offset + s.nameOff;
        const end = buf.indexOf(0, start);
        if (start < buf.length && end !== -1) name = buf.toString("latin1", start, end);
      }
      sections.push({ name, type: s.type, offset: s.offset, size: s.size, entsize: s.entsize });
    }
  }

  const findings: Finding[] = [];
  const names = sections.map((s) => s.name);

  const debug = names.filter((n) => /^\.z?debug_(info|line)$/.test(n));
  if (debug.length > 0) findings.push(finding("native_debug_info", file, { match: `sections: ${debug.join(", ")}` }));

  const symtab = sections.find((s) => s.type === SHT_SYMTAB);
  if (symtab) {
    const count = symtab.entsize > 0 ? Math.floor(symtab.size / symtab.entsize) : 0;
    findings.push(finding("native_symbols_not_stripped", file, { match: `.symtab with ${count} entries` }));
  }

  const hasInterp = segments.some((s) => s.type === PT_INTERP);
  const isExecutable = type === ET_EXEC || (type === ET_DYN && hasInterp);
  if (type === ET_EXEC) findings.push(finding("native_no_pie", file, { match: "ELF type EXEC (fixed load address)" }));

  if (type === ET_EXEC || type === ET_DYN) {
    const stack = segments.find((s) => s.type === PT_GNU_STACK);
    if (!stack) findings.push(finding("native_no_nx", file, { match: "no PT_GNU_STACK segment (executable stack by default)" }));
    else if (stack.flags & 1) findings.push(finding("native_no_nx", file, { match: "PT_GNU_STACK is RWX" }));

    if (!segments.some((s) => s.type === PT_GNU_RELRO)) findings.push(finding("native_no_relro", file, { match: "no PT_GNU_RELRO segment" }));

    // Go and Rust toolchains do not use the libc canary; reporting it there is noise.
    const isGo = names.includes(".gopclntab") || names.includes(".note.go.buildid");
    const isRust = buf.includes("rust_begin_unwind") || names.includes(".rustc");
    if (isExecutable && !isGo && !isRust && !buf.includes("__stack_chk_fail")) {
      findings.push(finding("native_no_stack_canary", file, { match: "no reference to __stack_chk_fail" }));
    }
  }

  return { format: "elf", findings, notes: [] };
}

// ── Mach-O ──────────────────────────────────────────────────────────────────

const LC_SEGMENT = 0x1;
const LC_SYMTAB = 0x2;
const LC_SEGMENT_64 = 0x19;
const LC_CODE_SIGNATURE = 0x1d;
const MH_EXECUTE = 2;
const MH_PIE = 0x200000;
const N_STAB = 0xe0;
const N_TYPE = 0x0e;
const N_SECT = 0x0e;
const N_EXT = 0x01;
const N_OSO = 0x66;
const N_FUN = 0x24;
const N_SO = 0x64;
const CS_ADHOC = 0x2;
const CS_RUNTIME = 0x10000;
const CSMAGIC_EMBEDDED_SIGNATURE = 0xfade0cc0;
const CSMAGIC_CODEDIRECTORY = 0xfade0c02;
const CSMAGIC_EMBEDDED_ENTITLEMENTS = 0xfade7171;

function entitlementTrue(xml: string, key: string): boolean {
  const tag = `<key>${key}</key>`;
  const at = xml.indexOf(tag);
  return at !== -1 && /^\s*<true\s*\/>/.test(xml.slice(at + tag.length, at + tag.length + 64));
}

function analyzeMachO(buf: Buffer, file: string): { findings: Finding[]; notes: string[] } {
  const is64 = buf.readUInt32LE(0) === MH_MAGIC_64;
  const filetype = buf.readUInt32LE(12);
  const ncmds = buf.readUInt32LE(16);
  const flags = buf.readUInt32LE(24);
  const findings: Finding[] = [];
  const notes: string[] = [];

  let symtab: { symoff: number; nsyms: number; stroff: number } | null = null;
  let codeSig: { dataoff: number; datasize: number } | null = null;
  let hasDwarfSegment = false;

  let p = is64 ? 32 : 28;
  for (let i = 0; i < ncmds && p + 8 <= buf.length; i++) {
    const cmd = buf.readUInt32LE(p);
    const size = buf.readUInt32LE(p + 4);
    if (size < 8) break;
    if (cmd === LC_SYMTAB) symtab = { symoff: buf.readUInt32LE(p + 8), nsyms: buf.readUInt32LE(p + 12), stroff: buf.readUInt32LE(p + 16) };
    else if (cmd === LC_CODE_SIGNATURE) codeSig = { dataoff: buf.readUInt32LE(p + 8), datasize: buf.readUInt32LE(p + 12) };
    else if ((cmd === LC_SEGMENT_64 || cmd === LC_SEGMENT) && buf.toString("latin1", p + 8, p + 24).split("\0")[0] === "__DWARF") hasDwarfSegment = true;
    p += size;
  }

  if (hasDwarfSegment) findings.push(finding("native_debug_info", file, { match: "__DWARF segment in the binary" }));

  if (symtab) {
    const entSize = is64 ? 16 : 12;
    let stabs = 0;
    let localDefined = 0;
    let firstObject = "";
    for (let i = 0; i < symtab.nsyms; i++) {
      const o = symtab.symoff + i * entSize;
      if (o + entSize > buf.length) break;
      const nType = buf[o + 4];
      if (nType & N_STAB) {
        if (nType === N_OSO || nType === N_SO || nType === N_FUN) stabs++;
        if (!firstObject && nType === N_OSO) {
          const s = symtab.stroff + buf.readUInt32LE(o);
          const end = buf.indexOf(0, s);
          if (end !== -1) firstObject = buf.toString("utf8", s, end);
        }
      } else if ((nType & N_TYPE) === N_SECT && !(nType & N_EXT)) {
        localDefined++;
      }
    }
    if (stabs > 0) {
      findings.push(finding("native_debug_info", file, {
        severity: "medium",
        match: `${stabs} debug-map (stab) entries${firstObject ? `, e.g. ${firstObject}` : ""}`,
      }));
    }
    if (localDefined > 10) findings.push(finding("native_symbols_not_stripped", file, { match: `${localDefined} local symbols` }));
  }

  if (filetype === MH_EXECUTE && !(flags & MH_PIE)) findings.push(finding("native_no_pie", file, { match: "MH_PIE flag not set" }));

  if (!codeSig) {
    if (filetype === MH_EXECUTE) findings.push(finding("native_unsigned", file, { match: "no LC_CODE_SIGNATURE" }));
    return { findings, notes };
  }

  const sig = buf.subarray(codeSig.dataoff, codeSig.dataoff + codeSig.datasize);
  if (sig.length < 12 || sig.readUInt32BE(0) !== CSMAGIC_EMBEDDED_SIGNATURE) return { findings, notes };
  const count = sig.readUInt32BE(8);
  let cdFlags: number | null = null;
  // Apple's own platform binaries are protected by SIP, not the hardened runtime flag.
  let platform = 0;
  let entitlements = "";
  for (let i = 0; i < count; i++) {
    const idx = 12 + i * 8;
    if (idx + 8 > sig.length) break;
    const off = sig.readUInt32BE(idx + 4);
    if (off + 8 > sig.length) continue;
    const magic = sig.readUInt32BE(off);
    if (magic === CSMAGIC_CODEDIRECTORY && cdFlags === null) {
      cdFlags = sig.readUInt32BE(off + 12);
      platform = sig[off + 38];
    }
    else if (magic === CSMAGIC_EMBEDDED_ENTITLEMENTS) entitlements = sig.toString("utf8", off + 8, off + sig.readUInt32BE(off + 4));
  }

  if (cdFlags !== null) {
    if (cdFlags & CS_ADHOC) findings.push(finding("native_adhoc_signed", file, { match: "CodeDirectory flags include CS_ADHOC" }));
    if (filetype === MH_EXECUTE && platform === 0 && !(cdFlags & CS_RUNTIME)) findings.push(finding("native_no_hardened_runtime", file, { match: "CodeDirectory flags lack CS_RUNTIME" }));
  }
  if (entitlements) {
    if (entitlementTrue(entitlements, "com.apple.security.get-task-allow")) {
      findings.push(finding("native_debuggable_entitlement", file, { match: "com.apple.security.get-task-allow = true" }));
    }
    const injection = ["com.apple.security.cs.disable-library-validation", "com.apple.security.cs.allow-dyld-environment-variables"].filter((k) =>
      entitlementTrue(entitlements, k),
    );
    if (injection.length > 0) findings.push(finding("native_injection_entitlement", file, { match: injection.join(", ") }));
  }

  return { findings, notes };
}

function analyzeFat(buf: Buffer, file: string): NativeResult {
  const is64 = buf.readUInt32BE(0) === FAT_MAGIC_64;
  const nArch = buf.readUInt32BE(4);
  const seen = new Map<string, Finding>();
  const notes: string[] = [];
  for (let i = 0; i < nArch; i++) {
    const o = 8 + i * (is64 ? 32 : 20);
    const offset = is64 ? Number(buf.readBigUInt64BE(o + 8)) : buf.readUInt32BE(o + 8);
    const size = is64 ? Number(buf.readBigUInt64BE(o + 16)) : buf.readUInt32BE(o + 12);
    const slice = buf.subarray(offset, offset + size);
    if (detectNativeFormat(slice) !== "macho") continue;
    const result = analyzeMachO(slice, file);
    notes.push(...result.notes);
    // Every slice is usually built the same way; report each issue once.
    for (const f of result.findings) if (!seen.has(f.patternId)) seen.set(f.patternId, f);
  }
  return { format: "fat-macho", findings: [...seen.values()], notes };
}

// ── PE / .NET ───────────────────────────────────────────────────────────────

const IMAGE_FILE_DLL = 0x2000;
const DLLCHAR_DYNAMIC_BASE = 0x40;
const DLLCHAR_NX_COMPAT = 0x100;
const DIR_SECURITY = 4;
const DIR_DEBUG = 6;
const DIR_CLR = 14;
const DEBUG_TYPE_CODEVIEW = 2;
const DEBUG_TYPE_EMBEDDED_PDB = 17;

/** Attribute and type names that commercial and open-source .NET obfuscators leave behind. */
const DOTNET_OBFUSCATOR_MARKERS: Array<{ name: string; marker: string }> = [
  { name: "ConfuserEx", marker: "ConfusedByAttribute" },
  { name: "Dotfuscator", marker: "DotfuscatorAttribute" },
  { name: "SmartAssembly", marker: "SmartAssembly.Attributes" },
  { name: "Babel", marker: "BabelObfuscatorAttribute" },
  { name: "Crypto Obfuscator", marker: "CryptoObfuscator" },
  { name: "Agile.NET", marker: "SecureTeam.Attributes" },
  { name: "Goliath", marker: "ObfuscatedByGoliath" },
  { name: "Xenocode", marker: "Xenocode.Client.Attributes" },
  { name: "Eazfuscator.NET", marker: "EazfuscatorNET" },
];

function analyzePe(buf: Buffer, file: string): NativeResult {
  const peOff = buf.readUInt32LE(0x3c);
  if (buf.toString("latin1", peOff, peOff + 4) !== "PE\0\0") return { format: "pe", findings: [], notes: [] };
  const coff = peOff + 4;
  const nSections = buf.readUInt16LE(coff + 2);
  const symPtr = buf.readUInt32LE(coff + 8);
  const nSyms = buf.readUInt32LE(coff + 12);
  const optSize = buf.readUInt16LE(coff + 16);
  const characteristics = buf.readUInt16LE(coff + 18);
  const opt = coff + 20;
  const pe32plus = buf.readUInt16LE(opt) === 0x20b;
  const dllChars = buf.readUInt16LE(opt + 70);
  const nDirs = buf.readUInt32LE(opt + (pe32plus ? 108 : 92));
  const dirBase = opt + (pe32plus ? 112 : 96);
  const dir = (i: number) => (i < nDirs ? { rva: buf.readUInt32LE(dirBase + i * 8), size: buf.readUInt32LE(dirBase + i * 8 + 4) } : { rva: 0, size: 0 });

  const sections: Array<{ va: number; vsize: number; raw: number; rawSize: number }> = [];
  for (let i = 0; i < nSections; i++) {
    const o = opt + optSize + i * 40;
    sections.push({ vsize: buf.readUInt32LE(o + 8), va: buf.readUInt32LE(o + 12), rawSize: buf.readUInt32LE(o + 16), raw: buf.readUInt32LE(o + 20) });
  }
  const rvaToOffset = (rva: number): number | null => {
    for (const s of sections) {
      if (rva >= s.va && rva < s.va + Math.max(s.vsize, s.rawSize)) return rva - s.va + s.raw;
    }
    return null;
  };

  const isDll = (characteristics & IMAGE_FILE_DLL) !== 0;
  const clr = dir(DIR_CLR);
  const isDotnet = clr.size > 0;
  const findings: Finding[] = [];
  const notes: string[] = [];

  if (!(dllChars & DLLCHAR_DYNAMIC_BASE)) findings.push(finding("native_no_pie", file, { match: "DllCharacteristics lacks DYNAMIC_BASE (ASLR)" }));
  if (!(dllChars & DLLCHAR_NX_COMPAT)) findings.push(finding("native_no_nx", file, { match: "DllCharacteristics lacks NX_COMPAT (DEP)" }));
  // Authenticode matters for what Windows launches; .NET apps also ship their
  // entry assembly as a non-DLL .dll, where an unsigned file is the norm.
  if (!isDll && /\.exe$/i.test(file) && dir(DIR_SECURITY).size === 0) findings.push(finding("native_unsigned", file, { match: "no Authenticode certificate table" }));
  if (symPtr !== 0 && nSyms > 0) findings.push(finding("native_symbols_not_stripped", file, { match: `COFF symbol table with ${nSyms} entries` }));

  const debugDir = dir(DIR_DEBUG);
  const debugOff = debugDir.size > 0 ? rvaToOffset(debugDir.rva) : null;
  if (debugOff !== null) {
    for (let o = debugOff; o + 28 <= debugOff + debugDir.size && o + 28 <= buf.length; o += 28) {
      const type = buf.readUInt32LE(o + 12);
      const dataSize = buf.readUInt32LE(o + 16);
      const dataPtr = buf.readUInt32LE(o + 24);
      if (type === DEBUG_TYPE_CODEVIEW && buf.toString("latin1", dataPtr, dataPtr + 4) === "RSDS") {
        const end = buf.indexOf(0, dataPtr + 24);
        const pdbPath = buf.toString("utf8", dataPtr + 24, end === -1 ? dataPtr + dataSize : end);
        if (/^[A-Za-z]:[\\/]|^\//.test(pdbPath)) findings.push(finding("native_build_path_leak", file, { match: pdbPath }));
      } else if (type === DEBUG_TYPE_EMBEDDED_PDB) {
        findings.push(isDotnet
          ? finding("dotnet_embedded_pdb", file, { match: `embedded portable PDB (${dataSize} bytes)` })
          : finding("native_debug_info", file, { match: `embedded PDB (${dataSize} bytes)` }));
      }
    }
  }

  if (isDotnet) {
    const clrOff = rvaToOffset(clr.rva);
    const metaOff = clrOff !== null ? rvaToOffset(buf.readUInt32LE(clrOff + 8)) : null;
    const strings = metaOff !== null ? readDotnetStringsHeap(buf, metaOff) : null;
    if (strings) {
      const verdict = assessDotnetNames(strings);
      notes.push(`${file}: .NET assembly, ${verdict.summary}`);
      if (!verdict.obfuscated) findings.push(finding("dotnet_not_obfuscated", file, { match: verdict.summary }));
    } else {
      notes.push(`${file}: .NET assembly, metadata could not be read`);
    }
  }

  return { format: "pe", flavor: isDotnet ? "dotnet" : undefined, findings, notes };
}

/** The #Strings heap holds every type, member, namespace and parameter name the assembly defines or references. */
export function readDotnetStringsHeap(buf: Buffer, metaOff: number): string[] | null {
  if (buf.toString("latin1", metaOff, metaOff + 4) !== "BSJB") return null;
  const versionLen = buf.readUInt32LE(metaOff + 12);
  let p = metaOff + 16 + versionLen;
  const nStreams = buf.readUInt16LE(p + 2);
  p += 4;
  for (let i = 0; i < nStreams; i++) {
    const offset = buf.readUInt32LE(p);
    const size = buf.readUInt32LE(p + 4);
    const nameEnd = buf.indexOf(0, p + 8);
    const name = buf.toString("latin1", p + 8, nameEnd);
    p = p + 8 + Math.ceil((name.length + 1) / 4) * 4;
    if (name === "#Strings") {
      return buf.toString("utf8", metaOff + offset, metaOff + offset + size).split("\0").filter((s) => s.length > 0);
    }
  }
  return null;
}

export function assessDotnetNames(names: string[]): { obfuscated: boolean; summary: string } {
  const joined = names.join("\n");
  const marker = DOTNET_OBFUSCATOR_MARKERS.find((m) => joined.includes(m.marker));
  if (marker) return { obfuscated: true, summary: `obfuscator marker found (${marker.name})` };

  // Compiler-generated names (<Main>$), dotted namespace/assembly names and
  // GUIDs are not evidence either way. What renaming obfuscators leave are
  // one- or two-letter names, bare numbers and non-ASCII junk identifiers.
  const candidates = names.filter((n) => !n.startsWith("<") && !n.includes(".") && !/[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-/.test(n));
  if (candidates.length < 30) return { obfuscated: true, summary: `only ${candidates.length} metadata names, too few to judge` };
  const renamed = candidates.filter((n) => /^[A-Za-z]{1,2}$/.test(n) || /^\d+$/.test(n) || /[^\x20-\x7e]/.test(n)).length;
  const ratio = renamed / candidates.length;
  const summary = `${renamed} of ${candidates.length} metadata names look renamed (${(ratio * 100).toFixed(0)}%), no obfuscator marker`;
  return { obfuscated: ratio >= 0.1, summary };
}
