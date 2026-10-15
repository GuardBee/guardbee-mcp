import type { LlmApi } from "./config.js";
import type { LlmUsage } from "./budget.js";

/**
 * The parts of OpenAI Chat Completions and Anthropic Messages bodies that
 * hold text written by people, tools or the model. Only these are scanned and
 * masked: image data, ids and tool names are left alone, so a run of digits
 * inside a base64 image is never "masked" into a broken file.
 */

type Json = Record<string, unknown>;
export type TextMapper = (text: string) => string;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** Map every string in a JSON value (tool inputs are free-form objects). */
function mapStrings(value: unknown, fn: TextMapper): unknown {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, fn));
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn)]));
  return value;
}

/** OpenAI content: a string, or parts of which `text` parts carry text. */
function mapOpenAiContent(content: unknown, fn: TextMapper): unknown {
  if (typeof content === "string") return fn(content);
  if (!Array.isArray(content)) return content;
  return content.map((part) => (isObject(part) && part["type"] === "text" && typeof part["text"] === "string" ? { ...part, text: fn(part["text"]) } : part));
}

function mapOpenAiToolCalls(calls: unknown, fn: TextMapper): unknown {
  if (!Array.isArray(calls)) return calls;
  return calls.map((call) => {
    if (!isObject(call) || !isObject(call["function"])) return call;
    const fnCall = call["function"];
    return typeof fnCall["arguments"] === "string" ? { ...call, function: { ...fnCall, arguments: fn(fnCall["arguments"]) } } : call;
  });
}

/** Anthropic content: a string, or blocks (text, tool_use input, tool_result content). */
function mapAnthropicContent(content: unknown, fn: TextMapper): unknown {
  if (typeof content === "string") return fn(content);
  if (!Array.isArray(content)) return content;
  return content.map((block) => {
    if (!isObject(block)) return block;
    switch (block["type"]) {
      case "text":
        return typeof block["text"] === "string" ? { ...block, text: fn(block["text"]) } : block;
      case "tool_use":
        return { ...block, input: mapStrings(block["input"], fn) };
      case "tool_result":
        return { ...block, content: mapAnthropicContent(block["content"], fn) };
      case "document":
        return mapAnthropicDocument(block, fn);
      default:
        return block;
    }
  });
}

/** A document's title and context, and its text when the source is text or content blocks (a PDF is left alone). */
function mapAnthropicDocument(block: Json, fn: TextMapper): Json {
  const out: Json = { ...block };
  if (typeof block["title"] === "string") out["title"] = fn(block["title"]);
  if (typeof block["context"] === "string") out["context"] = fn(block["context"]);
  const source = block["source"];
  if (isObject(source) && source["type"] === "text" && typeof source["data"] === "string") out["source"] = { ...source, data: fn(source["data"]) };
  if (isObject(source) && source["type"] === "content") out["source"] = { ...source, content: mapAnthropicContent(source["content"], fn) };
  return out;
}

/** OpenAI content parts that are not text the proxy can read: image_url is forwarded as is, refusal is the model's own. */
const OPENAI_PASSED_PARTS = new Set(["text", "image_url", "refusal"]);
/** Blocks the provider itself produced; only accepted in an assistant turn. */
const ANTHROPIC_MODEL_BLOCKS = /^(thinking|redacted_thinking|server_tool_use|mcp_tool_use|mcp_tool_result|[a-z_]+_tool_result)$/;

/**
 * What in a request the proxy cannot read, and so cannot mask: audio, files,
 * PDF documents, content shapes it does not know. Images are not on the
 * list: they are forwarded unchanged and the README says so. Empty: every
 * piece of text in the request goes through mapPrompt.
 */
export function unmaskableParts(api: LlmApi, body: Json): string[] {
  const found = new Set<string>();
  const shape = (content: unknown, where: string) => {
    if (content === undefined || content === null || typeof content === "string" || Array.isArray(content)) return true;
    found.add(`${where} of type ${typeof content}`);
    return false;
  };
  const openAi = (content: unknown) => {
    if (!shape(content, "content") || !Array.isArray(content)) return;
    for (const part of content) {
      const type = isObject(part) ? part["type"] : undefined;
      if (typeof type !== "string" || !OPENAI_PASSED_PARTS.has(type)) found.add(`content part "${String(type)}"`);
    }
  };
  const anthropic = (content: unknown, role: unknown) => {
    if (!shape(content, "content") || !Array.isArray(content)) return;
    for (const block of content) {
      const type = isObject(block) ? block["type"] : undefined;
      if (type === "text" || type === "tool_use" || type === "image") continue;
      if (type === "tool_result") anthropic((block as Json)["content"], role);
      else if (type === "document") {
        const source = (block as Json)["source"];
        const kind = isObject(source) ? source["type"] : undefined;
        if (kind === "content") anthropic((source as Json)["content"], role);
        else if (kind !== "text") found.add(`document with a ${String(kind)} source`);
      } else if (!(role === "assistant" && typeof type === "string" && ANTHROPIC_MODEL_BLOCKS.test(type) && type !== "tool_result")) {
        found.add(`content block "${String(type)}"`);
      }
    }
  };
  if (body["messages"] !== undefined && !Array.isArray(body["messages"])) found.add("messages that are not a list");
  for (const message of Array.isArray(body["messages"]) ? body["messages"] : []) {
    if (!isObject(message)) {
      found.add("a message that is not an object");
      continue;
    }
    if (api === "anthropic") anthropic(message["content"], message["role"]);
    else openAi(message["content"]);
  }
  if (api === "anthropic") anthropic(body["system"], "system");
  return [...found];
}

