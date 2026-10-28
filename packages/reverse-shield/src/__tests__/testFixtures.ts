import { deflateRawSync } from "zlib";
import { FUSE_SENTINEL } from "../electron.js";

// ── ZIP / APK ───────────────────────────────────────────────────────────────

/** Multi-entry ZIP (no CRC, which zip.ts does not check). `beforeCentralDir` is spliced in where an APK Signing Block lives. */
export function buildZip(entries: Array<{ name: string; data: Buffer; deflate?: boolean }>, beforeCentralDir: Buffer = Buffer.alloc(0)): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const content = e.deflate ? deflateRawSync(e.data) : e.data;
    const method = e.deflate ? 8 : 0;
    const name = Buffer.from(e.name, "utf8");
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt32LE(content.length, 18);
    lfh.writeUInt32LE(e.data.length, 22);
    lfh.writeUInt16LE(name.length, 26);
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(method, 10);
    cdh.writeUInt32LE(content.length, 20);
    cdh.writeUInt32LE(e.data.length, 24);
    cdh.writeUInt16LE(name.length, 28);
    cdh.writeUInt32LE(offset, 42);
    locals.push(lfh, name, content);
    centrals.push(cdh, name);
    offset += 30 + name.length + content.length;
  }
  const cdOffset = offset + beforeCentralDir.length;
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([...locals, beforeCentralDir, cd, eocd]);
}

/** Enough of an APK Signing Block for detection: the magic sits in the 16 bytes before the central directory. */
export function apkSigningBlock(): Buffer {
  return Buffer.concat([Buffer.alloc(32), Buffer.from("APK Sig Block 42", "latin1")]);
}

// ── AXML (binary AndroidManifest.xml) ───────────────────────────────────────

export interface AxmlAttrSpec {
  name: string;
  resourceId?: number;
  bool?: boolean;
  string?: string;
}

export function buildAxml(elements: Array<{ name: string; attrs: AxmlAttrSpec[] }>): Buffer {
  const strings: string[] = [];
  const intern = (s: string) => {
    let i = strings.indexOf(s);
    if (i === -1) i = strings.push(s) - 1;
    return i;
  };
  // Attribute names with resource ids must come first so the resource map indexes line up.
  const withIds = elements.flatMap((e) => e.attrs).filter((a) => a.resourceId !== undefined);
  const ids: number[] = [];
  for (const a of withIds) {
    if (!strings.includes(a.name)) {
      intern(a.name);
      ids.push(a.resourceId!);
    }
  }
  for (const e of elements) {
    intern(e.name);
    for (const a of e.attrs) {
      intern(a.name);
      if (a.string !== undefined) intern(a.string);
    }
  }

  // UTF-16 string pool
  const data = Buffer.concat(strings.map((s) => {
    const b = Buffer.alloc(2 + s.length * 2 + 2);
    b.writeUInt16LE(s.length, 0);
    b.write(s, 2, "utf16le");
    return b;
  }));
  const padded = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)]);
  const offsets = Buffer.alloc(strings.length * 4);
  let o = 0;
  strings.forEach((s, i) => {
    offsets.writeUInt32LE(o, i * 4);
    o += 2 + s.length * 2 + 2;
  });
  const spHeader = Buffer.alloc(28);
  spHeader.writeUInt16LE(0x0001, 0);
  spHeader.writeUInt16LE(28, 2);
  spHeader.writeUInt32LE(28 + offsets.length + padded.length, 4);
  spHeader.writeUInt32LE(strings.length, 8);
  spHeader.writeUInt32LE(0, 16);
  spHeader.writeUInt32LE(28 + offsets.length, 20);
  const pool = Buffer.concat([spHeader, offsets, padded]);

  const resMap = Buffer.alloc(8 + ids.length * 4);
  resMap.writeUInt16LE(0x0180, 0);
  resMap.writeUInt16LE(8, 2);
  resMap.writeUInt32LE(resMap.length, 4);
  ids.forEach((id, i) => resMap.writeUInt32LE(id, 8 + i * 4));

  const chunks = elements.map((e) => {
    const attrs = Buffer.alloc(e.attrs.length * 20);
    e.attrs.forEach((a, i) => {
      const p = i * 20;
      attrs.writeUInt32LE(0xffffffff, p);
      attrs.writeUInt32LE(strings.indexOf(a.name), p + 4);
      attrs.writeUInt16LE(8, p + 12);
      if (a.bool !== undefined) {
        attrs.writeUInt32LE(0xffffffff, p + 8);
        attrs[p + 15] = 0x12;
        attrs.writeUInt32LE(a.bool ? 0xffffffff : 0, p + 16);
      } else {
        const idx = strings.indexOf(a.string ?? "");
        attrs.writeUInt32LE(idx, p + 8);
        attrs[p + 15] = 0x03;
        attrs.writeUInt32LE(idx, p + 16);
      }
    });
    const head = Buffer.alloc(16 + 20);
    head.writeUInt16LE(0x0102, 0);
    head.writeUInt16LE(16, 2);
    head.writeUInt32LE(36 + attrs.length, 4);
    head.writeUInt32LE(0xffffffff, 16);
    head.writeUInt32LE(strings.indexOf(e.name), 20);
    head.writeUInt16LE(20, 24);
    head.writeUInt16LE(20, 26);
    head.writeUInt16LE(e.attrs.length, 28);
    return Buffer.concat([head, attrs]);
  });

  const body = Buffer.concat([pool, resMap, ...chunks]);
  const header = Buffer.alloc(8);
  header.writeUInt16LE(0x0003, 0);
  header.writeUInt16LE(8, 2);
  header.writeUInt32LE(8 + body.length, 4);
  return Buffer.concat([header, body]);
}

