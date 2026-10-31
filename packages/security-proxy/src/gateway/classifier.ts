import { combineWithClassifier, stringsIn, type InjectionClassifier, type ScanResult } from "@guardbee/guard-core";
import type { AuditEvent } from "../types.js";

/**
 * The optional prompt-injection classifier (`classifier:` in the gateway
 * config): `@guardbee/injection-model` in this process, or its sidecar. It is
 * the fast first pass after the rules: a rule's block stands; a high score
 * adds a block (or a warning in warn mode), a middling one a warning. What is
 * still a warning afterwards can go to the LLM judge as before. Off unless
 * configured; it never calls the network except a configured sidecar.
 */
export type GatewayClassifierConfig = ({ url: string; token?: string } | { modelDir?: string }) & {
  timeoutMs: number;
  /** A classifier that fails or misses timeoutMs: keep the rules' decision (open) or block (closed). */
  onError: "open" | "closed";
  warnAt: number;
  blockAt: number;
  /** Where it runs: tool arguments, tool results, resources, LLM gateway prompts. */
  apply: ("arguments" | "results" | "resources" | "llm")[];
};

export class ClassifierError extends Error {
  override name = "ClassifierError";
}

interface ModelModule {
  InjectionModel: { load(options: { dir?: string }): Promise<InjectionClassifier> };
}

class SidecarClassifier implements InjectionClassifier {
  model = "sidecar";
  constructor(private readonly config: { url: string; token?: string; timeoutMs: number }) {}

  async classify(texts: readonly string[]): Promise<number[]> {
    let response: Response;
    try {
      response = await fetch(new URL("/v1/classify", this.config.url), {
        method: "POST",
        headers: { "content-type": "application/json", ...(this.config.token ? { authorization: `Bearer ${this.config.token}` } : {}) },
        body: JSON.stringify({ texts }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === "TimeoutError";
      throw new ClassifierError(timedOut ? `the classifier sidecar did not answer in ${this.config.timeoutMs} ms` : `the classifier sidecar is unreachable (${err instanceof Error ? err.name : typeof err})`);
    }
    if (!response.ok) throw new ClassifierError(`the classifier sidecar answered HTTP ${response.status}`);
    const body = (await response.json().catch(() => null)) as { scores?: unknown; model?: unknown } | null;
    const scores = body?.scores;
    if (!Array.isArray(scores) || scores.length !== texts.length || !scores.every((s) => typeof s === "number" && s >= 0 && s <= 1)) {
      throw new ClassifierError("the classifier sidecar sent an answer in the wrong shape");
    }
    if (typeof body?.model === "string") this.model = body.model;
    return scores as number[];
  }
}

class LocalClassifier implements InjectionClassifier {
  model = "@guardbee/injection-model";
  private loaded?: Promise<InjectionClassifier>;
  constructor(private readonly dir: string | undefined) {}

  async classify(texts: readonly string[]): Promise<number[]> {
    this.loaded ??= this.load();
    // A failed load is tried again on the next call, not remembered
    const model = await this.loaded.catch((err: unknown) => {
      this.loaded = undefined;
      throw err;
    });
    this.model = model.model;
    try {
      return await model.classify(texts);
    } catch (err) {
      throw new ClassifierError(`the injection model failed (${err instanceof Error ? err.name : typeof err})`);
    }
  }

  private async load(): Promise<InjectionClassifier> {
    let mod: ModelModule;
    try {
      mod = (await import("@guardbee/injection-model" as string)) as ModelModule;
    } catch {
      throw new ClassifierError("classifier: needs @guardbee/injection-model installed next to the proxy (or classifier.url for a sidecar)");
    }
    try {
      return await mod.InjectionModel.load(this.dir ? { dir: this.dir } : {});
    } catch (err) {
      throw new ClassifierError(`the injection model did not load: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

const classifiers = new WeakMap<GatewayClassifierConfig, InjectionClassifier>();

/** One classifier (one loaded model) per config, shared by every session. */
export function classifierFor(config: GatewayClassifierConfig | undefined, where: GatewayClassifierConfig["apply"][number]): InjectionClassifier | undefined {
  if (!config || !config.apply.includes(where)) return undefined;
  let classifier = classifiers.get(config);
  if (!classifier) {
    classifier = "url" in config ? new SidecarClassifier(config) : new LocalClassifier(config.modelDir);
    classifiers.set(config, classifier);
  }
  return classifier;
}

export interface Classified {
  scan: ScanResult;
  audit?: NonNullable<AuditEvent["classifier"]>;
}

/** Score the text in `value` and combine it with the rules' result. Never called for a rule's block. */
export async function classifyInjection(config: GatewayClassifierConfig, classifier: InjectionClassifier, value: unknown, rules: ScanResult, mode: "block" | "warn"): Promise<Classified> {
  if (rules.action === "block") return { scan: rules };
  const text = stringsIn(value).join("\n").trim();
  if (!text) return { scan: rules };
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    const [score] = await Promise.race([
      classifier.classify([text]),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ClassifierError(`the classifier did not answer in ${config.timeoutMs} ms`)), config.timeoutMs);
      }),
    ]);
    const latencyMs = Math.round(performance.now() - started);
    const scan = combineWithClassifier(rules, score!, config, mode, classifier.model);
    return { scan, audit: { model: classifier.model, score: Number(score!.toFixed(4)), latencyMs } };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const audit = { model: classifier.model, latencyMs: Math.round(performance.now() - started), error };
    if (config.onError === "closed") return { scan: { action: "block", reason: `Prompt injection classifier unavailable (onError: closed): ${error}` }, audit };
    return { scan: rules, audit };
  } finally {
    clearTimeout(timer);
  }
}
