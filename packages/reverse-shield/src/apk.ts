import { closeSync, openSync, statSync } from "fs";
import { attribute, parseAxml } from "./axml.js";
import { assessDexObfuscation, readTypeDescriptors } from "./dex.js";
import { finding } from "./finding.js";
import type { Finding } from "./finding.js";
import { readAt } from "./fsutil.js";
import { analyzeNative } from "./native.js";
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

export function analyzeApk(filePath: string): ApkResult | null {
  const size = statSync(filePath).size;
  const fd = openSync(filePath, "r");
  try {
    const entries = readZipEntries(fd, size);
    const manifestEntry = entries.find((e) => e.name === "AndroidManifest.xml");
    if (!manifestEntry) return null;

    const read = (e: ZipEntry): Buffer | null => (e.uncompressedSize > MAX_ENTRY_BYTES ? null : extractZipEntry(fd, e));
    const at = (name: string) => `${filePath}!/${name}`;
    const findings: Finding[] = [];
    const notes: string[] = [];
    let scannedFiles = 1;

    // ── Manifest ──
    const manifestBuf = read(manifestEntry);
    const elements = manifestBuf ? parseAxml(manifestBuf) : null;
    const manifest = elements?.find((e) => e.name === "manifest");
    const application = elements?.find((e) => e.name === "application");
    const packageName = String(manifest?.attributes.find((a) => a.name === "package")?.value ?? "");
    if (!elements) notes.push("AndroidManifest.xml is not binary XML (unpacked or re-encoded APK?)");
    if (packageName) notes.push(`package ${packageName}`);

    if (attribute(application, "debuggable")?.value === true) {
      findings.push(finding("apk_debuggable", at("AndroidManifest.xml"), { match: 'android:debuggable="true"' }));
    }
    if (attribute(application, "testOnly")?.value === true) {
      findings.push(finding("apk_test_only", at("AndroidManifest.xml"), { match: 'android:testOnly="true"' }));
    }
    const allowBackup = attribute(application, "allowBackup");
    if (application && allowBackup?.value !== false) {
      findings.push(finding("apk_allow_backup", at("AndroidManifest.xml"), {
        match: allowBackup ? 'android:allowBackup="true"' : "android:allowBackup not set (defaults to true)",
      }));
    }

    // ── Code: R8/ProGuard ──
    const dexEntries = entries.filter((e) => /^classes\d*\.dex$/.test(e.name));
    const descriptors: string[] = [];
    for (const e of dexEntries) {
      const buf = read(e);
      if (buf) descriptors.push(...readTypeDescriptors(buf));
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
    const jsBundle = entries.find((e) => e.name === "assets/index.android.bundle");
    if (jsBundle) {
      const buf = read(jsBundle);
      if (buf && buf.subarray(0, 8).equals(HERMES_MAGIC)) {
        notes.push("React Native bundle is Hermes bytecode");
      } else if (buf) {
        findings.push(finding("apk_js_bundle_plaintext", at(jsBundle.name), { match: `${(buf.length / 1024).toFixed(0)} KiB of JavaScript` }));
        findings.push(...analyzeWebFiles([{ key: "index.android.bundle.js", display: at(jsBundle.name), size: buf.length, read: () => buf }]));
        scannedFiles++;
      }
    }
    const webAssets = entries.filter((e) => /^assets\/.*\.(?:m?js|map)$/i.test(e.name) && !e.name.includes("node_modules"));
    if (webAssets.length > 0) {
      scannedFiles += webAssets.length;
      findings.push(...analyzeWebFiles(webAssets.map((e) => ({ key: e.name, display: at(e.name), size: e.uncompressedSize, read: () => read(e) }))));
    }

    // ── Native libraries ──
    const libs = entries.filter((e) => /^lib\/[^/]+\/[^/]+\.so$/.test(e.name)).slice(0, MAX_NATIVE_LIBS);
    const seen = new Set<string>();
    for (const e of libs) {
      const buf = read(e);
      const result = buf ? analyzeNative(buf, at(e.name)) : null;
      scannedFiles++;
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

    // ── Signing ──
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
