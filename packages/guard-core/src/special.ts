/**
 * KVKK Art. 6 special categories of personal data: health, religion and
 * belief, ethnic origin, political opinion, union membership, criminal
 * record, sex life, biometric and genetic data.
 *
 * A term list per category, Turkish and English, and a context rule: a term
 * is masked only when the same text is about a person. That means a name the
 * NER model found, a personal identifier a regex detector found, or a word
 * that points at someone ("hastanın", "çalışan", "babam", a first-person
 * verb). "Diyabet hastaları için rehber" is left alone; "Hastanın diyabeti
 * var" is masked.
 *
 * The bias is conservative: once a text is about a person, every term in it
 * is masked, even one that is about something else. These detectors are
 * opt-in (preset KVKK_SENSITIVE, or `enable` by name). They find words, not
 * meaning: a term that is not on the list is missed, and a listed word used in
 * another sense next to a person is masked.
 */

export const SPECIAL_CATEGORIES = [
  "health",
  "religion_belief",
  "ethnic_origin",
  "political_opinion",
  "union_membership",
  "criminal_record",
  "sex_life",
  "biometric",
  "genetic",
] as const;

export type SpecialCategory = (typeof SPECIAL_CATEGORIES)[number];

export const SPECIAL_CATEGORY_REPLACEMENT: Record<SpecialCategory, string> = {
  health: "[SAĞLIK]",
  religion_belief: "[DİN-İNANÇ]",
  ethnic_origin: "[ETNİK-KÖKEN]",
  political_opinion: "[SİYASİ-GÖRÜŞ]",
  union_membership: "[SENDİKA]",
  criminal_record: "[SABIKA]",
  sex_life: "[CİNSEL-HAYAT]",
  biometric: "[BİYOMETRİK]",
  genetic: "[GENETİK]",
};

/**
 * Terms, lower case (Turkish rules). A term matches at the start of a word and
 * takes the rest of its last word with it ("diyabet" masks "diyabetini"); a
 * term in double quotes matches the whole word only ("gey" but not
 * "geyik"). Words in a term may be split by spaces or hyphens.
 */
const TERMS: Record<SpecialCategory, string[]> = {
  health: [
    "kanser", "tümör", "lösemi", "lenfoma", "kemoterapi", "radyoterapi", "metastaz",
    "diyabet", "şeker hastası", "şeker hastalığı", "insülin", "hipertansiyon", "tansiyon hastası", "astım", "koah",
    "epilepsi", "sara hastası", "migren", "alzheimer", "demans", "parkinson", "multipl skleroz", "\"ms hastası\"",
    "şizofreni", "bipolar", "depresyon", "anksiyete bozukluğu", "panik atak", "panik bozukluk", "obsesif", "\"okb\"",
    "\"dehb\"", "hiperaktivite", "otizm", "\"hiv\"", "\"aids\"", "hepatit", "tüberküloz", "verem",
    "kalp krizi", "kalp yetmezliği", "enfarktüs", "bypass", "anjiyo", "inme geçir", "felç geçir",
    "böbrek yetmezliği", "diyaliz", "siroz", "organ nakli", "hamile", "gebelik", "düşük yap", "kürtaj",
    "antidepresan", "psikiyatri", "psikolojik tedavi", "alkol bağımlı", "madde bağımlı", "engel oranı", "engelli raporu",
    "görme engelli", "işitme engelli", "hiv pozitif",
    "cancer", "diabetes", "diabetic", "depression", "bipolar disorder", "epilepsy", "schizophrenia", "\"adhd\"",
    "autism", "dementia", "asthma", "chemotherapy", "pregnant", "heart attack", "stroke",
  ],
  religion_belief: [
    "alevi", "sünni", "\"şii\"", "caferi", "müslüman", "hristiyan", "hıristiyan", "yahudi", "musevi", "ortodoks", "katolik",
    "protestan", "süryani", "ezidi", "yezidi", "yehova şahidi", "budist", "hindu", "ateist", "deist", "agnostik", "dinsiz",
    "cemevi", "kiliseye gid", "sinagog", "namaz kıl", "oruç tut", "mezhebi", "dinini değiştir", "din değiştir", "tarikat",
    "muslim", "christian", "jewish", "catholic", "atheist", "\"kosher\"", "\"halal\"",
  ],
  ethnic_origin: [
    "kürt", "ermeni", "çerkez", "zaza", "çingene", "gürcü", "boşnak", "arnavut", "pomak", "abaza", "asuri", "keldani",
    "etnik kökeni", "ırkı", "ırkından", "siyahi", "\"kurdish\"", "\"armenian\"", "ethnic origin", "ethnicity",
  ],
  political_opinion: [
    "parti üyesi", "partisi üyesi", "partili", "partisinin", "il başkan", "ilçe başkan",
    "milletvekili adayı", "meclis üyeliğine aday", "belediye başkan adayı", "sosyalist", "komünist", "milliyetçi", "ülkücü",
    "faşist", "anarşist", "muhafazakâr", "muhafazakar", "solcu", "sağcı", "kemalist", "islamcı", "siyasi görüş",
    "görüşlü", "mitinge", "eyleme katıl", "oy verdi", "oy veriyor", "party member", "communist", "socialist", "votes for",
  ],
  union_membership: [
    "sendika", "sendikal", "sendikalı", "trade union", "union member", "union steward", "member of unite", "labour union",
  ],
  criminal_record: [
    "sabıka", "adli sicil", "mahkûm", "mahkum", "hüküm giy", "hükümlü", "hapis", "cezaevi", "tutuklu", "tutuklan",
    "gözaltına alın", "denetimli serbestlik", "şartlı tahliye", "suç kaydı", "hapse gir", "hapis yat",
    "criminal record", "conviction", "convicted", "prison", "jail", "probation",
  ],
  sex_life: [
    "eşcinsel", "\"gey\"", "\"gay\"", "lezbiyen", "lesbian", "biseksüel", "bisexual", "aseksüel", "asexual", "\"lgbt\"",
    "cinsel yönelim", "cinsel hayat", "cinsel ilişki", "evlilik dışı ilişki", "eşcinsel ilişki", "sexual orientation",
  ],
  biometric: [
    "parmak izi", "avuç içi", "damar izi", "yüz tanıma", "yüz geometri", "yüz şablonu", "retina", "\"iris\"", "ses izi",
    "biyometrik", "fingerprint", "voiceprint", "face template", "facial recognition", "biometric",
  ],
  genetic: [
    "genetik", "gen mutasyon", "mutasyon", "brca", "talasemi", "orak hücre", "kistik fibrozis", "huntington",
    "down sendrom", "\"sma\"", "dna testi", "\"dna\"", "genom", "apoe", "faktör v leiden", "kromozom",
    "genetic", "gene mutation", "\"genome\"",
  ],
};

