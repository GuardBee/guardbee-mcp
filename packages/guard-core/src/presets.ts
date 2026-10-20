import { z } from "zod";
import { MODEL_PII, PERSONAL_DATA_CATEGORIES, PII_PATTERNS } from "./pii.js";
import { SPECIAL_CATEGORIES } from "./special.js";

/**
 * Which detectors mask: a named preset, then `enable` / `disable` by detector
 * name. Opt-in detectors (ip_address, mac_address, plate_tr, and the KVKK
 * Art. 6 special categories) are in no preset but KVKK_SENSITIVE; turn them
 * on with `enable`.
 */
export interface PiiSelection {
  preset?: PiiPresetName;
  enable?: readonly string[];
  disable?: readonly string[];
}

/**
 * Every detector name `maskPiiInText` knows: the regex ones, the model ones
 * (which need a `SpanLookup`), and the KVKK Art. 6 special categories.
 */
export const PII_DETECTORS: readonly string[] = [...new Set([...PII_PATTERNS.map((p) => p.name), ...MODEL_PII, ...SPECIAL_CATEGORIES])];

const OPT_IN = new Set<string>([...PII_PATTERNS.filter((p) => p.optIn).map((p) => p.name), ...SPECIAL_CATEGORIES]);
const PERSONAL = new Set<string>([...PERSONAL_DATA_CATEGORIES, ...MODEL_PII, ...SPECIAL_CATEGORIES]);
const defaults = (names: Iterable<string>) => [...names].filter((name) => !OPT_IN.has(name));

export const PII_PRESETS = {
  /** Every detector that runs by default (the behaviour without a selection). */
  ALL: defaults(PII_DETECTORS),
  /** Personal data under KVKK / GDPR; no credentials. */
  KVKK: defaults([...PERSONAL_DATA_CATEGORIES, ...MODEL_PII]),
  /** KVKK plus the Art. 6 special categories (health, religion, ethnic origin, …), found when the text is about a person. */
  KVKK_SENSITIVE: [...defaults([...PERSONAL_DATA_CATEGORIES, ...MODEL_PII]), ...SPECIAL_CATEGORIES],
  /** Who someone is and where they live. */
  IDENTITY: ["person_name", "address", "birth_date"],
  /** Numbers and handles that point at one person or account. */
  IDENTIFIERS: ["tc_kimlik", "vkn", "mersis", "sgk_no", "passport", "iban", "credit_card", "phone_tr", "kep", "email"],
  /** Keys, tokens, private keys and connection strings: not personal data. */
  SECRETS: defaults(PII_DETECTORS.filter((name) => !PERSONAL.has(name))),
} as const satisfies Record<string, readonly string[]>;

export type PiiPresetName = keyof typeof PII_PRESETS;
export const PII_PRESET_NAMES = Object.keys(PII_PRESETS) as PiiPresetName[];

/**
 * The resolved set of detectors that mask. Passed as `include` to
 * `maskPiiInText` / `maskPiiInValue`, it runs exactly these detectors,
 * opt-in ones included, where a plain set only adds opt-in detectors.
 */
export class PiiScope extends Set<string> {
  readonly exact = true;
}

/** Problems with a selection: an unknown preset or detector name. Empty when it is valid. */
export function piiSelectionErrors(selection: PiiSelection): string[] {
  const errors: string[] = [];
  if (selection.preset !== undefined && !(selection.preset in PII_PRESETS)) {
    errors.push(`unknown PII preset "${selection.preset}" (one of ${PII_PRESET_NAMES.join(", ")})`);
  }
  for (const key of ["enable", "disable"] as const) {
    for (const name of selection[key] ?? []) {
      if (!PII_DETECTORS.includes(name)) errors.push(`${key}: unknown PII detector "${name}"`);
    }
  }
  return errors;
}

/** The detectors a selection masks; throws on an unknown preset or detector name. */
export function piiScope(selection: PiiSelection = {}): PiiScope {
  const errors = piiSelectionErrors(selection);
  if (errors.length > 0) throw new Error(errors.join("; "));
  const scope = new PiiScope(PII_PRESETS[selection.preset ?? "ALL"]);
  for (const name of selection.enable ?? []) scope.add(name);
  for (const name of selection.disable ?? []) scope.delete(name);
  return scope;
}

/** The fields of a selection, for config objects that hold one next to other settings. */
export const piiSelectionShape = {
  preset: z.enum(PII_PRESET_NAMES as [PiiPresetName, ...PiiPresetName[]]).optional(),
  enable: z.array(z.string().min(1)).optional(),
  disable: z.array(z.string().min(1)).optional(),
};

/** Report every unknown detector name in `enable` / `disable` at its path. */
export function checkPiiDetectorNames(selection: PiiSelection, ctx: z.RefinementCtx, path: (string | number)[] = []): void {
  for (const key of ["enable", "disable"] as const) {
    for (const [index, name] of (selection[key] ?? []).entries()) {
      if (!PII_DETECTORS.includes(name)) ctx.addIssue({ code: "custom", path: [...path, key, index], message: `unknown PII detector "${name}"` });
    }
  }
}

/** `{ preset, enable, disable }` in a config file; unknown names fail validation. */
export const piiSelectionSchema = z
  .object(piiSelectionShape)
  .strict()
  .superRefine((selection, ctx) => checkPiiDetectorNames(selection, ctx));
