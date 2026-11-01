import { closeSync, openSync, statSync } from "fs";
import { assessDexObfuscation } from "./dex.js";
import { finding } from "./finding.js";
import type { Finding } from "./finding.js";
import { assessDotnetNames, detectNativeFormat, readDotnetStringsHeap } from "./native.js";
import { analyzeConfigFiles, isConfigFile, printableStrings } from "./secrets.js";
import type { ArtifactFile } from "./web.js";
import { extractZipEntry, readZipEntries } from "./zip.js";

export interface FrameworkResult {
  findings: Finding[];
  notes: string[];
}

const IL2CPP_METADATA_MAGIC = 0xfab11baf;
const PYINSTALLER_COOKIE = Buffer.from([0x4d, 0x45, 0x49, 0x0c, 0x0b, 0x0a, 0x0b, 0x0e]); // "MEI\014\013\012\013\016"

// ── Unity ───────────────────────────────────────────────────────────────────

/** The .NET #Strings heap of a managed DLL, located the same way analyzeNative does. */
function dotnetNames(buf: Buffer): string[] | null {
  if (detectNativeFormat(buf) !== "pe") return null;
  try {
    const peOff = buf.readUInt32LE(0x3c);
    const coff = peOff + 4;
    const nSections = buf.readUInt16LE(coff + 2);
    const optSize = buf.readUInt16LE(coff + 16);
    const opt = coff + 20;
    const dirBase = opt + (buf.readUInt16LE(opt) === 0x20b ? 112 : 96);
    const clrRva = buf.readUInt32LE(dirBase + 14 * 8);
    if (!clrRva) return null;
    const toOffset = (rva: number): number | null => {
      for (let i = 0; i < nSections; i++) {
        const o = opt + optSize + i * 40;
        const va = buf.readUInt32LE(o + 12);
        const size = Math.max(buf.readUInt32LE(o + 8), buf.readUInt32LE(o + 16));
        if (rva >= va && rva < va + size) return rva - va + buf.readUInt32LE(o + 20);
      }
      return null;
    };
    const clr = toOffset(clrRva);
    const meta = clr === null ? null : toOffset(buf.readUInt32LE(clr + 8));
    return meta === null ? null : readDotnetStringsHeap(buf, meta);
  } catch {
    return null;
  }
}

function unity(files: ArtifactFile[]): FrameworkResult {
  const findings: Finding[] = [];
  const notes: string[] = [];

  for (const f of files.filter((x) => x.key.endsWith("/Metadata/global-metadata.dat"))) {
    const head = f.read()?.subarray(0, 8);
    if (!head || head.length < 8) continue;
    if (head.readUInt32LE(0) === IL2CPP_METADATA_MAGIC) {
      findings.push(finding("unity_il2cpp_metadata", f.display, { match: `global-metadata.dat v${head.readUInt32LE(4)} with an intact header (${(f.size / 1024 / 1024).toFixed(1)} MiB)` }));
    } else {
      notes.push(`Unity IL2CPP metadata at ${f.key} does not start with the standard header (encrypted or protected)`);
    }
  }

  const managed = files.filter((x) => /(^|\/)Managed\/Assembly-CSharp(-firstpass)?\.dll$/.test(x.key));
  for (const f of managed) {
    const buf = f.read();
    const names = buf ? dotnetNames(buf) : null;
    if (!names) continue;
    const verdict = assessDotnetNames(names);
    if (verdict.obfuscated) notes.push(`${f.key}: ${verdict.summary}`);
    else findings.push(finding("unity_mono_assemblies", f.display, { match: verdict.summary }));
  }
  if (findings.length + notes.length > 0) notes.unshift("Unity player detected");
  return { findings, notes };
}

// ── Flutter ─────────────────────────────────────────────────────────────────

// Dart identifiers as the AOT snapshot stores them: `Name`, `_private@1234567`
// (library-private names carry the library key), `Class.method`.
const DART_IDENTIFIER = /^_?[A-Za-z$][A-Za-z0-9$]*(?:@\d+)?$/;
const DART_MIN_IDENTIFIERS = 200;
const DART_OBFUSCATED_SHORT_RATIO = 0.1;

/**
 * --obfuscate renames every class, method and field the program defines (the
 * Flutter framework included) to two- or three-letter names; the Dart VM's
 * own names (_TwoByteString, LocalVarDescriptors, ...) are kept. Checked
 * against stripped AOT snapshots of one program built both ways: 1% of
 * identifiers are that short without the flag and 37% with it (31% unstripped).
 */
export function assessDartNames(buf: Buffer): { identifiers: number; short: number; obfuscated: boolean } | null {
  const ids = printableStrings(buf, 6, false).split("\n").filter((s) => DART_IDENTIFIER.test(s));
  if (ids.length < DART_MIN_IDENTIFIERS) return null;
  const short = ids.filter((s) => s.replace(/^_/, "").replace(/@\d+$/, "").length <= 3).length;
  return { identifiers: ids.length, short, obfuscated: short / ids.length >= DART_OBFUSCATED_SHORT_RATIO };
}