/**
 * Map the prompt texts of a request body. `only` restricts it to messages
 * from these roles (the system prompt counts as "system").
 */
export function mapPrompt(api: LlmApi, body: Json, fn: TextMapper, only?: ReadonlySet<string>): Json {
  const take = (role: unknown) => !only || (typeof role === "string" && only.has(role));
  const messages = Array.isArray(body["messages"])
    ? body["messages"].map((message) => {
        if (!isObject(message) || !take(message["role"])) return message;
        if (api === "anthropic") return { ...message, content: mapAnthropicContent(message["content"], fn) };
        const mapped: Json = { ...message, content: mapOpenAiContent(message["content"], fn) };
        if (message["tool_calls"] !== undefined) mapped["tool_calls"] = mapOpenAiToolCalls(message["tool_calls"], fn);
        return mapped;
      })
    : body["messages"];
  const out: Json = { ...body, messages };
  if (api === "anthropic" && body["system"] !== undefined && take("system")) out["system"] = mapAnthropicContent(body["system"], fn);
  return out;
}

/** Every prompt text from these roles, for scanning. */
export function promptTexts(api: LlmApi, body: Json, roles: ReadonlySet<string>): string[] {
  const texts: string[] = [];
  mapPrompt(api, body, (text) => (texts.push(text), text), roles);
  return texts;
}

/** Map the texts of a non-streamed completion. */
export function mapCompletion(api: LlmApi, body: Json, fn: TextMapper): Json {
  if (api === "anthropic") return { ...body, content: mapAnthropicContent(body["content"], fn) };
  if (!Array.isArray(body["choices"])) return body;
  return {
    ...body,
    choices: body["choices"].map((choice) => {
      if (!isObject(choice) || !isObject(choice["message"])) return choice;
      const message = choice["message"];
      const mapped: Json = { ...message };
      if (typeof message["content"] === "string") mapped["content"] = fn(message["content"]);
      if (message["tool_calls"] !== undefined) mapped["tool_calls"] = mapOpenAiToolCalls(message["tool_calls"], fn);
      return { ...choice, message: mapped };
    }),
  };
}

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** Token counts from a completion body or a streamed event; null when it has none. */
export function usageOf(api: LlmApi, body: unknown): LlmUsage | null {
  if (!isObject(body)) return null;
  if (api === "openai") {
    const usage = body["usage"];
    return isObject(usage) ? { inputTokens: num(usage["prompt_tokens"]), outputTokens: num(usage["completion_tokens"]) } : null;
  }
  // Anthropic: a body, a message_start (usage under message) or a message_delta (output only)
  const usage = isObject(body["usage"]) ? body["usage"] : isObject(body["message"]) && isObject(body["message"]["usage"]) ? body["message"]["usage"] : null;
  if (!usage) return null;
  const input = num(usage["input_tokens"]) + num(usage["cache_creation_input_tokens"]) + num(usage["cache_read_input_tokens"]);
  return { inputTokens: input, outputTokens: num(usage["output_tokens"]) };
}

/** An error body in the shape the client's SDK parses; `code` is one of the proxy's own stable codes. */
export function errorBody(api: LlmApi, status: number, message: string, code?: string): Json {
  const type =
    status === 401 ? "authentication_error" : status === 403 ? "permission_error" : status === 429 ? "rate_limit_error" : status >= 500 ? "api_error" : "invalid_request_error";
  return api === "anthropic" ? { type: "error", error: { type, message, ...(code ? { code } : {}) } } : { error: { message, type, code: code ?? null } };
}

/**
 * Relays a server-sent event stream event by event and collects token usage
 * on the way. Events are split on blank lines; a partial event waits for the
 * next chunk. `dropUsageChunks` removes the usage-only OpenAI chunk the proxy
 * asked for (stream_options.include_usage) when the client did not.
 */
export class SseRelay {
  private buffer = "";
  private readonly decoder = new TextDecoder();
  usage: LlmUsage | null = null;

  constructor(
    private readonly api: LlmApi,
    private readonly dropUsageChunks = false,
  ) {}

