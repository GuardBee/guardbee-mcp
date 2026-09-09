import { describe, it, expect } from "vitest";
import {
  analyzePrivacyPolicyText,
  findPrivacyPolicyUrl,
  detectCookieBanner,
  formatPolicyAnalysis,
} from "../policy-analyzer.js";
import {
  getRequirements,
  REQUIREMENTS,
  SCENARIO_MAP,
} from "../frameworks.js";
import { GuardBeeApiError } from "../client.js";
import { formatGapAnalysis, formatActionPlan } from "../format.js";
import type { Finding } from "../client.js";

// ── Frameworks ────────────────────────────────────────────────────────────────

describe("getRequirements", () => {
  it("returns only KVKK requirements when asked", () => {
    const reqs = getRequirements(["KVKK"]);
    expect(reqs.every((r) => r.framework === "KVKK")).toBe(true);
    expect(reqs.length).toBeGreaterThan(0);
  });

  it("returns only GDPR requirements when asked", () => {
    const reqs = getRequirements(["GDPR"]);
    expect(reqs.every((r) => r.framework === "GDPR")).toBe(true);
  });

  it("returns only CCPA requirements when asked", () => {
    const reqs = getRequirements(["CCPA"]);
    expect(reqs.every((r) => r.framework === "CCPA")).toBe(true);
  });

  it("returns combined requirements for multiple frameworks", () => {
    const reqs = getRequirements(["KVKK", "GDPR"]);
    const frameworks = new Set(reqs.map((r) => r.framework));
    expect(frameworks.has("KVKK")).toBe(true);
    expect(frameworks.has("GDPR")).toBe(true);
  });

  it("each requirement has required fields", () => {
    for (const req of REQUIREMENTS) {
      expect(req.id).toBeTruthy();
      expect(req.title).toBeTruthy();
      expect(req.description).toBeTruthy();
      expect(["critical", "high", "medium", "low"]).toContain(req.severity);
    }
  });
});

describe("SCENARIO_MAP", () => {
  it("maps KVKK to kvkkFocus", () => {
    expect(SCENARIO_MAP["KVKK"]).toBe("kvkkFocus");
  });

  it("maps GDPR to gdprFocus", () => {
    expect(SCENARIO_MAP["GDPR"]).toBe("gdprFocus");
  });

  it("maps CCPA to ccpaFocus", () => {
    expect(SCENARIO_MAP["CCPA"]).toBe("ccpaFocus");
  });
});

// ── Privacy policy text analysis ──────────────────────────────────────────────

describe("analyzePrivacyPolicyText", () => {
  it("gives high score to comprehensive policy", () => {
    const text = `
      This privacy policy explains how we process your personal data.
      Legal basis: we rely on legitimate interest and consent.
      Retention period: we keep your data for 3 years.
      We share your data with third party service providers.
      International transfers are protected by standard contractual clauses.
      Contact our Data Protection Officer at dpo@example.com.
      We use cookies and tracking technologies.
      You can withdraw your consent at any time and opt-out of marketing.
      You have the right to lodge a complaint with the supervisory authority.
      We do not use automated decision-making or profiling.
      You have the right to access, rectification, erasure and right to object.
    `;
    const result = analyzePrivacyPolicyText("https://example.com/privacy", text);
    expect(result.score).toBeGreaterThan(70);
    expect(result.grade).toMatch(/^[AB]$/);
  });

  it("gives low score to thin policy", () => {
    const result = analyzePrivacyPolicyText("https://example.com/privacy", "We value your privacy.");
    expect(result.score).toBeLessThan(30);
    expect(result.grade).toBe("F");
  });

  it("counts word count correctly", () => {
    const result = analyzePrivacyPolicyText("https://example.com/privacy", "one two three four five");
    expect(result.wordCount).toBe(5);
  });

  it("includes the URL in the result", () => {
    const result = analyzePrivacyPolicyText("https://example.com/privacy", "some text");
    expect(result.url).toBe("https://example.com/privacy");
  });

  it("detects legal basis mention", () => {
    const result = analyzePrivacyPolicyText("x", "We process data on the legal basis of legitimate interest.");
    const signal = result.signals.find((s) => s.id === "legal-basis");
    expect(signal?.found).toBe(true);
    expect(signal?.excerpt).toBeTruthy();
  });

  it("flags missing retention info", () => {
    const result = analyzePrivacyPolicyText("x", "We collect your name and email.");
    const signal = result.signals.find((s) => s.id === "retention");
    expect(signal?.found).toBe(false);
  });

  it("detects Turkish privacy keywords", () => {
    const result = analyzePrivacyPolicyText("x", "Kişisel verilerinizi saklama süresi 2 yıldır. Üçüncü taraf hizmet sağlayıcılar kullanılmaktadır.");
    const retention = result.signals.find((s) => s.id === "retention");
    const thirdParty = result.signals.find((s) => s.id === "third-parties");
    expect(retention?.found).toBe(true);
    expect(thirdParty?.found).toBe(true);
  });
});

// ── findPrivacyPolicyUrl ──────────────────────────────────────────────────────