// ── DEX ─────────────────────────────────────────────────────────────────────

export function buildDex(descriptors: string[]): Buffer {
  const headerSize = 0x70;
  const n = descriptors.length;
  const stringIdsOff = headerSize;
  const typeIdsOff = stringIdsOff + n * 4;
  let dataOff = typeIdsOff + n * 4;
  const stringIds = Buffer.alloc(n * 4);
  const typeIds = Buffer.alloc(n * 4);
  const data: Buffer[] = [];
  descriptors.forEach((d, i) => {
    stringIds.writeUInt32LE(dataOff, i * 4);
    typeIds.writeUInt32LE(i, i * 4);
    const bytes = Buffer.from(d, "utf8");
    const entry = Buffer.concat([Buffer.from([d.length]), bytes, Buffer.from([0])]);
    data.push(entry);
    dataOff += entry.length;
  });
  const header = Buffer.alloc(headerSize);
  header.write("dex\n035\0", 0, "latin1");
  header.writeUInt32LE(n, 0x38);
  header.writeUInt32LE(stringIdsOff, 0x3c);
  header.writeUInt32LE(n, 0x40);
  header.writeUInt32LE(typeIdsOff, 0x44);
  return Buffer.concat([header, stringIds, typeIds, ...data]);
}

// ── ASAR / Electron ─────────────────────────────────────────────────────────

export function buildAsar(files: Record<string, string>): Buffer {
  const index: { files: Record<string, unknown> } = { files: {} };
  const contents: Buffer[] = [];
  let offset = 0;
  for (const [path, text] of Object.entries(files)) {
    const parts = path.split("/");
    let node = index;
    for (const dir of parts.slice(0, -1)) {
      node.files[dir] ??= { files: {} };
      node = node.files[dir] as typeof index;
    }
    const buf = Buffer.from(text, "utf8");
    node.files[parts[parts.length - 1]] = { size: buf.length, offset: String(offset) };
    contents.push(buf);
    offset += buf.length;
  }
  const json = Buffer.from(JSON.stringify(index), "utf8");
  const jsonPadded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4)]);
  const headerPickle = Buffer.alloc(8);
  headerPickle.writeUInt32LE(4 + jsonPadded.length, 0);
  headerPickle.writeUInt32LE(json.length, 4);
  const sizePickle = Buffer.alloc(8);
  sizePickle.writeUInt32LE(4, 0);
  sizePickle.writeUInt32LE(8 + jsonPadded.length, 4);
  return Buffer.concat([sizePickle, headerPickle, jsonPadded, ...contents]);
}

/** A stand-in Electron binary: padding, the fuse sentinel, version 1, then the fuse states. */
export function buildFuseBinary(states: string, padding = 4096): Buffer {
  return Buffer.concat([Buffer.alloc(padding, 0x90), FUSE_SENTINEL, Buffer.from([1, states.length]), Buffer.from(states, "latin1"), Buffer.alloc(64)]);
}

// ── ELF ─────────────────────────────────────────────────────────────────────

