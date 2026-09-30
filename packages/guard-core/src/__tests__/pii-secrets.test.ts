import { describe, it, expect } from "vitest";
import { maskPiiInText } from "../pii.js";

describe("maskPiiInText — Turkish identifiers", () => {
  it("masks a labeled tax number that passes the checksum", () => {
    expect(maskPiiInText("VKN: 1234567890")).toBe("VKN: [VKN]");
    expect(maskPiiInText("Vergi No 1234567890")).toBe("Vergi No [VKN]");
    expect(maskPiiInText("Vergi kimlik numarası: 1234567890")).toBe("Vergi kimlik numarası: [VKN]");
  });

  it("leaves a wrong check digit and an unlabeled 10-digit number alone", () => {
    expect(maskPiiInText("VKN: 1234567891")).toBe("VKN: 1234567891");
    expect(maskPiiInText("Sipariş 1234567890 hazır")).toBe("Sipariş 1234567890 hazır");
  });

  it("masks Turkish phone numbers but not other 10-digit runs", () => {
    expect(maskPiiInText("Tel: 0532 123 45 67")).toBe("Tel: +90-***-***-**[TELEFON]");
    expect(maskPiiInText("Tel: +90 532 123 45 67")).toBe("Tel: +90-***-***-**[TELEFON]");
    expect(maskPiiInText("Kargo takip 1234567890")).toBe("Kargo takip 1234567890");
  });
});

describe("maskPiiInText — secrets", () => {
  it.each([
    ["GitHub token", "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8", "[API-KEY]"],
    ["AWS access key", "AKIA" + "ABCDEFGHIJKLMNOP", "[API-KEY]"],
    ["Anthropic key", "sk-ant-" + "api03-abcdefghijklmnopqrstuvwxyz012345", "[API-KEY]"],
    ["Stripe live key", "sk_live_" + "abcdefghijklmnopqrstuvwx", "[API-KEY]"],
    ["Slack token", "xoxb-" + "1234567890-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx", "[API-KEY]"],
  ])("masks a %s", (_, secret, expected) => {
    expect(maskPiiInText(`key=${secret} end`)).toBe(`key=${expected} end`);
  });

  it("masks a whole private key block, not only its first line", () => {
    const key = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\nAAAABG5vbmUAAAAEbm9uZQ==\n-----END OPENSSH PRIVATE KEY-----";
    expect(maskPiiInText(`id_rsa:\n${key}\ndone`)).toBe("id_rsa:\n[PRIVATE-KEY]\ndone");
  });

  it("masks a connection string with a password before the email rule sees user@host", () => {
    expect(maskPiiInText("DATABASE_URL=postgres://app:" + "s3cretPass@db.internal:5432/prod")).toBe(
      "DATABASE_URL=[CONNECTION-STRING]",
    );
  });

  it("honors the secret rule's allowlist (localhost connection strings)", () => {
    const local = "postgres://app:app@localhost:5432/dev";
    expect(maskPiiInText(local)).toBe(local);
  });

  it("the generic key rule needs a separator and letters plus digits", () => {
    expect(maskPiiInText("api_" + "k3y9x8c7v6b5n4m3q2")).toBe("[API-KEY]");
    expect(maskPiiInText("tokenization1234567890ab")).toBe("tokenization1234567890ab");
    expect(maskPiiInText("secret_management_overview")).toBe("secret_management_overview");
  });

  it("does not mask a publishable Stripe key (broad rule)", () => {
    const publishable = "pk_live_" + "abcdefghijklmnopqrstuvwx";
    expect(maskPiiInText(publishable)).toBe(publishable);
  });
});

describe("maskPiiInText — phone false positives from real READMEs", () => {
  it.each([
    "https://user-images.githubusercontent.com/8784712/49065552-49dc8500-f25a.png",
    "The inet_aton form 2130706433 is 127.0.0.1",
    "// 3232235777n",
    "build 5321234567",
  ])("leaves %s alone", (text) => {
    expect(maskPiiInText(text)).toBe(text);
  });

  it("still masks a grouped number without a prefix", () => {
    expect(maskPiiInText("Tel 532 123 45 67")).toBe("Tel +90-***-***-**[TELEFON]");
  });
});
