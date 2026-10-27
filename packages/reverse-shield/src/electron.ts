import { closeSync, existsSync, openSync, readFileSync, readdirSync, statSync } from "fs";
import { basename, extname, join, relative, sep } from "path";
import { readAsar } from "./asar.js";
import { finding } from "./finding.js";
import type { Finding } from "./finding.js";
import { findInFile, readAt, walkFiles } from "./fsutil.js";
import { analyzeWebFiles, isWebAsset } from "./web.js";
import type { ArtifactFile } from "./web.js";

/** Marker @electron/fuses writes before the fuse wire: version byte, length byte, then one byte per fuse. */
export const FUSE_SENTINEL = Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX");

// FuseV1Options order in @electron/fuses
const FUSES = [
  "RunAsNode",
  "EnableCookieEncryption",
  "EnableNodeOptionsEnvironmentVariable",
  "EnableNodeCliInspectArguments",
  "EnableEmbeddedAsarIntegrityValidation",
  "OnlyLoadAppFromAsar",
  "LoadBrowserProcessSpecificV8Snapshot",
  "GrantFileProtocolExtraPrivileges",
] as const;

export interface FuseWire {
  version: number;
  /** One char per fuse: "1" enabled, "0" disabled, "r" removed. */
  states: string;
}

export function parseFuseWire(buf: Buffer, sentinelOffset: number): FuseWire | null {
  const p = sentinelOffset + FUSE_SENTINEL.length;
  if (p + 2 > buf.length) return null;
  const version = buf[p];
  const length = buf[p + 1];
  if (length === 0 || p + 2 + length > buf.length) return null;
  return { version, states: buf.toString("latin1", p + 2, p + 2 + length) };
}

export function readFuseWire(binaryPath: string): FuseWire | null {
  const [hit] = findInFile(binaryPath, FUSE_SENTINEL, 1);
  if (hit === undefined) return null;
  const fd = openSync(binaryPath, "r");
  try {
    return parseFuseWire(readAt(fd, hit, FUSE_SENTINEL.length + 2 + 64), 0);
  } finally {
    closeSync(fd);
  }
}

export function describeFuses(wire: FuseWire): string {
  return FUSES.slice(0, wire.states.length)
    .map((name, i) => `${name}=${wire.states[i] === "1" ? "on" : wire.states[i] === "0" ? "off" : "removed"}`)
    .join(", ");
}

export function fuseFindings(wire: FuseWire, file: string): Finding[] {
  const s = wire.states;
  const findings: Finding[] = [];
  const on = (i: number) => s[i] === "1";
  const off = (i: number) => s[i] === "0";
  const add = (id: string, fuseIndex: number) =>
    findings.push(finding(id, file, { match: `${FUSES[fuseIndex]}=${on(fuseIndex) ? "on" : "off"}` }));

  if (on(0)) add("electron_fuse_run_as_node", 0);
  if (on(3)) add("electron_fuse_inspect_args", 3);
  if (on(2)) add("electron_fuse_node_options", 2);
  if (off(4)) add("electron_fuse_asar_integrity_off", 4);
  if (off(5)) add("electron_fuse_load_outside_asar", 5);
  return findings;
}

export interface ElectronLayout {
  root: string;
  /** Binary that carries the fuse wire (Electron Framework on macOS, the app executable elsewhere). */
  fuseBinary: string | null;
  resources: string;
}

const MIN_ELECTRON_BINARY_BYTES = 20 * 1024 * 1024;

export function detectElectron(dir: string): ElectronLayout | null {
  const macFramework = join(dir, "Contents", "Frameworks", "Electron Framework.framework");
  if (existsSync(macFramework)) {
    const bin = join(macFramework, "Electron Framework");
    return { root: dir, fuseBinary: existsSync(bin) ? bin : null, resources: join(dir, "Contents", "Resources") };
  }

  const resources = join(dir, "resources");
  if (!existsSync(join(resources, "app.asar")) && !existsSync(join(resources, "app", "package.json"))) return null;

  // Windows/Linux: the fuse wire is in the main executable next to resources/.
  const candidates: string[] = [];
  for (const name of safeReaddir(dir)) {
    const full = join(dir, name);
    const ext = extname(name).toLowerCase();
    if (ext !== "" && ext !== ".exe") continue;
    try {
      const st = statSync(full);
      if (st.isFile() && st.size >= MIN_ELECTRON_BINARY_BYTES) candidates.push(full);
    } catch {
      // unreadable entry
    }
  }
  const fuseBinary = candidates.find((c) => findInFile(c, FUSE_SENTINEL, 1).length > 0) ?? null;
  return { root: dir, fuseBinary, resources };
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export interface ElectronResult {
  findings: Finding[];
  notes: string[];
  scannedFiles: number;
}

export function analyzeElectron(layout: ElectronLayout, maxFiles: number): ElectronResult {
  const findings: Finding[] = [];
  const notes: string[] = [];
  let scannedFiles = 0;

  if (layout.fuseBinary) {
    const wire = readFuseWire(layout.fuseBinary);
    if (wire) {
      notes.push(`Electron fuses (${basename(layout.fuseBinary)}): ${describeFuses(wire)}`);
      findings.push(...fuseFindings(wire, layout.fuseBinary));
    } else {
      notes.push(`No Electron fuse wire found in ${layout.fuseBinary} (Electron older than 12, or a custom build).`);
    }
  }

  const appDir = join(layout.resources, "app");
  if (existsSync(join(appDir, "package.json"))) {
    findings.push(finding("electron_app_unpacked", appDir, {
      match: existsSync(join(layout.resources, "app.asar")) ? "resources/app is loaded ahead of app.asar" : "no app.asar",
    }));
    const files: ArtifactFile[] = [];
    walkFiles(appDir, { maxFiles, skipDirs: new Set(["node_modules", ".git"]) }, (full) => {
      const key = relative(appDir, full).split(sep).join("/");
      if (!isWebAsset(key)) return;
      files.push({ key, display: full, size: statSync(full).size, read: () => readFileSync(full) });
    });
    scannedFiles += files.length;
    findings.push(...analyzeWebFiles(files));
  }

  const asarPath = join(layout.resources, "app.asar");
  if (existsSync(asarPath)) {
    const entries = readAsar(asarPath);
    if (entries) {
      const web = entries.filter((e) => isWebAsset(e.key)).slice(0, maxFiles);
      notes.push(`app.asar: ${entries.length} file(s), ${web.length} shipped JavaScript/source map file(s) checked`);
      scannedFiles += web.length;
      findings.push(...analyzeWebFiles(web));
    } else {
      notes.push(`app.asar could not be parsed: ${asarPath}`);
    }
  }

  return { findings, notes, scannedFiles };
}
