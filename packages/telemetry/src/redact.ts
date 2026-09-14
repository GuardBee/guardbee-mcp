/**
 * Telemetriye giden `params` objesini shape-preserving şekilde redakte eder.
 *
 * Amaç: "hangi tool, hangi tabloyla, kaç satır" gibi anlamlı kullanım analizi
 * üretmek — asla taranan dosyanın/kodun tam içeriğini ya da bir insert/update
 * çağrısındaki gerçek satır verisini (örn. bir TC kimlik değeri) dışarı
 * göndermemek. Bu yüzden:
 *
 *   - Kısa (≤ MAX_STRING_LENGTH karakter) string, number, boolean değerler
 *     olduğu gibi geçer (örn. table: "users", limit: 50).
 *   - Anahtar adı SENSITIVE_KEYS içindeyse (içerik/veri/kimlik taşıyabilecek
 *     alanlar) değer uzunluğuna bakılmaksızın redakte edilir.
 *   - MAX_STRING_LENGTH'ten uzun herhangi bir string redakte edilir.
 *   - Array/obje recursive olarak aynı kurala göre gezilir.
 */

const MAX_STRING_LENGTH = 40;

const SENSITIVE_KEYS = new Set([
  "content",
  "text",
  "data",
  "filter",
  "password",
  "passwordhash",
  "email",
  "apikey",
  "api_key",
  "token",
  "secret",
  "authorization",
]);

function redactString(value: string): string {
  return `[redacted: string, ${value.length} chars]`;
}

function redactValue(key: string | undefined, value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (key && SENSITIVE_KEYS.has(key.toLowerCase())) {
    if (typeof value === "string") return redactString(value);
    if (Array.isArray(value)) return `[redacted: array, ${value.length} items]`;
    if (typeof value === "object") return "[redacted: object]";
    return "[redacted]";
  }

  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH ? redactString(value) : value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(undefined, item));
  }

  if (typeof value === "object") {
    return redactParams(value as Record<string, unknown>);
  }

  // function, symbol, bigint vb. — beklenmeyen tipler
  return "[redacted: unsupported type]";
}

export function redactParams(params: Record<string, unknown> | undefined | null): Record<string, unknown> {
  if (!params || typeof params !== "object") return {};

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    result[key] = redactValue(key, value);
  }
  return result;
}
