import http from "http";
import type { AddressInfo } from "net";
import { parse as parseYaml } from "yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLogger } from "../audit/logger.js";
import { Gateway } from "../gateway/gateway.js";
import { startHttpGateway } from "../http-server.js";
import { llmSchema, type LlmConfig, type LlmRoute } from "../llm/config.js";
import type { AuditEvent, ProxyConfig } from "../types.js";
import { fakeUpstream, gatewayConfig } from "./fakes.js";

const TCKN = "10000000146";

// A detector that throws on any text holding `boom.on` — the error message quotes the text,
// as a real bug's message might, so the tests can check it is never logged or returned.
const boom = vi.hoisted(() => ({ on: "" }));
vi.mock("@guardbee/guard-core", async (importOriginal) => {
  const real = await importOriginal<typeof import("@guardbee/guard-core")>();
  const check = (value: unknown) => {
    if (boom.on && JSON.stringify(value).includes(boom.on)) throw new TypeError(`cannot read ${JSON.stringify(value)}`);
  };
  return {
    ...real,
    maskPiiInText: (...args: Parameters<typeof real.maskPiiInText>) => (check(args[0]), real.maskPiiInText(...args)),
    maskPiiInValue: (...args: Parameters<typeof real.maskPiiInValue>) => (check(args[0]), real.maskPiiInValue(...args)),
  };
});

const cleanups: (() => Promise<unknown>)[] = [];
beforeEach(() => {
  boom.on = "";
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

type Seen = Record<string, unknown>;

/** A provider that records each body and answers with `answer` (OpenAI or Anthropic shape). */
async function fakeProvider(answer = "ok"): Promise<{ url: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    seen.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Seen);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify(
        req.url?.endsWith("/messages")
          ? { id: "m", type: "message", role: "assistant", content: [{ type: "text", text: answer }], usage: { input_tokens: 1, output_tokens: 1 } }
          : { id: "c", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: answer }, finish_reason: "stop" }] },
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise((resolve) => server.close(resolve)));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

async function startLlm(url: string, llm: Partial<LlmConfig> = {}, interceptors: NonNullable<ProxyConfig["interceptors"]> = { piiMasking: { enabled: true } }) {
  const events: AuditEvent[] = [];
  const audit = { log: (event: AuditEvent) => events.push(event), close: async () => {} } as unknown as AuditLogger;
  const routes: LlmRoute[] = [
    { model: "gpt-*", provider: "oai" },
    { model: "claude-*", provider: "ant" },
  ];
  const config = gatewayConfig({
    interceptors,
    llm: {
      path: "/v1",
      providers: {
        oai: { name: "oai", api: "openai", baseUrl: `${url}/v1`, apiKey: "sk-openai", headers: {} },
        ant: { name: "ant", api: "anthropic", baseUrl: url, apiKey: "sk-ant", headers: {} },
      },
      routes,
      keys: [{ key: "gb-alice", user: "alice", groups: [] }],
      pricing: {},
      budgets: [],
      access: [],
      accessDefault: "allow",
      maskResponses: false,
      timeoutSeconds: 10,
      ...llm,
    },
  });
  const gw = await startHttpGateway([], config, audit, { transport: "http", host: "127.0.0.1", port: 0, path: "/mcp", apiKeys: [], maxSessions: 10 });
  cleanups.push(() => gw.close());
  return { base: gw.llmUrl!, events };
}

const post = (base: string, path: string, body: unknown) =>
  fetch(`${base}${path}`, { method: "POST", headers: { authorization: "Bearer gb-alice", "content-type": "application/json" }, body: JSON.stringify(body) });
const chat = (base: string, messages: unknown[], model = "gpt-4o") => post(base, "/chat/completions", { model, messages });
const messages = (base: string, msgs: unknown[]) => post(base, "/messages", { model: "claude-sonnet-4-5", max_tokens: 10, messages: msgs });

