import { mapOutputItem, mapResponsesOutput } from "./responses.js";
import { SseRelay, type LlmShape } from "./shapes.js";

type Json = Record<string, unknown>;

/**
 * Rewrites a piece of answer text (puts PII tokens back, masks PII) and
 * reports what it found. Must be pure: it runs on overlapping text.
 */
export type TextRewrite = (text: string) => { text: string; hits: Record<string, number> };

/**
 * Called with the texts a rewrite is about to see, before it sees them: the
 * gateway runs the name model (ner:) over them here, since a rewrite is
 * synchronous and the model is not.
 */
export type RewritePrepare = (texts: string[]) => Promise<void>;

/** Text already sent, kept so a label before a cut ("Pasaport No:") still applies to the value after it. */
const CONTEXT_CHARS = 300;
/** Held text grows past this without a safe cut: send what we have rather than stall the stream. */
const MAX_HELD_CHARS = 4096;

const isDigit = (ch: string | undefined) => ch !== undefined && ch >= "0" && ch <= "9";

/** A label whose value runs to the end of the line (the address detector): hold the line from it. */
const LINE_LABEL = /\b(?:adres(?:i)?|ikametgah|address)\s*:/gi;

/**
 * Where text may be cut before rewriting it: at a space with no digit on
 * either side, so a number written in groups (IBAN, card, phone, MERSİS,
 * a plate) is never split, and a token or e-mail (no spaces) never is
 * either. A private key block is held until its END line, and a line with
 * an address label until the line ends.
 */
function safeCut(text: string, keepNames = false): number {
  let limit = text.length;
  const begin = text.lastIndexOf("-----BEGIN");
  if (begin !== -1 && text.indexOf("-----END", begin) === -1) limit = begin;
  const lineStart = text.lastIndexOf("\n", limit - 1) + 1;
  for (const label of text.slice(lineStart, limit).matchAll(LINE_LABEL)) {
    limit = Math.min(limit, lineStart + label.index);
    break;
  }
  return lastCut(text.slice(0, limit), limit < text.length ? text[limit] : undefined, keepNames);
}

const UPPER = /\p{Lu}/u;

/** Whether the word that ends at `end` (exclusive) starts with a capital letter. */
function capitalisedBefore(text: string, end: number): boolean {
  let start = end;
  while (start > 0 && !/\s/.test(text[start - 1]!)) start--;
  return UPPER.test(text[start] ?? "");
}

/**
 * The last cut in `text`; `next` is the character after it, when known. With
 * `keepNames` (the name model is on) a cut never falls next to a capitalised
 * word, so "Ayşe Yılmaz" reaches the model in one piece.
 */
function lastCut(text: string, next?: string, keepNames = false): number {
  for (let i = text.length - 1; i > 0; i--) {
    const after = i + 1 < text.length ? text[i + 1] : next;
    if (after === undefined || !/\s/.test(text[i]!) || isDigit(text[i - 1]) || isDigit(after)) continue;
    if (keepNames && (UPPER.test(after) || capitalisedBefore(text, i))) continue;
    return i + 1;
  }
  return 0;
}

function subtract(into: Record<string, number>, whole: Record<string, number>, part: Record<string, number>): void {
  for (const [category, count] of Object.entries(whole)) {
    const added = count - (part[category] ?? 0);
    if (added > 0) into[category] = (into[category] ?? 0) + added;
  }
}

/**
 * One stream of answer text (one choice, one content block, one tool call's
 * arguments). Text is held until a safe cut, then rewritten together with the
 * last text sent, so a match is never split and a label is never lost.
 */
export class HeldText {
  private pending = "";
  private context = "";

  constructor(
    private readonly rewrite: TextRewrite,
    private readonly hits: Record<string, number>,
    private readonly prepare?: RewritePrepare,
  ) {}

