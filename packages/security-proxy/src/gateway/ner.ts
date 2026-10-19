import type { ModelDetector, ModelSpan, SpanLookup } from "@guardbee/guard-core";

/**
 * Where person names are found (`ner:` in the gateway config): the
 * `guardbee-ner serve` sidecar, or `@guardbee/ner` loaded into this process.
 * Without it the `person_name` detector finds nothing.
 */
export type NerConfig =
  | { url: string; token?: string; timeoutMs: number }
  | { modelDir?: string; timeoutMs: number };

/** Name detection did not finish. The message never holds the texts. */
export class NerError extends Error {
  override name = "NerError";
}

/** What this file needs from @guardbee/ner; it is an optional install, not a dependency. */
interface NerModule {
  NerModel: { load(options: { dir?: string }): Promise<ModelDetector> };
}

/** Texts per sidecar request stay well under its 8 MB body limit. */
const MAX_BATCH_CHARS = 1_000_000;

class SidecarDetector implements ModelDetector {
  constructor(private readonly config: { url: string; token?: string; timeoutMs: number }) {}

  async detect(texts: readonly string[]): Promise<ModelSpan[][]> {
    const spans: ModelSpan[][] = [];
    for (const batch of batches(texts)) spans.push(...(await this.request(batch)));
    return spans;
  }

  private async request(texts: readonly string[]): Promise<ModelSpan[][]> {
    let response: Response;
    try {
      response = await fetch(new URL("/v1/detect", this.config.url), {
        method: "POST",
        headers: { "content-type": "application/json", ...(this.config.token ? { authorization: `Bearer ${this.config.token}` } : {}) },
        body: JSON.stringify({ texts }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === "TimeoutError";
      throw new NerError(timedOut ? `the NER sidecar did not answer in ${this.config.timeoutMs} ms` : `the NER sidecar is unreachable (${err instanceof Error ? err.name : typeof err})`);
    }
    if (!response.ok) throw new NerError(`the NER sidecar answered HTTP ${response.status}`);
    const body = (await response.json().catch(() => null)) as { spans?: unknown } | null;
    if (!isSpanLists(body?.spans, texts.length)) throw new NerError("the NER sidecar sent an answer in the wrong shape");
    return body.spans;
  }
}

class LocalDetector implements ModelDetector {
  private model?: Promise<ModelDetector>;

  constructor(private readonly dir: string | undefined) {}

  async detect(texts: readonly string[]): Promise<ModelSpan[][]> {
    this.model ??= this.load();
    // A failed load is tried again on the next request, not remembered
    const model = await this.model.catch((err: unknown) => {
      this.model = undefined;
      throw err;
    });
    try {
      return await model.detect(texts);
    } catch (err) {
      throw new NerError(`the NER model failed (${err instanceof Error ? err.name : typeof err})`);
    }
  }

  private async load(): Promise<ModelDetector> {
    let mod: NerModule;
    try {
      mod = (await import("@guardbee/ner" as string)) as NerModule;
    } catch {
      throw new NerError("ner: needs @guardbee/ner installed next to the proxy (or ner.url for a sidecar)");
    }
    try {
      return await mod.NerModel.load(this.dir ? { dir: this.dir } : {});
    } catch (err) {
      // The model's own message names files and hashes, never texts
      throw new NerError(`the NER model did not load: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function batches(texts: readonly string[]): string[][] {
  const out: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const text of texts) {
    if (current.length > 0 && size + text.length > MAX_BATCH_CHARS) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(text);
    size += text.length;
  }
  if (current.length > 0) out.push(current);
  return out;
}

function isSpanLists(value: unknown, count: number): value is ModelSpan[][] {
  return (
    Array.isArray(value) &&
    value.length === count &&
    value.every(
      (list) =>
        Array.isArray(list) &&
        list.every((span) => {
          const s = span as Partial<ModelSpan> | null;
          return typeof s === "object" && s !== null && Number.isInteger(s.start) && Number.isInteger(s.end) && typeof s.detector === "string";
        }),
    )
  );
}

// One detector per config object: every session and the LLM endpoints share the loaded model
const detectors = new WeakMap<NerConfig, ModelDetector>();

export function nerDetectorFor(config: NerConfig): ModelDetector {
  let detector = detectors.get(config);
  if (!detector) detectors.set(config, (detector = "url" in config ? new SidecarDetector(config) : new LocalDetector(config.modelDir)));
  return detector;
}

const HAS_LETTER = /\p{L}/u;

function collect(value: unknown, into: Set<string>): void {
  if (typeof value === "string") {
    if (HAS_LETTER.test(value)) into.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collect(item, into);
  } else if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) collect(item, into);
  }
}

/**
 * Run the model over every string in `values` (as maskPiiInValue walks them)
 * and return the lookup masking reads. It throws for a string it was not
 * given, so a text that skipped the model is never taken as name-free.
 */
export async function scanNames(detector: ModelDetector, ...values: unknown[]): Promise<SpanLookup> {
  const unique = new Set<string>();
  for (const value of values) collect(value, unique);
  const texts = [...unique];
  const spans = texts.length > 0 ? await detector.detect(texts) : [];
  if (spans.length !== texts.length) throw new NerError(`the NER model answered for ${spans.length} of ${texts.length} texts`);
  const found = new Map(texts.map((text, i) => [text, spans[i]!]));
  return (text) => {
    const hit = found.get(text);
    if (hit) return hit;
    if (!HAS_LETTER.test(text)) return [];
    throw new NerError("a text reached masking without going through the NER model");
  };
}
