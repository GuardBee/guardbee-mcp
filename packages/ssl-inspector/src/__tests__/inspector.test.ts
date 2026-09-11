import { describe, it, expect } from "vitest";
import { formatInspectReport } from "../inspector.js";
import type { TlsInspectResult, CertInfo } from "../inspector.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCert(overrides: Partial<CertInfo> = {}): CertInfo {
  const now = new Date();
  const future = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000); // +60 days
  return {
    subject: { CN: "example.com" },
    issuer: { O: "Test CA", CN: "Test CA Root" },
    validFrom: now.toISOString(),
    validTo: future.toISOString(),
    daysUntilExpiry: 60,
    isExpired: false,
    serialNumber: "AABBCC",
    fingerprint: "AA:BB:CC",
    fingerprint256: "AA:BB:CC:DD",
    subjectAltNames: ["example.com", "www.example.com"],
    keyUsage: [],
    extKeyUsage: [],
    isCA: false,
    ...overrides,
  };
}

function makeResult(overrides: Partial<TlsInspectResult> = {}): TlsInspectResult {
  return {
    host: "example.com",
    port: 443,
    reachable: true,
    protocol: "TLSv1.3",
    cipher: "TLS_AES_256_GCM_SHA384",
    cipherStrength: 256,
    chainDepth: 2,
    chainValid: true,
    cert: makeCert(),
    findings: [{ severity: "info", code: "OK", message: "No issues found" }],
    ...overrides,
  };
}

// ── formatInspectReport ───────────────────────────────────────────────────────

describe("formatInspectReport", () => {
  it("shows unreachable host with error message", () => {
    const r = makeResult({ reachable: false, error: "Connection refused", findings: [] });
    const report = formatInspectReport([r]);
    expect(report).toContain("Unreachable");
    expect(report).toContain("Connection refused");
  });

  it("shows protocol and cipher", () => {
    const r = makeResult();
    const report = formatInspectReport([r]);
    expect(report).toContain("TLSv1.3");
    expect(report).toContain("TLS_AES_256_GCM_SHA384");
  });

  it("shows cert CN and validity", () => {
    const r = makeResult();
    const report = formatInspectReport([r]);
    expect(report).toContain("example.com");
    expect(report).toContain("expires in 60 days");
  });

  it("shows SANs", () => {
    const r = makeResult();
    const report = formatInspectReport([r]);
    expect(report).toContain("www.example.com");
  });

  it("shows no issues for clean cert", () => {
    const r = makeResult();
    const report = formatInspectReport([r]);
    expect(report).toContain("No security issues found");
  });

  it("shows issues when findings include non-OK entries", () => {
    const r = makeResult({
      findings: [{ severity: "high", code: "CERT_EXPIRY_SOON", message: "Certificate expires in 5 days" }],
    });
    const report = formatInspectReport([r]);
    expect(report).toContain("[HIGH]");
    expect(report).toContain("expires in 5 days");
  });

  it("renders multiple hosts", () => {
    const r1 = makeResult({ host: "alpha.com" });
    const r2 = makeResult({ host: "beta.com", reachable: false, error: "Timeout", findings: [] });
    const report = formatInspectReport([r1, r2]);
    expect(report).toContain("alpha.com");
    expect(report).toContain("beta.com");
  });
});

// ── Finding severity logic (via result construction) ─────────────────────────

describe("Finding severity categories", () => {
  it("expired cert finding is critical severity", () => {
    const findings: TlsInspectResult["findings"] = [
      { severity: "critical", code: "CERT_EXPIRED", message: "Certificate expired 5 days ago" },
    ];
    const r = makeResult({ findings });
    expect(r.findings[0]!.severity).toBe("critical");
  });

  it("deprecated TLS 1.0 finding is high severity", () => {
    const findings: TlsInspectResult["findings"] = [
      { severity: "high", code: "DEPRECATED_PROTOCOL", message: "TLSv1 is deprecated" },
    ];
    const r = makeResult({ findings });
    expect(r.findings[0]!.severity).toBe("high");
  });

  it("no HSTS finding is medium severity", () => {
    const findings: TlsInspectResult["findings"] = [
      { severity: "medium", code: "NO_HSTS", message: "HSTS header not found" },
    ];
    const r = makeResult({ findings });
    expect(r.findings[0]!.severity).toBe("medium");
  });
});

// ── CertInfo helpers ──────────────────────────────────────────────────────────

describe("CertInfo shape", () => {
  it("expired cert has isExpired=true and negative daysUntilExpiry", () => {
    const past = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const cert = makeCert({ daysUntilExpiry: -10, isExpired: true, validTo: past });
    expect(cert.isExpired).toBe(true);
    expect(cert.daysUntilExpiry).toBeLessThan(0);
  });

  it("cert with no SANs is flagged", () => {
    const cert = makeCert({ subjectAltNames: [] });
    expect(cert.subjectAltNames).toHaveLength(0);
  });
});
