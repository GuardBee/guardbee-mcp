/**
 * The bypass suite: each identifier written in a form that hides it from a
 * plain regex (an encoding, another script's digits, separators), and
 * encoded-looking text with no personal data in it. A case "leaks" when the
 * form of the value is still in the masked output; a clean string "changes"
 * when masking touched it at all. guard-core masks rather than reporting
 * spans, so this measures the masking itself, the way the proxy uses it.
 *
 *   pnpm bypass            # writes results/bypass.md and the README block
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { maskPiiInText, maskPiiInValue } from "@guardbee/guard-core";

/** Values that pass guard-core's validators (TC check digits, IBAN mod 97, Luhn, a TR mobile prefix). */
const VALUES = {
  tc_kimlik: "10000000146",
  iban: "TR330006100519786457841326",
  email: "ahmet.yilmaz@example.com",
  phone_tr: "05321234567",
  credit_card: "4111111111111111",
} as const;
type Identifier = keyof typeof VALUES;

const LABEL: Record<Identifier, string> = { tc_kimlik: "TC", iban: "IBAN", email: "e-posta", phone_tr: "tel", credit_card: "kart" };

const b64 = (s: string) => Buffer.from(s).toString("base64");
const digits = (zero: number) => (s: string) => s.replace(/\d/g, (d) => String.fromCodePoint(zero + Number(d)));
const chars = (fn: (c: string) => string) => (s: string) => [...s].map(fn).join("");

/** How a technique writes a value; `text` places it in a line (by default after the identifier's label). */
interface Technique {
  name: string;
  encode: (value: string, id: Identifier) => string | null;
  text?: (encoded: string, id: Identifier) => string;
  /** Not handled on purpose; reported, not counted against the score. */
  outOfScope?: string;
}

