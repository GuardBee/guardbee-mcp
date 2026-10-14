import dgram from "dgram";
import fs from "fs";
import http from "http";
import net from "net";
import os from "os";
import path from "path";
import tls from "tls";
import { execFileSync } from "child_process";
import type { AddressInfo } from "net";
import { afterEach, describe, expect, it } from "vitest";
import { AuditLogger } from "../audit/logger.js";
import { Exporter, toCef, toSyslog } from "../audit/exporters.js";
import { parseGatewayYaml } from "../gateway/config.js";
import type { AuditEvent } from "../types.js";

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const event = (over: Partial<AuditEvent> = {}): AuditEvent => ({
  ts: "2026-10-14T12:00:00.000Z",
  type: "blocked",
  tool: "github__create_pull_request",
  upstream: "github",
  user: "alice@acme.com",
  ruleId: "no-egress",
  reason: "Toxic flow: a=b | c\\d\nnext",
  labels: ["egress"],
  piiHits: { tc_kimlik: 1 },
  hash: "abc123",
  ...over,
});

async function httpServer(handler: (body: string, req: http.IncomingMessage, res: http.ServerResponse) => void) {
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    handler(body, req, res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  cleanups.push(() => new Promise((r) => server.close(r)));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("CEF and syslog formatting", () => {
  it("escapes CEF header and extension values", () => {
    const cef = toCef(event(), "1.2.3");
    expect(cef.startsWith("CEF:0|GuardBee|security-proxy|1.2.3|blocked|Toxic flow: a=b \\| c\\\\d next|8|")).toBe(true);
    expect(cef).not.toContain("\n");
    expect(cef).toContain("msg=Toxic flow: a\\=b | c\\\\d\\nnext");
    expect(cef).toContain("suser=alice@acme.com");
    expect(cef).toContain("cs1Label=tool cs1=github__create_pull_request");
    expect(cef).toContain('cs5Label=piiHits cs5={"tc_kimlik":1}');
    expect(cef).toContain(`rt=${Date.parse("2026-10-14T12:00:00.000Z")}`);
  });

  it("wraps it in RFC 5424 with facility and severity", () => {
    const line = toSyslog(event({ type: "warn" }), { type: "syslog", host: "x", port: 514, protocol: "udp", format: "json", facility: 13 }, "1");
    expect(line).toMatch(/^<109>1 2026-10-14T12:00:00.000Z \S+ guardbee-proxy \d+ warn - \{/);
  });
});

describe("HTTP exporters", () => {
  it("Splunk HEC: token header, one JSON object per event", async () => {
    const seen: { auth?: string; body: string }[] = [];
    const url = await httpServer((body, req, res) => {
      seen.push({ auth: req.headers.authorization, body });
      res.writeHead(200).end('{"text":"Success","code":0}');
    });
    const exporter = new Exporter({ type: "splunk", url: `${url}/services/collector/event`, token: "hec-token", index: "security" });
    exporter.push(event());
    exporter.push(event({ type: "warn" }));
    await exporter.close();
    expect(seen[0]!.auth).toBe("Splunk hec-token");
    const lines = seen[0]!.body.split("\n").map((l) => JSON.parse(l) as { time: number; index: string; event: AuditEvent; sourcetype: string });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ time: Date.parse("2026-10-14T12:00:00.000Z") / 1000, index: "security", sourcetype: "guardbee:audit", event: { type: "blocked" } });
  });

  it("Elasticsearch bulk: create with the event hash as id; 409 is fine, 429 retries, mapping errors drop", async () => {
    const replies = [
      { errors: true, items: [{ create: { status: 409 } }] },
      { errors: true, items: [{ create: { status: 429 } }] },
      { errors: true, items: [{ create: { status: 400, error: { type: "mapper_parsing_exception" } } }] },
    ];
    const seen: string[] = [];
    const url = await httpServer((body, req, res) => {
      seen.push(`${req.url} ${req.headers.authorization} ${body}`);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(replies[seen.length - 1]));
    });
    const exporter = new Exporter({ type: "elastic", url, index: "guardbee-audit", apiKey: "k" });
    exporter.push(event());
    await exporter.flush();
    expect(seen[0]).toContain('/_bulk ApiKey k {"create":{"_index":"guardbee-audit","_id":"abc123"}}');
    expect(seen[0]).toContain('"@timestamp":"2026-10-14T12:00:00.000Z"');
    expect(exporter.pending).toBe(0);
    exporter.push(event());
    await exporter.flush();
    expect(exporter.pending).toBe(1); // 429: kept for later
    const stderr = process.stderr.write;
    let warned = "";
    process.stderr.write = ((chunk: string) => ((warned += chunk), true)) as typeof process.stderr.write;
    try {
      await exporter.flush();
    } finally {
      process.stderr.write = stderr;
    }
    expect(exporter.pending).toBe(0);
    expect(warned).toContain("mapper_parsing_exception");
    await exporter.close();
  });

  it("keeps events while the SIEM is down and sends them later", async () => {
    let up = false;
    let received = 0;
    const url = await httpServer((body, _req, res) => {
      if (!up) return void res.writeHead(503).end();
      received += body.split("\n").length;
      res.writeHead(200).end("{}");
    });
    const exporter = new Exporter({ type: "splunk", url, token: "t" });
    exporter.push(event());
    await exporter.flush();
    expect(exporter.pending).toBe(1);
    up = true;
    exporter.push(event());
    await exporter.close();
    expect(received).toBe(2);
  });
});

