import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { scanText, scanDirectory } from "../scanner.js";

function idsOf(text: string): string[] {
  return scanText(text).map((f) => f.patternId);
}

describe("form mode", () => {
  it("yakalar: TypeScript elicitInput şifre ve api anahtarı istiyor", () => {
    const code = `
await server.elicitInput({
  message: "Connect the billing account",
  requestedSchema: {
    type: "object",
    properties: {
      apiKey: { type: "string" },
      card_number: { type: "string" },
    },
  },
});`;
    const ids = idsOf(code);
    expect(ids.filter((id) => id === "form_mode_secret")).toHaveLength(2);
  });

  it("yakalar: Python ctx.elicit password alanı istiyor", () => {
    const code = `
result = await ctx.elicit(
    "Sign in",
    requested_schema={
        "type": "object",
        "properties": {
            "password": {"type": "string"},
        },
    },
)`;
    expect(idsOf(code)).toContain("form_mode_secret");
  });

  it("yakalar: mode yazılmamış JSON isteği form sayılır ve secret ister", () => {
    const code = `
{
  "method": "elicitation/create",
  "params": {
    "message": "Paste the token",
    "requestedSchema": {
      "type": "object",
      "properties": { "access_token": { "type": "string" } }
    }
  }
}`;
    expect(idsOf(code)).toContain("form_mode_secret");
  });

  it("isim ve e-posta formunu yakalamaz", () => {
    const code = `
await server.elicitInput({
  mode: "form",
  message: "Who should we notify?",
  requestedSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      email: { type: "string", format: "email" },
    },
    required: ["name", "email"],
  },
});`;
    expect(idsOf(code)).toEqual([]);
  });

  it("secretQuestion alanını secret sanmaz", () => {
    const code = `
await server.elicitInput({
  message: "Recovery",
  requestedSchema: { type: "object", properties: { secretQuestion: { type: "string" } } },
});`;
    expect(idsOf(code)).toEqual([]);
  });

  it("URL modundaki bir çağrıyı form secret sanmaz", () => {
    const code = `
await server.elicitInput({
  mode: "url",
  message: "Add your API key on our page",
  url: "https://mcp.example.com/connect?state=abc",
});`;
    expect(idsOf(code)).not.toContain("form_mode_secret");
  });
});

describe("URL mode", () => {
  it("yakalar: üçüncü parti authorize adresine doğrudan giden URL", () => {
    const code = `
await server.elicitInput({
  mode: "url",
  message: "Authorize GitHub",
  url: "https://github.com/login/oauth/authorize?client_id=abc&state=xyz",
});`;
    expect(idsOf(code)).toContain("url_third_party_authorize");
  });

  it("kendi connect rotasını yakalamaz", () => {
    const code = `
await server.elicitInput({
  mode: "url",
  message: "Continue on our site",
  url: "https://mcp.example.com/connect?state=abc&client_id=app",
});`;
    expect(idsOf(code)).toEqual([]);
  });

  it("yakalar: URL içine gömülü access_token", () => {
    const code = `
await server.elicitInput({
  mode: "url",
  message: "Finish setup",
  url: "https://mcp.example.com/connect?access_token=ya29.secretvalue",
});`;
    expect(idsOf(code)).toContain("url_embeds_credential");
    expect(idsOf(code)).not.toContain("url_third_party_authorize");
  });

  it("yakalar: URL içine gömülü e-posta", () => {
    const code = `
await ctx.elicit(
    message="Confirm",
    mode="url",
    url="https://mcp.example.com/connect?email=bob@example.com",
)`;
    expect(idsOf(code)).toContain("url_embeds_pii");
  });

  it("yakalar: geliştirme dışı http URL", () => {
    const code = `
await server.elicitInput({
  mode: "url",
  message: "Pay",
  url: "http://payments.example.com/checkout?state=abc",
});`;
    expect(idsOf(code)).toContain("elicitation_url_not_https");
  });

  it("localhost http adresini yakalamaz", () => {
    const code = `
await server.elicitInput({
  mode: "url",
  message: "Local connect",
  url: "http://localhost:3000/connect?state=abc",
});`;
    expect(idsOf(code)).toEqual([]);
  });

  it("şablon içindeki Google authorize adresini yakalar", () => {
    const code = "await server.elicitInput({ mode: \"url\", message: \"Go\", url: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}` });";
    expect(idsOf(code)).toContain("url_third_party_authorize");
  });
});

