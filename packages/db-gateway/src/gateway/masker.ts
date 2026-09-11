import { createHash } from "crypto";
import type { FieldRule, MaskingStrategy } from "../config";

/**
 * Tek bir değeri maskeleme stratejisine göre dönüştürür.
 */
export function applyStrategy(value: unknown, strategy: MaskingStrategy): unknown {
  if (value === null || value === undefined) return value;

  switch (strategy) {
    case "redact":
      return "[REDACTED]";

    case "mask":
      return maskValue(value);

    case "hash":
      return createHash("sha256")
        .update(String(value))
        .digest("hex")
        .slice(0, 16);

    case "allow":
      return value;
  }
}

/**
 * String değerlerin ortasını yıldızlar:
 *   "ahmet@example.com"  → "ah***@example.com"
 *   "5301234567"         → "530***4567"
 *   "TR12 0001 0017..."  → "TR12***..."
 */
function maskValue(value: unknown): string {
  const str = String(value);

  // E-posta
  if (str.includes("@")) {
    const [local, domain] = str.split("@");
    const visible = local.slice(0, Math.min(2, local.length));
    return `${visible}***@${domain}`;
  }

  // Sadece rakamlar (telefon, TC kimlik, IBAN sayısal kısmı)
  if (/^\+?[\d\s\-()]+$/.test(str)) {
    const digits = str.replace(/\D/g, "");
    if (digits.length <= 4) return "****";
    return digits.slice(0, 3) + "***" + digits.slice(-2);
  }

  // Genel string
  if (str.length <= 4) return "****";
  const show = Math.max(1, Math.floor(str.length * 0.2));
  return str.slice(0, show) + "***" + str.slice(-show);
}

/**
 * Glob benzeri pattern eşleştirme:
 *   "*Password*"  → passwordHash, userPassword, ...
 *   "email"       → tam eşleşme
 */
function matchesPattern(fieldName: string, pattern: string): boolean {
  if (!pattern.includes("*")) return fieldName === pattern;
  const regexStr = pattern
    .split("*")
    .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${regexStr}$`, "i").test(fieldName);
}

/**
 * Bir row objesini verilen field kurallarına göre maskeler.
 * İç içe objeler için recursive çalışır.
 */
export function maskRow(
  row: Record<string, unknown>,
  fieldRules: FieldRule[],
  tableName?: string
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    const rule = fieldRules.find(
      (r) =>
        matchesPattern(key, r.field) &&
        (!r.table || r.table === tableName)
    );

    if (rule) {
      result[key] = applyStrategy(value, rule.strategy);
    } else if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      // İç içe obje: recursive maskele
      result[key] = maskRow(
        value as Record<string, unknown>,
        fieldRules,
        tableName
      );
    } else if (Array.isArray(value)) {
      // Array içindeki objeler
      result[key] = value.map((item) =>
        item && typeof item === "object"
          ? maskRow(item as Record<string, unknown>, fieldRules, tableName)
          : item
      );
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Row listesini maskeler ve maxRows sınırını uygular.
 */
export function maskRows(
  rows: Record<string, unknown>[],
  fieldRules: FieldRule[],
  tableName: string,
  maxRows: number
): { rows: Record<string, unknown>[]; truncated: boolean } {
  const truncated = rows.length > maxRows;
  const limited = truncated ? rows.slice(0, maxRows) : rows;
  return {
    rows: limited.map((row) => maskRow(row, fieldRules, tableName)),
    truncated,
  };
}
