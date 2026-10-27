import type { Ecosystem } from "./osv.js";

/**
 * Version ordering per ecosystem, enough to evaluate OSV ranges:
 * SemVer 2.0 for npm, crates.io and Go; PEP 440 for PyPI; and a generic
 * Maven/RubyGems-style ordering (numeric segments, pre-release qualifiers
 * before the release) for everything else.
 */
export function compareVersions(a: string, b: string, ecosystem: Ecosystem | string): number {
  if (a === b) return 0;
  if (ecosystem === "PyPI") {
    const pa = parsePep440(a);
    const pb = parsePep440(b);
    if (pa && pb) return comparePep440(pa, pb);
  } else if (ecosystem === "npm" || ecosystem === "crates.io" || ecosystem === "Go") {
    const sa = parseSemver(a);
    const sb = parseSemver(b);
    if (sa && sb) return compareSemver(sa, sb);
  }
  return compareGeneric(a, b);
}

// ── SemVer ────────────────────────────────────────────────────────────────────

interface Semver {
  core: [number, number, number];
  pre: string[];
}

function parseSemver(v: string): Semver | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v.trim());
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split(".") : [] };
}

function compareSemver(a: Semver, b: Semver): number {
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i]! - b.core[i]!;
  // A pre-release sorts before its release.
  if (a.pre.length === 0 || b.pre.length === 0) return b.pre.length - a.pre.length;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      if (Number(x) !== Number(y)) return Number(x) - Number(y);
    } else if (xn !== yn) {
      return xn ? -1 : 1; // numeric identifiers sort before alphanumeric
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

// ── PEP 440 ───────────────────────────────────────────────────────────────────

interface Pep440 {
  epoch: number;
  release: number[];
  pre: [number, number] | null; // [a=0 | b=1 | rc=2, n]
  post: number | null;
  dev: number | null;
}

const PEP440 =
  /^v?(?:(\d+)!)?(\d+(?:\.\d+)*)(?:[-_.]?(a|alpha|b|beta|c|rc|pre|preview)[-_.]?(\d*))?(?:-(\d+)|[-_.]?(post|rev|r)[-_.]?(\d*))?(?:[-_.]?(dev)[-_.]?(\d*))?(?:\+[a-z0-9.]+)?$/i;

function parsePep440(v: string): Pep440 | null {
  const m = PEP440.exec(v.trim());
  if (!m) return null;
  const preKind = m[3]?.toLowerCase();
  const pre: [number, number] | null = preKind
    ? [preKind.startsWith("a") ? 0 : preKind.startsWith("b") ? 1 : 2, Number(m[4] || 0)]
    : null;
  const post = m[5] !== undefined ? Number(m[5]) : m[6] ? Number(m[7] || 0) : null;
  return {
    epoch: Number(m[1] ?? 0),
    release: m[2]!.split(".").map(Number),
    pre,
    post,
    dev: m[8] ? Number(m[9] || 0) : null,
  };
}

function comparePep440(a: Pep440, b: Pep440): number {
  if (a.epoch !== b.epoch) return a.epoch - b.epoch;
  const len = Math.max(a.release.length, b.release.length);
  for (let i = 0; i < len; i++) {
    const d = (a.release[i] ?? 0) - (b.release[i] ?? 0);
    if (d !== 0) return d;
  }
  // packaging's ordering: X.devN < X.aN < X.bN < X.rcN < X < X.postN
  const preKey = (p: Pep440): number[] =>
    p.pre ? p.pre : p.post === null && p.dev !== null ? [-1, 0] : [3, 0];
  const pa = preKey(a);
  const pb = preKey(b);
  for (let i = 0; i < 2; i++) if (pa[i] !== pb[i]) return pa[i]! - pb[i]!;
  const postA = a.post ?? -1;
  const postB = b.post ?? -1;
  if (postA !== postB) return postA - postB;
  const devA = a.dev ?? Number.POSITIVE_INFINITY;
  const devB = b.dev ?? Number.POSITIVE_INFINITY;
  return devA === devB ? 0 : devA < devB ? -1 : 1;
}

// ── Generic (Maven, RubyGems, …) ──────────────────────────────────────────────

const QUALIFIER_RANK: Record<string, number> = {
  dev: -6,
  snapshot: -5,
  alpha: -4,
  a: -4,
  beta: -3,
  b: -3,
  milestone: -2,
  m: -2,
  rc: -1,
  cr: -1,
  pre: -1,
  ga: 0,
  final: 0,
  release: 0,
  sp: 1,
};

function tokens(v: string): Array<number | string> {
  // A leading "v" (Composer's v4.4.0) is a tag prefix, not a qualifier.
  const bare = v.toLowerCase().replace(/^v(?=\d)/, "");
  return (bare.match(/\d+|[a-z]+/g) ?? []).map((t) => (/^\d+$/.test(t) ? Number(t) : t));
}

function compareGeneric(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  for (let i = 0; i < Math.max(ta.length, tb.length); i++) {
    const x = ta[i];
    const y = tb[i];
    if (x === y) continue;
    // A missing segment is the release: less than a number, more than a pre-release qualifier.
    const rank = (t: number | string | undefined): [number, number | string] =>
      t === undefined ? [1, 0] : typeof t === "number" ? [2, t] : [1, QUALIFIER_RANK[t] ?? 0.5];
    const [kx, vx] = rank(x);
    const [ky, vy] = rank(y);
    if (kx !== ky) return kx - ky;
    if (vx !== vy) return vx < vy ? -1 : 1;
    if (typeof x === "string" && typeof y === "string") return x < y ? -1 : 1;
  }
  return 0;
}
