import fs from "fs";
import { createHash } from "crypto";
import { maskPiiInValue, MODEL_PII, PERSONAL_DATA_CATEGORIES, PII_PATTERNS, SPECIAL_CATEGORIES } from "@guardbee/guard-core";
import type { AuditConfig, AuditEvent } from "../types.js";
import { stable } from "../interceptors/definition-drift.js";
import { DashboardSink } from "./dashboard-sink.js";
import { Exporter } from "./exporters.js";
import path from "path";

function packageVersion(): string {
  try {
    return (JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8")) as { version: string }).version;
  } catch {
    return "1";
  }
}

const GENESIS = "";

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Hash of an event line without its own `hash` field (key order as written). */
function chainHash(unhashed: Omit<AuditEvent, "hash">): string {
  return sha256(JSON.stringify(unhashed));
}

/** The last event hash in an existing JSONL file, so a restart continues the chain. */
function lastHashIn(filePath: string): string {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return GENESIS;
  }
  const lines = raw.split("\n").filter((line) => line.trim() !== "");
  const last = lines[lines.length - 1];
  if (!last) return GENESIS;
  try {
    const hash = (JSON.parse(last) as AuditEvent).hash;
    return typeof hash === "string" ? hash : GENESIS;
  } catch {
    return GENESIS;
  }
}

/**
 * Append events to a JSONL audit log at once, continuing its hash chain: for
 * one-off writers such as `init`, which runs before any proxy does. Events
 * carry no payloads, so nothing is redacted.
 */
export function appendAuditEventsSync(filePath: string, events: Omit<AuditEvent, "hash" | "prevHash">[]): void {
  let prev = lastHashIn(filePath);
  const lines = events.map((event) => {
    const unhashed: Omit<AuditEvent, "hash"> = { ...event, prevHash: prev };
    prev = chainHash(unhashed);
    return JSON.stringify({ ...unhashed, hash: prev }) + "\n";
  });
  fs.appendFileSync(filePath, lines.join(""), { mode: 0o600 });
}

export class AuditLogger {
  private config: AuditConfig;
  private stream: fs.WriteStream | null = null;
  private lastHash = GENESIS;
  private readonly dashboard: DashboardSink | null = null;
  private readonly exporters: Exporter[] = [];

  constructor(config: AuditConfig, fetchImpl?: typeof fetch) {
    this.config = config;
    if (config.sink === "file" && config.filePath) {
      this.lastHash = lastHashIn(config.filePath);
      this.stream = fs.createWriteStream(config.filePath, { flags: "a" });
    }
    if (config.enabled && config.dashboard) this.dashboard = new DashboardSink(config.dashboard, fetchImpl);
    if (config.enabled && config.exporters?.length) {
      const version = packageVersion();
      this.exporters = config.exporters.map((exporter) => new Exporter(exporter, { version, ...(fetchImpl ? { fetchImpl } : {}) }));
    }
  }

  log(event: AuditEvent): void {
    if (!this.config.enabled) return;
    const unhashed: Omit<AuditEvent, "hash"> = { ...this.redact(event), prevHash: this.lastHash };
    const hash = chainHash(unhashed);
    this.lastHash = hash;
    const hashed = { ...unhashed, hash };
    this.dashboard?.push(hashed);
    for (const exporter of this.exporters) exporter.push(hashed);
    const line = JSON.stringify(hashed);
    if (this.config.sink === "file" && this.stream) {
      this.stream.write(line + "\n");
    } else {
      process.stderr.write("[guardbee-proxy] " + line + "\n");
    }
  }

  /** Flush the dashboard queue and close the file. */
  async close(): Promise<void> {
    await Promise.all([this.dashboard?.close(), ...this.exporters.map((exporter) => exporter.close())]);
    await new Promise<void>((resolve) => (this.stream ? this.stream.end(resolve) : resolve()));
  }

  private redact(event: AuditEvent): AuditEvent {
    if (this.config.includePayloads !== false) {
      // Payloads are logged as they were, personal data included, but never a credential
      const { input, output } = event;
      return {
        ...event,
        ...(input !== undefined ? { input: maskCredentials(input) } : {}),
        ...(output !== undefined ? { output: maskCredentials(output) } : {}),
      };
    }
    const { input, output: _output, ...rest } = event;
    return input === undefined ? rest : { ...rest, inputHash: sha256(stable(input)) };
  }
}

const PERSONAL = new Set<string>([...PERSONAL_DATA_CATEGORIES, ...MODEL_PII, ...SPECIAL_CATEGORIES]);
const CREDENTIAL_PLACEHOLDER = new Map(PII_PATTERNS.map((p) => [p.name, p.replacement] as const));

/** Provider keys, private keys, tokens and passwords in URLs replaced; personal data left for the log's owner. */
function maskCredentials<T>(value: T): T {
  return maskPiiInValue(value, (name, match) => (PERSONAL.has(name) ? match : (CREDENTIAL_PLACEHOLDER.get(name) ?? "[REDACTED]"))) as T;
}

export type ChainVerification =
  | { ok: true; events: number }
  | { ok: false; line: number; reason: string };

/** Recompute the hash chain of a JSONL audit log. A deleted, inserted or edited line breaks it. */
export function verifyAuditChain(jsonl: string): ChainVerification {
  const lines = jsonl.split("\n");
  let expectedPrev = GENESIS;
  let events = 0;
  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") continue;
    const lineNo = index + 1;
    let event: AuditEvent;
    try {
      event = JSON.parse(line) as AuditEvent;
    } catch {
      return { ok: false, line: lineNo, reason: "not valid JSON" };
    }
    const { hash, ...unhashed } = event;
    if (unhashed.prevHash !== expectedPrev) {
      return { ok: false, line: lineNo, reason: "prevHash does not match the previous event (a line was removed or reordered)" };
    }
    if (hash !== chainHash(unhashed)) {
      return { ok: false, line: lineNo, reason: "hash does not match the event contents (the line was edited)" };
    }
    expectedPrev = hash;
    events++;
  }
  return { ok: true, events };
}
