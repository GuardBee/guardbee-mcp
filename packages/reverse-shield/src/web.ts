import { finding } from "./finding.js";
import type { Finding } from "./finding.js";
import { findSecrets, lineCol } from "./secrets.js";
import type { SecretScanOptions } from "./secrets.js";

const MIN_BYTES_FOR_MINIFY_CHECK = 4096;

const INLINE_MAP_PREFIX = /^data:application\/json;(?:charset=[^;,]+;)?base64,/;
const EVAL_SOURCE_URL = /sourceURL=webpack(?:-internal)?:\/\//;

const DEV_BUILD_MARKERS: Array<{ framework: string; pattern: RegExp }> = [
  { framework: "React", pattern: /react(?:-dom)?\.development\.js/ },
  { framework: "Vue", pattern: /You are running (?:a development build of Vue|Vue in development mode)/ },
  { framework: "Angular", pattern: /Angular is running in development mode/ },
  { framework: "webpack dev server / HMR", pattern: /\[HMR\] (?:connected|Waiting for update signal)/ },
];

const INTERNAL_URL =
  /\bhttps?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:internal|local|corp|lan)|(?:[a-z0-9-]+\.)*(?:staging|stage|preprod|uat|qa|dev)(?:-[a-z0-9]+)?\.[a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::\d+)?/gi;

const MAPPING_KEY = "sourceMappingURL=";
const isSpace = (ch: string) => ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || ch === "\f" || ch === "\v";

/**
 * The URL of the last `//# sourceMappingURL=` comment that ends its line.
 * Scanned by hand rather than with a regex: bundles are untrusted input and
 * inline maps make the comment megabytes long. Only the last occurrence on
 * each line can end it, so every line is looked at once and the scan stays
 * linear even for a line made of nothing but the key.
 */
export function sourceMappingUrl(text: string): string | null {
  let i = text.lastIndexOf(MAPPING_KEY);
  while (i !== -1) {
    const lineStart = text.lastIndexOf("\n", i) + 1;
    const nl = text.indexOf("\n", i);
    const lineEnd = nl === -1 ? text.length : nl;

    let j = i - 1;
    while (j >= lineStart && isSpace(text[j])) j--;
    if (j - 2 >= lineStart && (text[j] === "#" || text[j] === "@") && text[j - 1] === "/" && text[j - 2] === "/") {
      const start = i + MAPPING_KEY.length;
      let end = start;
      while (end < lineEnd && !isSpace(text[end]) && text[end] !== "'" && text[end] !== '"') end++;
      let k = end;
      while (k < lineEnd && isSpace(text[k])) k++;
      if (end > start && k === lineEnd) return text.slice(start, end);
    }
    i = lineStart >= 2 ? text.lastIndexOf(MAPPING_KEY, lineStart - 2) : -1;
  }
  return null;
}

export interface SourceMapInfo {
  sources: number;
  embedded: number;
  samplePaths: string[];
}

/** Returns null when the text is not a source map (version + mappings). */
export function parseSourceMap(text: string): SourceMapInfo | null {
  let map: unknown;
  try {
    map = JSON.parse(text);
  } catch {
    return null;
  }
  if (!map || typeof map !== "object") return null;
  const m = map as { version?: unknown; mappings?: unknown; sources?: unknown; sourcesContent?: unknown; sections?: unknown };
  if (m.version === undefined || (typeof m.mappings !== "string" && !Array.isArray(m.sections))) return null;
  const sources = Array.isArray(m.sources) ? m.sources.filter((s): s is string => typeof s === "string") : [];
  const embedded = Array.isArray(m.sourcesContent) ? m.sourcesContent.filter((c) => typeof c === "string" && c.length > 0).length : 0;
  const own = sources.filter((s) => !s.includes("node_modules"));
  return { sources: sources.length, embedded, samplePaths: (own.length > 0 ? own : sources).slice(0, 3) };
}

export function sourceMapFinding(info: SourceMapInfo, file: string, id: "sourcemap_shipped" | "sourcemap_inline" | "sourcemap_publicly_reachable"): Finding {
  const paths = info.samplePaths.length > 0 ? ` e.g. ${info.samplePaths.join(", ")}` : "";
  if (info.embedded > 0) {
    return finding("sourcemap_embeds_source", file, {
      match: `${info.embedded} of ${info.sources} source file(s) embedded in sourcesContent${paths}`,
    });
  }
  return finding(id, file, { match: `${info.sources} original source path(s) mapped${paths}` });
}

