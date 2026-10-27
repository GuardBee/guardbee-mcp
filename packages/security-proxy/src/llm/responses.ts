/**
 * The OpenAI Responses API and Embeddings bodies: which parts hold text the
 * proxy masks, and which it cannot read. Kept apart from shapes.ts, which
 * dispatches to these by endpoint.
 */

type Json = Record<string, unknown>;
type TextMapper = (text: string) => string;
type Take = (role: string) => boolean;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** Text parts in a Responses message or tool output: input_text (and output_text in an earlier assistant turn). */
const TEXT_PARTS = new Set(["input_text", "output_text"]);
/** Parts forwarded as they are: images, and the model's own refusal. */
const PASSED_PARTS = new Set(["input_image", "refusal"]);

function mapParts(content: unknown, fn: TextMapper): unknown {
  if (typeof content === "string") return fn(content);
  if (!Array.isArray(content)) return content;
  return content.map((part) => (isObject(part) && TEXT_PARTS.has(String(part["type"])) && typeof part["text"] === "string" ? { ...part, text: fn(part["text"]) } : part));
}

/**
 * Input items the model produced in earlier turns, or references to them:
 * forwarded as they are. Its own function and custom tool calls are not on
 * the list — their arguments are text and are masked.
 */
const MODEL_ITEMS = /^(reasoning|item_reference|mcp_list_tools|mcp_approval_request|mcp_approval_response|(?!function_call$|custom_tool_call$)[a-z_]+_call)$/;

/** The role an input item counts as, for injection scanning (`only`). */
function roleOf(item: Json): string {
  const type = item["type"];
  if (type === undefined || type === "message") return typeof item["role"] === "string" ? item["role"] : "user";
  if (type === "function_call" || type === "custom_tool_call") return "assistant";
  if (typeof type === "string" && type.endsWith("_call_output")) return "tool";
  return "assistant";
}

export function mapResponsesInput(body: Json, fn: TextMapper, take: Take): Json {
  const out: Json = { ...body };
  if (typeof body["instructions"] === "string" && take("system")) out["instructions"] = fn(body["instructions"]);
  const input = body["input"];
  if (typeof input === "string") {
    if (take("user")) out["input"] = fn(input);
  } else if (Array.isArray(input)) {
    out["input"] = input.map((item) => {
      if (!isObject(item) || !take(roleOf(item))) return item;
      const type = item["type"];
      if (type === undefined || type === "message") return { ...item, content: mapParts(item["content"], fn) };
      if (type === "function_call" && typeof item["arguments"] === "string") return { ...item, arguments: fn(item["arguments"]) };
      if (type === "custom_tool_call" && typeof item["input"] === "string") return { ...item, input: fn(item["input"]) };
      if (typeof type === "string" && type.endsWith("_call_output") && type !== "computer_call_output") return { ...item, output: mapParts(item["output"], fn) };
      return item;
    });
  }
  // A stored prompt's variables are filled into it on the provider's side
  const prompt = body["prompt"];
  if (isObject(prompt) && isObject(prompt["variables"]) && take("user")) {
    out["prompt"] = {
      ...prompt,
      variables: Object.fromEntries(
        Object.entries(prompt["variables"]).map(([name, value]) => [name, typeof value === "string" ? fn(value) : (mapParts([value], fn) as unknown[])[0]]),
      ),
    };
  }
  return out;
}

export function unmaskableResponsesParts(body: Json): string[] {
  const found = new Set<string>();
  const parts = (content: unknown, where: string) => {
    if (content === undefined || content === null || typeof content === "string") return;
    if (!Array.isArray(content)) return void found.add(`${where} of type ${typeof content}`);
    for (const part of content) {
      const type = isObject(part) ? String(part["type"]) : "undefined";
      if (!TEXT_PARTS.has(type) && !PASSED_PARTS.has(type)) found.add(`content part "${type}"`);
    }
  };
  const input = body["input"];
  if (input !== undefined && typeof input !== "string" && !Array.isArray(input)) found.add(`input of type ${typeof input}`);
  for (const item of Array.isArray(input) ? input : []) {
    if (!isObject(item)) {
      found.add("an input item that is not an object");
      continue;
    }
    const type = item["type"];
    if (type === undefined || type === "message") parts(item["content"], "content");
    else if (type === "function_call" || type === "custom_tool_call") continue;
    else if (type === "computer_call_output") continue; // a screenshot, forwarded like any image
    else if (typeof type === "string" && type.endsWith("_call_output")) parts(item["output"], "output");
    else if (!(typeof type === "string" && MODEL_ITEMS.test(type))) found.add(`input item "${String(type)}"`);
  }
  const prompt = body["prompt"];
  if (isObject(prompt) && isObject(prompt["variables"])) {
    for (const value of Object.values(prompt["variables"])) if (isObject(value)) parts([value], "prompt variable");
  }
  return [...found];
}

/** The answer's texts: output_text parts, function call arguments, reasoning summaries, and the echoed instructions. */
export function mapResponsesOutput(body: Json, fn: TextMapper): Json {
  const out: Json = { ...body };
  if (typeof body["instructions"] === "string") out["instructions"] = fn(body["instructions"]);
  if (Array.isArray(body["output"])) out["output"] = body["output"].map((item) => mapOutputItem(item, fn));
  return out;
}

export function mapOutputItem(item: unknown, fn: TextMapper): unknown {
  if (!isObject(item)) return item;
  switch (item["type"]) {
    case "message":
      return { ...item, content: mapParts(item["content"], fn) };
    case "function_call":
      return typeof item["arguments"] === "string" ? { ...item, arguments: fn(item["arguments"]) } : item;
    case "custom_tool_call":
      return typeof item["input"] === "string" ? { ...item, input: fn(item["input"]) } : item;
    case "reasoning":
      return Array.isArray(item["summary"])
        ? { ...item, summary: item["summary"].map((s) => (isObject(s) && typeof s["text"] === "string" ? { ...s, text: fn(s["text"]) } : s)) }
        : item;
    default:
      return item;
  }
}

/** Embeddings input: a string or a list of strings is text; token ids (numbers) are not. */
export function mapEmbeddingInput(body: Json, fn: TextMapper, take: Take): Json {
  if (!take("user")) return body;
  const input = body["input"];
  if (typeof input === "string") return { ...body, input: fn(input) };
  if (Array.isArray(input)) return { ...body, input: input.map((item) => (typeof item === "string" ? fn(item) : item)) };
  return body;
}

export function unmaskableEmbeddingParts(body: Json): string[] {
  const input = body["input"];
  if (typeof input === "string") return [];
  if (!Array.isArray(input)) return [`input of type ${typeof input}`];
  return input.every((item) => typeof item === "string") ? [] : ["token-id input (send text, not token ids)"];
}