  /** Complete events from this chunk, ready to write. */
  push(chunk: Uint8Array): string {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    let out = "";
    let match: RegExpExecArray | null;
    while ((match = /\r?\n\r?\n/.exec(this.buffer))) {
      const event = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      if (this.keep(event)) out += event + "\n\n";
    }
    return out;
  }

  /** Whatever is left when the upstream closes. */
  end(): string {
    const rest = this.buffer + this.decoder.decode();
    this.buffer = "";
    return rest.trim() !== "" && this.keep(rest) ? rest : "";
  }

  private keep(event: string): boolean {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return true;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return true;
    }
    const found = usageOf(this.api, parsed);
    if (!found) return true;
    // Anthropic reports input in message_start and output in message_delta
    this.usage = {
      inputTokens: found.inputTokens || this.usage?.inputTokens || 0,
      outputTokens: found.outputTokens || this.usage?.outputTokens || 0,
    };
    const usageOnly = this.api === "openai" && isObject(parsed) && Array.isArray(parsed["choices"]) && parsed["choices"].length === 0;
    return !(usageOnly && this.dropUsageChunks);
  }
}

const sse = (data: unknown, event?: string) => `${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(data)}\n\n`;

/**
 * Replay a finished completion as a stream, for a client that asked for one
 * while the proxy had to see the whole answer first (to put PII tokens back
 * or mask the answer). The client gets valid events, all at once.
 */
export function completionAsStream(api: LlmApi, body: Json, includeUsage: boolean): string {
  if (api === "openai") return openAiStream(body, includeUsage);
  return anthropicStream(body);
}

function openAiStream(body: Json, includeUsage: boolean): string {
  const base = { id: body["id"], object: "chat.completion.chunk", created: body["created"], model: body["model"], system_fingerprint: body["system_fingerprint"] };
  let out = "";
  const choices = Array.isArray(body["choices"]) ? body["choices"] : [];
  for (const choice of choices) {
    if (!isObject(choice)) continue;
    const message = isObject(choice["message"]) ? choice["message"] : {};
    const delta: Json = { role: "assistant" };
    if (message["content"] !== undefined) delta["content"] = message["content"];
    if (message["refusal"] !== undefined) delta["refusal"] = message["refusal"];
    if (Array.isArray(message["tool_calls"])) {
      delta["tool_calls"] = message["tool_calls"].map((call, index) => (isObject(call) ? { index, ...call } : call));
    }
    out += sse({ ...base, choices: [{ index: choice["index"] ?? 0, delta, logprobs: null, finish_reason: null }] });
    out += sse({ ...base, choices: [{ index: choice["index"] ?? 0, delta: {}, logprobs: null, finish_reason: choice["finish_reason"] ?? "stop" }] });
  }
  if (includeUsage && body["usage"] !== undefined) out += sse({ ...base, choices: [], usage: body["usage"] });
  return out + "data: [DONE]\n\n";
}

function anthropicStream(body: Json): string {
  const usage = isObject(body["usage"]) ? body["usage"] : {};
  let out = sse(
    { type: "message_start", message: { ...body, content: [], stop_reason: null, stop_sequence: null, usage: { ...usage, output_tokens: 0 } } },
    "message_start",
  );
  const blocks = Array.isArray(body["content"]) ? body["content"] : [];
  for (const [index, block] of blocks.entries()) {
    if (!isObject(block)) continue;
    if (block["type"] === "text") {
      out += sse({ type: "content_block_start", index, content_block: { type: "text", text: "" } }, "content_block_start");
      out += sse({ type: "content_block_delta", index, delta: { type: "text_delta", text: block["text"] } }, "content_block_delta");
    } else if (block["type"] === "tool_use") {
      out += sse({ type: "content_block_start", index, content_block: { ...block, input: {} } }, "content_block_start");
      out += sse({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block["input"] ?? {}) } }, "content_block_delta");
    } else if (block["type"] === "thinking") {
      out += sse({ type: "content_block_start", index, content_block: { type: "thinking", thinking: "" } }, "content_block_start");
      out += sse({ type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: block["thinking"] } }, "content_block_delta");
      if (block["signature"] !== undefined) {
        out += sse({ type: "content_block_delta", index, delta: { type: "signature_delta", signature: block["signature"] } }, "content_block_delta");
      }
    } else {
      out += sse({ type: "content_block_start", index, content_block: block }, "content_block_start");
    }
    out += sse({ type: "content_block_stop", index }, "content_block_stop");
  }
  out += sse(
    { type: "message_delta", delta: { stop_reason: body["stop_reason"] ?? null, stop_sequence: body["stop_sequence"] ?? null }, usage: { output_tokens: usage["output_tokens"] ?? 0 } },
    "message_delta",
  );
  return out + sse({ type: "message_stop" }, "message_stop");
}
