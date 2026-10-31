import { closeSync, openSync, statSync } from "fs";
import { attribute, parseAxml } from "./axml.js";
import type { AxmlElement } from "./axml.js";
import { parseProtoXml } from "./protoxml.js";
import { assessDexObfuscation, readTypeDescriptors } from "./dex.js";
import { finding } from "./finding.js";
import { frameworkChecks } from "./frameworks.js";
import type { Finding } from "./finding.js";
import { readAt } from "./fsutil.js";
import { analyzeNative } from "./native.js";
import { analyzeConfigFiles, binarySecrets, findSecrets, isConfigFile, readProtoStrings } from "./secrets.js";
import type { SecretScanOptions } from "./secrets.js";
import { analyzeWebFiles } from "./web.js";
import { extractZipEntry, locateCentralDirectory, readZipEntries } from "./zip.js";
import type { ZipEntry } from "./zip.js";

const APK_SIG_BLOCK_MAGIC = "APK Sig Block 42";
const HERMES_MAGIC = Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f]);
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_NATIVE_LIBS = 40;

export interface ApkResult {
  findings: Finding[];
  notes: string[];
  scannedFiles: number;
}

export function isApk(filePath: string): boolean {
  return /\.apk$/i.test(filePath);
}

export function isAab(filePath: string): boolean {
  return /\.aab$/i.test(filePath);
}

/**
 * APK: binary AXML manifest at the root, classes*.dex, lib/, assets/.
 * AAB: one directory per module (base/, feature modules) with a protobuf
 * manifest in manifest/, dex in dex/; Play re-signs, so signing is not judged.
 */
interface Layout {
  manifest: RegExp;
  parse: (buf: Buffer) => AxmlElement[] | null;
  dex: RegExp;
  lib: RegExp;
  jsBundle: RegExp;
  assets: RegExp;
  /** Compiled resource table, where strings.xml values (and google-services keys) end up. */
  resources: RegExp;
  /** Files shipped as-is: assets/ and res/raw/. */
  shipped: RegExp;
  signed: boolean;
}

const APK: Layout = {
  manifest: /^AndroidManifest\.xml$/,
  parse: parseAxml,
  dex: /^classes\d*\.dex$/,
  lib: /^lib\/[^/]+\/[^/]+\.so$/,
  jsBundle: /^assets\/index\.android\.bundle$/,
  assets: /^assets\/.*\.(?:m?js|map)$/i,
  resources: /^resources\.arsc$/,
  shipped: /^(?:assets|res\/raw)\//,
  signed: true,
};

const AAB: Layout = {
  manifest: /^base\/manifest\/AndroidManifest\.xml$/,
  parse: parseProtoXml,
  dex: /^[^/]+\/dex\/classes\d*\.dex$/,
  lib: /^[^/]+\/lib\/[^/]+\/[^/]+\.so$/,
  jsBundle: /^base\/assets\/index\.android\.bundle$/,
  assets: /^[^/]+\/assets\/.*\.(?:m?js|map)$/i,
  resources: /^[^/]+\/resources\.pb$/,
  shipped: /^[^/]+\/(?:assets|res\/raw)\//,
  signed: false,
};

export function analyzeApk(filePath: string): ApkResult | null {
  return analyzeAndroidPackage(filePath, isAab(filePath) ? AAB : APK);
}

