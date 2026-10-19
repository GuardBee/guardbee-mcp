/**
 * Builds the dataset from the templates. Labels are right by construction:
 * each span is recorded where its value is written, so the generator, not a
 * reader, decides the offsets. `pnpm generate` rewrites data/tr-pii-v1.jsonl
 * and data/tr-names-challenge.jsonl; a test checks the committed files are
 * what this produces.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isCategory, type Category, type Doc, type Domain, type Span } from "./categories.js";
import {
  EMAIL_DOMAINS,
  FIRST_NAMES,
  SURNAMES,
  address,
  asciiFold,
  birthDate,
  creditCard,
  iban,
  int,
  mersis,
  notTcKimlik,
  passport,
  phone,
  pick,
  rng,
  sgkNo,
  suffix,
  tcKimlik,
  vkn,
  type Case,
  type Rand,
} from "./identities.js";
import { CHALLENGE_LINES } from "./challenge.js";
import { CLEAN_TEMPLATES, PII_TEMPLATES } from "./templates.js";

export const DATASET_SEED = 20261019;
export const DOCS_PER_DOMAIN = { pii: 100, clean: 40 } as const;

/** KVKK Art. 6 phrases, each worded to read in the templates' sentences. */
const SPECIAL: Record<string, { category: Category; phrases: string[] }> = {
  health: {
    category: "health",
    phrases: ["epilepsi", "astım", "tip 2 diyabet", "kronik böbrek yetmezliği", "majör depresyon", "bipolar bozukluk", "panik bozukluk", "meme kanseri", "multipl skleroz", "kalp yetmezliği", "migren", "HIV enfeksiyonu", "lösemi", "şizofreni"],
  },
  religion: { category: "religion_belief", phrases: ["Alevi", "Hristiyan", "Yahudi", "Süryani", "Ezidi", "Şii", "Yehova Şahidi", "Katolik"] },
  ethnic: { category: "ethnic_origin", phrases: ["Kürt", "Roman", "Ermeni", "Laz", "Çerkez", "Arap", "Gürcü", "Rum", "Boşnak"] },
  political: {
    category: "political_opinion",
    phrases: ["sosyalist görüşlü", "milliyetçi görüşlü", "muhalefet partisinin ilçe yöneticisi", "iktidar partisi üyesi", "anarşist görüşlü", "muhafazakâr parti delegesi"],
  },
  union: {
    category: "union_membership",
    phrases: ["metal işçileri sendikası üyesi", "eğitim çalışanları sendikası temsilcisi", "sağlık emekçileri sendikası üyesi", "belediye işçileri sendikası işyeri temsilcisi", "banka çalışanları sendikası üyesi"],
  },
  criminal: {
    category: "criminal_record",
    phrases: ["dolandırıcılık suçundan mahkûmiyeti", "hırsızlıktan sabıka kaydı", "kasten yaralamadan hapis cezası", "uyuşturucu ticaretinden hükümlülüğü", "zimmet suçundan mahkûmiyeti"],
  },
  sexlife: { category: "sex_life", phrases: ["eşcinsel", "biseksüel", "aseksüel"] },
  biometric: { category: "biometric", phrases: ["parmak izi", "yüz tanıma şablonu", "avuç içi damar izi", "retina taraması", "ses izi"] },
  genetic: {
    category: "genetic",
    phrases: ["BRCA1 mutasyonu", "BRCA2 gen mutasyonu", "Huntington geni", "talasemi taşıyıcılığı", "kistik fibrozis taşıyıcılığı", "Faktör V Leiden mutasyonu"],
  },
};

const COMPANIES = ["Örnek Lojistik A.Ş.", "Mavi Yazılım Ltd. Şti.", "Anadolu Gıda San. ve Tic. A.Ş.", "Kuzey Enerji A.Ş.", "Defne Tekstil Ltd. Şti.", "Pera Danışmanlık A.Ş."];

interface Person {
  first: string;
  last: string;
  female: boolean;
  email: string;
  kep: string;
}

