import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { basename, join, relative, sep } from "path";
import { analyzeApk, isAab, isApk } from "./apk.js";
import { readAsar } from "./asar.js";
import { analyzeElectron, detectElectron } from "./electron.js";
import { analyzeJar, frameworkChecks, isJar, pyinstallerCheck } from "./frameworks.js";
import { analyzeIosAppDir, analyzeIpa, isIosAppDir, isIpa } from "./ios.js";
import { bySeverity, grade } from "./finding.js";
import type { Finding } from "./finding.js";
import { readPrefix, walkFiles } from "./fsutil.js";
import { analyzeNative, detectNativeFormat } from "./native.js";
import type { TargetKind } from "./rules.js";
import { analyzeConfigFiles, binarySecrets, isConfigFile } from "./secrets.js";
import { analyzeWebFiles, collapseSecrets, isWebAsset } from "./web.js";
import type { ArtifactFile } from "./web.js";

export interface ScanOptions {
  maxFiles?: number;
  include?: string[];
  exclude?: string[];
}

export interface ScanResult {
  target: string;
  /** What was recognised: web assets, an Electron app, an APK, native binaries, .NET assemblies. */
  kinds: TargetKind[];
  grade: "A" | "B" | "C" | "D" | "F";
  scannedFiles: number;
  totalFindings: number;
  findings: Finding[];
  /** Context that is not a finding: fuse states, signing scheme, obfuscator detected, files skipped. */
  notes: string[];
  truncated: boolean;
  durationMs: number;
}

const DEFAULT_MAX_FILES = 5000;
const MAX_NATIVE_BYTES = 256 * 1024 * 1024;

// Build output (dist/, build/, out/) is exactly what this scanner is for, so
// unlike the source scanners only VCS, dependency and cache folders are skipped.
const SKIP_DIRS = new Set(["node_modules", ".git", ".svn", ".hg", "__pycache__", ".venv", "venv", ".gradle", ".idea", ".turbo", ".cache"]);

class Collector {
  findings: Finding[] = [];
  notes: string[] = [];
  kinds = new Set<TargetKind>();
  scannedFiles = 0;
  truncated = false;

  add(findings: Finding[], kind?: TargetKind): void {
    this.findings.push(...findings);
    if (kind) this.kinds.add(kind);
    for (const f of findings) this.kinds.add(f.target);
  }
}

function analyzeNativeFile(path: string, c: Collector): boolean {
  const size = statSync(path).size;
  if (size < 64) return false;
  const format = detectNativeFormat(readPrefix(path, 8));
  if (!format) return false;
  if (size > MAX_NATIVE_BYTES) {
    c.notes.push(`${path}: ${format} binary larger than ${MAX_NATIVE_BYTES / 1024 / 1024} MiB, not parsed`);
    return true;
  }
  const buf = readFileSync(path);
  const result = analyzeNative(buf, path);
  if (!result) return false;
  c.scannedFiles++;
  c.notes.push(...result.notes);
  const kind = result.flavor === "dotnet" ? "dotnet" : "native";
  c.add(result.findings, kind);
  c.add(binarySecrets(buf, path, { target: kind }));
  if (result.flavor !== "dotnet") {
    const py = pyinstallerCheck(buf, path);
    c.notes.push(...py.notes);
    c.add(py.findings);
  }
  return true;
}

function macMainExecutables(appDir: string): string[] {
  const dir = join(appDir, "Contents", "MacOS");
  try {
    return readdirSync(dir).map((n) => join(dir, n)).filter((p) => statSync(p).isFile());
  } catch {
    return [];
  }
}

function scanAppBundle(dir: string, c: Collector, maxFiles: number): void {
  if (isIosAppDir(dir)) {
    const result = analyzeIosAppDir(dir, maxFiles);
    c.scannedFiles += result.scannedFiles;
    c.notes.push(...result.notes);
    c.add(result.findings, "ios");
    return;
  }
  const electron = detectElectron(dir);
  if (electron) {
    const result = analyzeElectron(electron, maxFiles);
    c.scannedFiles += result.scannedFiles;
    c.notes.push(...result.notes);
    c.add(result.findings, "electron");
  }
  // The app's own executable; bundled frameworks (Electron, Sparkle, ...) are third-party builds.
  for (const exe of macMainExecutables(dir)) analyzeNativeFile(exe, c);
}

