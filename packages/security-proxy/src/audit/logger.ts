import fs from "fs";
import { createHash } from "crypto";
import type { AuditConfig, AuditEvent } from "../types.js";
import { stable } from "../interceptors/definition-drift.js";

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

export class AuditLogger {
  private config: AuditConfig;
  private stream: fs.WriteStream | null = null;
  private lastHash = GENESIS;

  constructor(config: AuditConfig) {
    this.config = config;
    if (config.sink === "file" && config.filePath) {
      this.lastHash = lastHashIn(config.filePath);
      this.stream = fs.createWriteStream(config.filePath, { flags: "a" });
    }
  }

  log(event: AuditEvent): void {
    if (!this.config.enabled) return;
    const unhashed: Omit<AuditEvent, "hash"> = { ...this.redact(event), prevHash: this.lastHash };
    const hash = chainHash(unhashed);
    this.lastHash = hash;
    const line = JSON.stringify({ ...unhashed, hash });
    if (this.config.sink === "file" && this.stream) {
      this.stream.write(line + "\n");
    } else {
      process.stderr.write("[guardbee-proxy] " + line + "\n");
    }
  }

  close(): void {
    this.stream?.end();
  }

  private redact(event: AuditEvent): AuditEvent {
    if (this.config.includePayloads !== false) return event;
    const { input, output: _output, ...rest } = event;
    return input === undefined ? rest : { ...rest, inputHash: sha256(stable(input)) };
  }
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
