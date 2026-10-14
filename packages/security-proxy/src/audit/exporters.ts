import dgram from "dgram";
import fs from "fs";
import net from "net";
import os from "os";
import tls from "tls";
import type { AuditEvent } from "../types.js";
import { BatchQueue, type SendOutcome } from "./batch-queue.js";

/** Audit events to a SIEM: Splunk HEC, Elasticsearch/OpenSearch bulk, or syslog (RFC 5424 or CEF). */
export type ExporterConfig =
  | {
      type: "splunk";
      /** HEC endpoint, e.g. https://splunk:8088/services/collector/event */
      url: string;
      token: string;
      index?: string;
      sourcetype?: string;
      batchSize?: number;
      flushIntervalMs?: number;
    }
  | {
      type: "elastic";
      /** Cluster URL; events go to <url>/_bulk */
      url: string;
      index: string;
      /** `ApiKey` header value, or basic auth. */
      apiKey?: string;
      username?: string;
      password?: string;
      batchSize?: number;
      flushIntervalMs?: number;
    }
  | {
      type: "syslog";
      host: string;
      port: number;
      protocol: "udp" | "tcp" | "tls";
      format: "cef" | "json";
      /** TCP/TLS framing (RFC 6587): octet counting (default) or a newline after each message. */
      framing?: "octet" | "newline";
      facility?: number;
      appName?: string;
      /** TLS: a CA file for a private CA; certificates are always verified. */
      caFile?: string;
      batchSize?: number;
      flushIntervalMs?: number;
    };

const REQUEST_TIMEOUT_MS = 10_000;
const PERMANENT = new Set([400, 401, 403, 404, 413]);
const HOST = os.hostname();

/** blocked / toxic_flow are what a SOC acts on; warn is worth a look; the rest is activity. */
function severity(event: AuditEvent): { cef: number; syslog: number } {
  if (event.type === "blocked" || event.type === "toxic_flow") return { cef: 8, syslog: 4 };
  if (event.type === "warn" || event.type === "approval") return { cef: 5, syslog: 5 };
  return { cef: 3, syslog: 6 };
}

function httpOutcome(status: number, name: string): SendOutcome {
  if (status >= 200 && status < 300) return { ok: true };
  if (PERMANENT.has(status)) return { drop: true, reason: `HTTP ${status}${status === 401 || status === 403 ? ` — check the ${name} credentials` : ""}` };
  return { retry: true };
}