describe("findPrivacyPolicyUrl", () => {
  it("finds privacy link in HTML", () => {
    const html = `<a href="/privacy-policy">Privacy Policy</a>`;
    const result = findPrivacyPolicyUrl(html, "https://example.com");
    expect(result).toBe("https://example.com/privacy-policy");
  });

  it("returns absolute URL as-is", () => {
    const html = `<a href="https://example.com/privacy">Privacy</a>`;
    const result = findPrivacyPolicyUrl(html, "https://example.com");
    expect(result).toBe("https://example.com/privacy");
  });

  it("finds Turkish gizlilik link", () => {
    const html = `<a href="/gizlilik-politikasi">Gizlilik</a>`;
    const result = findPrivacyPolicyUrl(html, "https://example.com");
    expect(result).toBe("https://example.com/gizlilik-politikasi");
  });

  it("finds aydinlatma link", () => {
    const html = `<a href="/aydinlatma-metni">Aydınlatma</a>`;
    const result = findPrivacyPolicyUrl(html, "https://example.com");
    expect(result).toBe("https://example.com/aydinlatma-metni");
  });

  it("returns null when no privacy link found", () => {
    const html = `<a href="/about">About Us</a>`;
    const result = findPrivacyPolicyUrl(html, "https://example.com");
    expect(result).toBeNull();
  });
});

// ── detectCookieBanner ────────────────────────────────────────────────────────

describe("detectCookieBanner", () => {
  it("detects OneTrust CMP", () => {
    const html = `<script src="https://cdn.cookielaw.org/scripttemplates/otSDKStub.js"></script>`;
    const result = detectCookieBanner(html);
    expect(result.detected).toBe(true);
    expect(result.signals.some((s) => s.includes("CMP"))).toBe(true);
  });

  it("detects cookie consent text", () => {
    const html = `<div>We use cookie consent to improve your experience. Accept cookies to continue.</div>`;
    const result = detectCookieBanner(html);
    expect(result.detected).toBe(true);
  });

  it("detects Turkish cookie consent", () => {
    const html = `<div>Çerez onayı için kabul etmenizi istiyoruz.</div>`;
    const result = detectCookieBanner(html);
    expect(result.detected).toBe(true);
  });

  it("returns false for clean page", () => {
    const html = `<html><body><h1>Hello World</h1></body></html>`;
    const result = detectCookieBanner(html);
    expect(result.detected).toBe(false);
    expect(result.signals).toHaveLength(0);
  });

  it("detects reject option (important for KVKK)", () => {
    const html = `<button>Reject all cookies</button><button>Accept cookies</button>`;
    const result = detectCookieBanner(html);
    expect(result.detected).toBe(true);
    expect(result.signals.some((s) => s.includes("Reject"))).toBe(true);
  });
});

// ── formatPolicyAnalysis ──────────────────────────────────────────────────────

describe("formatPolicyAnalysis", () => {
  it("shows score and grade", () => {
    const analysis = analyzePrivacyPolicyText("https://example.com/privacy", "legal basis cookies third party");
    const out = formatPolicyAnalysis(analysis);
    expect(out).toContain("/100");
    expect(out).toMatch(/Grade: [A-F]/);
  });

  it("shows checklist of requirements", () => {
    // Use text that triggers at least one signal (cookies) so both ✅ and ❌ appear
    const analysis = analyzePrivacyPolicyText("https://example.com/privacy", "We use cookies to improve your experience.");
    const out = formatPolicyAnalysis(analysis);
    expect(out).toContain("✅");
    expect(out).toContain("❌");
  });
});

// ── formatGapAnalysis ─────────────────────────────────────────────────────────

describe("formatGapAnalysis", () => {
  it("shows gap count", () => {
    const findings: Finding[] = [{
      id: "f1",
      scanId: "s1",
      moduleId: "kvkk-cookie-consent",
      title: "No cookie consent banner",
      severity: "CRITICAL",
      status: "OPEN",
      description: "Missing cookie consent",
      recommendation: "Add a cookie banner",
      cveId: null,
      documentationUrl: null,
    }];
    const requirements = getRequirements(["KVKK"]);
    const out = formatGapAnalysis(requirements, findings, "KVKK");
    expect(out).toContain("Gap Analysis");
    expect(out).toContain("gap");
  });
});

// ── formatActionPlan ──────────────────────────────────────────────────────────

describe("formatActionPlan", () => {
  it("shows clean message when no findings", () => {
    const out = formatActionPlan([], []);
    expect(out).toContain("No compliance gaps");
  });

  it("shows critical findings first", () => {
    const findings: Finding[] = [
      { id: "1", scanId: "s", moduleId: "m", title: "Critical issue", severity: "CRITICAL", status: null, description: null, recommendation: "Fix it now", cveId: null, documentationUrl: null },
      { id: "2", scanId: "s", moduleId: "m", title: "Low issue", severity: "LOW", status: null, description: null, recommendation: null, cveId: null, documentationUrl: null },
    ];
    const out = formatActionPlan([], findings);
    const critIdx = out.indexOf("IMMEDIATE");
    const lowIdx = out.indexOf("Fix it now");
    expect(critIdx).toBeLessThan(lowIdx);
  });
});

// ── GuardBeeApiError ──────────────────────────────────────────────────────────

describe("GuardBeeApiError", () => {
  it("carries status and optional code", () => {
    const err = new GuardBeeApiError("Forbidden", 403, "DOMAIN_MISMATCH");
    expect(err.status).toBe(403);
    expect(err.code).toBe("DOMAIN_MISMATCH");
    expect(err instanceof Error).toBe(true);
  });
});