export function looksUnminified(text: string): { unminified: boolean; avgLineLength: number; indentedRatio: number } {
  let nonEmpty = 0;
  let chars = 0;
  let indented = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    nonEmpty++;
    chars += line.length;
    if (/^(?: {2,}|\t)\S/.test(line)) indented++;
  }
  const avgLineLength = nonEmpty === 0 ? 0 : chars / nonEmpty;
  const indentedRatio = nonEmpty === 0 ? 0 : indented / nonEmpty;
  return { unminified: nonEmpty >= 40 && avgLineLength < 100 && indentedRatio > 0.3, avgLineLength, indentedRatio };
}

export interface JsCheckOptions {
  /** Skip the minification check (e.g. for small inline snippets). */
  skipMinifyCheck?: boolean;
  /** Passed to the credential check: target and mobile context of the bundle. */
  secrets?: SecretScanOptions;
}

/**
 * Checks one shipped JavaScript file for what it gives away: source maps
 * (inline or referenced), eval-wrapped dev bundles, missing minification,
 * framework development builds, embedded credentials and internal hosts.
 * Source maps that sit next to the file are handled by the caller, which can
 * see the filesystem or the network.
 */
export function analyzeJavaScript(text: string, file: string, options: JsCheckOptions = {}): Finding[] {
  const findings: Finding[] = [];

  const mapUrl = sourceMappingUrl(text);
  if (mapUrl && INLINE_MAP_PREFIX.test(mapUrl)) {
    const info = parseSourceMap(Buffer.from(mapUrl.replace(INLINE_MAP_PREFIX, ""), "base64").toString("utf8"));
    findings.push(info ? sourceMapFinding(info, file, "sourcemap_inline") : finding("sourcemap_inline", file, { match: "inline data: source map (not parseable)" }));
  } else if (mapUrl) {
    findings.push(finding("sourcemap_reference", file, { match: `//# sourceMappingURL=${mapUrl}` }));
  }

  const isEvalBundle = text.includes("eval(") && EVAL_SOURCE_URL.test(text);
  if (isEvalBundle) {
    const idx = text.search(EVAL_SOURCE_URL);
    findings.push(finding("eval_devtool_bundle", file, { match: text.slice(idx, idx + 80).split("\\n")[0], ...lineCol(text, idx) }));
  }

  if (!options.skipMinifyCheck && !isEvalBundle && Buffer.byteLength(text) >= MIN_BYTES_FOR_MINIFY_CHECK) {
    const m = looksUnminified(text);
    if (m.unminified) {
      findings.push(finding("unminified_bundle", file, {
        match: `average line ${m.avgLineLength.toFixed(0)} chars, ${(m.indentedRatio * 100).toFixed(0)}% indented lines`,
      }));
    }
  }

  for (const marker of DEV_BUILD_MARKERS) {
    const idx = text.search(marker.pattern);
    if (idx !== -1) {
      findings.push(finding("dev_build_framework", file, { match: `${marker.framework}: ${text.slice(idx, idx + 60).trim()}`, ...lineCol(text, idx) }));
    }
  }

  findings.push(...findSecrets(text, file, options.secrets));

  const hosts = new Set<string>();
  let firstHostIndex = -1;
  for (const m of text.matchAll(INTERNAL_URL)) {
    hosts.add(m[0]);
    if (firstHostIndex === -1) firstHostIndex = m.index ?? 0;
    if (hosts.size >= 5) break;
  }
  if (hosts.size > 0) {
    findings.push(finding("internal_endpoint", file, { match: [...hosts].join(", "), ...lineCol(text, firstHostIndex) }));
  }

  return findings;
}

const JS_EXT = /\.(?:m|c)?js$/i;
const MAP_EXT = /\.map$/i;
export const MAX_TEXT_BYTES = 20 * 1024 * 1024;

/** A file in a build directory, an ASAR or an APK, keyed by a "/"-separated path. */
export interface ArtifactFile {
  key: string;
  display: string;
  size: number;
  read(): Buffer | null;
}