  async push(delta: string): Promise<string> {
    this.pending += delta;
    let cut = safeCut(this.pending, this.prepare !== undefined);
    if (cut === 0 && this.pending.length > MAX_HELD_CHARS) cut = this.pending.length - CONTEXT_CHARS;
    if (cut <= 0) return "";
    return this.emit(cut);
  }

  /** Add text without releasing any: the stream is about to end. */
  append(delta: string): void {
    this.pending += delta;
  }

  async flush(): Promise<string> {
    return this.pending ? this.emit(this.pending.length) : "";
  }

  private async emit(cut: number): Promise<string> {
    const segment = this.pending.slice(0, cut);
    this.pending = this.pending.slice(cut);
    await this.prepare?.([this.context + segment, this.context, segment]);
    const whole = this.rewrite(this.context + segment);
    const before = this.rewrite(this.context);
    let out: string;
    if (whole.text.startsWith(before.text)) {
      out = whole.text.slice(before.text.length);
      subtract(this.hits, whole.hits, before.hits);
    } else {
      // A match ran across the earlier cut; rewrite this part on its own
      const alone = this.rewrite(segment);
      out = alone.text;
      subtract(this.hits, alone.hits, {});
    }
    this.context = (this.context + segment).slice(-CONTEXT_CHARS);
    return out;
  }
}

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

function dataOf(event: string): string {
  return event
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
}

/** Responses API text streams: event type (without .delta/.done) → held-stream kind, and the full-text field of its .done event. */
const RESPONSES_STREAMS: Record<string, { kind: string; field: string }> = {
  "response.output_text": { kind: "text", field: "text" },
  "response.function_call_arguments": { kind: "args", field: "arguments" },
  "response.custom_tool_call_input": { kind: "custom", field: "input" },
  "response.reasoning_summary_text": { kind: "summary", field: "text" },
  "response.reasoning_text": { kind: "reasoning", field: "text" },
};

const sse = (data: unknown, event?: string) => `${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(data)}\n\n`;

/**
 * Rewrites a streamed answer as it passes: text deltas are held per stream
 * and released at safe cuts, rewritten. What is still held when a choice or
 * block ends is sent in an extra delta just before its end event. Usage is
 * collected like SseRelay does.
 */
export class SseRewriter {
  private buffer = "";
  private readonly decoder = new TextDecoder();
  private readonly relay: SseRelay;
  private readonly held = new Map<string, HeldText>();
  /** What each OpenAI choice's last chunk looked like, to build a flush chunk from. */
  private readonly lastChunk = new Map<number, Json>();
  /** Responses API: each held stream's last delta event, to build a flush event from. */
  private readonly lastDelta = new Map<string, Json>();
  readonly hits: Record<string, number> = {};

  constructor(
    private readonly api: LlmShape,
    private readonly rewrite: TextRewrite,
    dropUsageChunks = false,
    private readonly prepare?: RewritePrepare,
  ) {
    this.relay = new SseRelay(api, dropUsageChunks);
  }

  get usage() {
    return this.relay.usage;
  }

  async push(chunk: Uint8Array): Promise<string> {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    let out = "";
    let match: RegExpExecArray | null;
    while ((match = /\r?\n\r?\n/.exec(this.buffer))) {
      const event = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      out += await this.event(event);
    }
    return out;
  }

  async end(): Promise<string> {
    const rest = this.buffer + this.decoder.decode();
    this.buffer = "";
    let out = rest.trim() !== "" ? await this.event(rest) : "";
    // A stream cut short: still release (rewritten) what was held
    for (const key of [...this.held.keys()]) out += await this.flushKey(key);
    return out;
  }

  /**
   * Rewrite whole texts inside a JSON value with a pure mapper: one pass
   * collects them for `prepare`, the second rewrites.
   */
  private async mapWhole<T>(map: (rewrite: (text: string) => string) => T): Promise<T> {
    if (this.prepare) {
      const texts: string[] = [];
      map((text) => (texts.push(text), text));
      await this.prepare(texts);
    }
    return map((text) => this.rewrite(text).text);
  }

