import { closeSync, existsSync, openSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";
import { finding } from "./finding.js";
import { frameworkChecks } from "./frameworks.js";
import type { Finding } from "./finding.js";
import { walkFiles } from "./fsutil.js";
import { analyzeNative, detectNativeFormat } from "./native.js";
import { parsePlist, plistInside } from "./plist.js";
import type { PlistValue } from "./plist.js";
import { analyzeConfigFiles, binarySecrets, isConfigFile } from "./secrets.js";
import type { SecretScanOptions } from "./secrets.js";
import { analyzeWebFiles, isWebAsset } from "./web.js";
import type { ArtifactFile } from "./web.js";
import { extractZipEntry, readZipEntries } from "./zip.js";

const HERMES_MAGIC = Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f]);
const MAX_ENTRY_BYTES = 256 * 1024 * 1024;
const LC_ENCRYPTION_INFO = 0x21;
const LC_ENCRYPTION_INFO_64 = 0x2c;

/** A file inside an iOS .app, keyed relative to the bundle root. */
export interface BundleFile extends ArtifactFile {}

export interface IosResult {
  findings: Finding[];
  notes: string[];
  scannedFiles: number;
  /** Every file of the bundle, for framework checks that look for engine-specific layouts. */
  files: BundleFile[];
}

export function isIpa(path: string): boolean {
  return /\.ipa$/i.test(path);
}

/** An iOS .app is flat (Info.plist at its root); a macOS .app has Contents/. */
export function isIosAppDir(dir: string): boolean {
  return dir.endsWith(".app") && existsSync(join(dir, "Info.plist")) && !existsSync(join(dir, "Contents"));
}

function dict(v: PlistValue | null): Record<string, PlistValue> {
  return v && typeof v === "object" && !Array.isArray(v) && !Buffer.isBuffer(v) ? v : {};
}

/** cryptid of the first thin Mach-O slice: 0 means the code is not FairPlay-encrypted. */
function cryptId(buf: Buffer): number | null {
  let slice = buf;
  if (detectNativeFormat(buf) === "fat-macho") {
    const offset = buf.readUInt32BE(8 + 8);
    slice = buf.subarray(offset);
  }
  if (detectNativeFormat(slice) !== "macho") return null;
  const is64 = slice.readUInt32LE(0) === 0xfeedfacf;
  const ncmds = slice.readUInt32LE(16);
  let p = is64 ? 32 : 28;
  for (let i = 0; i < ncmds && p + 20 <= slice.length; i++) {
    const cmd = slice.readUInt32LE(p);
    if (cmd === LC_ENCRYPTION_INFO || cmd === LC_ENCRYPTION_INFO_64) return slice.readUInt32LE(p + 16);
    p += slice.readUInt32LE(p + 4);
  }
  return null;
}

/**
 * Checks an iOS app bundle, from an .ipa or a .app folder: the Debug-build
 * markers Xcode leaves, the provisioning profile, the main executable, a
 * React Native bundle and any web code (Capacitor/Cordova) it carries.
 */