describe("fail closed: masking failures (502)", () => {
  it("a detector that throws refuses the request with a stable code, and neither logs nor returns the text", async () => {
    const provider = await fakeProvider();
    const { base, events } = await startLlm(provider.url);
    boom.on = TCKN;
    const res = await chat(base, [{ role: "user", content: `TC ${TCKN}` }]);
    expect(res.status).toBe(502);
    expect(res.headers.get("x-guardbee-error")).toBe("guardbee_masking_failed");
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ error: { type: "api_error", code: "guardbee_masking_failed" } });
    expect(text).not.toContain(TCKN);
    expect(provider.seen).toHaveLength(0);
    expect(events).toContainEqual(expect.objectContaining({ type: "blocked", ruleId: "pii:masking-failed", reason: "masking failed (TypeError)" }));
    expect(JSON.stringify(events)).not.toContain(TCKN);
  });

  it("a block pattern over its time budget refuses with the same code, in the Anthropic error shape too", async () => {
    const provider = await fakeProvider();
    const { base, events } = await startLlm(provider.url, {}, { piiMasking: { enabled: true, blockPatterns: ["(a+)+b"] } });
    const res = await messages(base, [{ role: "user", content: "a".repeat(40) }]);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ type: "error", error: { type: "api_error", code: "guardbee_masking_failed" } });
    expect(provider.seen).toHaveLength(0);
    expect(events.some((e) => e.ruleId === "pii:pattern-timeout")).toBe(true);
  });

  it("checks before masking fail closed too: the egress-secret scan throwing still sends nothing", async () => {
    const provider = await fakeProvider();
    // Masking off: only the earlier checks run
    const { base } = await startLlm(provider.url, {}, { piiMasking: { enabled: false } });
    boom.on = "hello";
    const res = await chat(base, [{ role: "user", content: "hello" }]);
    expect(res.status).toBe(502);
    expect(provider.seen).toHaveLength(0);
  });

  it("an answer that cannot be masked is withheld, not passed on", async () => {
    const provider = await fakeProvider(`yanıt ${TCKN}`);
    const { base, events } = await startLlm(provider.url, { maskResponses: true });
    boom.on = TCKN;
    const res = await chat(base, [{ role: "user", content: "hi" }]);
    const text = await res.text();
    expect(text).not.toContain(TCKN);
    expect(text).toContain("[GuardBee: withheld, masking failed]");
    expect(events.some((e) => e.type === "blocked" && e.ruleId === "pii:masking-failed")).toBe(true);
  });
});