export const TECHNIQUES: Technique[] = [
  { name: "plain", encode: (v) => v },
  { name: "base64 (value)", encode: (v) => b64(v), text: (e) => `token=${e}` },
  { name: "base64 (sentence)", encode: (v, id) => b64(`${LABEL[id]}: ${v}`), text: (e) => `payload ${e}` },
  // Not inside a JWT, which guard-core masks whole as a credential
  { name: "base64url (JSON)", encode: (v, id) => Buffer.from(JSON.stringify({ sub: "u1", [id]: v })).toString("base64url"), text: (e) => `/callback?state=${e}` },
  { name: "base64 of base64", encode: (v) => b64(b64(v)), text: (e) => `blob=${e}` },
  { name: "hex", encode: (v, id) => Buffer.from(`${id}=${v}`).toString("hex"), text: (e) => `data=${e}` },
  { name: "URL encoding", encode: chars((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`), text: (e) => `https://api.example.com/search?q=${e}&page=2` },
  // Only the punctuation, as a browser leaves it: "ahmet%2Eyilmaz%40example%2Ecom"
  { name: "URL encoding (punctuation)", encode: (v) => encodeURIComponent(v).replace(/\./g, "%2E"), text: (e) => `?v=${e}` },
  { name: "HTML decimal entities", encode: chars((c) => `&#${c.charCodeAt(0)};`) },
  { name: "HTML hex entities", encode: chars((c) => `&#x${c.charCodeAt(0).toString(16)};`) },
  { name: "JSON \\u escapes", encode: chars((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`), text: (e, id) => `{"${id}":"${e}"}` },
  { name: "fullwidth digits", encode: (v) => v.replace(/\d/g, (d) => String.fromCharCode(0xff10 + Number(d))) },
  { name: "Arabic-Indic digits", encode: (v) => digits(0x660)(v) },
  { name: "Devanagari digits", encode: (v) => digits(0x966)(v) },
  { name: "zero-width characters", encode: (v) => [...v].join("​") },
  {
    name: "separators / spelled out",
    encode: (v, id) =>
      ({
        tc_kimlik: "100 000 001 46",
        iban: "TR33-0006-1005-1978-6457-8413-26",
        email: "ahmet.yilmaz [at] example [dot] com",
        phone_tr: "+90.532.123.45.67",
        credit_card: "4111-1111-1111-1111",
      })[id] ?? v,
  },
  { name: "reversed", encode: (v) => [...v].reverse().join(""), outOfScope: "a reversed value reads as noise to a model too" },
];

/** Encoded-looking text with nothing personal: hashes, ids, encoded prose, and escapes of ordinary text. */
export const CLEAN: [string, string][] = [
  ["SHA-256", "sha256: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"],
  ["git commit", "fix landed in 3f2a9c1e8b7d6a5f4e3d2c1b0a9f8e7d6c5b4a39"],
  ["UUID", "request 123e4567-e89b-12d3-a456-426614174000 failed"],
  ["npm integrity", "integrity sha512-Pf3hGu0sQuFBVg7fJ3CvA0B2l0m7f9ZP0Wq2l1z3m2Q8Xh0aHj3vC0Q5bF9rN7cL4sT2yU1oE6dK8gW9xR3pA=="],
  ["base64 PNG", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="],
  // Not a JWT: guard-core masks a JWT as a credential, whatever its payload
  ["base64url cursor", `next=${Buffer.from(JSON.stringify({ page: 2, sort: "date", after: "2026-10-01" })).toString("base64url")}`],
  ["base64 prose", `note=${b64("Toplantı yarın saat 10'da, gündem ekte.")}`],
  ["hex prose", `msg=${Buffer.from("deploy finished without errors").toString("hex")}`],
  ["URL-encoded Turkish", "https://example.com/ara?q=%C3%A7ilek%20re%C3%A7eli&sayfa=2"],
  ["percentages", "Kampanyada %50 indirim, üyelere %20 ek indirim var."],
  ["HTML entities", "Fiyat &lt; 100 TL &amp; kargo &#252;cretsiz &mdash; stoklarla s&#305;n&#305;rl&#305;."],
  ["JSON \\u escapes", '{"title":"\\u00c7al\\u0131\\u015fma plan\\u0131","count":42}'],
  ["Arabic-Indic digits", "السعر ١٢٥ ريال للقطعة الواحدة"],
  ["Devanagari digits", "कुल ४५० रुपये, ३ दिन में डिलीवरी"],
  ["long word", "Muvaffakiyetsizleştiricileştiriveremeyebileceklerimizdenmişsinizcesine"],
  ["file path", "src/components/UserProfileSettingsPanel.tsx"],
];

/** A split value is not one string any detector sees. Reported, not counted. */
const SPLIT = { tc_ilk: "100000", tc_son: "00146" };

interface Row {
  technique: string;
  masked: number;
  total: number;
  leaked: string[];
  outOfScope?: string;
}

export function runBypass(): { rows: Row[]; clean: { name: string; changed: boolean }[]; split: boolean } {
  const rows: Row[] = TECHNIQUES.map((technique) => {
    const row: Row = { technique: technique.name, masked: 0, total: 0, leaked: [], ...(technique.outOfScope ? { outOfScope: technique.outOfScope } : {}) };
    for (const id of Object.keys(VALUES) as Identifier[]) {
      const encoded = technique.encode(VALUES[id], id);
      if (encoded === null) continue;
      const text = technique.text ? technique.text(encoded, id) : `${LABEL[id]}: ${encoded}`;
      row.total++;
      if (maskPiiInText(text).includes(encoded)) row.leaked.push(id);
      else row.masked++;
    }
    return row;
  });
  const clean = CLEAN.map(([name, text]) => ({ name, changed: maskPiiInText(text) !== text }));
  const split = JSON.stringify(maskPiiInValue(SPLIT)) !== JSON.stringify(SPLIT);
  return { rows, clean, split };
}

export function bypassMarkdown({ rows, clean, split }: ReturnType<typeof runBypass>): string {
  const counted = rows.filter((row) => !row.outOfScope);
  const masked = counted.reduce((n, row) => n + row.masked, 0);
  const total = counted.reduce((n, row) => n + row.total, 0);
  const lines = [
    `Masked: **${masked} of ${total}** (${Object.keys(VALUES).length} identifiers × ${counted.length} forms). Clean strings changed: **${clean.filter((c) => c.changed).length} of ${clean.length}**.`,
    "",
    "| Form | Masked | Leaked |",
    "|---|---|---|",
    ...rows.map((row) => `| ${row.technique}${row.outOfScope ? " (out of scope)" : ""} | ${row.masked}/${row.total} | ${row.leaked.join(", ") || "–"} |`),
    "",
    `Changed clean strings: ${clean.filter((c) => c.changed).map((c) => c.name).join(", ") || "none"}.`,
    `Out of scope: ${rows.filter((row) => row.outOfScope).map((row) => `${row.technique} (${row.outOfScope})`).join("; ")}; a value split across fields (${split ? "masked" : "not masked"}).`,
    "",
  ];
  return lines.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const markdown = bypassMarkdown(runBypass());
  writeFileSync(fileURLToPath(new URL("../results/bypass.md", import.meta.url)), `# Bypass suite: guard-core regex\n\n${markdown}`);
  const readme = fileURLToPath(new URL("../README.md", import.meta.url));
  writeFileSync(readme, readFileSync(readme, "utf8").replace(/(<!-- results:bypass -->\n)[\s\S]*?(<!-- \/results -->)/, (_all, open: string, close: string) => `${open}${markdown}${close}`));
  console.log(markdown);
}