function analyzeAndroidPackage(filePath: string, layout: Layout): ApkResult | null {
  const size = statSync(filePath).size;
  const fd = openSync(filePath, "r");
  try {
    const entries = readZipEntries(fd, size);
    const manifestEntry = entries.find((e) => layout.manifest.test(e.name));
    if (!manifestEntry) return null;

    const read = (e: ZipEntry): Buffer | null => (e.uncompressedSize > MAX_ENTRY_BYTES ? null : extractZipEntry(fd, e));
    const at = (name: string) => `${filePath}!/${name}`;
    const findings: Finding[] = [];
    const notes: string[] = [];
    let scannedFiles = 1;

    // ── Manifest ──
    const manifestBuf = read(manifestEntry);
    const elements = manifestBuf ? layout.parse(manifestBuf) : null;
    const manifest = elements?.find((e) => e.name === "manifest");
    const application = elements?.find((e) => e.name === "application");
    const packageName = String(manifest?.attributes.find((a) => a.name === "package")?.value ?? "");
    if (!elements) notes.push(`${manifestEntry.name} could not be parsed (unpacked or re-encoded package?)`);
    if (packageName) notes.push(`package ${packageName}`);

    if (attribute(application, "debuggable")?.value === true) {
      findings.push(finding("apk_debuggable", at(manifestEntry.name), { match: 'android:debuggable="true"' }));
    }
    if (attribute(application, "testOnly")?.value === true) {
      findings.push(finding("apk_test_only", at(manifestEntry.name), { match: 'android:testOnly="true"' }));
    }
    const allowBackup = attribute(application, "allowBackup");
    if (application && allowBackup?.value !== false) {
      findings.push(finding("apk_allow_backup", at(manifestEntry.name), {
        match: allowBackup ? 'android:allowBackup="true"' : "android:allowBackup not set (defaults to true)",
      }));
    }

    // ── Code: R8/ProGuard ──
    const dexEntries = entries.filter((e) => layout.dex.test(e.name));
    const descriptors: string[] = [];
    const secrets: SecretScanOptions = { target: "android", mobile: true };
    for (const e of dexEntries) {
      const buf = read(e);
      if (!buf) continue;
      descriptors.push(...readTypeDescriptors(buf));
      findings.push(...binarySecrets(buf, at(e.name), secrets));
    }
    scannedFiles += dexEntries.length;
    if (descriptors.length > 0) {
      // The application id can differ from the code namespace (e.g. a ".debug"
      // suffix), so also try the packages of the classes the manifest names.
      const componentClasses = (elements ?? [])
        .flatMap((el) => el.attributes.filter((a) => a.name === "name" && typeof a.value === "string").map((a) => String(a.value)))
        .map((n) => (n.startsWith(".") ? packageName + n : n))
        .filter((n) => n.includes("."));
      const candidates = new Set([packageName, ...componentClasses.map((n) => n.slice(0, n.lastIndexOf(".")))].filter(Boolean));
      const verdict = [...candidates]
        .map((pkg) => ({ pkg, ...assessDexObfuscation(descriptors, pkg) }))
        .sort((a, b) => b.appClasses - a.appClasses)[0];
      if (verdict) {
        notes.push(`${verdict.pkg}: ${verdict.appClasses} app classes in ${dexEntries.length} dex file(s), ${verdict.shortNamed} with 1–2 letter names`);
        if (!verdict.obfuscated) {
          findings.push(finding("apk_no_obfuscation", at(dexEntries[0].name), {
            match: `${verdict.appClasses} classes under ${verdict.pkg}, ${verdict.shortNamed} renamed; e.g. ${verdict.sample.join(", ")}`,
          }));
        }
      }
    }

    // ── React Native / web assets ──
    const jsBundle = entries.find((e) => layout.jsBundle.test(e.name));
    if (jsBundle) {
      const buf = read(jsBundle);
      if (buf && buf.subarray(0, 8).equals(HERMES_MAGIC)) {
        notes.push("React Native bundle is Hermes bytecode");
        findings.push(...binarySecrets(buf, at(jsBundle.name), secrets));
        scannedFiles++;
      } else if (buf) {
        findings.push(finding("apk_js_bundle_plaintext", at(jsBundle.name), { match: `${(buf.length / 1024).toFixed(0)} KiB of JavaScript` }));
        findings.push(...analyzeWebFiles([{ key: "index.android.bundle.js", display: at(jsBundle.name), size: buf.length, read: () => buf }], { mobile: true }));
        scannedFiles++;
      }
    }
    const webAssets = entries.filter((e) => layout.assets.test(e.name) && !e.name.includes("node_modules"));
    if (webAssets.length > 0) {
      scannedFiles += webAssets.length;
      findings.push(...analyzeWebFiles(webAssets.map((e) => ({ key: e.name, display: at(e.name), size: e.uncompressedSize, read: () => read(e) })), { mobile: true }));
    }

    // ── Resources and shipped config files ──
    for (const e of entries.filter((x) => layout.resources.test(x.name))) {
      const buf = read(e);
      if (!buf) continue;
      scannedFiles++;
      if (e.name.endsWith(".pb")) findings.push(...findSecrets(readProtoStrings(buf).join("\n"), at(e.name), { ...secrets, positions: false }));
      else findings.push(...binarySecrets(buf, at(e.name), secrets));
    }
    const shipped = entries.filter((e) => layout.shipped.test(e.name) && !e.name.endsWith("/") && (isConfigFile(e.name) || /(?:^|\/)res\/raw\/[^/.]+$/.test(e.name)));
    scannedFiles += shipped.length;
    findings.push(...analyzeConfigFiles(shipped.map((e) => ({ key: e.name, display: at(e.name), size: e.uncompressedSize, read: () => read(e) })), secrets));

    // ── Native libraries ──
    const libs = entries.filter((e) => layout.lib.test(e.name)).slice(0, MAX_NATIVE_LIBS);
    const seen = new Set<string>();
    for (const e of libs) {
      const buf = read(e);
      const result = buf ? analyzeNative(buf, at(e.name)) : null;
      scannedFiles++;
      // Keys "hidden" in NDK code are a common pattern; the strings are there for anyone to read.
      if (buf) findings.push(...binarySecrets(buf, at(e.name), secrets));
      for (const f of result?.findings ?? []) {
        // Same library for several ABIs: report each issue once per library name.
        const key = `${f.patternId}:${e.name.split("/").pop()}`;
        if (f.patternId !== "native_debug_info" && f.patternId !== "native_symbols_not_stripped") continue;
        if (!seen.has(key)) {
          seen.add(key);
          findings.push(f);
        }
      }
    }

    // ── Engines (Unity, Flutter) ──
    const engine = frameworkChecks(entries.filter((e) => !e.name.endsWith("/")).map((e) => ({ key: e.name, display: at(e.name), size: e.uncompressedSize, read: () => read(e) })));
    findings.push(...engine.findings);
    notes.push(...engine.notes);

    // ── Signing ──
    if (!layout.signed) {
      notes.push("App Bundle: Google Play re-signs the APKs it generates, so signing is not judged here");
      return { findings, notes, scannedFiles };
    }
    const located = locateCentralDirectory(fd, size);
    const hasSigBlock = located !== null && located.cdOffset >= 16 && readAt(fd, located.cdOffset - 16, 16).toString("latin1") === APK_SIG_BLOCK_MAGIC;
    const hasV1 = entries.some((e) => /^META-INF\/[^/]+\.(?:RSA|DSA|EC)$/i.test(e.name));
    if (!hasSigBlock && !hasV1) findings.push(finding("apk_unsigned", filePath, { match: "no APK Signing Block and no META-INF signature" }));
    else if (!hasSigBlock) findings.push(finding("apk_v1_only_signature", filePath, { match: "META-INF signature only, no APK Signing Block (v2+)" }));
    else notes.push(`signed with APK Signature Scheme v2+${hasV1 ? " and v1" : ""}`);

    return { findings, notes, scannedFiles };
  } finally {
    closeSync(fd);
  }
}
