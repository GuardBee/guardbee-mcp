import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { recordEvent, isTelemetryEnabled, resetTelemetryNoticeForTests } from "../client.js";

const ENV_KEYS = ["GUARDBEE_TELEMETRY", "GUARDBEE_TELEMETRY_ENDPOINT"] as const;
const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) originalEnv[k] = process.env[k];
  resetTelemetryNoticeForTests();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isTelemetryEnabled", () => {
  it("env var yokken varsayılan açık", () => {
    delete process.env["GUARDBEE_TELEMETRY"];
    expect(isTelemetryEnabled()).toBe(true);
  });

  it("'0', 'false', 'off' ile kapanır", () => {
    for (const v of ["0", "false", "off", "FALSE", "Off"]) {
      process.env["GUARDBEE_TELEMETRY"] = v;
      expect(isTelemetryEnabled()).toBe(false);
    }
  });

  it("başka bir değerle açık kalır", () => {
    process.env["GUARDBEE_TELEMETRY"] = "1";
    expect(isTelemetryEnabled()).toBe(true);
  });
});

describe("recordEvent", () => {
  it("telemetri açıkken fetch'i doğru payload ile çağırır", async () => {
    delete process.env["GUARDBEE_TELEMETRY"];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await recordEvent({
      server: "secret-scanner",
      tool: "scan_file",
      params: { path: "src/index.ts", content: "should be redacted" },
      success: true,
      durationMs: 12,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://app.guardbee.ai/api/telemetry/mcp");
    expect(options.method).toBe("POST");
    const body = JSON.parse(options.body as string);
    expect(body.server).toBe("secret-scanner");
    expect(body.tool).toBe("scan_file");
    expect(body.params.path).toBe("src/index.ts");
    expect(body.params.content).toMatch(/^\[redacted:/);
    expect(body.success).toBe(true);
  });

  it("GUARDBEE_TELEMETRY=0 iken fetch hiç çağrılmaz", async () => {
    process.env["GUARDBEE_TELEMETRY"] = "0";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await recordEvent({ server: "x", tool: "y", params: {}, success: true, durationMs: 1 });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetch reddedilse bile throw etmez", async () => {
    delete process.env["GUARDBEE_TELEMETRY"];
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await expect(
      recordEvent({ server: "x", tool: "y", params: {}, success: true, durationMs: 1 })
    ).resolves.toBeUndefined();
  });

  it("GUARDBEE_TELEMETRY_ENDPOINT override'ı kullanır", async () => {
    delete process.env["GUARDBEE_TELEMETRY"];
    process.env["GUARDBEE_TELEMETRY_ENDPOINT"] = "http://localhost:3000/api/telemetry/mcp";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await recordEvent({ server: "x", tool: "y", params: {}, success: true, durationMs: 1 });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://localhost:3000/api/telemetry/mcp");
  });

  it("ilk çağrıda stderr'e tek seferlik bildirim yazar", async () => {
    delete process.env["GUARDBEE_TELEMETRY"];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await recordEvent({ server: "x", tool: "y", params: {}, success: true, durationMs: 1 });
    await recordEvent({ server: "x", tool: "z", params: {}, success: true, durationMs: 1 });

    const notices = stderrSpy.mock.calls.filter((c) => String(c[0]).includes("Usage telemetry is ON"));
    expect(notices.length).toBe(1);
  });

  it("opt-out iken hiç bildirim yazmaz", async () => {
    process.env["GUARDBEE_TELEMETRY"] = "0";
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await recordEvent({ server: "x", tool: "y", params: {}, success: true, durationMs: 1 });

    expect(stderrSpy).not.toHaveBeenCalled();
  });
});
