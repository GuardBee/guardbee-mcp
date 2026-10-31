import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { combineWithClassifier, DEFAULT_CLASSIFIER_THRESHOLDS, Judge, judgeFromEnv, scanForPromptInjection } from "@guardbee/guard-core";
import type { Lang, Sample } from "./data.js";

/** A detector under test: flags a text as an injection/jailbreak attempt or not. */
export interface System {
  name: string;
  version: string;
  /** Settings that reproduce the numbers (thresholds, modes, model and revision). */
  settings: string;
  detect: (text: string, lang: Lang) => boolean | Promise<boolean>;
  /** Called once after a run (to free a model). */
  close?: () => Promise<void>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const coreVersion = () => `guard-core ${JSON.parse(fs.readFileSync(path.join(here, "..", "..", "guard-core", "package.json"), "utf8")).version as string}`;

/** What the proxy refuses: a precise rule matched (scanForPromptInjection in block mode). */
export function guardbeeBlock(): System {
  return {
    name: "GuardBee rules (block)",
    version: coreVersion(),
    settings: "scanForPromptInjection(text, 'block').action === 'block': only the precise rules; what the proxy refuses",
    detect: (text) => scanForPromptInjection(text, "block").action === "block",
  };
}

/** Everything the rules report, including the generic phrases that only warn. */
export function guardbeeBlockOrWarn(): System {
  return {
    name: "GuardBee rules (block or warn)",
    version: coreVersion(),
    settings: "scanForPromptInjection(text, 'block').action !== 'allow': precise rules and the generic phrases that only warn",
    detect: (text) => scanForPromptInjection(text, "block").action !== "allow",
  };
}

/** Rules (block or warn) plus the local LLM judge (GUARDBEE_JUDGE_URL / GUARDBEE_JUDGE_MODEL). */
export function guardbeeWithJudge(): System | undefined {
  const config = judgeFromEnv();
  if (!config) return undefined;
  const judge = new Judge({ ...config, cacheSize: 0 });
  const rules = guardbeeBlockOrWarn();
  return {
    name: `GuardBee rules + judge (${config.model})`,
    version: `${coreVersion()}, ${config.model}`,
    settings: `rules (block or warn) OR judge verdict malicious at confidence >= 0.7 (local ${config.endpoint})`,
    detect: async (text, lang) => {
      if (await rules.detect(text, lang)) return true;
      try {
        const v = await judge.classifyInjection(text, { where: "user message to an AI assistant" });
        return v.verdict === "malicious" && v.confidence >= 0.7;
      } catch {
        return false;
      }
    },
  };
}

/**
 * protectai/deberta-v3-base-prompt-injection-v2 (Apache-2.0), the ONNX export from its repository,
 * run with onnxruntime on CPU. INJECTION_BENCH_PROTECTAI = a directory with model.onnx and tokenizer.json
 * from revision 90c9989b1a342275dd0d1a95aad283c04e075671.
 */
export async function protectAi(): Promise<System | undefined> {
  const dir = process.env["INJECTION_BENCH_PROTECTAI"];
  if (!dir) return undefined;
  const ort = await import("onnxruntime-node");
  const { Tokenizer } = await import("@huggingface/tokenizers");
  const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const tokenizer = new Tokenizer(read("tokenizer.json"), read("tokenizer_config.json"));
  const session = await ort.InferenceSession.create(path.join(dir, "model.onnx"), { executionProviders: ["cpu"] });
  const cls = tokenizer.token_to_id("[CLS]")!;
  const sep = tokenizer.token_to_id("[SEP]")!;
  return {
    name: "ProtectAI DeBERTa-v3 prompt-injection v2",
    version: "90c9989 (ONNX)",
    settings: "softmax P(INJECTION) >= 0.5 on the first 512 tokens (the model card's pipeline truncation); onnxruntime-node CPU",
    detect: async (text) => {
      const ids = [cls, ...tokenizer.encode(text, { add_special_tokens: false }).ids.slice(0, 510), sep];
      const tensor = (values: number[]) => new ort.Tensor("int64", BigInt64Array.from(values, BigInt), [1, values.length]);
      const feeds: Record<string, InstanceType<typeof ort.Tensor>> = {};
      for (const name of session.inputNames) {
        if (name === "input_ids") feeds[name] = tensor(ids);
        else if (name === "attention_mask") feeds[name] = tensor(ids.map(() => 1));
        else if (name === "token_type_ids") feeds[name] = tensor(ids.map(() => 0));
      }
      const logits = (await session.run(feeds))[session.outputNames[0]!]!.data as Float32Array;
      const [safe, injection] = [logits[0]!, logits[1]!];
      return 1 / (1 + Math.exp(safe - injection)) >= 0.5;
    },
    close: () => session.release(),
  };
}

/**
 * GuardBee with its classifier (@guardbee/injection-model), as the proxy runs it with the default thresholds:
 * a rule's block, or a score >= blockAt, blocks. INJECTION_BENCH_CLASSIFIER = the model directory.
 * Returns two systems: what the proxy blocks, and everything it blocks or warns about.
 */
export async function guardbeeClassifier(): Promise<System[]> {
  const dir = process.env["INJECTION_BENCH_CLASSIFIER"];
  if (!dir) return [];
  const { InjectionModel } = (await import("@guardbee/injection-model" as string)) as {
    InjectionModel: { load(o: { dir: string }): Promise<{ model: string; classify(t: string[]): Promise<number[]>; close(): Promise<void> }> };
  };
  const model = await InjectionModel.load({ dir });
  const t = DEFAULT_CLASSIFIER_THRESHOLDS;
  const decide = async (text: string) => combineWithClassifier(scanForPromptInjection(text, "block"), (await model.classify([text]))[0]!, t, "block", model.model);
  let open = 2;
  const close = async () => {
    if (--open === 0) await model.close();
  };
  return [
    {
      name: "GuardBee rules + classifier (block)",
      version: `${coreVersion()}, ${model.model}`,
      settings: `rule block OR P(injection) >= ${t.blockAt}: what the proxy refuses with classifier: {} (defaults)`,
      detect: async (text) => (await decide(text)).action === "block",
      close,
    },
    {
      name: "GuardBee rules + classifier (block or warn)",
      version: `${coreVersion()}, ${model.model}`,
      settings: `anything the rules flag OR P(injection) >= ${t.warnAt}`,
      detect: async (text) => (await decide(text)).action !== "allow",
      close,
    },
  ];
}

export async function allSystems(): Promise<System[]> {
  return [guardbeeBlock(), guardbeeBlockOrWarn(), ...(await guardbeeClassifier()), guardbeeWithJudge(), await protectAi()].filter((s): s is System => !!s);
}

export type { Sample };