/** "X kökenli", "X asıllı": an ethnic origin, whatever the word before it. */
const ORIGIN = /(?<![\p{L}\p{N}])\p{L}+\s+(?:kökenli|asıllı|asilli|kokenli)(?![\p{L}\p{N}])/gu;

/**
 * Words that put a person in the text. Role nouns take their case endings
 * ("hastanın", "çalışana") but not the plural: "hastanın" points at one
 * person, "hastaları" at a group (a guide, a statistic). Nor do the words
 * built on them: "hastalık" (illness), "hastane" (hospital). Short words that
 * start other words (bey → beyaz, ben → benzer) match whole, or before an
 * apostrophe ("Ahmet Bey'in").
 */
const ROLE_WORDS = [
  "hasta", "danışan", "müşteri", "çalışan", "personel", "başvurucu", "başvuran", "davacı", "davalı", "sanık", "şüpheli",
  "mağdur", "tanık", "tanığ", "sanığ", "öğrenci", "sigortalı", "işçi", "kiracı",
];
const WHOLE_WORDS = [
  "aday", "adayın", "veli", "eşi", "eşim", "eşinin", "kızı", "kızım", "oğlu", "oğlum", "annesi", "annem", "babası", "babam",
  "kardeşi", "kardeşim", "bay", "bayan", "hanım", "hanımın", "bey", "sayın", "kendisi", "kendisinin", "ben", "benim", "bana",
  "bende", "patient", "employee", "customer", "applicant", "candidate", "defendant", "plaintiff", "mr", "mrs", "ms", "he",
  "she", "his", "her", "my",
];

const LETTER = "[\\p{L}\\p{N}]";
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Turkish lower case turns the I of "HIV" or "DIABETES" into ı: every i in a term matches both. */
const dotless = (pattern: string) => pattern.replace(/i/g, "[iı]");
/** A case ending after an apostrophe: "Cemevi'ne", "HIV'li". */
const SUFFIX = "(?:['’]\\p{L}+)?";

const PERSON = new RegExp(
  `(?<!${LETTER})(?:(?:${ROLE_WORDS.map((word) => dotless(escape(word))).join("|")})(?!lar|ler|l[ıi][kğ]|ne)\\p{L}{0,6}|(?:${WHOLE_WORDS.map((word) => dotless(escape(word))).join("|")}))(?!${LETTER})`,
  "u",
);
/**
 * A first-person verb ("gelemiyorum", "gideceğim"): the speaker is the person.
 * Not the past tense: "-dım" is also the end of "astım" and "adım".
 */
const FIRST_PERSON = /\p{L}{2,}(?:[ıiuü]yorum|[ae]c[ae]ğ[ıi]m)(?![\p{L}\p{N}])/u;

