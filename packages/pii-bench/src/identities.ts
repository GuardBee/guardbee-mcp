/**
 * Synthetic identities. Every number passes its checksum (a detector that
 * validates must still find it), and none belongs to a real person: names are
 * common first names and surnames combined at random, domains are reserved
 * or made up.
 */

/** Seeded PRNG (mulberry32): the dataset and the bootstrap are reproducible. */
export function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rand = () => number;

export const pick = <T>(rand: Rand, items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
export const int = (rand: Rand, min: number, max: number): number => min + Math.floor(rand() * (max - min + 1));
const digits = (rand: Rand, count: number): string => Array.from({ length: count }, () => String(int(rand, 0, 9))).join("");

export const FIRST_NAMES = [
  "Ayşe", "Fatma", "Zeynep", "Elif", "Emine", "Hatice", "Merve", "Büşra", "Esra", "Özlem",
  "Gülşen", "Derya", "Şeyma", "Tuğba", "Ebru", "Sibel", "Nur", "Gökçe", "İrem", "Ceren",
  "Selin", "Yasemin", "Sevgi", "Hülya", "Dilek", "Melike", "Ümran", "Aslı", "Pınar", "Duygu",
  "Mehmet", "Mustafa", "Ahmet", "Ali", "Hüseyin", "Hasan", "İbrahim", "Murat", "Emre", "Burak",
  "Ömer", "Yusuf", "Serkan", "Kemal", "Oğuz", "Barış", "Cem", "Tolga", "Uğur", "Volkan",
  "Erdem", "Gökhan", "Onur", "Kaan", "Selim", "Levent", "Çağrı", "Doğan", "Halil", "Tuncay",
] as const;

export const SURNAMES = [
  "Yılmaz", "Kaya", "Demir", "Şahin", "Çelik", "Yıldız", "Yıldırım", "Öztürk", "Aydın", "Özdemir",
  "Arslan", "Doğan", "Kılıç", "Aslan", "Çetin", "Kara", "Koç", "Kurt", "Özkan", "Şimşek",
  "Polat", "Korkmaz", "Erdoğan", "Akın", "Güneş", "Aktaş", "Bulut", "Keskin", "Ünal", "Tekin",
  "Uysal", "Karaca", "Bozkurt", "Avcı", "Sarı", "Güler", "Turan", "Işık", "Erdem", "Ateş",
  "Gündoğdu", "Kocabaş", "Sönmez", "Tuna", "Ekinci", "Çakır", "Uçar", "Başaran", "Altun", "Köse",
] as const;

const FOLD: Record<string, string> = { ç: "c", ğ: "g", ı: "i", İ: "i", ö: "o", ş: "s", ü: "u", Ç: "c", Ğ: "g", Ö: "o", Ş: "s", Ü: "u" };
/** An e-mail local part from a name: lower case, Turkish letters folded to ASCII. */
export const asciiFold = (text: string): string => text.replace(/[çğıİöşüÇĞÖŞÜ]/g, (c) => FOLD[c]!).toLowerCase();

const BACK = "aıou";
const VOWELS = "aeıioöuü";
/** The last vowel of a word decides its suffix (Turkish vowel harmony). */
function lastVowel(word: string): string {
  const lower = word.toLocaleLowerCase("tr");
  for (let i = lower.length - 1; i >= 0; i--) if (VOWELS.includes(lower[i]!)) return lower[i]!;
  return "e";
}

export type Case = "gen" | "dat" | "acc" | "abl" | "loc";

/** A proper name's case suffix, apostrophe included: Ayşe'nin, Ahmet'e, Kaya'yı, Öztürk'ten. */
export function suffix(word: string, kind: Case): string {
  const v = lastVowel(word);
  const endsInVowel = VOWELS.includes(word.toLocaleLowerCase("tr").at(-1)!);
  const two = BACK.includes(v) ? "a" : "e";
  const four = "aı".includes(v) ? "ı" : "ei".includes(v) ? "i" : "ou".includes(v) ? "u" : "ü";
  const hard = /[çfhkpsşt]$/i.test(word);
  switch (kind) {
    case "gen":
      return `'${endsInVowel ? "n" : ""}${four}n`;
    case "dat":
      return `'${endsInVowel ? "y" : ""}${two}`;
    case "acc":
      return `'${endsInVowel ? "y" : ""}${four}`;
    case "abl":
      return `'${hard ? "t" : "d"}${two}n`;
    case "loc":
      return `'${hard ? "t" : "d"}${two}`;
  }
}

export function tcKimlik(rand: Rand): string {
  const d = [int(rand, 1, 9), ...Array.from({ length: 8 }, () => int(rand, 0, 9))];
  const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!;
  const even = d[1]! + d[3]! + d[5]! + d[7]!;
  d.push((((odd * 7 - even) % 10) + 10) % 10);
  d.push(d.reduce((a, b) => a + b, 0) % 10);
  return d.join("");
}

/** An 11-digit number that is not a valid TC Kimlik No (an order or file number). */
export function notTcKimlik(rand: Rand): string {
  const valid = tcKimlik(rand);
  return valid.slice(0, 10) + String((Number(valid[10]) + int(rand, 1, 9)) % 10);
}

export function vkn(rand: Rand): string {
  const d = Array.from({ length: 9 }, () => int(rand, 0, 9));
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const tmp = (d[i]! + 10 - (i + 1)) % 10;
    sum += tmp === 9 ? 9 : (tmp * 2 ** (10 - (i + 1))) % 9;
  }
  return d.join("") + String((10 - (sum % 10)) % 10);
}

