import { SECRET_RULES } from "@guardbee/guard-core";
import { readDexStrings } from "./dex.js";
import { finding } from "./finding.js";
import type { Finding } from "./finding.js";
import { parsePlist } from "./plist.js";
import type { PlistValue } from "./plist.js";
import { readFields } from "./protoxml.js";
import type { TargetKind } from "./rules.js";
import type { ArtifactFile } from "./web.js";

// Fixed-format credentials only: minified code and binaries are full of
// 40-character base64 runs and quoted strings next to the word "key", which
// the broad rules would report by the hundred.
const FIXED_FORMAT_RULES = SECRET_RULES.filter((r) => !r.broad);

// The private-key rules match the PEM header alone. Crypto libraries bundled
// into an app carry those headers as string constants for their parsers, so an
// artifact only holds a key when base64 key material follows the header.
const PEM_HEADER_RULE = /private_key/;
const PEM_BODY = /^(?:\s|\\[rn]|["'`+,])*(?:[A-Za-z-]+:[^\n\\]*(?:\\n|\n)(?:\s|\\[rn])*)*[A-Za-z0-9+/]{60,}/;

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

// The google-services Gradle plugin and GoogleService-Info.plist put the
// Firebase API key into every app that uses Firebase; it is meant to ship and
// is locked down by restricting it, not by hiding it.
const MOBILE_GOOGLE_KEY = "google_api_key";
const MOBILE_GOOGLE_KEY_CONTEXT =
  "A Google/Firebase API key. Apps that use Firebase ship one by design; anyone can lift it, so it must be restricted to this app's package name or bundle id (and to the APIs it needs) in Google Cloud Console.";

export function lineCol(text: string, index: number): { line: number; column: number } {
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

export interface SecretScanOptions {
  /** Where the text came from; the finding carries it (an APK's strings are not a web bundle). */
  target?: TargetKind;
  /** Text is a real file whose line numbers mean something, rather than strings pulled out of a binary. */
  positions?: boolean;
  /** Android or iOS package: Firebase/Google API keys are expected there and reported as medium. */
  mobile?: boolean;
}

/** Fixed-format credentials in a piece of text, one finding per rule. */
export function findSecrets(text: string, file: string, options: SecretScanOptions = {}): Finding[] {
  const findings: Finding[] = [];
  const positions = options.positions ?? true;
  for (const rule of FIXED_FORMAT_RULES) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`);
    for (const m of text.matchAll(re)) {
      const value = m[0];
      const index = m.index ?? 0;
      if (rule.allowlist?.some((a) => a.test(value))) continue;
      if (CONNECTION_RULE.test(rule.id) ? isPlaceholderConnection(value) : !rule.skipPlaceholderCheck && isPlaceholder(value)) continue;
      if (PEM_HEADER_RULE.test(rule.id) && !PEM_BODY.test(text.slice(index + value.length, index + value.length + 160))) continue;
      const mobileKey = options.mobile === true && rule.id === MOBILE_GOOGLE_KEY;
      findings.push(finding("bundle_secret", file, {
        severity: mobileKey ? "medium" : rule.severity === "low" ? "medium" : rule.severity,
        match: `${rule.name}: ${mask(value)}`,
        target: options.target,
        ...(mobileKey ? { context: MOBILE_GOOGLE_KEY_CONTEXT } : {}),
        ...(positions ? lineCol(text, index) : {}),
      }));
      break; // one per rule per file is enough to act on
    }
  }
  return findings;
}

// Every fixed-format rule needs at least this many characters; shorter runs
// are symbol names and format strings that can only slow the match down.
const MIN_RUN = 16;

const isAsciiText = (b: number) => (b >= 0x20 && b <= 0x7e) || b === 0x09 || b === 0x0a || b === 0x0d;

/**
 * Printable runs of a binary, one per line: ASCII/UTF-8 C strings, plus
 * UTF-16LE runs at both alignments (.NET user strings, Windows resources,
 * older resource tables). One pass per encoding, so it stays linear.
 */
export function printableStrings(buf: Buffer, minRun = MIN_RUN): string {
  const out: string[] = [];
  let start = -1;
  for (let i = 0; i <= buf.length; i++) {
    if (i < buf.length && isAsciiText(buf[i])) {
      if (start === -1) start = i;
    } else if (start !== -1) {
      if (i - start >= minRun) out.push(buf.toString("latin1", start, i));
      start = -1;
    }
  }
  for (const align of [0, 1]) {
    start = -1;
    for (let i = align; i <= buf.length; i += 2) {
      const text = i + 1 < buf.length && buf[i + 1] === 0 && isAsciiText(buf[i]);
      if (text) {
        if (start === -1) start = i;
      } else if (start !== -1) {
        if ((i - start) / 2 >= minRun) out.push(buf.toString("utf16le", start, i));
        start = -1;
      }
    }
  }
  return out.join("\n");
}

/**
 * Strings of Android's compiled resource table (resources.arsc). The values of
 * strings.xml live in its global string pool, each string behind one or two
 * length bytes — read through the pool's offsets so those bytes are not glued
 * onto the value.
 */
export function readArscStrings(buf: Buffer): string[] {
  if (buf.length < 12 || buf.readUInt16LE(0) !== 0x0002) return [];
  const pool = buf.readUInt16LE(2);
  if (pool + 28 > buf.length || buf.readUInt16LE(pool) !== 0x0001) return [];
  const headerSize = buf.readUInt16LE(pool + 2);
  const count = buf.readUInt32LE(pool + 8);
  const utf8 = (buf.readUInt32LE(pool + 16) & 0x100) !== 0;
  const stringsStart = pool + buf.readUInt32LE(pool + 20);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const o = pool + headerSize + i * 4;
    if (o + 4 > buf.length) break;
    let p = stringsStart + buf.readUInt32LE(o);
    if (p >= buf.length) continue;
    if (utf8) {
      p += buf[p] & 0x80 ? 2 : 1; // UTF-16 length
      if (p >= buf.length) continue;
      let len = buf[p];
      if (len & 0x80) len = ((len & 0x7f) << 8) | buf[p + 1];
      p += buf[p] & 0x80 ? 2 : 1;
      if (p + len <= buf.length) out.push(buf.toString("utf8", p, p + len));
    } else {
      if (p + 2 > buf.length) continue;
      let len = buf.readUInt16LE(p);
      p += 2;
      if (len & 0x8000) {
        len = ((len & 0x7fff) << 16) | buf.readUInt16LE(p);
        p += 2;
      }
      if (p + len * 2 <= buf.length) out.push(buf.toString("utf16le", p, p + len * 2));
    }
  }
  return out;
}

const hasControl = (b: Buffer) => b.some((c) => c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d);

/**
 * String fields of an App Bundle's protobuf resource table (resources.pb). The
 * schema is not needed: a length-delimited field with control bytes in it is a
 * nested message, one without is text.
 */
export function readProtoStrings(buf: Buffer, depth = 0, out: string[] = []): string[] {
  if (depth > 12) return out;
  let fields;
  try {
    fields = readFields(buf);
  } catch {
    return out;
  }
  for (const f of fields) {
    if (!f.bytes || f.bytes.length === 0) continue;
    if (hasControl(f.bytes)) readProtoStrings(f.bytes, depth + 1, out);
    else out.push(f.bytes.toString("utf8"));
  }
  return out;
}

function plistStrings(v: PlistValue | null, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) plistStrings(x, out);
  else if (v && typeof v === "object" && !Buffer.isBuffer(v)) {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      plistStrings(x, out);
    }
  }
  return out;
}

const CONFIG_EXT = /\.(?:json|plist|xml|properties|env|ya?ml|txt|ini|conf|cfg|config|toml|strings)$/i;
const DOTENV = /(?:^|\/)\.env(?:\.[\w-]+)?$/;
export const MAX_CONFIG_BYTES = 8 * 1024 * 1024;

/** Configuration and data files apps ship next to their code: JSON, plists, .env, properties, YAML. */
export function isConfigFile(key: string): boolean {
  return (CONFIG_EXT.test(key) || DOTENV.test(key)) && !key.split("/").includes("node_modules");
}

/** The text of a shipped file: binary plists by value, other binary formats by their printable runs. */
function textOfFile(buf: Buffer): { text: string; positions: boolean } {
  if (buf.length >= 8 && buf.toString("latin1", 0, 8) === "bplist00") return { text: plistStrings(parsePlist(buf)).join("\n"), positions: false };
  if (buf.subarray(0, 512).includes(0)) return { text: printableStrings(buf), positions: false };
  return { text: buf.toString("utf8"), positions: true };
}

/** Secrets in shipped configuration files (see isConfigFile). */
export function analyzeConfigFiles(files: ArtifactFile[], options: SecretScanOptions = {}): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    if (file.size > MAX_CONFIG_BYTES) continue;
    const buf = file.read();
    if (!buf) continue;
    const { text, positions } = textOfFile(buf);
    findings.push(...findSecrets(text, file.display, { ...options, positions }));
  }
  return findings;
}

/** Secrets in a compiled artifact: dex, a resource table, Hermes bytecode, a native or .NET binary. */
export function binarySecrets(buf: Buffer, file: string, options: SecretScanOptions = {}): Finding[] {
  const dex = readDexStrings(buf);
  const arsc = dex.length === 0 ? readArscStrings(buf) : [];
  const text = dex.length > 0 ? dex.join("\n") : arsc.length > 0 ? arsc.join("\n") : printableStrings(buf);
  return findSecrets(text, file, { ...options, positions: false });
}