describe("fail closed: content the proxy cannot read (415)", () => {
  it("refuses OpenAI audio and file parts", async () => {
    const provider = await fakeProvider();
    const { base, events } = await startLlm(provider.url);
    const res = await chat(base, [
      {
        role: "user",
        content: [
          { type: "text", text: "transcribe" },
          { type: "input_audio", input_audio: { data: "UklGR", format: "wav" } },
          { type: "file", file: { file_data: "data:application/pdf;base64,JVBER" } },
        ],
      },
    ]);
    expect(res.status).toBe(415);
    expect(res.headers.get("x-guardbee-error")).toBe("guardbee_unmaskable_content");
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain('content part "input_audio", content part "file"');
    expect(provider.seen).toHaveLength(0);
    expect(events.some((e) => e.ruleId === "pii:unmaskable")).toBe(true);
  });

  it("refuses an Anthropic PDF document but masks a text document", async () => {
    const provider = await fakeProvider();
    const { base } = await startLlm(provider.url);
    const pdf = await messages(base, [{ role: "user", content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBER" } }] }]);
    expect(pdf.status).toBe(415);
    expect(provider.seen).toHaveLength(0);

    const text = await messages(base, [
      { role: "user", content: [{ type: "document", title: `Dosya ${TCKN}`, source: { type: "text", media_type: "text/plain", data: `TC ${TCKN}` } }] },
    ]);
    expect(text.status).toBe(200);
    expect(JSON.stringify(provider.seen[0])).not.toContain(TCKN);
  });

  it("refuses an unknown block from the user, but passes the model's own thinking in an assistant turn", async () => {
    const provider = await fakeProvider();
    const { base } = await startLlm(provider.url);
    const unknown = await messages(base, [{ role: "user", content: [{ type: "search_result", source: "x", title: "t", content: [] }] }]);
    expect(unknown.status).toBe(415);

    const thinking = await messages(base, [
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "thinking", thinking: "…", signature: "sig" }, { type: "text", text: "hello" }] },
      { role: "user", content: "again" },
    ]);
    expect(thinking.status).toBe(200);
  });

  it("passes images on, as the README says", async () => {
    const provider = await fakeProvider();
    const { base } = await startLlm(provider.url);
    const res = await chat(base, [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,iVBOR" } }] }]);
    expect(res.status).toBe(200);
  });
});

describe("fail closed: a text too long to mask (413)", () => {
  it("is refused per text, not per request", async () => {
    const provider = await fakeProvider();
    const { base } = await startLlm(provider.url, { maxTextChars: 100 });
    const one = await chat(base, [{ role: "user", content: "x".repeat(101) }]);
    expect(one.status).toBe(413);
    expect(one.headers.get("x-guardbee-error")).toBe("guardbee_text_too_large");
    expect(((await one.json()) as { error: { message: string } }).error.message).toContain("split it into smaller messages");
    expect(provider.seen).toHaveLength(0);

    const split = await chat(base, [
      { role: "user", content: "x".repeat(100) },
      { role: "user", content: "x".repeat(100) },
    ]);
    expect(split.status).toBe(200);
  });
});

describe("masking: off on a route", () => {
  it("passes PII and unreadable parts through, and writes it to the audit log every time", async () => {
    const provider = await fakeProvider();
    const { base, events } = await startLlm(provider.url, {
      routes: [
        { model: "gpt-4o-internal", provider: "oai", masking: "off" },
        { model: "gpt-*", provider: "oai" },
      ],
    });
    const res = await chat(base, [{ role: "user", content: [{ type: "text", text: `TC ${TCKN}` }, { type: "input_audio", input_audio: { data: "UklGR", format: "wav" } }] }], "gpt-4o-internal");
    expect(res.status).toBe(200);
    expect(JSON.stringify(provider.seen[0])).toContain(TCKN);
    expect(events).toContainEqual(expect.objectContaining({ type: "warn", ruleId: "pii:masking-off", reason: 'PII masking is off for route "gpt-4o-internal" (llm.routes)' }));
    // PII is still counted
    expect(events.find((e) => e.type === "tool_call")?.piiHits).toEqual({ tc_kimlik: 1 });

    // Other routes still mask
    await chat(base, [{ role: "user", content: `TC ${TCKN}` }]);
    expect(JSON.stringify(provider.seen[1])).not.toContain(TCKN);
  });

  it("is read from guardbee-proxy.yaml as the string off", () => {
    const raw = parseYaml("providers: { oai: { api: openai, baseUrl: https://api.openai.com/v1, apiKeyEnv: OPENAI_API_KEY } }\nroutes:\n  - { model: gpt-4o, provider: oai, masking: off }\n");
    expect(llmSchema.parse(raw).routes[0]).toEqual({ model: "gpt-4o", provider: "oai", masking: "off" });
  });
});

describe("fail closed in the MCP gateway", () => {
  it("withholds a tool result when masking throws, with a stable code and without the text", async () => {
    const events: AuditEvent[] = [];
    const audit = { log: (event: AuditEvent) => events.push(event), close: async () => {} } as unknown as AuditLogger;
    const crm = fakeUpstream("crm", [{ name: "get_customer", returns: `TC ${TCKN}` }]);
    const gw = new Gateway([crm], gatewayConfig({ interceptors: { piiMasking: { enabled: true } } }), audit);
    await gw.listTools();
    boom.on = TCKN;
    const err = await gw.callTool("crm__get_customer", {}).then(
      () => null,
      (e: unknown) => e as { message: string; data?: unknown },
    );
    expect(err?.message).toContain("Result withheld: masking failed (TypeError)");
    expect(err?.message).not.toContain(TCKN);
    expect(err?.data).toEqual({ guardbee: "guardbee_masking_failed" });
    expect(events.some((e) => e.type === "tool_response")).toBe(false);
    expect(JSON.stringify(events)).not.toContain(TCKN);
  });
});
