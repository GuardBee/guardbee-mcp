import { describe, expect, it } from "vitest";
import { gradeOf, score, type ScoreInput } from "../rubric.js";

const now = new Date("2026-11-01T00:00:00Z");
const input = (overrides: Partial<ScoreInput> = {}): ScoreInput => ({
  facts: {
    ecosystem: "npm",
    name: "pkg",
    version: "1.0.0",
    createdAt: "2025-01-01T00:00:00Z",
    publishedAt: "2026-10-01T00:00:00Z",
    releases: 12,
    license: "MIT",
    repository: "https://github.com/o/pkg",
    installScripts: [],
    files: [],
  },
  findings: [],
  issues: [],
  provenance: "verified",
  now,
  ...overrides,
});

describe("rubric", () => {
  it("gives a clean, attested, maintained package 100 / A", () => {
    expect(score(input())).toMatchObject({ grade: "A", score: 100, reasons: [] });
  });

  it("counts a rule once per package and caps code points", () => {
    const findings = [
      ...Array.from({ length: 5 }, (_, i) => ({ scanner: "server-auditor" as const, id: "python_ssrf_from_tool_input", severity: "high" as const, file: "a.py", line: i + 1 })),
      { scanner: "oauth-auditor" as const, id: "missing_host_origin_check", severity: "medium" as const, file: "b.js", line: 3 },
    ];
    const result = score(input({ findings }));
    expect(result.score).toBe(90);
    expect(result.reasons.map((r) => [r.id, r.points])).toEqual([
      ["server-auditor:python_ssrf_from_tool_input", -8],
      ["oauth-auditor:missing_host_origin_check", -2],
    ]);
    expect(result.reasons[0]!.detail).toContain("(+4 more)");
    expect(result.subscores).toEqual({ code: 90, supplyChain: 100, maintenance: 100 });
  });

  it("caps a critical finding at D, a published secret at F, and malware at 0", () => {
    const critical = score(input({ findings: [{ scanner: "server-auditor", id: "go_shell_from_tool_input", severity: "critical", file: "main.go", line: 9 }] }));
    expect([critical.score, critical.grade]).toEqual([69, "D"]);
    const secret = score(input({ findings: [{ scanner: "secret-scanner", id: "openai_api_key", severity: "high", file: "dist/x.js", line: 1 }] }));
    expect(secret.grade).toBe("F");
    const malware = score(input({ issues: [{ id: "MAL-2026-1", malicious: true, severity: "critical" }] }));
    expect([malware.score, malware.grade]).toEqual([0, "F"]);
  });

  it("weighs vulnerabilities, install scripts, provenance and maintenance", () => {
    const result = score(
      input({
        issues: [{ id: "GHSA-1", malicious: false, severity: "high", summary: "ReDoS" }],
        provenance: "absent",
        facts: { ...input().facts, installScripts: ["postinstall"], license: undefined as unknown as string, repository: undefined as unknown as string, createdAt: "2026-10-20T00:00:00Z" },
      }),
    );
    expect(result.reasons.map((r) => [r.id, r.points])).toEqual([
      ["vulnerability:GHSA-1", -20],
      ["install-scripts", -10],
      ["no-provenance", -5],
      ["no-repository", -10],
      ["no-license", -5],
      ["new-package", -5],
    ]);
    expect([result.score, result.grade]).toEqual([45, "F"]);
    expect(score(input({ provenance: "failed" })).score).toBe(60);
  });

  it("maps scores to grades", () => {
    expect([100, 90, 89, 80, 79, 70, 69, 60, 59, 0].map(gradeOf).join("")).toBe("AABBCCDDFF");
  });
});