function person(rand: Rand, avoid?: Person): Person {
  for (;;) {
    const index = Math.floor(rand() * FIRST_NAMES.length);
    const [first, last] = [FIRST_NAMES[index]!, pick(rand, SURNAMES)];
    if (avoid && (avoid.first === first || avoid.last === last)) continue;
    const [f, l] = [asciiFold(first), asciiFold(last)];
    const local = pick(rand, [`${f}.${l}`, `${f}${l}`, `${f[0]}${l}`, `${f}.${l}${int(rand, 1, 99)}`, `${f}_${l}`]);
    return { first, last, female: index < 30, email: `${local}@${pick(rand, EMAIL_DOMAINS)}`, kep: `${f}.${l}@hs${String(int(rand, 1, 9)).padStart(2, "0")}.kep.tr` };
  }
}

type Segment = { text: string; category?: Category };

const two = (n: number) => String(n).padStart(2, "0");

/** Unlabeled values: what a detector should leave alone. */
const UNLABELED: Record<string, (rand: Rand) => string> = {
  order: notTcKimlik,
  refno: (rand) => `${int(rand, 1, 9)}${Array.from({ length: 9 }, () => int(rand, 0, 9)).join("")}`,
  ticket: (rand) => pick(rand, [`TKT-${int(rand, 2024, 2026)}-${String(int(rand, 1, 999999)).padStart(6, "0")}`, `#${int(rand, 100000, 999999)}`]),
  amount: (rand) => `${int(rand, 50, 25000).toLocaleString("tr-TR")},${two(int(rand, 0, 99))} TL`,
  date: (rand) => `${two(int(rand, 1, 28))}.${two(int(rand, 1, 12))}.${int(rand, 2025, 2026)}`,
  time: (rand) => `${two(int(rand, 8, 22))}:${two(int(rand, 0, 59))}`,
  version: (rand) => `${int(rand, 1, 4)}.${int(rand, 0, 30)}.${int(rand, 0, 9)}`,
  product: (rand) => `${pick(rand, ["PRD", "SKU", "URN"])}-${int(rand, 10000, 99999)}`,
  company: (rand) => pick(rand, COMPANIES),
  year: (rand) => String(int(rand, 2019, 2026)),
  casenum: (rand) => String(int(rand, 100, 9999)),
  callcenter: (rand) => `0850 ${int(rand, 200, 899)} ${two(int(rand, 10, 99))} ${two(int(rand, 10, 99))}`,
  rolemail: (rand) => `${pick(rand, ["ik", "destek", "muhasebe", "info", "bordro"])}@${pick(rand, EMAIL_DOMAINS)}`,
};

/** Labeled values, by slot name. */
const LABELED: Record<string, [Category, (rand: Rand) => string]> = {
  tc: ["tc_kimlik", tcKimlik],
  vkn: ["vkn", vkn],
  iban: ["iban", (rand) => iban(rand, true)],
  iban_compact: ["iban", (rand) => iban(rand, false)],
  card: ["credit_card", (rand) => creditCard(rand, " ")],
  card_dashed: ["credit_card", (rand) => creditCard(rand, "-")],
  card_plain: ["credit_card", (rand) => creditCard(rand, "")],
  phone: ["phone_tr", (rand) => phone(rand, "spaced")],
  phone_plus90: ["phone_tr", (rand) => phone(rand, "plus90")],
  phone_dashed: ["phone_tr", (rand) => phone(rand, "dashed")],
  phone_parens: ["phone_tr", (rand) => phone(rand, "parens")],
  phone_bare: ["phone_tr", (rand) => phone(rand, "bare")],
  passport: ["passport", passport],
  sgk: ["sgk_no", sgkNo],
  mersis: ["mersis", mersis],
  dob: ["birth_date", (rand) => birthDate(rand, "dotted")],
  dob_iso: ["birth_date", (rand) => birthDate(rand, "iso")],
  dob_words: ["birth_date", (rand) => birthDate(rand, "words")],
  addr: ["address", (rand) => address(rand)],
  addr_short: ["address", (rand) => address(rand, true)],
  ...Object.fromEntries(Object.entries(SPECIAL).map(([slot, { category, phrases }]) => [slot, [category, (rand: Rand) => pick(rand, phrases)]])),
};

