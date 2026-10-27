import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelDetector, ModelSpan } from "@guardbee/guard-core";
import { Tokenizer } from "@huggingface/tokenizers";
import * as ort from "onnxruntime-node";
import { alignTokens, decodeEntities, windows } from "./decode.js";
import { DEFAULT_MODEL, defaultModelDir, verifyModel, type ModelSpec } from "./model-files.js";

export interface NerOptions {
  /** A directory holding the model's files (see `downloadModel`); defaults to the cache directory. */
  dir?: string;
  spec?: ModelSpec;
  /** Skip the hash check on load (it reads ~185 MB once). Default false. */
  skipVerify?: boolean;
  /** Tokens per window, special tokens included; BERT's limit is 512. */
  windowTokens?: number;
  /** Tokens two neighbouring windows share. */
  overlapTokens?: number;
  /** onnxruntime threads for one inference; default lets onnxruntime decide. */
  threads?: number;
}

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

/** A loaded NER model: finds person names in text, offline, in this process. */
export class NerModel implements ModelDetector {
  private constructor(
    private readonly session: ort.InferenceSession,
    private readonly tokenizer: Tokenizer,
    private readonly labels: string[],
    private readonly spec: ModelSpec,
    private readonly windowTokens: number,
    private readonly overlapTokens: number,
  ) {}

  /** Load from `dir` (default: the cache directory). Throws when a file is missing or altered. */
  static async load(options: NerOptions = {}): Promise<NerModel> {
    const spec = options.spec ?? DEFAULT_MODEL;
    const dir = options.dir ?? defaultModelDir(spec);
    if (!options.skipVerify) {
      const bad = await verifyModel(dir, spec);
      if (bad.length > 0) throw new Error(`NER model in ${dir} is missing or altered: ${bad.join(", ")} (run \`guardbee-ner download\`)`);
    }
    const onnx = spec.files.find((file) => file.path.endsWith(".onnx"))!;
    const session = await ort.InferenceSession.create(join(dir, onnx.path), {
      graphOptimizationLevel: "all",
      ...(options.threads ? { intraOpNumThreads: options.threads } : {}),
    });
    const tokenizer = new Tokenizer(readJson(join(dir, "tokenizer.json")), readJson(join(dir, "tokenizer_config.json")));
    const id2label = readJson(join(dir, "config.json"))["id2label"] as Record<string, string>;
    const labels = Object.keys(id2label)
      .sort((a, b) => Number(a) - Number(b))
      .map((id) => id2label[id]!);
    return new NerModel(session, tokenizer, labels, spec, options.windowTokens ?? 512, options.overlapTokens ?? 128);
  }

  async detect(texts: readonly string[]): Promise<ModelSpan[][]> {
    const results: ModelSpan[][] = [];
    for (const text of texts) results.push(await this.detectOne(text));
    return results;
  }

  private async detectOne(text: string): Promise<ModelSpan[]> {
    if (!/\p{L}/u.test(text)) return [];
    const encoding = this.tokenizer.encode(text, { add_special_tokens: false });
    const ids = encoding.ids;
    const labels: string[] = new Array(ids.length).fill("O");
    const cls = this.tokenizer.token_to_id("[CLS]") ?? this.tokenizer.token_to_id("<s>")!;
    const sep = this.tokenizer.token_to_id("[SEP]") ?? this.tokenizer.token_to_id("</s>")!;
    for (const window of windows(ids.length, this.windowTokens - 2, this.overlapTokens)) {
      const input = [cls, ...ids.slice(window.start, window.end), sep];
      const predicted = await this.run(input);
      // predicted[0] is [CLS]
      for (let i = window.ownStart; i < window.ownEnd; i++) labels[i] = predicted[i - window.start + 1]!;
    }
    return decodeEntities(text, alignTokens(text, encoding.tokens), labels, this.spec.types);
  }

  /** One window through the model: the label of each token (argmax). */
  private async run(ids: number[]): Promise<string[]> {
    const shape = [1, ids.length];
    const tensor = (values: number[]) => new ort.Tensor("int64", BigInt64Array.from(values, BigInt), shape);
    const feeds: Record<string, ort.Tensor> = {};
    for (const name of this.session.inputNames) {
      if (name === "input_ids") feeds[name] = tensor(ids);
      else if (name === "attention_mask") feeds[name] = tensor(ids.map(() => 1));
      else if (name === "token_type_ids") feeds[name] = tensor(ids.map(() => 0));
    }
    const output = (await this.session.run(feeds))[this.session.outputNames[0]!]!;
    const logits = output.data as Float32Array;
    const classes = output.dims[2]!;
    const result: string[] = [];
    for (let t = 0; t < ids.length; t++) {
      let best = 0;
      for (let c = 1; c < classes; c++) if (logits[t * classes + c]! > logits[t * classes + best]!) best = c;
      result.push(this.labels[best] ?? "O");
    }
    return result;
  }
}