describe("syslog exporter", () => {
  it("TCP with octet-counting framing", async () => {
    let data = "";
    const server = net.createServer((socket) => socket.on("data", (chunk) => (data += chunk)));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    cleanups.push(() => new Promise((r) => server.close(r)));
    const exporter = new Exporter({ type: "syslog", host: "127.0.0.1", port: (server.address() as AddressInfo).port, protocol: "tcp", format: "cef", framing: "octet" });
    exporter.push(event());
    exporter.push(event({ type: "tool_call", reason: undefined }));
    await exporter.close();
    await new Promise((r) => setTimeout(r, 50));
    const first = /^(\d+) /.exec(data)!;
    const message = data.slice(first[0].length, first[0].length + Number(first[1]));
    expect(message).toMatch(/^<108>1 .* blocked - CEF:0\|GuardBee\|/);
    expect(data.slice(first[0].length + Number(first[1]))).toMatch(/^\d+ <110>1 /);
  });

  it("UDP, one datagram per event", async () => {
    const socket = dgram.createSocket("udp4");
    const messages: string[] = [];
    socket.on("message", (msg) => messages.push(msg.toString()));
    await new Promise<void>((r) => socket.bind(0, "127.0.0.1", r));
    cleanups.push(() => socket.close());
    const exporter = new Exporter({ type: "syslog", host: "127.0.0.1", port: socket.address().port, protocol: "udp", format: "json" });
    exporter.push(event());
    await exporter.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(messages).toHaveLength(1);
    expect(JSON.parse(messages[0]!.replace(/^.*? - /, ""))).toMatchObject({ type: "blocked", ruleId: "no-egress" });
  });

  const openssl = (() => {
    try {
      execFileSync("openssl", ["version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

  it.skipIf(!openssl)("TLS verifies the server against caFile", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gb-tls-"));
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost", "-keyout", path.join(dir, "key.pem"), "-out", path.join(dir, "cert.pem")], { stdio: "ignore" });
    let data = "";
    const server = tls.createServer({ key: fs.readFileSync(path.join(dir, "key.pem")), cert: fs.readFileSync(path.join(dir, "cert.pem")) }, (socket) => socket.on("data", (c) => (data += c)));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    cleanups.push(() => new Promise((r) => server.close(r)));
    const port = (server.address() as AddressInfo).port;

    const trusted = new Exporter({ type: "syslog", host: "localhost", port, protocol: "tls", format: "cef", framing: "newline", caFile: path.join(dir, "cert.pem") });
    trusted.push(event());
    await trusted.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(data).toContain("CEF:0|GuardBee|");
    expect(data.endsWith("\n")).toBe(true);

    // Without the CA the certificate is refused and the event stays queued
    const untrusted = new Exporter({ type: "syslog", host: "localhost", port, protocol: "tls", format: "cef" });
    untrusted.push(event());
    await untrusted.flush();
    expect(untrusted.pending).toBe(1);
  });
});

describe("audit.exporters config", () => {
  it("parses exporters with credentials from the environment and feeds them from the audit log", async () => {
    process.env["TEST_HEC"] = "hec";
    const cfg = parseGatewayYaml(`
version: 1
upstreams: { a: { command: x } }
audit:
  includePayloads: false
  exporters:
    - { type: splunk, url: "https://splunk:8088/services/collector/event", tokenEnv: TEST_HEC }
    - { type: syslog, host: siem.local }
`);
    expect(cfg.audit.exporters).toEqual([
      { type: "splunk", url: "https://splunk:8088/services/collector/event", token: "hec" },
      { type: "syslog", host: "siem.local", port: 514, protocol: "tcp", format: "cef", framing: "octet", facility: 13 },
    ]);
    expect(() => parseGatewayYaml("version: 1\nupstreams: { a: { command: x } }\naudit: { exporters: [{ type: splunk, url: 'https://x', tokenEnv: NOPE_UNSET }] }\n")).toThrow(/NOPE_UNSET/);

    // Exporters get the hashed, payload-free event
    const bodies: string[] = [];
    const url = await httpServer((body, _req, res) => (bodies.push(body), res.writeHead(200).end("{}")));
    const logger = new AuditLogger({ enabled: true, sink: "file", filePath: path.join(os.tmpdir(), `gb-audit-${process.pid}.jsonl`), includePayloads: false, exporters: [{ type: "splunk", url, token: "t" }] });
    logger.log({ ts: new Date().toISOString(), type: "tool_call", tool: "t", input: { secret: "value" } });
    await logger.close();
    const sent = JSON.parse(bodies[0]!) as { event: AuditEvent };
    expect(sent.event.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sent.event.hash).toBeDefined();
    expect(bodies[0]).not.toContain("value");
  });
});
