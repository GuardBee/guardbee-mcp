import { SECRET_RULES } from "@guardbee/guard-core";
import { finding } from "./finding.js";
import type { Finding } from "./finding.js";

const MIN_BYTES_FOR_MINIFY_CHECK = 4096;

const SOURCE_MAPPING_URL = /\/\/[#@]\s*sourceMappingURL=([^\s'"]+)\s*$/m;
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

// Fixed-format credentials only: minified code is full of 40-character base64
// runs and quoted strings next to the word "key", which the broad rules would
// report by the hundred.
const BUNDLE_SECRET_RULES = SECRET_RULES.filter((r) => !r.broad);

// The private-key rules match the PEM header alone. Crypto libraries bundled
// into an app carry those headers as string constants for their parsers, so a
// bundle only holds a key when base64 key material follows the header.
const PEM_HEADER_RULE = /private_key/;

// Placeholder shapes that never occur in a real credential (same heuristic as
// secret-scanner): a repeated or sequential run, or an "example" word.
const PLACEHOLDER_WORDS = /example|placeholder|sample|dummy|fake[_-]?key|change[-_]?me|testkey|yourkey|redacted/i;

function isPlaceholder(value: string): boolean {
  if (/(.)\1{7,}/.test(value) || PLACEHOLDER_WORDS.test(value)) return true;
  let run = 1;
  for (let i = 1; i < value.length; i++) {
    run = value.charCodeAt(i) === value.charCodeAt(i - 1) + 1 ? run + 1 : 1;
    if (run >= 8) return true;
  }
  return false;
}

// Connection-string rules skip the generic check (a real URL can sit on an
// example.com host), so judge the parts instead: UI hints and docs use a
// literal "password" and a literal "host", which a deployed database never has.
const CONNECTION_RULE = /^db_url_/;
const PLACEHOLDER_PASSWORD = /^(?:password|passw(?:or)?d|pass|pwd|secret|sifre|şifre|parola|changeme|your[-_]?password|<[^>]*>|\*+|x+|\.{3})$/i;
const PLACEHOLDER_HOST = /^(?:host|hostname|your[-_]?host|server|db-host)$/i;

function isPlaceholderConnection(url: string): boolean {
  const m = /^[a-z+]+:\/\/[^:/@]*:([^@]*)@([^:/?#]+)/i.exec(url);
  return m !== null && (PLACEHOLDER_PASSWORD.test(m[1]) || PLACEHOLDER_HOST.test(m[2]));
}
const PEM_BODY = /^(?:\s|\\[rn]|["'`+,])*(?:[A-Za-z-]+:[^\n\\]*(?:\\n|\n)(?:\s|\\[rn])*)*[A-Za-z0-9+/]{60,}/;

function lineCol(text: string, index: number): { line: number; column: number } {
  let line = 1;
  let last = -1;
  for (let i = text.indexOf("\n"); i !== -1 && i < index; i = text.indexOf("\n", i + 1)) {
    line++;
    last = i;
  }
  return { line, column: index - last };
}

function mask(value: string): string {
  return value.length <= 8 ? "****" : `${value.slice(0, 4)}…${value.slice(-2)} (${value.length} chars)`;
}

export function sourceMappingUrl(text: string): string | null {
  // Only the tail matters: the comment must be the last thing in the file, and
  // scanning a multi-megabyte bundle with a multiline regex is wasted work.
  const m = SOURCE_MAPPING_URL.exec(text.slice(-4096));
  return m ? m[1] : null;
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

  for (const rule of BUNDLE_SECRET_RULES) {
    rule.pattern.lastIndex = 0;
    const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`);
    for (const m of text.matchAll(re)) {
      const value = m[0];
      if (rule.allowlist?.some((a) => a.test(value))) continue;
      if (CONNECTION_RULE.test(rule.id) ? isPlaceholderConnection(value) : !rule.skipPlaceholderCheck && isPlaceholder(value)) continue;
      if (PEM_HEADER_RULE.test(rule.id) && !PEM_BODY.test(text.slice((m.index ?? 0) + value.length, (m.index ?? 0) + value.length + 160))) continue;
      findings.push(finding("bundle_secret", file, {
        severity: rule.severity === "low" ? "medium" : rule.severity,
        match: `${rule.name}: ${mask(value)}`,
        ...lineCol(text, m.index ?? 0),
      }));
      break; // one per rule per file is enough to act on
    }
  }

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
export function analyzeWebFiles(files: ArtifactFile[]): Finding[] {
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
    for (const f of analyzeJavaScript(text, file.display)) {
      if (mapShipped && f.patternId === "sourcemap_reference") continue;
      findings.push(f);
    }
  }
  return collapseRepeats(findings);
}

const COLLAPSE_AFTER = 5;

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
      const seen = secrets.get(f.match);
      if (seen) seen.files++;
      else secrets.set(f.match, { first: f, files: 1 });
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
