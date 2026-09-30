// Checksum validators — run after a regex match to keep false positives low.

/** Turkish national ID (TC Kimlik No) checksum — the standard 11-digit algorithm. */
export function isValidTcKimlik(raw: string): boolean {
  const d = raw.replace(/\D/g, "");
  if (d.length !== 11 || d[0] === "0") return false;
  const digits = d.split("").map(Number);
  const oddSum = digits[0] + digits[2] + digits[4] + digits[6] + digits[8];
  const evenSum = digits[1] + digits[3] + digits[5] + digits[7];
  const d10 = ((oddSum * 7 - evenSum) % 10 + 10) % 10;
  const first10Sum = digits.slice(0, 10).reduce((a, b) => a + b, 0);
  const d11 = first10Sum % 10;
  return d10 === digits[9] && d11 === digits[10];
}

/** Luhn checksum for credit card numbers. */
export function isValidLuhn(raw: string): boolean {
  const d = raw.replace(/[\s-]/g, "");
  if (!/^\d{13,19}$/.test(d)) return false;
  let sum = 0;
  let double = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let digit = Number(d[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/** IBAN mod-97 checksum (ISO 7064 MOD97-10), computed in chunks to avoid precision loss. */
export function isValidIban(raw: string): boolean {
  const iban = raw.replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let remainder = "";
  for (const ch of numeric) {
    remainder = (Number(remainder + ch) % 97).toString();
  }
  return Number(remainder) === 1;
}
