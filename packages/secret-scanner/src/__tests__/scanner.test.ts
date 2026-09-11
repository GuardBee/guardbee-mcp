import { describe, it, expect } from "vitest";
import { scanText } from "../scanner.js";

describe("scanText", () => {
  it("detects AWS access key", () => {
    const findings = scanText("export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE");
    expect(findings.some((f) => f.patternId === "aws_access_key")).toBe(true);
  });

  it("detects GitHub PAT", () => {
    const findings = scanText("token: ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    expect(findings.some((f) => f.patternId === "github_pat")).toBe(true);
  });

  it("detects Stripe secret key", () => {
    // split to avoid GitHub push protection on test fixtures
    const key = ["sk", "_live_", "abc123xyz456def789ghi012"].join("");
    const findings = scanText(`const stripe = require("stripe")("${key}")`);
    expect(findings.some((f) => f.patternId === "stripe_secret")).toBe(true);
  });

  it("detects OpenAI API key", () => {
    const key = ["sk-abcdefghijklmnopqrst", "T3BlbkFJ", "abcdefghijklmnopqrst"].join("");
    const findings = scanText(`OPENAI_API_KEY=${key}`);
    expect(findings.some((f) => f.patternId === "openai_key")).toBe(true);
  });

  it("detects Anthropic API key", () => {
    const key = ["sk-ant-", "api03-abcdefghijklmnopqrstuvwxyz0123456789ABCD"].join("");
    const findings = scanText(`key = '${key}'`);
    expect(findings.some((f) => f.patternId === "anthropic_key")).toBe(true);
  });

  it("detects Slack token", () => {
    const token = ["xoxb-", "123456789012-123456789012-abcdefghijklmnopqrstuvwx"].join("");
    const findings = scanText(`SLACK_TOKEN=${token}`);
    expect(findings.some((f) => f.patternId === "slack_token")).toBe(true);
  });

  it("detects PostgreSQL URL with credentials", () => {
    const findings = scanText("DATABASE_URL=postgresql://admin:s3cr3tpass@prod.db.example.com:5432/mydb");
    expect(findings.some((f) => f.patternId === "db_url_postgres")).toBe(true);
  });

  it("does not flag localhost postgres URL", () => {
    const findings = scanText("DATABASE_URL=postgresql://user:pass@localhost:5432/mydb");
    expect(findings.filter((f) => f.patternId === "db_url_postgres")).toHaveLength(0);
  });

  it("detects RSA private key header", () => {
    const findings = scanText("-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAK...");
    expect(findings.some((f) => f.patternId === "private_key_rsa")).toBe(true);
  });

  it("detects JWT token", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const findings = scanText(`Authorization: Bearer ${jwt}`);
    expect(findings.some((f) => f.patternId === "jwt")).toBe(true);
  });

  it("detects hardcoded password assignment", () => {
    const findings = scanText('const password = "MyS3cr3tP@ssword!"');
    expect(findings.some((f) => f.patternId === "generic_secret_assignment")).toBe(true);
  });

  it("ignores process.env references", () => {
    const findings = scanText("const apiKey = process.env.API_KEY");
    expect(findings.filter((f) => f.patternId === "generic_secret_assignment")).toHaveLength(0);
  });

  it("ignores placeholder values", () => {
    const findings = scanText('password = "your-password-here"');
    expect(findings.filter((f) => f.patternId === "generic_secret_assignment")).toHaveLength(0);
  });

  it("redacts the match value", () => {
    const findings = scanText("token: ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    const f = findings.find((f) => f.patternId === "github_pat");
    expect(f?.match).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(f?.match).toContain("*");
  });

  it("returns correct line number", () => {
    const text = "line1\nline2\ntoken: ghp_abcdefghijklmnopqrstuvwxyz0123456789\nline4";
    const findings = scanText(text);
    const f = findings.find((f) => f.patternId === "github_pat");
    expect(f?.line).toBe(3);
  });

  it("returns no findings for clean text", () => {
    expect(scanText("const x = 1; console.log('hello world');")).toHaveLength(0);
  });
});
