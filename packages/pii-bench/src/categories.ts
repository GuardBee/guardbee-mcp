/**
 * The label set. Identifier categories use guard-core's detector names, so a
 * detection and a label compare by name; `person_name` and the KVKK Art. 6
 * special categories have no regex detector yet (#126).
 */

export const IDENTIFIER_CATEGORIES = [
  "tc_kimlik",
  "vkn",
  "iban",
  "credit_card",
  "email",
  "kep",
  "phone_tr",
  "passport",
  "sgk_no",
  "mersis",
  "birth_date",
  "address",
] as const;

/** KVKK Art. 6 special categories, labeled only when tied to an identifiable person. */
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

export const CATEGORIES = [...IDENTIFIER_CATEGORIES, "person_name", ...SPECIAL_CATEGORIES] as const;

export type Category = (typeof CATEGORIES)[number];

export const isCategory = (name: string): name is Category => (CATEGORIES as readonly string[]).includes(name);

export type Domain = "support" | "hr" | "legal" | "chat";

export interface Span {
  start: number;
  end: number;
  category: Category;
}

export interface Doc {
  id: string;
  domain: Domain;
  /** `pii`: labeled personal data; `clean`: none, for the false-alarm rate. */
  set: "pii" | "clean";
  text: string;
  spans: Span[];
}