export function analyzeIosBundle(files: BundleFile[], label: string): IosResult {
  const findings: Finding[] = [];
  const notes: string[] = [];
  const byKey = new Map(files.map((f) => [f.key, f]));
  let scannedFiles = 0;
  const secrets: SecretScanOptions = { target: "ios", mobile: true };

  const info = dict(byKey.get("Info.plist")?.read() ? parsePlist(byKey.get("Info.plist")!.read()!) : null);
  const appName = label.split("/").pop()?.replace(/\.app$/, "") ?? "";
  const exe = typeof info.CFBundleExecutable === "string" ? info.CFBundleExecutable : appName;
  if (info.CFBundleIdentifier) notes.push(`bundle ${String(info.CFBundleIdentifier)}${info.DTPlatformName ? ` (${String(info.DTPlatformName)})` : ""}`);
  if (info.DTPlatformName === "iphonesimulator") notes.push("Simulator build: it cannot be distributed, but its code is the same as a device build of that configuration");

  // ── Debug configuration ──
  const debugDylib = byKey.get(`${exe}.debug.dylib`);
  const preview = byKey.get("__preview.dylib");
  if (debugDylib || preview) {
    findings.push(finding("ios_debug_build", (debugDylib ?? preview)!.display, {
      match: [debugDylib ? `${exe}.debug.dylib` : "", preview ? "__preview.dylib" : ""].filter(Boolean).join(" + "),
    }));
  }

  // ── Debug symbols copied into the bundle ──
  const dsyms = [...new Set(files.map((f) => /^(?:.*\/)?([^/]+\.dSYM)\//.exec(f.key)?.[1]).filter((n): n is string => n !== undefined))];
  if (dsyms.length > 0) {
    const first = files.find((f) => f.key.includes(`${dsyms[0]}/`))!;
    findings.push(finding("ios_dsym_shipped", first.display.slice(0, first.display.indexOf(`${dsyms[0]}/`) + dsyms[0].length), {
      match: dsyms.length > 3 ? `${dsyms.slice(0, 3).join(", ")} and ${dsyms.length - 3} more` : dsyms.join(", "),
    }));
  }

  // ── Executables ──
  const nativeTargets = [byKey.get(exe), debugDylib].filter((f): f is BundleFile => f !== undefined);
  for (const f of nativeTargets) {
    const buf = f.read();
    const result = buf ? analyzeNative(buf, f.display) : null;
    if (!result || !buf) continue;
    scannedFiles++;
    notes.push(...result.notes);
    const isMain = f.key === exe;
    findings.push(...binarySecrets(buf, f.display, secrets));
    for (const nf of result.findings) {
      // Hardened Runtime is a macOS mechanism; iOS enforces code signing differently.
      if (nf.patternId === "native_no_hardened_runtime") continue;
      if (!isMain && nf.patternId !== "native_debug_info" && nf.patternId !== "native_symbols_not_stripped") continue;
      findings.push(nf);
    }
    if (isMain) {
      const id = cryptId(buf);
      if (id === 0) notes.push(`${exe} is not FairPlay-encrypted (normal for development and ad-hoc exports; the App Store encrypts on distribution)`);
    }
  }
  if (!byKey.has(exe)) notes.push(`main executable ${exe} not found in the bundle`);

  // ── Provisioning ──
  const profile = byKey.get("embedded.mobileprovision")?.read();
  if (profile) {
    const p = dict(plistInside(profile));
    const ent = dict(p.Entitlements ?? null);
    const name = typeof p.Name === "string" ? p.Name : "embedded.mobileprovision";
    if (ent["get-task-allow"] === true) findings.push(finding("ios_development_profile", byKey.get("embedded.mobileprovision")!.display, { match: `${name}: get-task-allow = true` }));
    else notes.push(`provisioning profile ${name}${p.ProvisionsAllDevices ? " (enterprise)" : Array.isArray(p.ProvisionedDevices) ? " (ad hoc)" : ""}`);
  }

  // ── React Native / web code ──
  const rn = byKey.get("main.jsbundle");
  if (rn) {
    const buf = rn.read();
    if (buf && buf.subarray(0, 8).equals(HERMES_MAGIC)) {
      notes.push("React Native bundle is Hermes bytecode");
      findings.push(...binarySecrets(buf, rn.display, secrets));
      scannedFiles++;
    } else if (buf) {
      findings.push(finding("ios_js_bundle_plaintext", rn.display, { match: `${(buf.length / 1024).toFixed(0)} KiB of JavaScript` }));
      findings.push(...analyzeWebFiles([{ ...rn, key: "main.jsbundle.js", read: () => buf }], { mobile: true }));
      scannedFiles++;
    }
  }
  const web = files.filter((f) => isWebAsset(f.key));
  if (web.length > 0) {
    scannedFiles += web.length;
    findings.push(...analyzeWebFiles(web, { mobile: true }));
  }
  // Info.plist, GoogleService-Info.plist and the JSON/plist config apps bundle.
  const config = files.filter((f) => isConfigFile(f.key));
  scannedFiles += config.length;
  findings.push(...analyzeConfigFiles(config, secrets));

  const engine = frameworkChecks(files);
  findings.push(...engine.findings);
  notes.push(...engine.notes);

  return { findings, notes, scannedFiles, files };
}

export function analyzeIpa(path: string): IosResult | null {
  const size = statSync(path).size;
  const fd = openSync(path, "r");
  let entries;
  try {
    entries = readZipEntries(fd, size);
  } finally {
    closeSync(fd);
  }
  const first = entries.find((e) => /^Payload\/[^/]+\.app\//.test(e.name));
  if (!first) return null;
  const prefix = first.name.slice(0, first.name.indexOf(".app/") + 5);
  const files: BundleFile[] = entries
    .filter((e) => e.name.startsWith(prefix) && !e.name.endsWith("/"))
    .map((e) => ({
      key: e.name.slice(prefix.length),
      display: `${path}!/${e.name}`,
      size: e.uncompressedSize,
      read: () => {
        if (e.uncompressedSize > MAX_ENTRY_BYTES) return null;
        const rfd = openSync(path, "r");
        try {
          return extractZipEntry(rfd, e);
        } finally {
          closeSync(rfd);
        }
      },
    }));
  return analyzeIosBundle(files, prefix.slice(0, -1));
}

export function analyzeIosAppDir(dir: string, maxFiles: number): IosResult {
  const files: BundleFile[] = [];
  walkFiles(dir, { maxFiles, skipDirs: new Set(["node_modules", "_CodeSignature"]) }, (full) => {
    const key = relative(dir, full).split(sep).join("/");
    files.push({ key, display: full, size: statSync(full).size, read: () => (statSync(full).size > MAX_ENTRY_BYTES ? null : readFileSync(full)) });
  });
  return analyzeIosBundle(files, dir);
}
