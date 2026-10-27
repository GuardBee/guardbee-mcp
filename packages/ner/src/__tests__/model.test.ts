import { describe, expect, it } from "vitest";
import { NerModel } from "../ner.js";

/**
 * The real model: set GUARDBEE_NER_TEST_DIR to a directory `guardbee-ner
 * download` filled. Skipped otherwise, so CI does not fetch 186 MB.
 */
const dir = process.env["GUARDBEE_NER_TEST_DIR"];

describe.skipIf(!dir)("NerModel (default model)", () => {
  // Loaded on first use: a skipped suite still runs this body
  let load: Promise<NerModel> | undefined;
  const names = async (text: string) => {
    const [spans] = await (await (load ??= NerModel.load({ dir: dir! }))).detect([text]);
    return spans!.map((span) => text.slice(span.start, span.end));
  };

  it("finds full names, without titles or case suffixes", async () => {
    expect(await names("Müşteri Ayşe Yılmaz'ın talebini Mehmet Bey iletti.")).toEqual(["Ayşe Yılmaz", "Mehmet"]);
  });

  it("reads upper-case legal text", async () => {
    expect(await names("DAVACI: HÜSEYİN ÖZTÜRK\nVEKİLİ: Av. FATMA ŞAHİN")).toEqual(["HÜSEYİN ÖZTÜRK", "FATMA ŞAHİN"]);
  });

  it("leaves the same words alone when no one is named", async () => {
    // Mid-sentence; a capitalised one opening a sentence can go either way (README, Limits)
    expect(await names("Yarın barış görüşmeleri başlıyor, deniz kenarında güneş açtı.")).toEqual([]);
    expect(await names("Sipariş 48213377102 kargoya verildi.")).toEqual([]);
  });

  it("finds a name past the first window of a long text", async () => {
    const filler = "Toplantı notları burada devam ediyor ve konu uzuyor. ".repeat(120);
    expect(await names(`${filler}Sonunda Zeynep Kaya söz aldı.`)).toEqual(["Zeynep Kaya"]);
  });
});