export function isWebAsset(key: string): boolean {
  return (JS_EXT.test(key) || MAP_EXT.test(key)) && !key.split("/").includes("node_modules");
}

function resolveKey(fromKey: string, ref: string): string {
  const parts = fromKey.split("/").slice(0, -1);
  for (const seg of ref.split(/[?#]/)[0].split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  return parts.join("/");
}

/**
 * Runs the JavaScript and source map checks over a set of shipped files. A
 * bundle whose sourceMappingURL resolves to a map in the same set is reported
 * once, through the map, rather than again as a bare reference.
 */
export function analyzeWebFiles(files: ArtifactFile[], secrets?: SecretScanOptions): Finding[] {
  const findings: Finding[] = [];
  const keys = new Set(files.map((f) => f.key));

  for (const file of files) {
    if (file.size > MAX_TEXT_BYTES) continue;
    if (MAP_EXT.test(file.key)) {
      const buf = file.read();
      const info = buf ? parseSourceMap(buf.toString("utf8")) : null;
      if (info) findings.push(sourceMapFinding(info, file.display, "sourcemap_shipped"));
      continue;
    }
    if (!JS_EXT.test(file.key)) continue;
    const buf = file.read();
    if (!buf) continue;
    const text = buf.toString("utf8");
    const mapUrl = sourceMappingUrl(text);
    const mapShipped = mapUrl !== null && !INLINE_MAP_PREFIX.test(mapUrl) && keys.has(resolveKey(file.key, mapUrl));
    for (const f of analyzeJavaScript(text, file.display, { secrets })) {
      if (mapShipped && f.patternId === "sourcemap_reference") continue;
      findings.push(f);
    }
  }
  return collapseRepeats(findings);
}

const COLLAPSE_AFTER = 5;

/** collapseRepeats for credentials only, across everything a scan found. */
export function collapseSecrets(findings: Finding[]): Finding[] {
  return [...findings.filter((f) => f.patternId !== "bundle_secret"), ...collapseRepeats(findings.filter((f) => f.patternId === "bundle_secret"))];
}

/**
 * A packaged app repeats the same key, host list or build setting across
 * dozens of chunks. Report each distinct thing once and say how far it
 * spreads, so the real number of problems stays readable.
 */
export function collapseRepeats(findings: Finding[]): Finding[] {
  const out: Finding[] = [];
  const secrets = new Map<string, { first: Finding; files: number }>();
  const hosts: Finding[] = [];
  const perFile = new Map<string, Finding[]>();

  for (const f of findings) {
    if (f.patternId === "bundle_secret") {
      // A finding collapsed earlier (per package) carries its count in the match.
      const [base, extra] = f.match.split(" — also in ");
      const files = 1 + (extra ? Number.parseInt(extra, 10) || 0 : 0);
      const seen = secrets.get(base);
      if (seen) seen.files += files;
      else secrets.set(base, { first: { ...f, match: base }, files });
    } else if (f.patternId === "internal_endpoint") {
      hosts.push(f);
    } else if (f.patternId === "unminified_bundle" || f.patternId === "sourcemap_reference") {
      perFile.set(f.patternId, [...(perFile.get(f.patternId) ?? []), f]);
    } else {
      out.push(f);
    }
  }

  for (const { first, files } of secrets.values()) {
    out.push(files > 1 ? { ...first, match: `${first.match} — also in ${files - 1} other file(s)` } : first);
  }

  if (hosts.length > 0) {
    const all = new Set(hosts.flatMap((h) => h.match.split(", ")));
    const list = [...all].slice(0, 8).join(", ") + (all.size > 8 ? `, … (${all.size} hosts)` : "");
    out.push({ ...hosts[0], match: hosts.length > 1 ? `${list} — in ${hosts.length} files` : list });
  }

  for (const group of perFile.values()) {
    if (group.length <= COLLAPSE_AFTER) {
      out.push(...group);
      continue;
    }
    const names = group.slice(0, 3).map((g) => (g.file ?? "").split(/[/\\]/).pop());
    out.push({ ...group[0], line: 1, column: 1, match: `${group.length} files, e.g. ${names.join(", ")}` });
  }

  return out;
}
