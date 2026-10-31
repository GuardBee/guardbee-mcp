import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { InjectionClassifier } from "@guardbee/guard-core";
import { Tokenizer } from "@huggingface/tokenizers";
import * as ort from "onnxruntime-node";
import { DEFAULT_MODEL, defaultModelDir, verifyModel, type ModelSpec } from "./model-files.js";

export interface InjectionModelOptions {
  /** A directory holding the model's files (see `downloadModel`); defaults to the cache directory. */
  dir?: string;
  spec?: ModelSpec;
  /** Skip the hash check on load. Default false. */
  skipVerify?: boolean;
  /** Tokens per window, special tokens included (the model was trained on 256). */
  windowTokens?: number;
  /** Tokens two neighbouring windows share. */
  overlapTokens?: number;
  /** Longest text scored, in tokens; the rest is not looked at (a long document's injection is usually near its start or end, so the last window is always scored). */
  maxTokens?: number;
  threads?: number;
}

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

/** Window starts over `length` tokens: overlapping, and the last window always ends at the end. */
export function windowStarts(length: number, size: number, overlap: number, maxTokens: number): number[] {
  if (length <= size) return [0];
  const step = Math.max(1, size - overlap);
  const starts: number[] = [];
  for (let s = 0; s + size < length && s < maxTokens; s += step) starts.push(s);
  const last = length - size;
  if (starts[starts.length - 1] !== last) starts.push(last);
  return starts;
}

/** The classifier, offline, in this process: P(injection) per text, the highest over its windows. */
export class InjectionModel implements InjectionClassifier {
  private constructor(
    private readonly session: ort.InferenceSession,
    private readonly tokenizer: Tokenizer,
    private readonly cls: number,
    private readonly sep: number,
    private readonly injectionIndex: number,
    readonly model: string,
    private readonly options: Required<Pick<InjectionModelOptions, "windowTokens" | "overlapTokens" | "maxTokens">>,
  ) {}

  /** Load from `dir` (default: the cache directory). Throws when a file is missing or altered. */
  static async load(options: InjectionModelOptions = {}): Promise<InjectionModel> {
    const spec = options.spec ?? DEFAULT_MODEL;
    const dir = options.dir ?? defaultModelDir(spec);
    if (!options.skipVerify) {
      const bad = await verifyModel(dir, spec);
      if (bad.length > 0) throw new Error(`injection model in ${dir} is missing or altered: ${bad.join(", ")} (run \`guardbee-injection-model download\`)`);
    }
    const onnx = spec.files.find((file) => file.path.endsWith(".onnx"))!;
    const session = await ort.InferenceSession.create(join(dir, onnx.path), {
      graphOptimizationLevel: "all",
      ...(options.threads ? { intraOpNumThreads: options.threads } : {}),
    });
    const tokenizer = new Tokenizer(readJson(join(dir, "tokenizer.json")), readJson(join(dir, "tokenizer_config.json")));
    const id2label = readJson(join(dir, "config.json"))["id2label"] as Record<string, string>;
    const injectionIndex = Number(Object.keys(id2label).find((id) => id2label[id] === "INJECTION") ?? 1);
    const cls = tokenizer.token_to_id("[CLS]") ?? tokenizer.token_to_id("<s>")!;
    const sep = tokenizer.token_to_id("[SEP]") ?? tokenizer.token_to_id("</s>")!;
    return new InjectionModel(session, tokenizer, cls, sep, injectionIndex, spec.id, {
      windowTokens: options.windowTokens ?? 256,
      overlapTokens: options.overlapTokens ?? 64,
      maxTokens: options.maxTokens ?? 8192,
    });
  }

  async classify(texts: readonly string[]): Promise<number[]> {
    const scores: number[] = [];
    for (const text of texts) scores.push(await this.scoreOne(text));
    return scores;
  }

  private async scoreOne(text: string): Promise<number> {
    if (!/\p{L}/u.test(text)) return 0;
    const ids = this.tokenizer.encode(text, { add_special_tokens: false }).ids;
    const size = this.options.windowTokens - 2;
    let best = 0;
    for (const start of windowStarts(ids.length, size, this.options.overlapTokens, this.options.maxTokens)) {
      best = Math.max(best, await this.run([this.cls, ...ids.slice(start, start + size), this.sep]));
      if (best >= 0.99) break;
    }
    return best;
  }

  private async run(ids: number[]): Promise<number> {
    const shape = [1, ids.length];
    const tensor = (values: number[]) => new ort.Tensor("int64", BigInt64Array.from(values, BigInt), shape);
    const feeds: Record<string, ort.Tensor> = {};
    for (const name of this.session.inputNames) {
      if (name === "input_ids") feeds[name] = tensor(ids);
      else if (name === "attention_mask") feeds[name] = tensor(ids.map(() => 1));
      else if (name === "token_type_ids") feeds[name] = tensor(ids.map(() => 0));
    }
    const logits = (await this.session.run(feeds))[this.session.outputNames[0]!]!.data as Float32Array;
    const max = Math.max(logits[0]!, logits[1]!);
    const e0 = Math.exp(logits[0]! - max);
    const e1 = Math.exp(logits[1]! - max);
    return (this.injectionIndex === 1 ? e1 : e0) / (e0 + e1);
  }

  async close(): Promise<void> {
    await this.session.release();
  }
}
