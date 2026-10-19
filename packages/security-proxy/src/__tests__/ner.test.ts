import http from "http";
import type { AddressInfo } from "net";
import { afterEach, describe, expect, it } from "vitest";
import type { AuditLogger } from "../audit/logger.js";
import { parseGatewayYaml, type GatewayConfig } from "../gateway/config.js";
import { Gateway } from "../gateway/gateway.js";
import { NerError, nerDetectorFor, scanNames } from "../gateway/ner.js";
import { startHttpGateway } from "../http-server.js";
import type { AuditEvent, ProxyConfig } from "../types.js";
import { fakeUpstream, gatewayConfig, textOf } from "./fakes.js";

const NAME = "Ayşe Yılmaz";
const TCKN = "10000000146";
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function listen(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const readJson = async (req: http.IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
};

/** A guardbee-ner stand-in that tags every "Ayşe Yılmaz"; `status` other than 200 makes it fail. */
async function fakeSidecar(options: { status?: number; delayMs?: number } = {}) {
  const requests: { texts: string[]; authorization?: string }[] = [];
  const url = await listen(async (req, res) => {
    const body = (await readJson(req)) as { texts: string[] };
    requests.push({ texts: body.texts, ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}) });
    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    if (options.status && options.status !== 200) {
      res.writeHead(options.status).end();
      return;
    }
    const spans = body.texts.map((text) => {
      const at = text.indexOf(NAME);
      return at < 0 ? [] : [{ start: at, end: at + NAME.length, detector: "person_name" }];
    });
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ spans }));
  });
  return { url, requests };
}

function capture() {
  const events: AuditEvent[] = [];
  return { events, audit: { log: (event: AuditEvent) => events.push(event), close: async () => {} } as unknown as AuditLogger };
}

function gateway(returns: string, overrides: Partial<GatewayConfig>) {
  const upstream = fakeUpstream("crm", [{ name: "get_customer", returns }, { name: "update_note" }]);
  const { events, audit } = capture();
  return { gw: new Gateway([upstream], gatewayConfig(overrides), audit), upstream, events };
}