export interface ElfSpec {
  type: "exec" | "pie" | "shared";
  sections: Array<{ name: string; type?: number; size?: number; entsize?: number }>;
  stackFlags?: number | null;
  relro?: boolean;
  extra?: string;
}

export function buildElf64(spec: ElfSpec): Buffer {
  const names = ["", ".shstrtab", ...spec.sections.map((s) => s.name)];
  const shstrtab = Buffer.from(names.join("\0") + "\0", "latin1");
  const phdrs: Array<{ type: number; flags: number }> = [];
  if (spec.type !== "shared") phdrs.push({ type: 3, flags: 4 });
  if (spec.stackFlags !== null) phdrs.push({ type: 0x6474e551, flags: spec.stackFlags ?? 6 });
  if (spec.relro !== false) phdrs.push({ type: 0x6474e552, flags: 4 });

  const phoff = 64;
  const extra = Buffer.from(spec.extra ?? "", "latin1");
  const strOff = phoff + phdrs.length * 56;
  const extraOff = strOff + shstrtab.length;
  const shoff = Math.ceil((extraOff + extra.length) / 8) * 8;
  const shnum = names.length;

  const buf = Buffer.alloc(shoff + shnum * 64);
  buf[0] = 0x7f;
  buf.write("ELF", 1, "latin1");
  buf[4] = 2;
  buf[5] = 1;
  buf[6] = 1;
  buf.writeUInt16LE(spec.type === "exec" ? 2 : 3, 16);
  buf.writeUInt16LE(0x3e, 18);
  buf.writeBigUInt64LE(BigInt(phoff), 32);
  buf.writeBigUInt64LE(BigInt(shoff), 40);
  buf.writeUInt16LE(56, 54);
  buf.writeUInt16LE(phdrs.length, 56);
  buf.writeUInt16LE(64, 58);
  buf.writeUInt16LE(shnum, 60);
  buf.writeUInt16LE(1, 62);
  phdrs.forEach((p, i) => {
    buf.writeUInt32LE(p.type, phoff + i * 56);
    buf.writeUInt32LE(p.flags, phoff + i * 56 + 4);
  });
  shstrtab.copy(buf, strOff);
  extra.copy(buf, extraOff);

  let nameOff = 1;
  const sections = [{ name: ".shstrtab", type: 3, size: shstrtab.length, entsize: 0, offset: strOff }, ...spec.sections.map((s) => ({ ...s, offset: 0 }))];
  sections.forEach((s, i) => {
    const o = shoff + (i + 1) * 64;
    buf.writeUInt32LE(nameOff, o);
    buf.writeUInt32LE(s.type ?? 1, o + 4);
    buf.writeBigUInt64LE(BigInt(s.offset), o + 24);
    buf.writeBigUInt64LE(BigInt(s.size ?? 0), o + 32);
    buf.writeBigUInt64LE(BigInt(s.entsize ?? 0), o + 56);
    nameOff += s.name.length + 1;
  });
  return buf;
}

// ── Mach-O ──────────────────────────────────────────────────────────────────

export interface MachOSpec {
  filetype?: number;
  pie?: boolean;
  /** nlist n_type values for the symbol table. */
  symbols?: number[];
  signature?: { flags: number; platform?: number; entitlements?: string } | null;
}