function flutter(files: ArtifactFile[]): FrameworkResult {
  const engine = files.some((f) => /(^|\/)libflutter\.so$/.test(f.key) || /(^|\/)Flutter\.framework\/Flutter$/.test(f.key));
  const apps = files.filter((f) => /(^|\/)libapp\.so$/.test(f.key) || /(^|\/)App\.framework\/App$/.test(f.key));
  if (!engine || apps.length === 0) return { findings: [], notes: [] };
  // One snapshot per ABI in an APK: they are built with the same flags, so judging one is enough.
  const app = apps[0];
  const buf = app.read();
  const verdict = buf ? assessDartNames(buf) : null;
  if (!verdict) {
    return { findings: [], notes: [`Flutter app (${app.key}): too few Dart names in the snapshot to judge obfuscation; build releases with --obfuscate --split-debug-info=<dir>.`] };
  }
  const summary = `${verdict.identifiers} Dart identifiers, ${((100 * verdict.short) / verdict.identifiers).toFixed(0)}% with 1–3 letter names`;
  if (verdict.obfuscated) return { findings: [], notes: [`Flutter app (${app.key}): Dart code is obfuscated (${summary})`] };
  return { findings: [finding("flutter_not_obfuscated", app.display, { match: summary })], notes: [] };
}

export function frameworkChecks(files: ArtifactFile[]): FrameworkResult {
  const results = [unity(files), flutter(files)];
  return { findings: results.flatMap((r) => r.findings), notes: results.flatMap((r) => r.notes) };
}

// ── PyInstaller ─────────────────────────────────────────────────────────────

/**
 * A PyInstaller executable ends with a CArchive whose cookie marks it; the
 * archive holds the app's .pyc files, which extract and decompile with
 * public tools. PyArmor-protected archives carry its runtime module.
 */
export function pyinstallerCheck(buf: Buffer, file: string): FrameworkResult {
  // At the very end on Linux/Windows; on macOS the archive sits in its own
  // Mach-O section and the code signature follows, so search the whole file.
  const cookieAt = buf.lastIndexOf(PYINSTALLER_COOKIE);
  if (cookieAt === -1) {
    if (buf.includes("Nuitka") && buf.includes("__compiled__")) return { findings: [], notes: [`${file}: compiled with Nuitka (Python compiled to C)`] };
    return { findings: [], notes: [] };
  }
  const python = buf.subarray(cookieAt + 24, cookieAt + 88).toString("latin1").match(/python\d+(?:\.\d+)*/i)?.[0];
  if (buf.includes("pyarmor_runtime") || buf.includes("__pyarmor__")) {
    return { findings: [], notes: [`${file}: PyInstaller bundle protected with PyArmor`] };
  }
  return { findings: [finding("python_pyinstaller_bundle", file, { match: `PyInstaller archive${python ? ` (${python})` : ""}` })], notes: [] };
}

// ── Java ────────────────────────────────────────────────────────────────────

export function isJar(path: string): boolean {
  return /\.(jar|war)$/i.test(path);
}

function manifestValue(manifest: string, key: string): string | null {
  // MANIFEST.MF wraps long values onto continuation lines that start with a space.
  const unfolded = manifest.replace(/\r?\n /g, "");
  const line = unfolded.split(/\r?\n/).find((l) => l.startsWith(`${key}:`));
  return line ? line.slice(key.length + 1).trim() : null;
}

/** Class names in a JAR (plain or Spring Boot) judged like dex: ProGuard leaves one- and two-letter names. */
export function analyzeJar(path: string): FrameworkResult & { scannedFiles: number } {
  const size = statSync(path).size;
  const fd = openSync(path, "r");
  try {
    const entries = readZipEntries(fd, size);
    // application.properties / .yml in a Spring Boot JAR is where database passwords end up.
    const config = entries.filter((e) => !e.name.endsWith("/") && !e.name.startsWith("META-INF/") && isConfigFile(e.name));
    const secretFindings = analyzeConfigFiles(
      config.map((e) => ({ key: e.name, display: `${path}!/${e.name}`, size: e.uncompressedSize, read: () => extractZipEntry(fd, e) })),
      { target: "framework" },
    );
    const mfEntry = entries.find((e) => e.name === "META-INF/MANIFEST.MF");
    const mf = mfEntry ? extractZipEntry(fd, mfEntry)?.toString("utf8") ?? "" : "";
    const main = manifestValue(mf, "Start-Class") ?? manifestValue(mf, "Main-Class");
    const classes = entries
      .filter((e) => e.name.endsWith(".class") && !e.name.startsWith("META-INF/"))
      .map((e) => e.name.replace(/^(BOOT-INF|WEB-INF)\/classes\//, ""));
    const notes: string[] = [];
    if (classes.length === 0) return { findings: secretFindings, notes: [`${path}: no classes in the archive`], scannedFiles: 1 };
    const pkg = main && main.includes(".") ? main.slice(0, main.lastIndexOf(".")) : null;
    if (!pkg) return { findings: secretFindings, notes: [`${path}: ${classes.length} classes, no Main-Class/Start-Class to locate the application package`], scannedFiles: 1 };
    const verdict = assessDexObfuscation(classes.map((c) => `L${c.slice(0, -".class".length)};`), pkg);
    notes.push(`${pkg}: ${verdict.appClasses} app classes, ${verdict.shortNamed} with 1–2 letter names`);
    const findings = verdict.obfuscated
      ? [...secretFindings]
      : [...secretFindings, finding("java_not_obfuscated", path, { match: `${verdict.appClasses} classes under ${pkg}, ${verdict.shortNamed} renamed; e.g. ${verdict.sample.join(", ")}` })];
    return { findings, notes, scannedFiles: 1 };
  } finally {
    closeSync(fd);
  }
}
