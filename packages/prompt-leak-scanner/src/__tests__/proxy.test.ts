import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "http";
import { startProxy, type AuditEvent } from "../proxy.js";

let proxyServer: Server | undefined;
let upstreamServer: Server | undefined;

afterEach(async () => {
  if (proxyServer) await new Promise((r) => proxyServer!.close(r));
  if (upstreamServer) await new Promise((r) => upstreamServer!.close(r));
  proxyServer = undefined;
  upstreamServer = undefined;
});

function startMockUpstream(): Promise<{ port: number; receivedBodies: string[] }> {
  const receivedBodies: string[] = [];
  return new Promise((resolve) => {
    upstreamServer = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        receivedBodies.push(Buffer.concat(chunks).toString("utf8"));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, echoPath: req.url }));
      });
    });
    upstreamServer.listen(0, "127.0.0.1", () => resolve({ port: (upstreamServer!.address() as { port: number }).port, receivedBodies }));
  });
}

function postJson(port: number, path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, json: await res.json() }));
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as { port: number }).port;
      probe.close(() => resolve(port));
    });
  });
}

describe("startProxy — monitor mode", () => {
  it("temiz bir body'yi değiştirmeden upstream'e iletir", async () => {
    const { port: upstreamPort, receivedBodies } = await startMockUpstream();
    const proxyPort = await freePort();
    const audits: AuditEvent[] = [];
    proxyServer = startProxy({ port: proxyPort, upstream: `http://127.0.0.1:${upstreamPort}`, mode: "monitor", onAudit: (e) => audits.push(e) });

    const body = { messages: [{ role: "user", content: "hello there" }] };
    const { status } = await postJson(proxyPort, "/v1/chat/completions", body);

    expect(status).toBe(200);
    expect(JSON.parse(receivedBodies[0])).toEqual(body);
    expect(audits[0]).toMatchObject({ blocked: false, findingCount: 0 });
  });

  it("secret içeren bir body'yi DEĞİŞTİRMEDEN iletir (monitor sadece loglar)", async () => {
    const { port: upstreamPort, receivedBodies } = await startMockUpstream();
    const proxyPort = await freePort();
    const audits: AuditEvent[] = [];
    proxyServer = startProxy({ port: proxyPort, upstream: `http://127.0.0.1:${upstreamPort}`, mode: "monitor", onAudit: (e) => audits.push(e) });

    const body = { messages: [{ role: "user", content: "my key is sk-abcdefghijklmnopqrstuvwx" }] };
    await postJson(proxyPort, "/v1/chat/completions", body);

    expect(JSON.parse(receivedBodies[0])).toEqual(body);
    expect(audits[0]).toMatchObject({ findingCount: 1 });
    expect(audits[0].findingCodes).toContain("openai_api_key");
  });

  it("audit event ham secret değerini içermez", async () => {
    const { port: upstreamPort } = await startMockUpstream();
    const proxyPort = await freePort();
    const audits: AuditEvent[] = [];
    proxyServer = startProxy({ port: proxyPort, upstream: `http://127.0.0.1:${upstreamPort}`, mode: "monitor", onAudit: (e) => audits.push(e) });

    await postJson(proxyPort, "/v1/chat/completions", { messages: [{ role: "user", content: "my key is sk-abcdefghijklmnopqrstuvwx" }] });

    const serialized = JSON.stringify(audits[0]);
    expect(serialized).not.toContain("sk-abcdefghijklmnopqrstuvwx");
  });
});

describe("startProxy — redact mode", () => {
  it("secret içeren body'yi redakte edilmiş haliyle upstream'e iletir", async () => {
    const { port: upstreamPort, receivedBodies } = await startMockUpstream();
    const proxyPort = await freePort();
    proxyServer = startProxy({ port: proxyPort, upstream: `http://127.0.0.1:${upstreamPort}`, mode: "redact" });

    await postJson(proxyPort, "/v1/chat/completions", { messages: [{ role: "user", content: "my key is sk-abcdefghijklmnopqrstuvwx" }] });

    const forwarded = JSON.parse(receivedBodies[0]);
    expect(forwarded.messages[0].content).toBe("my key is [REDACTED:openai_api_key]");
  });
});

describe("startProxy — block mode", () => {
  it("critical bulgu varsa isteği upstream'e hiç iletmeden 400 döner", async () => {
    const { port: upstreamPort, receivedBodies } = await startMockUpstream();
    const proxyPort = await freePort();
    proxyServer = startProxy({ port: proxyPort, upstream: `http://127.0.0.1:${upstreamPort}`, mode: "block", failOnSeverity: "high" });

    const { status, json } = await postJson(proxyPort, "/v1/chat/completions", { messages: [{ role: "user", content: "my key is sk-abcdefghijklmnopqrstuvwx" }] });

    expect(status).toBe(400);
    expect((json as { error: string }).error).toBe("blocked_by_guardbee_prompt_leak_scanner");
    expect(receivedBodies).toHaveLength(0);
  });

  it("temiz bir body'yi normal şekilde iletir", async () => {
    const { port: upstreamPort, receivedBodies } = await startMockUpstream();
    const proxyPort = await freePort();
    proxyServer = startProxy({ port: proxyPort, upstream: `http://127.0.0.1:${upstreamPort}`, mode: "block" });

    const { status } = await postJson(proxyPort, "/v1/chat/completions", { messages: [{ role: "user", content: "hello" }] });

    expect(status).toBe(200);
    expect(receivedBodies).toHaveLength(1);
  });
});
