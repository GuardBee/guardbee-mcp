/**
 * Bir hedefe (LLM API'si ya da kendi chatbot endpoint'iniz) tek bir prompt
 * gönderip metin yanıtını döner. Her adaptör bu tek arayüzü implement eder —
 * runner ve probe'lar hedefin gerçekte ne olduğunu bilmez.
 */
export type ProbeTarget = {
  send(prompt: string): Promise<string>;
};

/** Test edilebilirlik için `fetch`'i enjekte edilebilir bırakıyoruz (gerçek ağ çağrısı olmadan mock'lanabilsin). */
export type FetchLike = typeof fetch;

function readApiKey(envVar: string): string {
  const key = process.env[envVar];
  if (!key) {
    throw new Error(
      `[guardbee-llm-redteam] Environment variable "${envVar}" is not set. Set it to your target's API key before probing — the key itself is never passed as a tool parameter.`
    );
  }
  return key;
}

async function readErrorBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}

export type OpenAiTargetOptions = {
  /** Env var holding the API key — never pass the key value itself. */
  apiKeyEnv: string;
  model: string;
  /** Default: https://api.openai.com/v1 — override for OpenAI-compatible gateways (Groq, local vLLM, etc.). */
  baseUrl?: string;
  /** Optional system prompt — test your own guardrail wording, not just the raw model. */
  systemPrompt?: string;
  fetchImpl?: FetchLike;
};

export function createOpenAiTarget(options: OpenAiTargetOptions): ProbeTarget {
  const baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async send(prompt: string): Promise<string> {
      const apiKey = readApiKey(options.apiKeyEnv);
      const messages = [
        ...(options.systemPrompt ? [{ role: "system", content: options.systemPrompt }] : []),
        { role: "user", content: prompt },
      ];

      const res = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: options.model, messages, temperature: 0 }),
      });

      if (!res.ok) {
        throw new Error(`[guardbee-llm-redteam] OpenAI-compatible target returned ${res.status}: ${await readErrorBody(res)}`);
      }

      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return data.choices?.[0]?.message?.content ?? "";
    },
  };
}

export type AnthropicTargetOptions = {
  apiKeyEnv: string;
  model: string;
  systemPrompt?: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
};

export function createAnthropicTarget(options: AnthropicTargetOptions): ProbeTarget {
  const baseUrl = (options.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async send(prompt: string): Promise<string> {
      const apiKey = readApiKey(options.apiKeyEnv);

      const res = await fetchImpl(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: options.model,
          max_tokens: 1024,
          ...(options.systemPrompt ? { system: options.systemPrompt } : {}),
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!res.ok) {
        throw new Error(`[guardbee-llm-redteam] Anthropic target returned ${res.status}: ${await readErrorBody(res)}`);
      }

      const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
      return data.content?.find((block) => block.type === "text")?.text ?? "";
    },
  };
}

export type WebhookTargetOptions = {
  url: string;
  /** Optional — set only if your endpoint requires a Bearer token. */
  apiKeyEnv?: string;
  /** JSON field name to send the prompt under. Default: "prompt". */
  promptField?: string;
  /** JSON field name to read the response text from. Default: "response". */
  responseField?: string;
  fetchImpl?: FetchLike;
};

/**
 * Generic adapter for a custom/internal chatbot endpoint: POSTs
 * `{ [promptField]: prompt }` as JSON and reads the reply from `responseField`
 * (a top-level key; use dot notation for one level of nesting, e.g. "data.text").
 */
export function createWebhookTarget(options: WebhookTargetOptions): ProbeTarget {
  const promptField = options.promptField ?? "prompt";
  const responseField = options.responseField ?? "response";
  const fetchImpl = options.fetchImpl ?? fetch;

  function readField(obj: unknown, path: string): string {
    const parts = path.split(".");
    let cur: unknown = obj;
    for (const part of parts) {
      if (cur === null || typeof cur !== "object") return "";
      cur = (cur as Record<string, unknown>)[part];
    }
    return typeof cur === "string" ? cur : "";
  }

  return {
    async send(prompt: string): Promise<string> {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (options.apiKeyEnv) {
        headers["Authorization"] = `Bearer ${readApiKey(options.apiKeyEnv)}`;
      }

      const res = await fetchImpl(options.url, {
        method: "POST",
        headers,
        body: JSON.stringify({ [promptField]: prompt }),
      });

      if (!res.ok) {
        throw new Error(`[guardbee-llm-redteam] Webhook target returned ${res.status}: ${await readErrorBody(res)}`);
      }

      const data = await res.json();
      return readField(data, responseField);
    },
  };
}