export function buildMachO64(spec: MachOSpec): Buffer {
  const cmds: Buffer[] = [];
  const symbols = spec.symbols ?? [];
  const headerSize = 32;
  const symtabCmd = Buffer.alloc(24);
  const sigCmd = Buffer.alloc(16);
  const cmdsSize = (symbols.length > 0 ? 24 : 0) + (spec.signature ? 16 : 0);
  let tail = headerSize + cmdsSize;

  const symOff = tail;
  const nlist = Buffer.alloc(symbols.length * 16);
  symbols.forEach((t, i) => {
    nlist.writeUInt32LE(1, i * 16);
    nlist[i * 16 + 4] = t;
  });
  const strtab = Buffer.from("\0_sym\0", "latin1");
  tail += nlist.length;
  const strOff = tail;
  tail += strtab.length;

  if (symbols.length > 0) {
    symtabCmd.writeUInt32LE(0x2, 0);
    symtabCmd.writeUInt32LE(24, 4);
    symtabCmd.writeUInt32LE(symOff, 8);
    symtabCmd.writeUInt32LE(symbols.length, 12);
    symtabCmd.writeUInt32LE(strOff, 16);
    symtabCmd.writeUInt32LE(strtab.length, 20);
    cmds.push(symtabCmd);
  }

  let sigBlob = Buffer.alloc(0);
  if (spec.signature) {
    const cd = Buffer.alloc(44);
    cd.writeUInt32BE(0xfade0c02, 0);
    cd.writeUInt32BE(44, 4);
    cd.writeUInt32BE(0x20400, 8);
    cd.writeUInt32BE(spec.signature.flags, 12);
    cd[38] = spec.signature.platform ?? 0;
    const blobs: Array<{ type: number; data: Buffer }> = [{ type: 0, data: cd }];
    if (spec.signature.entitlements) {
      const xml = Buffer.from(spec.signature.entitlements, "utf8");
      const ent = Buffer.alloc(8);
      ent.writeUInt32BE(0xfade7171, 0);
      ent.writeUInt32BE(8 + xml.length, 4);
      blobs.push({ type: 5, data: Buffer.concat([ent, xml]) });
    }
    const index = Buffer.alloc(12 + blobs.length * 8);
    index.writeUInt32BE(0xfade0cc0, 0);
    index.writeUInt32BE(blobs.length, 8);
    let off = index.length;
    blobs.forEach((b, i) => {
      index.writeUInt32BE(b.type, 12 + i * 8);
      index.writeUInt32BE(off, 12 + i * 8 + 4);
      off += b.data.length;
    });
    sigBlob = Buffer.concat([index, ...blobs.map((b) => b.data)]);
    sigBlob.writeUInt32BE(sigBlob.length, 4);
    sigCmd.writeUInt32LE(0x1d, 0);
    sigCmd.writeUInt32LE(16, 4);
    sigCmd.writeUInt32LE(tail, 8);
    sigCmd.writeUInt32LE(sigBlob.length, 12);
    cmds.push(sigCmd);
  }

  const header = Buffer.alloc(headerSize);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(0x0100000c, 4);
  header.writeUInt32LE(spec.filetype ?? 2, 12);
  header.writeUInt32LE(cmds.length, 16);
  header.writeUInt32LE(cmdsSize, 20);
  header.writeUInt32LE(spec.pie === false ? 0 : 0x200000, 24);
  return Buffer.concat([header, ...cmds, nlist, strtab, sigBlob]);
}