function personSlot(who: Person, field: string, kind: Case | undefined): Segment[] {
  const label = (name: string, after = ""): Segment[] => {
    const tail = kind ? suffix(after ? after.trim() : name, kind) : "";
    return [{ text: name, category: "person_name" }, { text: after + tail }];
  };
  switch (field) {
    case "":
      return label(`${who.first} ${who.last}`);
    case "first":
      return label(who.first);
    case "last":
      return label(who.last);
    case "hitap":
      return label(who.first, who.female ? " Hanım" : " Bey");
    case "email":
      return [{ text: who.email, category: "email" }];
    case "kep":
      return [{ text: who.kep, category: "kep" }];
    default:
      throw new Error(`unknown person field "${field}"`);
  }
}

const TOKEN = /\{([^}]+)\}|\[\[([^|\]]+)\|([a-z_]+)\]\]/g;

/** One document from a template: its text and the labeled spans in it. */
export function render(template: string, rand: Rand): { text: string; spans: Span[] } {
  const p = person(rand);
  const people: Record<string, Person> = { P: p, Q: person(rand, p) };
  const segments: Segment[] = [];
  let cursor = 0;
  for (const match of template.matchAll(TOKEN)) {
    segments.push({ text: template.slice(cursor, match.index) });
    cursor = match.index + match[0].length;
    if (match[2] !== undefined) {
      const category = match[3]!;
      if (!isCategory(category)) throw new Error(`unknown category "${category}"`);
      segments.push({ text: match[2], category });
      continue;
    }
    const [slot, kind] = match[1]!.split(":") as [string, Case | undefined];
    const [head, field = ""] = slot.split(".");
    const who = people[head!];
    if (who) segments.push(...personSlot(who, field, kind));
    else if (LABELED[slot]) segments.push({ text: LABELED[slot][1](rand), category: LABELED[slot][0] });
    else if (UNLABELED[slot]) segments.push({ text: UNLABELED[slot](rand) });
    else throw new Error(`unknown slot "{${match[1]}}"`);
  }
  segments.push({ text: template.slice(cursor) });

  let text = "";
  const spans: Span[] = [];
  for (const { text: part, category } of segments) {
    if (category) spans.push({ start: text.length, end: text.length + part.length, category });
    text += part;
  }
  return { text, spans };
}

export function generateDataset(seed = DATASET_SEED): Doc[] {
  const rand = rng(seed);
  const docs: Doc[] = [];
  for (const set of ["pii", "clean"] as const) {
    const templates = set === "pii" ? PII_TEMPLATES : CLEAN_TEMPLATES;
    for (const domain of Object.keys(templates) as Domain[]) {
      const list = templates[domain];
      for (let i = 0; i < DOCS_PER_DOMAIN[set]; i++) {
        const { text, spans } = render(list[i % list.length]!, rand);
        docs.push({ id: `${domain}-${set}-${String(i + 1).padStart(3, "0")}`, domain, set, text, spans });
      }
    }
  }
  return docs;
}

/** The hand-written name challenge (challenge.ts): a line with a label is a PII document, one without is clean. */
export function generateChallenge(): Doc[] {
  return CHALLENGE_LINES.map((line, i) => {
    const { text, spans } = render(line, rng(i));
    const domain: Domain = text === text.toLocaleUpperCase("tr") ? "legal" : /^\p{Ll}/u.test(text) ? "chat" : "support";
    return { id: `challenge-${String(i + 1).padStart(3, "0")}`, domain, set: spans.length > 0 ? "pii" : "clean", text, spans };
  });
}

export const toJsonl = (docs: Doc[]): string => docs.map((doc) => JSON.stringify(doc)).join("\n") + "\n";

export const DATASET_PATH = fileURLToPath(new URL("../data/tr-pii-v1.jsonl", import.meta.url));
export const CHALLENGE_PATH = fileURLToPath(new URL("../data/tr-names-challenge.jsonl", import.meta.url));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [path, docs] of [[DATASET_PATH, generateDataset()], [CHALLENGE_PATH, generateChallenge()]] as const) {
    writeFileSync(path, toJsonl(docs));
    console.log(`wrote ${docs.length} documents to ${path}`);
  }
}
