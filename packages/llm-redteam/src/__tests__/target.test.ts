import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createOpenAiTarget, createAnthropicTarget, createWebhookTarget } from "../target.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("createOpenAiTarget", () => {
  beforeEach(() => {
    process.env.TEST_OPENAI_KEY = "sk-test-123";
  });
  afterEach(() => {
    delete process.env.TEST_OPENAI_KEY;
  });

  it("posts messages and returns the completion content", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: url.toString(), init: init! });
      return jsonResponse({ choices: [{ message: { content: "hello back" } }] });
    }) as unknown as typeof fetch;

    const target = createOpenAiTarget({ apiKeyEnv: "TEST_OPENAI_KEY", model: "gpt-4o-mini", fetchImpl });
    const result = await target.send("hi there");

    expect(result).toBe("hello back");
    expect(calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages).toEqual([{ role: "user", content: "hi there" }]);
    expect((calls[0].init.headers as Record<string, string>)["Authorization"]).toBe("Bearer sk-test-123");
  });

  it("includes a system prompt when provided", async () => {
    const mockFetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ choices: [{ message: { content: "ok" } }] })
    );
    const target = createOpenAiTarget({
      apiKeyEnv: "TEST_OPENAI_KEY",
      model: "gpt-4o-mini",
      systemPrompt: "You are a helpful assistant.",
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    await target.send("hi");

    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[0]).toEqual({ role: "system", content: "You are a helpful assistant." });
  });

  it("respects a custom baseUrl", async () => {
    const mockFetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ choices: [{ message: { content: "ok" } }] })
    );
    const target = createOpenAiTarget({
      apiKeyEnv: "TEST_OPENAI_KEY",
      model: "llama3",
      baseUrl: "http://localhost:8000/v1",
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    await target.send("hi");
    expect(mockFetch.mock.calls[0][0] as string).toBe("http://localhost:8000/v1/chat/completions");
  });

  it("throws when the env var is not set", async () => {
    delete process.env.TEST_OPENAI_KEY;
    const target = createOpenAiTarget({ apiKeyEnv: "TEST_OPENAI_KEY", model: "gpt-4o-mini" });
    await expect(target.send("hi")).rejects.toThrow('Environment variable "TEST_OPENAI_KEY" is not set');
  });

  it("throws with the response body when the API errors", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "bad request" }, 400)) as unknown as typeof fetch;
    const target = createOpenAiTarget({ apiKeyEnv: "TEST_OPENAI_KEY", model: "gpt-4o-mini", fetchImpl });
    await expect(target.send("hi")).rejects.toThrow("400");
  });
});

describe("createAnthropicTarget", () => {
  beforeEach(() => {
    process.env.TEST_ANTHROPIC_KEY = "sk-ant-test";
  });
  afterEach(() => {
    delete process.env.TEST_ANTHROPIC_KEY;
  });

  it("posts to the messages endpoint and extracts the text block", async () => {
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(url.toString()).toBe("https://api.anthropic.com/v1/messages");
      expect((init!.headers as Record<string, string>)["x-api-key"]).toBe("sk-ant-test");
      return jsonResponse({ content: [{ type: "text", text: "claude says hi" }] });
    }) as unknown as typeof fetch;

    const target = createAnthropicTarget({ apiKeyEnv: "TEST_ANTHROPIC_KEY", model: "claude-sonnet-4-5", fetchImpl });
    const result = await target.send("hi");
    expect(result).toBe("claude says hi");
  });

  it("includes system prompt as a top-level field, not a message", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.system).toBe("Be nice.");
      expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
      return jsonResponse({ content: [{ type: "text", text: "ok" }] });
    }) as unknown as typeof fetch;

    const target = createAnthropicTarget({
      apiKeyEnv: "TEST_ANTHROPIC_KEY",
      model: "claude-sonnet-4-5",
      systemPrompt: "Be nice.",
      fetchImpl,
    });
    await target.send("hi");
  });
});

describe("createWebhookTarget", () => {
  it("posts the prompt under the default field and reads the default response field", async () => {
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(url.toString()).toBe("https://chatbot.example.com/chat");
      const body = JSON.parse(init!.body as string);
      expect(body).toEqual({ prompt: "hi" });
      return jsonResponse({ response: "webhook says hi" });
    }) as unknown as typeof fetch;

    const target = createWebhookTarget({ url: "https://chatbot.example.com/chat", fetchImpl });
    expect(await target.send("hi")).toBe("webhook says hi");
  });

  it("supports custom field names", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body).toEqual({ message: "hi" });
      return jsonResponse({ reply: "custom field response" });
    }) as unknown as typeof fetch;

    const target = createWebhookTarget({
      url: "https://chatbot.example.com/chat",
      promptField: "message",
      responseField: "reply",
      fetchImpl,
    });
    expect(await target.send("hi")).toBe("custom field response");
  });

  it("supports one level of nested response field via dot notation", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: { text: "nested reply" } })) as unknown as typeof fetch;
    const target = createWebhookTarget({
      url: "https://chatbot.example.com/chat",
      responseField: "data.text",
      fetchImpl,
    });
    expect(await target.send("hi")).toBe("nested reply");
  });

  it("adds a bearer token when apiKeyEnv is set", async () => {
    process.env.TEST_WEBHOOK_KEY = "webhook-secret";
    const fetchImpl = vi.fn(async (_url, init) => {
      expect((init as RequestInit).headers as Record<string, string>).toMatchObject({
        Authorization: "Bearer webhook-secret",
      });
      return jsonResponse({ response: "ok" });
    }) as unknown as typeof fetch;

    const target = createWebhookTarget({ url: "https://x.example.com", apiKeyEnv: "TEST_WEBHOOK_KEY", fetchImpl });
    await target.send("hi");
    delete process.env.TEST_WEBHOOK_KEY;
  });

  it("does not add an Authorization header when apiKeyEnv is not set", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      expect((init as RequestInit).headers as Record<string, string>).not.toHaveProperty("Authorization");
      return jsonResponse({ response: "ok" });
    }) as unknown as typeof fetch;

    const target = createWebhookTarget({ url: "https://x.example.com", fetchImpl });
    await target.send("hi");
  });
});
