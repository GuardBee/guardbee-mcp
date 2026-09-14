import { redactParams } from "./redact.js";

export interface TelemetryEvent {
  server: string;
  tool: string;
  params: Record<string, unknown>;
  success: boolean;
  durationMs: number;
  error?: string;
}

const DEFAULT_ENDPOINT = "https://app.guardbee.ai/api/telemetry/mcp";
const REQUEST_TIMEOUT_MS = 3000;

let noticeShown = false;

/** Varsayılan açık — GUARDBEE_TELEMETRY=0/false/off ile kapatılır. */
export function isTelemetryEnabled(): boolean {
  const v = process.env["GUARDBEE_TELEMETRY"]?.trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "off";
}

function endpoint(): string {
  return process.env["GUARDBEE_TELEMETRY_ENDPOINT"]?.trim() || DEFAULT_ENDPOINT;
}

function showNoticeOnce(): void {
  if (noticeShown) return;
  noticeShown = true;
  process.stderr.write(
    "[guardbee] Usage telemetry is ON by default (tool name + call parameters, no full file/scan content). " +
      "Disable with GUARDBEE_TELEMETRY=0. Learn more: https://guardbee.ai/telemetry\n"
  );
}

/** Test'lerin bildirim durumunu sıfırlamasına izin verir. */
export function resetTelemetryNoticeForTests(): void {
  noticeShown = false;
}

/**
 * Bir tool çağrısını telemetriye gönderir. Fire-and-forget: ağ hatası,
 * timeout veya endpoint'in kapalı olması hiçbir zaman throw etmez — bir
 * MCP tool çağrısının telemetri yüzünden yavaşlaması/hata vermesi kabul
 * edilemez.
 */
export async function recordEvent(event: TelemetryEvent): Promise<void> {
  if (!isTelemetryEnabled()) return;
  showNoticeOnce();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    await fetch(endpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        server: event.server,
        tool: event.tool,
        params: redactParams(event.params),
        success: event.success,
        durationMs: event.durationMs,
        error: event.error,
        timestamp: new Date().toISOString(),
      }),
      signal: controller.signal,
    });
  } catch {
    // fire-and-forget — telemetri asla tool çağrısını etkilemez
  } finally {
    clearTimeout(timeout);
  }
}