  private stream(key: string): HeldText {
    let held = this.held.get(key);
    if (!held) this.held.set(key, (held = new HeldText(this.rewrite, this.hits, this.prepare)));
    return held;
  }

  /** Release a held stream as one extra delta in the right shape. */
  private async flushKey(key: string): Promise<string> {
    const held = this.held.get(key);
    this.held.delete(key);
    const text = (await held?.flush()) ?? "";
    if (!text) return "";
    const [kind, a, b] = key.split(":");
    if (this.api === "responses") {
      const base = this.lastDelta.get(key) ?? {};
      return sse({ ...base, delta: text }, String(base["type"]));
    }
    if (this.api === "anthropic") {
      const index = Number(a);
      const delta =
        kind === "json" ? { type: "input_json_delta", partial_json: text } : kind === "thinking" ? { type: "thinking_delta", thinking: text } : { type: "text_delta", text };
      return sse({ type: "content_block_delta", index, delta }, "content_block_delta");
    }
    const index = Number(a);
    const base = this.lastChunk.get(index) ?? {};
    const delta = kind === "args" ? { tool_calls: [{ index: Number(b), function: { arguments: text } }] } : { content: text };
    return sse({ ...base, choices: [{ index, delta, finish_reason: null }] });
  }

  private async event(event: string): Promise<string> {
    // Usage (and the usage-only chunk drop) as in a plain relay
    const kept = this.relay.push(new TextEncoder().encode(event + "\n\n"));
    if (!kept) return "";
    const data = dataOf(event);
    if (!data || data === "[DONE]") {
      let out = "";
      if (data === "[DONE]") for (const key of [...this.held.keys()]) out += await this.flushKey(key);
      return out + kept;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return kept;
    }
    if (!isObject(parsed)) return kept;
    if (this.api === "responses") return this.responsesEvent(parsed);
    return this.api === "anthropic" ? this.anthropicEvent(event, parsed) : this.openAiEvent(parsed);
  }

  /**
   * Responses API events. Deltas are held per stream like the other APIs;
   * a `.done` event first releases what its stream holds, then carries its
   * full text rewritten. Items, parts and the response object (created,
   * completed) are rewritten whole, so the final snapshot matches the deltas.
   */
  private async responsesEvent(data: Json): Promise<string> {
    const type = String(data["type"]);
    const out = (event: Json) => sse(event, type);
    const stream = RESPONSES_STREAMS[type.replace(/\.(delta|done)$/, "")];
    if (stream) {
      const key = `${stream.kind}:${String(data["output_index"] ?? 0)}:${String(data["content_index"] ?? data["summary_index"] ?? 0)}`;
      if (type.endsWith(".delta") && typeof data["delta"] === "string") {
        this.lastDelta.set(key, data);
        const text = await this.stream(key).push(data["delta"]);
        return text ? out({ ...data, delta: text }) : "";
      }
      if (type.endsWith(".done")) {
        const field = stream.field;
        const flushed = await this.flushKey(key);
        return flushed + out(typeof data[field] === "string" ? { ...data, [field]: await this.mapWhole((whole) => whole(data[field] as string)) } : data);
      }
      return out(data);
    }
    if ((type === "response.output_item.added" || type === "response.output_item.done") && data["item"] !== undefined) {
      return out({ ...data, item: await this.mapWhole((whole) => mapOutputItem(data["item"], whole)) });
    }
    if ((type === "response.content_part.added" || type === "response.content_part.done" || type.startsWith("response.reasoning_summary_part.")) && isObject(data["part"])) {
      const part = data["part"];
      return out(typeof part["text"] === "string" ? { ...data, part: { ...part, text: await this.mapWhole((whole) => whole(part["text"] as string)) } } : data);
    }
    const response = data["response"];
    if (isObject(response)) {
      // completed / incomplete / failed: the stream is over, release everything still held
      let before = "";
      if (type !== "response.created" && type !== "response.in_progress") for (const key of [...this.held.keys()]) before += await this.flushKey(key);
      return before + out({ ...data, response: await this.mapWhole((whole) => mapResponsesOutput(response, whole)) });
    }
    return out(data);
  }