function splunk(config: Extract<ExporterConfig, { type: "splunk" }>, fetchImpl: typeof fetch) {
  return async (events: AuditEvent[]): Promise<SendOutcome> => {
    // HEC takes several events in one body, one JSON object after another
    const body = events
      .map((event) =>
        JSON.stringify({
          time: Date.parse(event.ts) / 1000,
          host: HOST,
          source: "guardbee-proxy",
          sourcetype: config.sourcetype ?? "guardbee:audit",
          ...(config.index ? { index: config.index } : {}),
          event,
        }),
      )
      .join("\n");
    const response = await fetchImpl(config.url, {
      method: "POST",
      headers: { authorization: `Splunk ${config.token}`, "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return httpOutcome(response.status, "Splunk HEC token");
  };
}

function elastic(config: Extract<ExporterConfig, { type: "elastic" }>, fetchImpl: typeof fetch) {
  const auth = config.apiKey
    ? `ApiKey ${config.apiKey}`
    : config.username
      ? `Basic ${Buffer.from(`${config.username}:${config.password ?? ""}`).toString("base64")}`
      : null;
  return async (events: AuditEvent[]): Promise<SendOutcome> => {
    // create (not index): the hash makes the id, so a retried batch never duplicates
    const body =
      events
        .map((event) =>
          [JSON.stringify({ create: { _index: config.index, ...(event.hash ? { _id: event.hash } : {}) } }), JSON.stringify({ "@timestamp": event.ts, host: { name: HOST }, ...event })].join("\n"),
        )
        .join("\n") + "\n";
    const response = await fetchImpl(`${config.url.replace(/\/$/, "")}/_bulk`, {
      method: "POST",
      headers: { "content-type": "application/x-ndjson", ...(auth ? { authorization: auth } : {}) },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const outcome = httpOutcome(response.status, "Elasticsearch");
    if (!("ok" in outcome)) return outcome;
    // 200 with per-item results: 409 (already there) is fine, 429 means try again
    const result = (await response.json().catch(() => ({}))) as { errors?: boolean; items?: { create?: { status?: number; error?: { type?: string } } }[] };
    if (!result.errors) return outcome;
    const failed = (result.items ?? []).map((item) => item.create).filter((item) => item && item.status !== undefined && item.status >= 300 && item.status !== 409);
    if (failed.length === 0) return outcome;
    if (failed.some((item) => item!.status === 429)) return { retry: true };
    return { drop: true, reason: `bulk item errors (${[...new Set(failed.map((item) => item!.error?.type ?? item!.status))].join(", ")})` };
  };
}

// A header field may not span lines: a newline would split the syslog message
const cefHeader = (value: string) => value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
const cefValue = (value: string) => value.replace(/\\/g, "\\\\").replace(/=/g, "\\=").replace(/\r\n|\r|\n/g, "\\n");

/** ArcSight CEF: the SIEM-native shape most products parse without a custom extractor. */
export function toCef(event: AuditEvent, version: string): string {
  const name = event.reason ? event.reason.slice(0, 120) : `${event.type}${event.tool ? ` ${event.tool}` : ""}`;
  const fields: [string, string | undefined][] = [
    ["rt", String(Date.parse(event.ts))],
    ["act", event.type],
    ["suser", event.user],
    ["cs1Label", event.tool ? "tool" : undefined],
    ["cs1", event.tool],
    ["cs2Label", event.upstream ? "upstream" : undefined],
    ["cs2", event.upstream],
    ["cs3Label", event.ruleId ? "ruleId" : undefined],
    ["cs3", event.ruleId],
    ["cs4Label", event.sessionId ? "sessionId" : undefined],
    ["cs4", event.sessionId],
    ["cs5Label", event.piiHits ? "piiHits" : undefined],
    ["cs5", event.piiHits ? JSON.stringify(event.piiHits) : undefined],
    ["cs6Label", event.labels?.length ? "labels" : undefined],
    ["cs6", event.labels?.join(",")],
    ["msg", event.reason],
    ["externalId", event.hash],
  ];
  const extension = fields
    .filter((field): field is [string, string] => field[1] !== undefined && field[1] !== "")
    .map(([key, value]) => `${key}=${cefValue(value)}`)
    .join(" ");
  return `CEF:0|GuardBee|security-proxy|${cefHeader(version)}|${cefHeader(event.type)}|${cefHeader(name)}|${severity(event).cef}|${extension}`;
}

/** RFC 5424: <PRI>1 TIMESTAMP HOST APP PROCID MSGID - MSG */
export function toSyslog(event: AuditEvent, config: Extract<ExporterConfig, { type: "syslog" }>, version: string): string {
  const facility = config.facility ?? 13; // log audit
  const pri = facility * 8 + severity(event).syslog;
  const message = config.format === "cef" ? toCef(event, version) : JSON.stringify(event);
  return `<${pri}>1 ${event.ts} ${HOST} ${config.appName ?? "guardbee-proxy"} ${process.pid} ${event.type} - ${message}`;
}

function syslog(config: Extract<ExporterConfig, { type: "syslog" }>, version: string) {
  const ca = config.caFile ? fs.readFileSync(config.caFile) : undefined;
  if (config.protocol === "udp") {
    const socket = dgram.createSocket(net.isIPv6(config.host) ? "udp6" : "udp4");
    socket.unref();
    return async (events: AuditEvent[]): Promise<SendOutcome> => {
      for (const event of events) {
        await new Promise<void>((resolve, reject) => socket.send(Buffer.from(toSyslog(event, config, version)), config.port, config.host, (err) => (err ? reject(err) : resolve())));
      }
      return { ok: true };
    };
  }
  // TCP / TLS: one connection per batch, framed so the receiver can split messages
  return (events: AuditEvent[]): Promise<SendOutcome> =>
    new Promise((resolve, reject) => {
      const frame = (message: string) => (config.framing === "newline" ? `${message}\n` : `${Buffer.byteLength(message)} ${message}`);
      const payload = events.map((event) => frame(toSyslog(event, config, version))).join("");
      const onConnect = () => socket.end(payload, () => resolve({ ok: true }));
      const socket =
        config.protocol === "tls"
          ? tls.connect({ host: config.host, port: config.port, servername: net.isIP(config.host) ? undefined : config.host, ...(ca ? { ca } : {}) }, onConnect)
          : net.connect({ host: config.host, port: config.port }, onConnect);
      socket.setTimeout(REQUEST_TIMEOUT_MS, () => socket.destroy(new Error("syslog connection timed out")));
      socket.on("error", reject);
    });
}

/** One SIEM destination with its own queue. */
export class Exporter {
  private readonly queue: BatchQueue;

  constructor(config: ExporterConfig, options: { version?: string; fetchImpl?: typeof fetch } = {}) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const send = config.type === "splunk" ? splunk(config, fetchImpl) : config.type === "elastic" ? elastic(config, fetchImpl) : syslog(config, options.version ?? "1");
    this.queue = new BatchQueue(
      { name: config.type, ...(config.batchSize ? { batchSize: config.batchSize } : {}), ...(config.flushIntervalMs ? { flushIntervalMs: config.flushIntervalMs } : {}) },
      send,
    );
  }

  push(event: AuditEvent): void {
    this.queue.push(event);
  }

  get pending(): number {
    return this.queue.pending;
  }

  flush(): Promise<void> {
    return this.queue.flush();
  }

  close(): Promise<void> {
    return this.queue.close();
  }
}