function scanFile(path: string, c: Collector): void {
  if (isJar(path)) {
    const result = analyzeJar(path);
    c.scannedFiles += result.scannedFiles;
    c.notes.push(...result.notes);
    c.add(result.findings);
    return;
  }
  if (isIpa(path)) {
    const result = analyzeIpa(path);
    if (!result) {
      c.notes.push(`${path}: no Payload/*.app inside, not an IPA`);
      return;
    }
    c.scannedFiles += result.scannedFiles;
    c.notes.push(...result.notes);
    c.add(result.findings, "ios");
    return;
  }
  if (isApk(path) || isAab(path)) {
    const result = analyzeApk(path);
    if (!result) {
      c.notes.push(`${path}: no AndroidManifest.xml, not an APK or App Bundle`);
      return;
    }
    c.scannedFiles += result.scannedFiles;
    c.notes.push(...result.notes);
    c.add(result.findings, "android");
    return;
  }
  if (/\.asar$/i.test(path)) {
    const entries = readAsar(path);
    if (!entries) {
      c.notes.push(`${path}: not a readable ASAR archive`);
      return;
    }
    const web = entries.filter((e) => isWebAsset(e.key));
    const config = entries.filter((e) => isConfigFile(e.key));
    c.scannedFiles += web.length + config.length;
    c.add([...analyzeWebFiles(web), ...analyzeConfigFiles(config, { target: "electron" })], "electron");
    return;
  }
  if (isWebAsset(basename(path))) {
    c.scannedFiles++;
    c.add(analyzeWebFiles([{ key: basename(path), display: path, size: statSync(path).size, read: () => readFileSync(path) }]), "web");
    return;
  }
  if (!analyzeNativeFile(path, c)) c.notes.push(`${path}: not a recognised artifact (APK, AAB, IPA, JAR, ASAR, JavaScript, source map, ELF, Mach-O or PE)`);
}

function scanDir(root: string, c: Collector, options: ScanOptions, maxFiles: number): void {
  if (root.endsWith(".app") || detectElectron(root)) {
    scanAppBundle(root, c, maxFiles);
    return;
  }

  const web: ArtifactFile[] = [];
  const config: ArtifactFile[] = [];
  const all: ArtifactFile[] = [];
  const { truncated } = walkFiles(
    root,
    {
      maxFiles,
      include: options.include,
      exclude: options.exclude,
      skipDirs: SKIP_DIRS,
      claimDir: (dir) => {
        if (!dir.endsWith(".app") && !detectElectron(dir)) return false;
        scanAppBundle(dir, c, maxFiles);
        return true;
      },
    },
    (full) => {
      const key = relative(root, full).split(sep).join("/");
      all.push({ key, display: full, size: statSync(full).size, read: () => readFileSync(full) });
      if (isWebAsset(key)) {
        web.push({ key, display: full, size: statSync(full).size, read: () => readFileSync(full) });
      } else if (isConfigFile(key)) {
        config.push({ key, display: full, size: statSync(full).size, read: () => readFileSync(full) });
      } else if (isApk(full) || isAab(full) || isIpa(full) || isJar(full) || /\.asar$/i.test(full)) {
        scanFile(full, c);
      } else {
        analyzeNativeFile(full, c);
      }
    },
  );
  c.truncated = truncated;
  if (web.length > 0) {
    c.scannedFiles += web.length;
    c.add(analyzeWebFiles(web), "web");
  }
  // config.json, .env and friends copied into the build output ship with it.
  c.scannedFiles += config.length;
  c.add(analyzeConfigFiles(config));
  const engine = frameworkChecks(all);
  c.notes.push(...engine.notes);
  c.add(engine.findings);
}

/**
 * Scans a build artifact for what it gives away to a reverse engineer: a file
 * (APK, ASAR, bundle, source map, ELF/Mach-O/PE/.NET binary), a macOS .app,
 * an Electron app folder, or a build output directory containing any of them.
 */
export function scanPath(target: string, options: ScanOptions = {}): ScanResult {
  const start = Date.now();
  const c = new Collector();
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;

  if (!existsSync(target)) throw new Error(`Path not found: ${target}`);
  // "Foo.app/" from shell completion must still be recognised as a bundle.
  let path = target;
  while (path.length > 1 && (path.endsWith("/") || path.endsWith("\\"))) path = path.slice(0, -1);
  if (statSync(path).isDirectory()) scanDir(path, c, options, maxFiles);
  else scanFile(path, c);

  if (c.truncated) c.notes.push(`Stopped after ${maxFiles} files; raise maxFiles to scan the rest.`);
  // Unity's Assembly-CSharp.dll gets the engine-specific finding; drop the generic .NET one for the same file.
  const unityDlls = new Set(c.findings.filter((f) => f.patternId === "unity_mono_assemblies").map((f) => f.file));
  // One key found in several files (dex and resources, every ABI of a .so) is one problem.
  const findings = collapseSecrets(c.findings.filter((f) => !(f.patternId === "dotnet_not_obfuscated" && unityDlls.has(f.file)))).sort(bySeverity);
  return {
    target,
    kinds: [...c.kinds],
    grade: grade(findings),
    scannedFiles: c.scannedFiles,
    totalFindings: findings.length,
    findings,
    notes: c.notes,
    truncated: c.truncated,
    durationMs: Date.now() - start,
  };
}
