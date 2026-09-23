import { describe, it, expect } from "vitest";
import { scanText, scanAndRedactText, scanBody, redactBody } from "../scanner.js";

function idsOf(text: string): string[] {
  return scanText(text).map((f) => f.patternId);
}

describe("scanText — credentials", () => {
  it("yakalar: OpenAI API key", () => {
    expect(idsOf(`My key is sk-abcdefghijklmnopqrstuvwx and here is the prompt`)).toContain("openai_api_key");
  });

  it("yakalar: Anthropic API key", () => {
    expect(idsOf(`key: sk-ant-abcdefghijklmnopqrstuvwx`)).toContain("anthropic_api_key");
  });

  it("yakalar: AWS access key ID", () => {
    expect(idsOf(`AKIAIOSFODNN7EXAMPLE is the access key`)).toContain("aws_access_key_id");
  });

  it("yakalar: PEM private key block", () => {
    expect(idsOf(`-----BEGIN RSA PRIVATE KEY-----\nMIIExyz...`)).toContain("private_key_block");
  });

  it("yakalar: JWT", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dQw4w9WgXcQ_abcdefghij";
    expect(idsOf(`Authorization: Bearer ${jwt}`)).toContain("jwt_token");
  });

  it("normal metinde credential yakalamaz", () => {
    expect(idsOf(`Please summarize this document for me.`)).toHaveLength(0);
  });
});

describe("scanText — tc_kimlik_no (checksum-validated)", () => {
  it("geçerli bir TC Kimlik No'yu yakalar", () => {
    // 10000000146 gerçek algoritmayı sağlayan bilinen bir test değeri
    expect(idsOf(`Müşteri TC: 10000000146`)).toContain("tc_kimlik_no");
  });

  it("checksum'ı geçersiz 11 haneli bir sayıyı yakalamaz", () => {
    expect(idsOf(`Sipariş numarası: 12345678901`)).not.toContain("tc_kimlik_no");
  });

  it("0 ile başlayan 11 haneli bir sayıyı yakalamaz", () => {
    expect(idsOf(`Kod: 01234567890`)).not.toContain("tc_kimlik_no");
  });
});

describe("scanText — credit_card_number (Luhn-validated)", () => {
  it("geçerli (Luhn) bir kart numarasını yakalar", () => {
    expect(idsOf(`Card: 4532015112830366`)).toContain("credit_card_number");
  });

  it("Luhn'u geçmeyen 16 haneli bir sayıyı yakalamaz", () => {
    expect(idsOf(`Reference: 1234567890123456`)).not.toContain("credit_card_number");
  });
});

describe("scanText — iban (mod-97 validated)", () => {
  it("geçerli bir IBAN'ı yakalar", () => {
    expect(idsOf(`IBAN: TR330006100519786457841326`)).toContain("iban");
  });

  it("checksum'ı bozuk bir IBAN benzeri stringi yakalamaz", () => {
    expect(idsOf(`Code: TR330006100519786457841327`)).not.toContain("iban");
  });
});

describe("scanText — contact PII", () => {
  it("yakalar: email", () => {
    expect(idsOf(`Contact me at jane.doe@example.com`)).toContain("email_address");
  });

  it("yakalar: Türkiye telefon numarası", () => {
    expect(idsOf(`Beni ara: 0532 123 45 67`)).toContain("turkish_phone_number");
  });
});

describe("scanText — masking", () => {
  it("maskedMatch gerçek değeri asla tam göstermez", () => {
    const findings = scanText(`sk-abcdefghijklmnopqrstuvwx`);
    expect(findings[0].maskedMatch).not.toBe("sk-abcdefghijklmnopqrstuvwx");
    expect(findings[0].maskedMatch).toContain("…");
  });
});

describe("scanAndRedactText", () => {
  it("bulunan değeri [REDACTED:id] ile değiştirir", () => {
    const { findings, redactedText } = scanAndRedactText(`My key is sk-abcdefghijklmnopqrstuvwx, thanks`);
    expect(findings).toHaveLength(1);
    expect(redactedText).toBe(`My key is [REDACTED:openai_api_key], thanks`);
  });

  it("birden fazla bulguyu doğru sırayla redakte eder", () => {
    const { redactedText } = scanAndRedactText(`email jane@example.com and key sk-abcdefghijklmnopqrstuvwx`);
    expect(redactedText).toBe(`email [REDACTED:email_address] and key [REDACTED:openai_api_key]`);
  });
});

describe("scanBody — chat message extraction", () => {
  it("messages[].content string alanındaki bulguyu location ile birlikte döner", () => {
    const body = { messages: [{ role: "user", content: "my key is sk-abcdefghijklmnopqrstuvwx" }] };
    const { findings } = scanBody(body);
    expect(findings[0]).toMatchObject({ patternId: "openai_api_key", location: "messages[0].content" });
  });

  it("system alanındaki bulguyu yakalar", () => {
    const body = { system: "user email is jane@example.com", messages: [] };
    const { findings } = scanBody(body);
    expect(findings[0]).toMatchObject({ patternId: "email_address", location: "system" });
  });

  it("content-block array formundaki text alanını tarar", () => {
    const body = { messages: [{ role: "user", content: [{ type: "text", text: "key sk-abcdefghijklmnopqrstuvwx" }] }] };
    const { findings } = scanBody(body);
    expect(findings[0]).toMatchObject({ location: "messages[0].content[0].text" });
  });

  it("temiz bir body'de bulgu döndürmez", () => {
    const body = { messages: [{ role: "user", content: "What's the weather like today?" }] };
    expect(scanBody(body).findings).toHaveLength(0);
  });
});

describe("redactBody", () => {
  it("body'yi in-place redakte eder ve orijinal referansı döner", () => {
    const body = { messages: [{ role: "user", content: "my key is sk-abcdefghijklmnopqrstuvwx" }] };
    const { findings, redactedBody } = redactBody(body);
    expect(findings).toHaveLength(1);
    expect(redactedBody).toBe(body); // aynı obje referansı, in-place mutasyon
    expect((body.messages[0] as { content: string }).content).toBe("my key is [REDACTED:openai_api_key]");
  });
});
