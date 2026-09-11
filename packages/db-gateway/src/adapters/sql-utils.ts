const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * SQL identifier'lar (tablo/kolon adı) parametrize edilemez, bu yüzden
 * SQL'e gömülmeden önce hem format hem de canlı şema karşısında doğrulanmalı.
 * Bu kontrol format tarafını yapar; çağıran taraf ayrıca identifier'ın
 * information_schema'dan gelen gerçek tablo/kolon listesinde olduğunu
 * teyit etmelidir (bkz. pg.ts / mysql.ts).
 */
export function assertValidIdentifier(name: string, kind: "table" | "column"): void {
  if (!IDENTIFIER_RE.test(name)) {
    throw new Error(`[guardbee-gateway] Invalid ${kind} name: "${name}"`);
  }
}

/** `limit` her zaman pozitif bir tam sayı olmalı — SQL'e literal olarak gömülmeden önce doğrulanır. */
export function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`[guardbee-gateway] Invalid ${label}: must be a positive integer, got ${value}`);
  }
}

/** Identifier'ı verilen quote karakteriyle sarar, içindeki quote karakterlerini ikiye katlar. */
export function quoteIdentifier(name: string, quoteChar: '"' | "`"): string {
  return quoteChar + name.split(quoteChar).join(quoteChar + quoteChar) + quoteChar;
}
