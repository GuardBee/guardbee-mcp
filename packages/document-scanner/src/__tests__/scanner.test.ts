import { describe, expect, it } from "vitest";
import { detectKind, extractText } from "../extract.js";
import { scanBytes } from "../scanner.js";
import { buildSarif, formatResults, shouldFail } from "../report.js";
import { scannedPdf, textImage, textPdf } from "./fixtures.js";

const TCKN = "10000000146";
const IBAN = "TR33 0006 1005 1978 6457 8413 26";
/** OCR downloads Tesseract language data on first use; set GUARDBEE_OCR_TESTS=0 to skip offline. */
const ocr = process.env["GUARDBEE_OCR_TESTS"] !== "0";

describe("detectKind", () => {
  it("reads the type from the bytes", () => {
    expect(detectKind(textPdf(["x"]))).toBe("pdf");
    expect(detectKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("png");
    expect(detectKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(detectKind(new TextEncoder().encode("plain text, Türkçe"))).toBe("text");
    expect(detectKind(new Uint8Array([0, 1, 2, 3, 0, 9]))).toBe("binary");
  });
});

describe("text-layer PDFs", () => {
  it("finds PII and credentials with their page", async () => {
    const doc = textPdf([`Musteri TC ${TCKN}`, `IBAN ${IBAN}`, "Pasaport No: U12345678", "token ghp_1234567890abcdefghijklmnopqrstuvwxyz12"]);
    const result = await scanBytes(doc, "contract.pdf", { ocr: false });
    expect(result.kind).toBe("pdf");
    expect(result.findings.map((f) => f.detector).sort()).toEqual(["github_pat", "iban", "passport", "tc_kimlik"]);
    expect(result.findings.every((f) => f.page === 1 && f.method === "pdf-text")).toBe(true);
    expect(result.findings.find((f) => f.detector === "github_pat")).toMatchObject({ category: "credential", severity: "high" });
    expect(JSON.stringify(result)).not.toContain(TCKN);
  });

  it("a clean PDF has no findings, and text files are read as text", async () => {
    expect((await scanBytes(textPdf(["Quarterly report, nothing personal here."]))).findings).toEqual([]);
    const text = await scanBytes(new TextEncoder().encode(`mail ali@example.com`), "notes.txt");
    expect(text.findings).toMatchObject([{ detector: "email", method: "text" }]);
  });

  it("notes a scanned page instead of silently skipping it when OCR is off", async () => {
    const result = await extractText(await scannedPdf(["hello"]), { ocr: false });
    expect(result.pages).toEqual([]);
    expect(result.notes[0]).toContain("without a text layer");
  });

  it("refuses documents over maxBytes", async () => {
    const result = await extractText(textPdf(["x"]), { maxBytes: 10 });
    expect(result.notes[0]).toContain("over the 10-byte limit");
  });
});

describe.skipIf(!ocr)("OCR", () => {
  it("reads PII from a screenshot", async () => {
    const image = await textImage([`TC Kimlik: ${TCKN}`, `IBAN: ${IBAN}`]);
    const result = await scanBytes(image.bytes, "screenshot.png");
    expect(result.kind).toBe("png");
    expect(result.findings.map((f) => f.detector).sort()).toEqual(["iban", "tc_kimlik"]);
    expect(result.findings[0]!.method).toBe("ocr");
  }, 120_000);

  it("reads a card number from a screenshot (Luhn-checked after OCR)", async () => {
    const result = await scanBytes((await textImage(["Kart: 5555 5555 5555 4444"])).bytes, "card.png");
    expect(result.findings.map((f) => f.detector)).toEqual(["credit_card"]);
  }, 120_000);

  it("reads PII from a scanned PDF page", async () => {
    const result = await scanBytes(await scannedPdf([`TC Kimlik: ${TCKN}`, "e-posta: ali@example.com"]), "scan.pdf");
    expect(result.findings.map((f) => f.detector).sort()).toEqual(["email", "tc_kimlik"]);
    expect(result.findings.every((f) => f.method === "pdf-ocr")).toBe(true);
  }, 120_000);
});

describe("report", () => {
  it("formats, fails on severity and builds SARIF", async () => {
    const result = await scanBytes(textPdf([`TC ${TCKN}`, "mail ali@example.com"]), "a.pdf");
    const text = formatResults([result]);
    expect(text).toContain("[HIGH] tc_kimlik (personal) — page 1, pdf-text");
    expect(text).not.toContain(TCKN);
    expect(shouldFail(result.findings, "high")).toBe(true);
    expect(shouldFail(result.findings.filter((f) => f.severity === "medium"), "high")).toBe(false);
    const sarif = buildSarif("0.1.0", result.findings) as { runs: { results: { ruleId: string; locations: { physicalLocation: { region: { startLine: number } } }[] }[] }[] };
    expect(sarif.runs[0]!.results.map((r) => r.ruleId).sort()).toEqual(["email", "tc_kimlik"]);
    expect(sarif.runs[0]!.results[0]!.locations[0]!.physicalLocation.region.startLine).toBe(1);
  });
});
