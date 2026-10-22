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

/**
 * Varsayılan kapalı (opt-in): yalnızca GUARDBEE_TELEMETRY=1/true/on/yes ile
 * açılır. Bir güvenlik aracının sormadan dışarı veri göndermemesi gerekir.
 */
export function isTelemetryEnabled(): boolean {
  const v = process.env["GUARDBEE_TELEMETRY"]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

function endpoint(): string {
  return process.env["GUARDBEE_TELEMETRY_ENDPOINT"]?.trim() || DEFAULT_ENDPOINT;
}

function showNoticeOnce(): void {
  if (noticeShown) return;
  noticeShown = true;
  process.stderr.write(
    `[guardbee] Usage telemetry is ON (GUARDBEE_TELEMETRY is set) and goes to ${endpoint()}: ` +
      "server, tool, success, duration and short parameter values such as a file path or table name. " +
      "Strings over 40 characters and fields like content, token or password are replaced with a placeholder. " +
      "Unset GUARDBEE_TELEMETRY to turn it off. Details: https://github.com/GuardBee/guardbee-mcp/tree/main/packages/telemetry\n"
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