export function entitlementsPlist(keys: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>${keys.map((k) => `<key>${k}</key><true/>`).join("")}</dict></plist>`;
}

// ── PE / .NET ───────────────────────────────────────────────────────────────

export interface PeSpec {
  dll?: boolean;
  dllCharacteristics?: number;
  signed?: boolean;
  pdbPath?: string;
  embeddedPdb?: boolean;
  /** Names for the .NET #Strings heap; omit for a native PE. */
  dotnetNames?: string[];
}

export function buildPe(spec: PeSpec): Buffer {
  const fileAlign = 0x200;
  const sectionVA = 0x1000;
  const sectionRaw = 0x400;

  // Section contents: debug directory, CodeView record, CLR header, metadata.
  const section: Buffer[] = [];
  let cursor = 0;
  const place = (b: Buffer) => {
    const at = cursor;
    section.push(b);
    cursor += b.length;
    return at;
  };

  const debugEntries: Array<{ type: number; data: Buffer }> = [];
  if (spec.pdbPath !== undefined) {
    const cv = Buffer.concat([Buffer.from("RSDS", "latin1"), Buffer.alloc(20), Buffer.from(spec.pdbPath + "\0", "utf8")]);
    debugEntries.push({ type: 2, data: cv });
  }
  if (spec.embeddedPdb) debugEntries.push({ type: 17, data: Buffer.from("MPDB....", "latin1") });

  const debugDirAt = place(Buffer.alloc(debugEntries.length * 28));
  const dataAts = debugEntries.map((e) => place(e.data));
  debugEntries.forEach((e, i) => {
    const d = section[0];
    d.writeUInt32LE(e.type, i * 28 + 12);
    d.writeUInt32LE(e.data.length, i * 28 + 16);
    d.writeUInt32LE(sectionVA + dataAts[i], i * 28 + 20);
    d.writeUInt32LE(sectionRaw + dataAts[i], i * 28 + 24);
  });

  let clrAt = -1;
  if (spec.dotnetNames) {
    const strings = Buffer.from("\0" + spec.dotnetNames.join("\0") + "\0", "utf8");
    const stringsPadded = Buffer.concat([strings, Buffer.alloc((4 - (strings.length % 4)) % 4)]);
    const version = Buffer.from("v4.0.30319\0\0", "latin1");
    const root = Buffer.alloc(16);
    root.write("BSJB", 0, "latin1");
    root.writeUInt32LE(version.length, 12);
    const streamsHead = Buffer.alloc(4);
    streamsHead.writeUInt16LE(1, 2);
    const streamHdr = Buffer.concat([Buffer.alloc(8), Buffer.from("#Strings\0\0\0\0", "latin1")]);
    const metaLen = root.length + version.length + streamsHead.length + streamHdr.length;
    streamHdr.writeUInt32LE(metaLen, 0);
    streamHdr.writeUInt32LE(stringsPadded.length, 4);
    const meta = Buffer.concat([root, version, streamsHead, streamHdr, stringsPadded]);
    const clr = Buffer.alloc(72);
    clrAt = place(clr);
    const metaAt = place(meta);
    clr.writeUInt32LE(72, 0);
    clr.writeUInt32LE(sectionVA + metaAt, 8);
    clr.writeUInt32LE(meta.length, 12);
  }

  const sectionData = Buffer.concat(section);
  const sectionSize = Math.ceil(Math.max(sectionData.length, 1) / fileAlign) * fileAlign;
  const certAt = sectionRaw + sectionSize;
  const cert = spec.signed ? Buffer.alloc(16, 1) : Buffer.alloc(0);

  const buf = Buffer.alloc(certAt + cert.length);
  buf.write("MZ", 0, "latin1");
  const peOff = 0x80;
  buf.writeUInt32LE(peOff, 0x3c);
  buf.write("PE\0\0", peOff, "latin1");
  const coff = peOff + 4;
  buf.writeUInt16LE(0x8664, coff);
  buf.writeUInt16LE(1, coff + 2);
  buf.writeUInt16LE(240, coff + 16);
  buf.writeUInt16LE(0x0022 | (spec.dll ? 0x2000 : 0), coff + 18);
  const opt = coff + 20;
  buf.writeUInt16LE(0x20b, opt);
  buf.writeUInt16LE(spec.dllCharacteristics ?? 0x8160, opt + 70);
  buf.writeUInt32LE(16, opt + 108);
  const dirs = opt + 112;
  if (spec.signed) {
    buf.writeUInt32LE(certAt, dirs + 4 * 8);
    buf.writeUInt32LE(cert.length, dirs + 4 * 8 + 4);
  }
  if (debugEntries.length > 0) {
    buf.writeUInt32LE(sectionVA + debugDirAt, dirs + 6 * 8);
    buf.writeUInt32LE(debugEntries.length * 28, dirs + 6 * 8 + 4);
  }
  if (clrAt >= 0) {
    buf.writeUInt32LE(sectionVA + clrAt, dirs + 14 * 8);
    buf.writeUInt32LE(72, dirs + 14 * 8 + 4);
  }
  const sec = opt + 240;
  buf.write(".text", sec, "latin1");
  buf.writeUInt32LE(sectionSize, sec + 8);
  buf.writeUInt32LE(sectionVA, sec + 12);
  buf.writeUInt32LE(sectionSize, sec + 16);
  buf.writeUInt32LE(sectionRaw, sec + 20);
  sectionData.copy(buf, sectionRaw);
  cert.copy(buf, certAt);
  return buf;
}

/** Plain, descriptive identifiers like an unobfuscated assembly's metadata. */
export const READABLE_DOTNET_NAMES = [
  "LicenseValidator", "ValidateLicenseKey", "ComputeChecksum", "SubscriptionManager", "UpgradeToPremium", "CancelSubscription",
  "FeatureFlags", "EnableExperimentalScanner", "MaximumConcurrentScans", "Program", "Main", "Object", "String", "Console",
  "WriteLine", "StartsWith", "IsNullOrEmpty", "get_CurrentPlan", "set_CurrentPlan", "CurrentPlan", "paymentToken", "key",
  "args", "value", "validator", "manager", "DebuggableAttribute", "CompilationRelaxationsAttribute", "RuntimeCompatibilityAttribute",
  "TargetFrameworkAttribute", "AssemblyCompanyAttribute", "AssemblyProductAttribute", "AssemblyTitleAttribute", "LicenseApp",
  "System.Runtime", "System.Console", "<Module>", "<CurrentPlan>k__BackingField",
];

// ── Protobuf manifest (App Bundle) ──────────────────────────────────────────

function varint(n: number): Buffer {
  const out: number[] = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return Buffer.from(out);
}
const pbBytes = (no: number, data: Buffer) => Buffer.concat([varint(no * 8 + 2), varint(data.length), data]);
const pbString = (no: number, s: string) => pbBytes(no, Buffer.from(s, "utf8"));
const pbVarint = (no: number, n: number) => Buffer.concat([varint(no * 8), varint(n)]);

/** aapt2 XmlNode tree: elements nest by `children`, attributes carry their source text. */
export interface ProtoElement {
  name: string;
  attrs?: Array<{ name: string; value: string; resourceId?: number }>;
  children?: ProtoElement[];
}

export function buildProtoManifest(root: ProtoElement): Buffer {
  const element = (e: ProtoElement): Buffer => {
    const parts = [pbString(3, e.name)];
    for (const a of e.attrs ?? []) {
      parts.push(pbBytes(4, Buffer.concat([pbString(1, "http://schemas.android.com/apk/res/android"), pbString(2, a.name), pbString(3, a.value), ...(a.resourceId ? [pbVarint(5, a.resourceId)] : [])])));
    }
    for (const c of e.children ?? []) parts.push(pbBytes(5, pbBytes(1, element(c))));
    return Buffer.concat(parts);
  };
  return pbBytes(1, element(root));
}

// ── Binary plist ────────────────────────────────────────────────────────────

/** bplist00 for a flat dictionary of strings and booleans (Info.plist-like). */
export function buildBinaryPlist(dict: Record<string, string | boolean>): Buffer {
  const objects: Buffer[] = [];
  const add = (b: Buffer) => objects.push(b) - 1;
  const str = (s: string) => {
    const body = Buffer.from(s, "latin1");
    return add(Buffer.concat([body.length < 15 ? Buffer.from([0x50 | body.length]) : Buffer.from([0x5f, 0x10, body.length]), body]));
  };
  const entries = Object.entries(dict);
  const dictIndex = add(Buffer.alloc(0)); // placeholder, filled below
  const keyRefs = entries.map(([k]) => str(k));
  const valRefs = entries.map(([, v]) => (typeof v === "boolean" ? add(Buffer.from([v ? 0x09 : 0x08])) : str(v)));
  objects[dictIndex] = Buffer.concat([Buffer.from([0xd0 | entries.length]), Buffer.from(keyRefs), Buffer.from(valRefs)]);
  let offset = 8;
  const offsets: number[] = [];
  for (const o of objects) {
    offsets.push(offset);
    offset += o.length;
  }
  const trailer = Buffer.alloc(32);
  trailer[6] = 2;
  trailer[7] = 1;
  trailer.writeBigUInt64BE(BigInt(objects.length), 8);
  trailer.writeBigUInt64BE(BigInt(dictIndex), 16);
  trailer.writeBigUInt64BE(BigInt(offset), 24);
  const table = Buffer.alloc(offsets.length * 2);
  offsets.forEach((o, i) => table.writeUInt16BE(o, i * 2));
  return Buffer.concat([Buffer.from("bplist00", "latin1"), ...objects, table, trailer]);
}

// ── Engines ─────────────────────────────────────────────────────────────────

export function il2cppMetadata(version = 29, size = 256): Buffer {
  const b = Buffer.alloc(size);
  b.writeUInt32LE(0xfab11baf, 0);
  b.writeUInt32LE(version, 4);
  return b;
}

/** A stand-in PyInstaller executable: an ELF head, payload, then the CArchive cookie with the Python library name. */
export function pyinstallerExe(payload = "", python = "libpython3.12.so.1.0"): Buffer {
  const cookie = Buffer.alloc(88);
  Buffer.from([0x4d, 0x45, 0x49, 0x0c, 0x0b, 0x0a, 0x0b, 0x0e]).copy(cookie, 0);
  cookie.write(python, 24, "latin1");
  return Buffer.concat([buildElf64({ type: "pie", sections: [], extra: "__stack_chk_fail" }), Buffer.from(payload, "latin1"), cookie]);
}