function mod97(numeric: string): number {
  let remainder = 0;
  for (const ch of numeric) remainder = (remainder * 10 + Number(ch)) % 97;
  return remainder;
}

/** TR + check digits + 5-digit bank code + reserve digit 0 + 16-digit account. */
export function iban(rand: Rand, grouped: boolean): string {
  const bban = `${pick(rand, ["00010", "00012", "00015", "00046", "00062", "00064", "00067", "00111"])}0${digits(rand, 16)}`;
  const check = 98 - mod97(`${bban}${"TR".split("").map((c) => c.charCodeAt(0) - 55).join("")}00`);
  const value = `TR${String(check).padStart(2, "0")}${bban}`;
  return grouped ? value.replace(/(.{4})/g, "$1 ").trim() : value;
}

export function creditCard(rand: Rand, separator: " " | "-" | ""): string {
  const body = [pick(rand, [4, 5]), ...Array.from({ length: 14 }, () => int(rand, 0, 9))];
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let digit = body[14 - i]!;
    if (i % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  const value = [...body, (10 - (sum % 10)) % 10].join("");
  return value.replace(/(.{4})(?!$)/g, `$1${separator}`);
}

/** A mobile number in one of the ways people write it. */
export function phone(rand: Rand, style: "spaced" | "plus90" | "dashed" | "parens" | "bare"): string {
  const operator = pick(rand, ["530", "532", "533", "535", "505", "506", "542", "543", "544", "555", "552"]);
  const [a, b, c] = [digits(rand, 3), digits(rand, 2), digits(rand, 2)];
  switch (style) {
    case "spaced":
      return `0${operator} ${a} ${b} ${c}`;
    case "plus90":
      return `+90 ${operator} ${a} ${b} ${c}`;
    case "dashed":
      return `0${operator}-${a}-${b}${c}`;
    case "parens":
      return `(0${operator}) ${a} ${b} ${c}`;
    case "bare":
      return `${operator}${a}${b}${c}`;
  }
}

export const passport = (rand: Rand): string => `${pick(rand, ["U", "S", "Z"])}${digits(rand, 8)}`;
export const sgkNo = (rand: Rand): string => `${int(rand, 1, 9)}${digits(rand, 12)}`;
export const mersis = (rand: Rand): string => `0${digits(rand, 15)}`;

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

export function birthDate(rand: Rand, style: "dotted" | "iso" | "words"): string {
  const [day, month, year] = [int(rand, 1, 28), int(rand, 1, 12), int(rand, 1955, 2004)];
  const pad = (n: number) => String(n).padStart(2, "0");
  switch (style) {
    case "dotted":
      return `${pad(day)}.${pad(month)}.${year}`;
    case "iso":
      return `${year}-${pad(month)}-${pad(day)}`;
    case "words":
      return `${day} ${MONTHS[month - 1]} ${year}`;
  }
}

const DISTRICTS = [
  ["Kadıköy", "İstanbul"], ["Üsküdar", "İstanbul"], ["Beşiktaş", "İstanbul"], ["Bakırköy", "İstanbul"],
  ["Çankaya", "Ankara"], ["Keçiören", "Ankara"], ["Konak", "İzmir"], ["Bornova", "İzmir"],
  ["Nilüfer", "Bursa"], ["Muratpaşa", "Antalya"], ["Seyhan", "Adana"], ["Tepebaşı", "Eskişehir"],
] as const;
const NEIGHBORHOODS = ["Cumhuriyet", "Yenimahalle", "Bahçelievler", "Fatih", "Gazi", "Esentepe", "Barbaros", "Yıldıztepe", "Gülbahar", "Huzur"];
const STREETS = ["Lale", "Menekşe", "Çınar", "Ihlamur", "Papatya", "Gül", "Akasya", "Söğüt", "Kardelen", "Nergis"];

/** A street address; `short` drops the district and city (inline in prose). */
export function address(rand: Rand, short = false): string {
  const [district, city] = pick(rand, DISTRICTS);
  const street = `${pick(rand, STREETS)} ${pick(rand, ["Sok.", "Sokak", "Cad.", "Caddesi"])}`;
  const base = `${pick(rand, NEIGHBORHOODS)} Mah. ${street} No:${int(rand, 1, 120)}${rand() < 0.6 ? ` D:${int(rand, 1, 24)}` : ""}`;
  return short ? base : `${base} ${district}/${city}`;
}

export const EMAIL_DOMAINS = ["example.com", "example.com.tr", "ornekposta.com", "ornek-sirket.com.tr", "mail.example"] as const;
