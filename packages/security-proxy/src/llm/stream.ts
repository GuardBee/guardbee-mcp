import type { LlmApi } from "./config.js";
import { SseRelay } from "./shapes.js";

type Json = Record<string, unknown>;

/**
 * Rewrites a piece of answer text (puts PII tokens back, masks PII) and
 * reports what it found. Must be pure: it runs on overlapping text.
 */
export type TextRewrite = (text: string) => { text: string; hits: Record<string, number> };

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
function safeCut(text: string): number {
  let limit = text.length;
  const begin = text.lastIndexOf("-----BEGIN");
  if (begin !== -1 && text.indexOf("-----END", begin) === -1) limit = begin;
  const lineStart = text.lastIndexOf("\n", limit - 1) + 1;
  for (const label of text.slice(lineStart, limit).matchAll(LINE_LABEL)) {
    limit = Math.min(limit, lineStart + label.index);
    break;
  }
  return lastCut(text.slice(0, limit), limit < text.length ? text[limit] : undefined);
}

/** The last cut in `text`; `next` is the character after it, when known. */
function lastCut(text: string, next?: string): number {
  for (let i = text.length - 1; i > 0; i--) {
    const after = i + 1 < text.length ? text[i + 1] : next;
    if (after !== undefined && /\s/.test(text[i]!) && !isDigit(text[i - 1]) && !isDigit(after)) return i + 1;
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
  ) {}

  push(delta: string): string {
    this.pending += delta;
    let cut = safeCut(this.pending);
    if (cut === 0 && this.pending.length > MAX_HELD_CHARS) cut = this.pending.length - CONTEXT_CHARS;
    if (cut <= 0) return "";
    return this.emit(cut);
  }

  /** Add text without releasing any: the stream is about to end. */
  append(delta: string): void {
    this.pending += delta;
  }

  flush(): string {
    return this.pending ? this.emit(this.pending.length) : "";
  }

  private emit(cut: number): string {
    const segment = this.pending.slice(0, cut);
    this.pending = this.pending.slice(cut);
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
  readonly hits: Record<string, number> = {};

  constructor(
    private readonly api: LlmApi,
    private readonly rewrite: TextRewrite,
    dropUsageChunks = false,
  ) {
    this.relay = new SseRelay(api, dropUsageChunks);
  }

  get usage() {
    return this.relay.usage;
  }

  push(chunk: Uint8Array): string {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    let out = "";
    let match: RegExpExecArray | null;
    while ((match = /\r?\n\r?\n/.exec(this.buffer))) {
      const event = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      out += this.event(event);
    }
    return out;
  }

  end(): string {
    const rest = this.buffer + this.decoder.decode();
    this.buffer = "";
    let out = rest.trim() !== "" ? this.event(rest) : "";
    // A stream cut short: still release (rewritten) what was held
    for (const key of [...this.held.keys()]) out += this.flushKey(key);
    return out;
  }

  private stream(key: string): HeldText {
    let held = this.held.get(key);
    if (!held) this.held.set(key, (held = new HeldText(this.rewrite, this.hits)));
    return held;
  }

  /** Release a held stream as one extra delta in the right shape. */
  private flushKey(key: string): string {
    const held = this.held.get(key);
    this.held.delete(key);
    const text = held?.flush() ?? "";
    if (!text) return "";
    const [kind, a, b] = key.split(":");
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

  private event(event: string): string {
    // Usage (and the usage-only chunk drop) as in a plain relay
    const kept = this.relay.push(new TextEncoder().encode(event + "\n\n"));
    if (!kept) return "";
    const data = dataOf(event);
    if (!data || data === "[DONE]") {
      let out = "";
      if (data === "[DONE]") for (const key of [...this.held.keys()]) out += this.flushKey(key);
      return out + kept;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return kept;
    }
    if (!isObject(parsed)) return kept;
    return this.api === "anthropic" ? this.anthropicEvent(event, parsed) : this.openAiEvent(parsed);
  }

  private anthropicEvent(raw: string, data: Json): string {
    const index = typeof data["index"] === "number" ? data["index"] : 0;
    if (data["type"] === "content_block_delta" && isObject(data["delta"])) {
      const delta = data["delta"];
      const field = delta["type"] === "text_delta" ? "text" : delta["type"] === "input_json_delta" ? "partial_json" : delta["type"] === "thinking_delta" ? "thinking" : null;
      if (!field || typeof delta[field] !== "string") return raw + "\n\n";
      const kind = field === "partial_json" ? "json" : field === "thinking" ? "thinking" : "text";
      const text = this.stream(`${kind}:${index}`).push(delta[field] as string);
      return text ? sse({ ...data, delta: { ...delta, [field]: text } }, "content_block_delta") : "";
    }
    if (data["type"] === "content_block_stop") {
      let out = "";
      for (const key of [...this.held.keys()]) if (key.split(":")[1] === String(index)) out += this.flushKey(key);
      return out + raw + "\n\n";
    }
    if (data["type"] === "message_stop" || data["type"] === "message_delta") {
      let out = "";
      for (const key of [...this.held.keys()]) out += this.flushKey(key);
      return out + raw + "\n\n";
    }
    return raw + "\n\n";
  }

  private openAiEvent(data: Json): string {
    const choices = Array.isArray(data["choices"]) ? data["choices"] : [];
    if (choices.length === 0) return sse(data);
    let before = "";
    const rewritten = choices.map((choice) => {
      if (!isObject(choice)) return choice;
      const index = typeof choice["index"] === "number" ? choice["index"] : 0;
      const { choices: _choices, usage: _usage, ...rest } = data;
      this.lastChunk.set(index, rest);
      const delta = isObject(choice["delta"]) ? { ...choice["delta"] } : {};
      const finishing = choice["finish_reason"] !== null && choice["finish_reason"] !== undefined;
      // On the last chunk of a choice, text joins what is held and all of it goes out before this chunk
      const take = (key: string, text: string) => (finishing ? (this.stream(key).append(text), "") : this.stream(key).push(text));
      if (typeof delta["content"] === "string") delta["content"] = take(`text:${index}`, delta["content"]);
      if (Array.isArray(delta["tool_calls"])) {
        delta["tool_calls"] = delta["tool_calls"].map((call) => {
          if (!isObject(call) || !isObject(call["function"]) || typeof call["function"]["arguments"] !== "string") return call;
          const callIndex = typeof call["index"] === "number" ? call["index"] : 0;
          return { ...call, function: { ...call["function"], arguments: take(`args:${index}:${callIndex}`, call["function"]["arguments"]) } };
        });
      }
      // The choice ends here: what it still holds goes out first
      if (finishing) {
        for (const key of [...this.held.keys()]) if (key.split(":")[1] === String(index)) before += this.flushKey(key);
      }
      return { ...choice, delta };
    });
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
