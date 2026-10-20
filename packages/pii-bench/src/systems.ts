import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { SPECIAL_CATEGORIES, maskPiiInText, type ModelDetector, type ModelSpan, type SpanLookup } from "@guardbee/guard-core";

/** One span a system flags; `category` is its own name for it (guard-core's detector name). */
export interface Detection {
  start: number;
  end: number;
  category: string;
}

/** A detector under test. Add a system (NER, Presidio, an LLM prompt) by implementing this. */
export interface System {
  name: string;
  description: string;
  detect(text: string): Detection[] | Promise<Detection[]>;
}

const OPEN = "\uE000";
const CLOSE = "\uE001";
const MARK = /\uE000([\uE100-\uF8FF])\uE001/g;

/**
 * guard-core masks text rather than reporting spans. The replacer swaps each
 * match for a private-use marker, and walking the output back against the
 * matches recovers where each one was. A match a later pattern swallowed
 * (it holds a marker) is expanded, and the swallowed one kept as its own span.
 */
export function guardCoreSpans(text: string, spans?: SpanLookup, include?: ReadonlySet<string>): Detection[] {
  const found: { name: string; match: string }[] = [];
  const masked = maskPiiInText(
    text,
    (name, match) => {
      found.push({ name, match });
      return OPEN + String.fromCharCode(0xe100 + found.length - 1) + CLOSE;
    },
    include,
    undefined,
    spans,
  );

  const detections: Detection[] = [];
  const walk = (value: string, base: number): string => {
    let original = "";
    let cursor = 0;
    for (const marker of value.matchAll(MARK)) {
      original += value.slice(cursor, marker.index);
      cursor = marker.index + marker[0].length;
      const { name, match } = found[marker[1]!.charCodeAt(0) - 0xe100]!;
      const start = base + original.length;
      const inner = walk(match, start);
      detections.push({ start, end: start + inner.length, category: name });
      original += inner;
    }
    return original + value.slice(cursor);
  };
  // A text that needed Unicode normalization hands the replacer the normalized match
  if (walk(masked, 0) !== text) throw new Error("could not map guard-core matches back onto the text");
  return detections.sort((a, b) => a.start - b.start);
}

/**
 * guard-core's masking with a model's spans: the same path the proxy takes,
 * so a model-found name inside an e-mail address is left to the regex.
 */
export function withModel(name: string, description: string, load: () => Promise<ModelDetector>, include?: ReadonlySet<string>): System {
  let model: Promise<ModelDetector> | undefined;
  return {
    name,
    description,
    async detect(text) {
      const [found] = await (await (model ??= load())).detect([text]);
      return guardCoreSpans(text, () => found as ModelSpan[], include);
    },
  };
}

/**
 * Any token-classification model exported to ONNX (`optimum-cli export onnx
 * --task token-classification`): a directory with config.json, tokenizer.json,
 * tokenizer_config.json and model.onnx (or onnx/model.onnx). PER and PERSON
 * entities count as person_name. This is how the candidates were compared.
 */
export function onnxNerSystem(dir: string): System {
  const onnx = ["model_quantized.onnx", "model.onnx", "onnx/model_quantized.onnx", "onnx/model.onnx"].find((path) => existsSync(join(dir, path)));
  if (!onnx) throw new Error(`no model.onnx in ${dir}`);
  const name = `guard-core+${dir.split("/").filter(Boolean).at(-1)}`;
  return withModel(name, `guard-core regex + NER model in ${name.slice(11)} (${onnx}, ${(statSync(join(dir, onnx)).size / 1e6).toFixed(0)} MB)`, async () => {
    const { NerModel } = await import("@guardbee/ner");
    return NerModel.load({
      dir,
      skipVerify: true,
      spec: { repo: dir, revision: "local", files: [{ path: onnx, sha256: "", size: 0 }], types: { PER: "person_name", PERSON: "person_name" } },
    });
  });
}

/** The KVKK Art. 6 detectors, which are opt-in: on top of the defaults. */
const SPECIAL = new Set<string>(SPECIAL_CATEGORIES);
const loadDefaultModel = async () => {
  const { NerModel } = await import("@guardbee/ner");
  return NerModel.load();
};

export const SYSTEMS: Record<string, () => System> = {
  "guard-core-regex": () => ({
    name: "guard-core-regex",
    description: "@guardbee/guard-core maskPiiInText, default detectors (regex + checksum validation)",
    detect: (text) => guardCoreSpans(text),
  }),
  // The default model, from GUARDBEE_NER_CACHE or ~/.cache/guardbee/ner (`guardbee-ner download`)
  "guard-core+ner": () =>
    withModel("guard-core+ner", "@guardbee/guard-core regex + @guardbee/ner default model (akdeniz27/bert-base-turkish-cased-ner, int8)", loadDefaultModel),
  "guard-core+special": () => ({
    name: "guard-core+special",
    description: "@guardbee/guard-core default detectors + the KVKK Art. 6 term lists (context: identifiers and person words, no names)",
    detect: (text) => guardCoreSpans(text, undefined, SPECIAL),
  }),
  "guard-core+ner+special": () =>
    withModel(
      "guard-core+ner+special",
      "@guardbee/guard-core default detectors + @guardbee/ner default model + the KVKK Art. 6 term lists (preset KVKK_SENSITIVE's detectors)",
      loadDefaultModel,
      SPECIAL,
    ),
};
