const TOKEN_PREFIXES: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{8,}/,
  /sk-[A-Za-z0-9]{16,}/,
  /ghp_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /glpat-[A-Za-z0-9_-]{8,}/,
  /AKIA[0-9A-Z]{16}/,
  /xox[baprs]-[A-Za-z0-9-]{8,}/,
  /AIza[0-9A-Za-z\-_]{20,}/,
];

const SENSITIVE_KEY = /(?:api[_-]?key|secret|token|password|passwd|credential|private[_-]?key)/i;
const PLACEHOLDER =
  /^(?:\$\{[^}]+\}|changeme|your[-_].*|example|placeholder|xxx+|todo|<.*>|dummy|test|false|true|null|undefined|redacted|\*+)$/i;

export function redactSecret(value: string): string {
  if (value.length <= 4) return "****";
  return `${value.slice(0, 4)}…`;
}

export function looksLikeSecret(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || PLACEHOLDER.test(trimmed)) return false;
  return TOKEN_PREFIXES.some((re) => re.test(trimmed));
}

export function sensitiveEnvValue(key: string, value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || PLACEHOLDER.test(trimmed)) return false;
  if (looksLikeSecret(trimmed)) return true;
  if (!SENSITIVE_KEY.test(key)) return false;
  if (trimmed.length < 12) return false;
  if (/^https?:\/\//i.test(trimmed)) return false;
  return true;
}