describe("cevap sonrası", () => {
  it("yakalar: form metnindeki tıklanabilir adres", () => {
    const code = `
await server.elicitInput({
  message: "Read https://docs.example.com/setup then type your name",
  requestedSchema: { type: "object", properties: { name: { type: "string" } } },
});`;
    expect(idsOf(code)).toContain("form_clickable_url");
    expect(idsOf(code)).not.toContain("form_mode_secret");
  });

  it("URL modundaki bir adresi form linki sanmaz", () => {
    const code = `
await server.elicitInput({
  mode: "url",
  message: "Continue at https://mcp.example.com/connect",
  url: "https://mcp.example.com/connect?state=abc",
});`;
    expect(idsOf(code)).not.toContain("form_clickable_url");
  });

  it("yakalar: action bakılmadan content kullanılması", () => {
    const code = `
const result = await server.elicitInput({
  message: "Your name",
  requestedSchema: { type: "object", properties: { name: { type: "string" } } },
});
save(result.content.name);`;
    expect(idsOf(code)).toContain("ignored_decline");
  });

  it("accept kontrolü varsa decline eksik saymaz", () => {
    const code = `
const result = await server.elicitInput({
  message: "Your name",
  requestedSchema: { type: "object", properties: { name: { type: "string" } } },
});
if (result.action !== "accept") return;
save(result.content.name);`;
    expect(idsOf(code)).not.toContain("ignored_decline");
  });

  it("yakalar: formdaki e-postanın kullanıcı kaydı sanılması", () => {
    const code = `
const result = await server.elicitInput({
  message: "Who are you?",
  requestedSchema: { type: "object", properties: { email: { type: "string", format: "email" } } },
});
if (result.action !== "accept") return;
const user = await findUser(result.content.email);`;
    expect(idsOf(code)).toContain("client_asserted_identity");
    expect(idsOf(code)).not.toContain("ignored_decline");
  });

  it("token sub ile karşılaştırılan e-postayı yakalamaz", () => {
    const code = `
const result = await server.elicitInput({
  message: "Who are you?",
  requestedSchema: { type: "object", properties: { email: { type: "string", format: "email" } } },
});
if (result.action !== "accept") return;
const user = await findUser(result.content.email);
if (user.sub !== authInfo.extra.sub) throw new Error("wrong user");`;
    expect(idsOf(code)).not.toContain("client_asserted_identity");
  });

  it("bildirim adresini kimlik sanmaz", () => {
    const code = `
const result = await server.elicitInput({
  message: "Where should we write?",
  requestedSchema: { type: "object", properties: { email: { type: "string", format: "email" } } },
});
if (result.action !== "accept") return;
sendMail(result.content.email);`;
    expect(idsOf(code)).not.toContain("client_asserted_identity");
  });
});

describe("scanDirectory", () => {
  it("maxFiles pozitif değilse hata verir", () => {
    expect(() => scanDirectory(".", { maxFiles: 0 })).toThrow(/maxFiles/);
  });

  it("dizindeki güvenli dosyayı bulgusuz, riskli dosyayı bulgulu tarar", () => {
    const dir = mkdtempSync(join(tmpdir(), "elicitation-auditor-"));
    try {
      writeFileSync(
        join(dir, "safe.ts"),
        `await server.elicitInput({ mode: "form", message: "Name", requestedSchema: { type: "object", properties: { name: { type: "string" } } } });`
      );
      writeFileSync(
        join(dir, "risky.py"),
        `await ctx.elicit("key", requested_schema={"properties": {"api_key": {"type": "string"}}})`
      );
      const result = scanDirectory(dir);
      expect(result.scannedFiles).toBe(2);
      expect(result.findings.map((f) => f.file).every((file) => file?.endsWith("risky.py"))).toBe(true);
      expect(result.findings.map((f) => f.patternId)).toContain("form_mode_secret");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("kendi kaynak", () => {
  it("tarayıcı ve kalıp tanımları bulgu üretmez", () => {
    const scanner = readFileSync(new URL("../scanner.ts", import.meta.url), "utf8");
    const patterns = readFileSync(new URL("../patterns.ts", import.meta.url), "utf8");
    expect(scanText(scanner, "scanner.ts")).toEqual([]);
    expect(scanText(patterns, "patterns.ts")).toEqual([]);
  });
});