describe("ner: names in tool results", () => {
  it("masks the names the sidecar found, in the same pass as the regex detectors", async () => {
    const sidecar = await fakeSidecar();
    const { gw, events } = gateway(`${NAME} aradı, TC ${TCKN}`, { ner: { url: sidecar.url, timeoutMs: 2000 } });
    const text = textOf(await gw.callTool("crm__get_customer", {}));
    expect(text).toMatch(/^\[KİŞİ\] aradı, TC \[/);
    expect(text).not.toContain(TCKN);
    // One request for every string in the result (content types included, each once)
    expect(sidecar.requests).toEqual([{ texts: ["text", `${NAME} aradı, TC ${TCKN}`] }]);
    // A name is personal data: it counts under its own category, not as a secret
    expect(events.find((e) => e.type === "tool_response")?.piiHits).toEqual({ person_name: 1, tc_kimlik: 1 });
  });

  it("tokenizes a name, and puts it back when the agent passes the token on", async () => {
    const sidecar = await fakeSidecar();
    const { gw, upstream } = gateway(`Müşteri: ${NAME}`, { ner: { url: sidecar.url, timeoutMs: 2000 }, interceptors: { piiMasking: { enabled: true, mode: "tokenize" } } });
    const text = textOf(await gw.callTool("crm__get_customer", {}));
    const token = text.match(/<pii:person_name:[0-9a-f]{8}>/)?.[0];
    expect(token).toBeDefined();
    await gw.callTool("crm__update_note", { about: token });
    expect(upstream.calls.at(-1)).toEqual({ tool: "update_note", args: { about: NAME } });
  });

  it("sends the bearer token, and does not ask the model when masking is off", async () => {
    const sidecar = await fakeSidecar();
    const { gw } = gateway(NAME, { ner: { url: sidecar.url, token: "s3cret", timeoutMs: 2000 } });
    await gw.callTool("crm__get_customer", {});
    expect(sidecar.requests[0]?.authorization).toBe("Bearer s3cret");

    const off = gateway(NAME, { ner: { url: sidecar.url, timeoutMs: 2000 }, interceptors: { piiMasking: { enabled: false } } });
    expect(textOf(await off.gw.callTool("crm__get_customer", {}))).toBe(NAME);
    expect(sidecar.requests).toHaveLength(1);
  });

  it("withholds the result when the sidecar fails, times out or is down, and logs no text", async () => {
    const failing = await fakeSidecar({ status: 500 });
    const slow = await fakeSidecar({ delayMs: 500 });
    for (const [ner, reason] of [
      [{ url: failing.url, timeoutMs: 2000 }, "the NER sidecar answered HTTP 500"],
      [{ url: slow.url, timeoutMs: 50 }, "the NER sidecar did not answer in 50 ms"],
      [{ url: "http://127.0.0.1:9", timeoutMs: 2000 }, "the NER sidecar is unreachable"],
    ] as const) {
      const { gw, events } = gateway(`${NAME} ${TCKN}`, { ner });
      await expect(gw.callTool("crm__get_customer", {})).rejects.toThrow(/Result withheld: name detection failed/);
      const blocked = events.find((e) => e.type === "blocked");
      expect(blocked).toMatchObject({ ruleId: "pii:ner-failed" });
      expect(blocked?.reason).toContain(reason);
      expect(JSON.stringify(events)).not.toContain(NAME);
    }
  });

  it("covers resources and prompt templates too", async () => {
    const sidecar = await fakeSidecar();
    const upstream = fakeUpstream("docs", [], [{ uri: "file:///a.txt", name: "a", text: `Yazan: ${NAME}` }]);
    const gw = new Gateway([upstream], gatewayConfig({ ner: { url: sidecar.url, timeoutMs: 2000 } }), capture().audit);
    const read = await gw.readResource("file:///a.txt");
    expect((read.contents[0] as { text: string }).text).toBe("Yazan: [KİŞİ]");
  });
});

describe("ner: scanNames", () => {
  it("asks once per distinct string, and refuses a string it was not given", async () => {
    let calls = 0;
    const lookup = await scanNames(
      {
        async detect(texts) {
          calls++;
          return texts.map(() => []);
        },
      },
      { a: "Ali", b: ["Ali", "Veli"], n: 42 },
    );
    expect(calls).toBe(1);
    expect(lookup("Veli")).toEqual([]);
    // No letters, no names: digits and punctuation need no model
    expect(lookup("12:30")).toEqual([]);
    expect(() => lookup("Ahmet")).toThrow(NerError);
  });

  it("refuses an answer that does not cover every text", async () => {
    await expect(scanNames({ detect: async () => [] }, ["Ali"])).rejects.toThrow(/answered for 0 of 1/);
  });

  it("shares one detector per config, so the model loads once", () => {
    const config = { url: "http://127.0.0.1:1", timeoutMs: 1000 };
    expect(nerDetectorFor(config)).toBe(nerDetectorFor(config));
  });
});

describe("ner: LLM requests", () => {
  async function startLlm(providerUrl: string, ner: GatewayConfig["ner"], interceptors: NonNullable<ProxyConfig["interceptors"]> = { piiMasking: { enabled: true } }) {
    const { events, audit } = capture();
    const config = gatewayConfig({
      interceptors,
      ...(ner ? { ner } : {}),
      llm: {
        path: "/v1",
        providers: { oai: { name: "oai", api: "openai", baseUrl: `${providerUrl}/v1`, apiKey: "sk-openai", headers: {} } },
        routes: [{ model: "gpt-*", provider: "oai" }],
        keys: [{ key: "gb-alice", user: "alice", groups: [] }],
        pricing: {},
        budgets: [],
        access: [],
        accessDefault: "allow",
        maskResponses: false,
        timeoutSeconds: 10,
      },
    });
    const gw = await startHttpGateway([], config, audit, { transport: "http", host: "127.0.0.1", port: 0, path: "/mcp", apiKeys: [], maxSessions: 10 });
    cleanups.push(() => gw.close());
    return { base: gw.llmUrl!, events };
  }

  async function fakeProvider() {
    const seen: Record<string, unknown>[] = [];
    const url = await listen(async (req, res) => {
      seen.push(await readJson(req));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "c", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] }));
    });
    return { url, seen };
  }

  const chat = (base: string, content: string) =>
    fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { authorization: "Bearer gb-alice", "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "system", content: "Kısa yaz." }, { role: "user", content }] }),
    });

  it("masks names in the prompt before it reaches the provider", async () => {
    const sidecar = await fakeSidecar();
    const provider = await fakeProvider();
    const { base } = await startLlm(provider.url, { url: sidecar.url, timeoutMs: 2000 });
    expect((await chat(base, `${NAME} için dilekçe yaz`)).status).toBe(200);
    expect(JSON.stringify(provider.seen[0])).toContain("[KİŞİ] için dilekçe yaz");
    expect(JSON.stringify(provider.seen[0])).not.toContain(NAME);
    expect(sidecar.requests).toHaveLength(1);
    expect(sidecar.requests[0]!.texts).toEqual(expect.arrayContaining(["Kısa yaz.", `${NAME} için dilekçe yaz`]));
  });

  it("sends nothing when the sidecar fails (502, the masking-failed code)", async () => {
    const sidecar = await fakeSidecar({ status: 503 });
    const provider = await fakeProvider();
    const { base, events } = await startLlm(provider.url, { url: sidecar.url, timeoutMs: 2000 });
    const res = await chat(base, `${NAME} için dilekçe yaz`);
    expect(res.status).toBe(502);
    expect(res.headers.get("x-guardbee-error")).toBe("guardbee_masking_failed");
    expect(await res.text()).not.toContain(NAME);
    expect(provider.seen).toHaveLength(0);
    expect(events).toContainEqual(expect.objectContaining({ type: "blocked", ruleId: "pii:ner-failed" }));
  });

  it("does not ask the model when masking is off", async () => {
    const sidecar = await fakeSidecar();
    const provider = await fakeProvider();
    const { base } = await startLlm(provider.url, { url: sidecar.url, timeoutMs: 2000 }, { piiMasking: { enabled: false } });
    expect((await chat(base, NAME)).status).toBe(200);
    expect(sidecar.requests).toHaveLength(0);
  });
});

