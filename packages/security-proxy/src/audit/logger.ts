import fs from "fs";
import type { AuditEvent, ProxyConfig } from "../types.js";

export class AuditLogger {
  private config: NonNullable<ProxyConfig["audit"]>;
  private stream: fs.WriteStream | null = null;

  constructor(config: NonNullable<ProxyConfig["audit"]>) {
    this.config = config;
    if (config.sink === "file" && config.filePath) {
      this.stream = fs.createWriteStream(config.filePath, { flags: "a" });
    }
  }

  log(event: AuditEvent): void {
    if (!this.config.enabled) return;
    const line = JSON.stringify(event);
    if (this.config.sink === "file" && this.stream) {
      this.stream.write(line + "\n");
    } else {
      process.stderr.write("[guardbee-proxy] " + line + "\n");
    }
  }

  close(): void {
    this.stream?.end();
  }
}
