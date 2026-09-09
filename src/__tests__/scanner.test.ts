import { describe, it, expect } from "vitest";
import {
  GuardBeeClient,
  GuardBeeApiError,
} from "../client.js";
import {
  formatScan,
  formatScanList,
  formatFinding,
  formatFindingList,
  formatSummary,
} from "../format.js";
import type { Scan, Finding, ListResult, ScanSummary } from "../client.js";

// ── Test data ─────────────────────────────────────────────────────────────────

function makeScan(overrides: Partial<Scan> = {}): Scan {
  return {
    id: "clz000000000000000000001",
    url: "https://example.com",
    status: "COMPLETED",
    score: 72,
    brandId: null,
    workspaceId: "ws-001",
    createdAt: "2024-01-15T10:00:00.000Z",
    finishedAt: "2024-01-15T10:05:00.000Z",
    summary: { critical: 1, high: 2, medium: 3, low: 4, info: 5, passed: 20 },
    ...overrides,
  };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "find-001",
    scanId: "clz000000000000000000001",
    moduleId: "sql-injection",
    title: "SQL Injection vulnerability detected",
    severity: "CRITICAL",
    status: "OPEN",
    description: "The login form is vulnerable to SQL injection.",
    recommendation: "Use parameterized queries or prepared statements.",
    cveId: "CVE-2023-1234",
    documentationUrl: "https://owasp.org/www-project-top-ten/",
    createdAt: "2024-01-15T10:05:00.000Z",
    ...overrides,
  };
}

function makeListResult<T>(data: T[], total?: number): ListResult<T> {
  return {
    data,
    pagination: { page: 1, pageSize: 20, total: total ?? data.length, totalPages: 1 },
  };
}

// ── GuardBeeApiError ──────────────────────────────────────────────────────────

describe("GuardBeeApiError", () => {
  it("carries status and code", () => {
    const err = new GuardBeeApiError("Not found", 404, "NOT_FOUND");
    expect(err.status).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("Not found");
    expect(err.name).toBe("GuardBeeApiError");
  });

  it("works without code", () => {
    const err = new GuardBeeApiError("Server error", 500);
    expect(err.code).toBeUndefined();
  });
});

// ── GuardBeeClient construction ───────────────────────────────────────────────

describe("GuardBeeClient", () => {
  it("can be instantiated with an API key", () => {
    const client = new GuardBeeClient("gb_test_key");
    expect(client).toBeInstanceOf(GuardBeeClient);
  });

  it("accepts a custom base URL", () => {
    const client = new GuardBeeClient("gb_test_key", "https://custom.example.com");
    expect(client).toBeInstanceOf(GuardBeeClient);
  });
});

// ── formatScan ────────────────────────────────────────────────────────────────

describe("formatScan", () => {
  it("shows scan ID and URL", () => {
    const out = formatScan(makeScan());
    expect(out).toContain("clz000000000000000000001");
    expect(out).toContain("https://example.com");
  });

  it("shows score", () => {
    const out = formatScan(makeScan());
    expect(out).toContain("72/100");
  });

  it("shows summary counts", () => {
    const out = formatScan(makeScan());
    expect(out).toContain("1 critical");
    expect(out).toContain("2 high");
    expect(out).toContain("3 medium");
  });

  it("shows RUNNING status with icon", () => {
    const out = formatScan(makeScan({ status: "RUNNING", score: null, finishedAt: null }));
    expect(out).toContain("RUNNING");
    expect(out).toContain("pending");
  });

  it("does not show finishedAt when null", () => {
    const out = formatScan(makeScan({ finishedAt: null }));
    expect(out).not.toContain("Finished");
  });
});

// ── formatScanList ────────────────────────────────────────────────────────────

describe("formatScanList", () => {
  it("shows empty message when no scans", () => {
    const out = formatScanList(makeListResult([]));
    expect(out).toBe("No scans found.");
  });

  it("shows scan count in header", () => {
    const out = formatScanList(makeListResult([makeScan(), makeScan({ id: "clz2" })], 2));
    expect(out).toContain("2 total");
  });

  it("lists each scan URL", () => {
    const out = formatScanList(makeListResult([makeScan()]));
    expect(out).toContain("https://example.com");
  });
});

// ── formatFinding ─────────────────────────────────────────────────────────────

describe("formatFinding", () => {
  it("shows title and severity", () => {
    const out = formatFinding(makeFinding());
    expect(out).toContain("SQL Injection");
    expect(out).toContain("CRITICAL");
  });

  it("shows CVE ID", () => {
    const out = formatFinding(makeFinding());
    expect(out).toContain("CVE-2023-1234");
  });

  it("shows recommendation", () => {
    const out = formatFinding(makeFinding());
    expect(out).toContain("parameterized queries");
  });

  it("shows documentation URL", () => {
    const out = formatFinding(makeFinding());
    expect(out).toContain("owasp.org");
  });

  it("omits null fields gracefully", () => {
    const out = formatFinding(makeFinding({ cveId: null, documentationUrl: null, description: null }));
    expect(out).not.toContain("CVE");
    expect(out).not.toContain("Docs");
  });

  it("shows numbered index when provided", () => {
    const out = formatFinding(makeFinding(), 0);
    expect(out).toContain("1.");
  });
});

// ── formatFindingList ─────────────────────────────────────────────────────────

describe("formatFindingList", () => {
  it("shows empty message for specific scan", () => {
    const out = formatFindingList(makeListResult([]), "clz001");
    expect(out).toContain("No findings for scan clz001");
  });

  it("shows generic empty message without scanId", () => {
    const out = formatFindingList(makeListResult([]));
    expect(out).toBe("No findings found.");
  });

  it("shows total count", () => {
    const out = formatFindingList(makeListResult([makeFinding()], 5));
    expect(out).toContain("5 total");
  });

  it("lists finding titles", () => {
    const out = formatFindingList(makeListResult([makeFinding()]));
    expect(out).toContain("SQL Injection");
  });
});

// ── formatSummary ─────────────────────────────────────────────────────────────

describe("formatSummary", () => {
  it("shows clean result when no vulnerabilities", () => {
    const summary: ScanSummary = { critical: 0, high: 0, medium: 0, low: 0, info: 0, passed: 30 };
    const out = formatSummary(summary, "https://example.com", "scan-001");
    expect(out).toContain("No vulnerabilities found");
  });

  it("shows counts when vulnerabilities present", () => {
    const summary: ScanSummary = { critical: 2, high: 3, medium: 1, low: 0, info: 0, passed: 10 };
    const out = formatSummary(summary, "https://example.com", "scan-002");
    expect(out).toContain("2");
    expect(out).toContain("Critical");
    expect(out).toContain("get_findings");
  });

  it("includes the scan ID in output", () => {
    const summary: ScanSummary = { critical: 1, high: 0, medium: 0, low: 0, info: 0, passed: 5 };
    const out = formatSummary(summary, "https://example.com", "scan-xyz");
    expect(out).toContain("scan-xyz");
  });
});