describe("ner: config", () => {
  const yaml = (ner: string) => `version: 1\nupstreams:\n  crm:\n    command: crm-mcp\nner:\n${ner}`;

  it("reads a sidecar with its token from the environment, or an in-process model", () => {
    process.env["TEST_NER_TOKEN"] = "s3cret";
    expect(parseGatewayYaml(yaml("  url: http://127.0.0.1:8765\n  tokenEnv: TEST_NER_TOKEN")).ner).toEqual({ url: "http://127.0.0.1:8765", token: "s3cret", timeoutMs: 5000 });
    expect(parseGatewayYaml(yaml("  modelDir: /opt/guardbee/ner\n  timeoutMs: 1000")).ner).toEqual({ modelDir: "/opt/guardbee/ner", timeoutMs: 1000 });
    expect(parseGatewayYaml(yaml("  {}")).ner).toEqual({ timeoutMs: 5000 });
    delete process.env["TEST_NER_TOKEN"];
  });

  it("refuses plain http to another host, a token without a url, and both modes at once", () => {
    expect(() => parseGatewayYaml(yaml("  url: http://ner.internal:8765"))).toThrow(/use https:\/\/ for a sidecar on another host/);
    expect(() => parseGatewayYaml(yaml("  url: https://ner.internal"))).not.toThrow();
    expect(() => parseGatewayYaml(yaml("  url: http://[::1]:8765"))).not.toThrow();
    expect(() => parseGatewayYaml(yaml("  tokenEnv: X"))).toThrow(/tokenEnv is for a sidecar/);
    expect(() => parseGatewayYaml(yaml("  url: http://127.0.0.1:8765\n  modelDir: /x"))).toThrow(/not both/);
    expect(() => parseGatewayYaml(yaml("  url: http://127.0.0.1:8765\n  tokenEnv: MISSING_NER_TOKEN"))).toThrow(/MISSING_NER_TOKEN/);
  });
});