  private async anthropicEvent(raw: string, data: Json): Promise<string> {
    const index = typeof data["index"] === "number" ? data["index"] : 0;
    if (data["type"] === "content_block_delta" && isObject(data["delta"])) {
      const delta = data["delta"];
      const field = delta["type"] === "text_delta" ? "text" : delta["type"] === "input_json_delta" ? "partial_json" : delta["type"] === "thinking_delta" ? "thinking" : null;
      if (!field || typeof delta[field] !== "string") return raw + "\n\n";
      const kind = field === "partial_json" ? "json" : field === "thinking" ? "thinking" : "text";
      const text = await this.stream(`${kind}:${index}`).push(delta[field] as string);
      return text ? sse({ ...data, delta: { ...delta, [field]: text } }, "content_block_delta") : "";
    }
    if (data["type"] === "content_block_stop") {
      let out = "";
      for (const key of [...this.held.keys()]) if (key.split(":")[1] === String(index)) out += await this.flushKey(key);
      return out + raw + "\n\n";
    }
    if (data["type"] === "message_stop" || data["type"] === "message_delta") {
      let out = "";
      for (const key of [...this.held.keys()]) out += await this.flushKey(key);
      return out + raw + "\n\n";
    }
    return raw + "\n\n";
  }

  private async openAiEvent(data: Json): Promise<string> {
    const choices = Array.isArray(data["choices"]) ? data["choices"] : [];
    if (choices.length === 0) return sse(data);
    let before = "";
    const rewritten: unknown[] = [];
    for (const choice of choices) {
      if (!isObject(choice)) {
        rewritten.push(choice);
        continue;
      }
      const index = typeof choice["index"] === "number" ? choice["index"] : 0;
      const { choices: _choices, usage: _usage, ...rest } = data;
      this.lastChunk.set(index, rest);
      const delta = isObject(choice["delta"]) ? { ...choice["delta"] } : {};
      const finishing = choice["finish_reason"] !== null && choice["finish_reason"] !== undefined;
      // On the last chunk of a choice, text joins what is held and all of it goes out before this chunk
      const take = async (key: string, text: string) => (finishing ? (this.stream(key).append(text), "") : this.stream(key).push(text));
      if (typeof delta["content"] === "string") delta["content"] = await take(`text:${index}`, delta["content"]);
      if (Array.isArray(delta["tool_calls"])) {
        const calls: unknown[] = [];
        for (const call of delta["tool_calls"]) {
          if (!isObject(call) || !isObject(call["function"]) || typeof call["function"]["arguments"] !== "string") {
            calls.push(call);
            continue;
          }
          const callIndex = typeof call["index"] === "number" ? call["index"] : 0;
          calls.push({ ...call, function: { ...call["function"], arguments: await take(`args:${index}:${callIndex}`, call["function"]["arguments"]) } });
        }
        delta["tool_calls"] = calls;
      }
      // The choice ends here: what it still holds goes out first
      if (finishing) {
        for (const key of [...this.held.keys()]) if (key.split(":")[1] === String(index)) before += await this.flushKey(key);
      }
      rewritten.push({ ...choice, delta });
    }
    // A chunk that carried only held text says nothing now
    const empty = rewritten.every((choice) => {
      if (!isObject(choice) || !isObject(choice["delta"])) return false;
      const delta = choice["delta"];
      const meaningful = Object.entries(delta).some(([key, value]) => key !== "content" || value !== "");
      return !meaningful && (choice["finish_reason"] === null || choice["finish_reason"] === undefined);
    });
    return before + (empty ? "" : sse({ ...data, choices: rewritten }));
  }
}