function termPattern(terms: string[]): RegExp {
  const parts = terms.map((term) => {
    const exact = term.startsWith('"') && term.endsWith('"');
    const words = (exact ? term.slice(1, -1) : term).split(/\s+/).map((word) => dotless(escape(word)));
    return words.join("[\\s\\-]+") + (exact ? `(?!${LETTER})` : `${LETTER}*`) + SUFFIX;
  });
  // Longest first, so "kalp krizi" wins over a shorter term at the same place
  parts.sort((a, b) => b.length - a.length);
  return new RegExp(`(?<!${LETTER})(?:${parts.join("|")})`, "gu");
}

const PATTERNS: [SpecialCategory, RegExp][] = SPECIAL_CATEGORIES.map((category) => [category, termPattern(TERMS[category])]);

/**
 * A term is often the head of a longer phrase that says just as much: "metal
 * işçileri sendikası üyesi", "zimmet suçundan mahkûmiyeti", "BRCA1 gen
 * mutasyonu". The span grows over the words that complete it, so the mask does
 * not leave "metal işçileri [SENDİKA] üyesi" behind.
 */
const HEAD_AFTER = /^[\s\-]+(?:üye|temsilci|yönetici|delege|kayd|kayıt|mahk[uû]m|ceza|taşıyıcı|mutasyon|gen[iı]?(?![\p{L}])|varyant|şablon|veri|taraması|görüşlü|yardımcı|parti|ilçe|il(?![\p{L}])|işyeri|bozukluğ|bozukluk|enfeksiyon|sendrom|hastalığ|pozitif|ilişki|member|record)\p{L}*/u;
/** Categories whose terms take the words before them too ("belediye işçileri sendikası"). */
const GROWS_LEFT = new Set<SpecialCategory>(["health", "political_opinion", "union_membership", "criminal_record", "genetic"]);
const STOP = new Set([
  "ve", "ile", "bir", "bu", "şu", "o", "için", "gibi", "olarak", "olan", "olduğu", "olduğunu", "de", "da", "daha", "önce",
  "sonra", "iki", "üç", "kez", "çok", "en", "hem", "ya", "veya", "ki", "hakkında", "the", "a", "an", "of", "and", "is",
  "was", "has", "had", "for", "to", "with",
]);
const WORD_BEFORE = /(?:^|[\s\-])(\p{Ll}\p{L}{2,}|\p{N}+)[\s\-]+$/u;

function grow(text: string, lower: string, span: SpecialSpan): SpecialSpan {
  let { start, end } = span;
  // "sendikası işyeri temsilcisi", "parti il başkan yardımcısı": a few heads in a row
  for (let words = 0; words < 3; words++) {
    const after = HEAD_AFTER.exec(lower.slice(end));
    if (!after) break;
    end += after[0].length;
  }
  if (GROWS_LEFT.has(span.detector)) {
    for (let words = 0; words < 2; words++) {
      const before = WORD_BEFORE.exec(text.slice(Math.max(0, start - 40), start));
      if (!before || STOP.has(before[1]!.toLocaleLowerCase("tr")) || PERSON.test(before[1]!.toLocaleLowerCase("tr"))) break;
      start -= before[0].length - before[0].indexOf(before[1]!);
    }
  }
  return { ...span, start, end };
}

export interface SpecialSpan {
  start: number;
  end: number;
  detector: SpecialCategory;
}

/**
 * Special-category terms in `text`, whether or not it is about a person
 * (see `mentionsPerson`). Offsets are into `text`; overlapping finds keep the
 * first and longest.
 */
export function findSpecialTerms(text: string, runs: (category: SpecialCategory) => boolean): SpecialSpan[] {
  // Turkish lower case keeps every offset: İ → i and I → ı are one character each
  const lower = text.toLocaleLowerCase("tr");
  if (lower.length !== text.length) return [];
  const found: SpecialSpan[] = [];
  if (runs("ethnic_origin")) {
    for (const m of lower.matchAll(ORIGIN)) found.push({ start: m.index, end: m.index + m[0].length, detector: "ethnic_origin" });
  }
  for (const [category, pattern] of PATTERNS) {
    if (!runs(category)) continue;
    for (const m of lower.matchAll(pattern)) found.push({ start: m.index, end: m.index + m[0].length, detector: category });
  }
  const grown = found.map((span) => grow(text, lower, span));
  grown.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: SpecialSpan[] = [];
  for (const span of grown) {
    const last = kept.at(-1);
    if (!last || span.start >= last.end) kept.push(span);
    // Two finds of one category that grew into each other are one phrase ("DNA testi … Down sendromu")
    else if (span.detector === last.detector) last.end = Math.max(last.end, span.end);
  }
  return kept;
}

/** A word in `text` that points at a person (the context rule's last resort, after names and identifiers). */
export function mentionsPerson(text: string): boolean {
  const lower = text.toLocaleLowerCase("tr");
  return PERSON.test(lower) || FIRST_PERSON.test(lower);
}
