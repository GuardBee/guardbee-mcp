import { describe, expect, it } from "vitest";
import { maskPiiInText } from "../pii.js";

// Forms the pii-bench templates do not use, so these fixes are not only tuned to that set
const detected = (text: string) => {
  const names: string[] = [];
  maskPiiInText(text, (name, match) => (names.push(`${name}:${match}`), undefined));
  return names;
};

describe("phone_tr: parentheses and bare mobile numbers", () => {
  it.each([
    ["Ofis (0212) 555 12 34", "phone_tr:(0212) 555 12 34"],
    ["Cep (532) 123 45 67", "phone_tr:(532) 123 45 67"],
    ["Bana 0 (532) 123-45-67 numarasından ulaşın", "phone_tr:0 (532) 123-45-67"],
    ["cep: 5321234567", "phone_tr:5321234567"],
    ["numarası 5059876543 olan abone", "phone_tr:5059876543"],
    ["WhatsApp'tan yaz: 5441234567", "phone_tr:5441234567"],
  ])("finds %s", (text, found) => {
    expect(detected(text)).toEqual([found]);
  });

  it.each(["build 5321234567", "sipariş 5321234567 kargoda", "Ürün kodu (123) 456 78 90", "numara 5991234567"])("leaves %s", (text) => {
    expect(detected(text)).toEqual([]);
  });
});

describe("birth_date: more labels, month names, 'doğumlu'", () => {
  it.each([
    ["Doğum Tarihi: 3 Mart 1979", "birth_date:3 Mart 1979"],
    ["doğum tarihim 01/02/1990", "birth_date:01/02/1990"],
    ["1 Ocak 2000 doğumlu başvuran", "birth_date:1 Ocak 2000"],
    ["12.05.1988 tarihinde doğumlu", "birth_date:12.05.1988"],
    ["DOĞUM TARİHİ: 7 AĞUSTOS 1965", "birth_date:7 AĞUSTOS 1965"],
    ["DOB: 12 March 1990", "birth_date:12 March 1990"],
    ["born on 4 July 1985", "birth_date:4 July 1985"],
  ])("finds %s", (text, found) => {
    expect(detected(text)).toEqual([found]);
  });

  it.each(["Sözleşme 12 Şubat 2025 tarihinde imzalandı.", "Teslim tarihi: 12.05.2026", "Kampanya 1 Ocak 2026'da başlıyor."])("leaves %s", (text) => {
    expect(detected(text)).toEqual([]);
  });
});

describe("address: a street address without a label", () => {
  it.each([
    ["Yeni adresim Atatürk Mah. Cumhuriyet Cad. No:12 D:4 Kadıköy/İstanbul, kargoyu oraya", "address:Atatürk Mah. Cumhuriyet Cad. No:12 D:4 Kadıköy/İstanbul"],
    ["19 Mayıs Mahallesi İnönü Sokak No: 7 adresinde oturuyor", "address:19 Mayıs Mahallesi İnönü Sokak No: 7"],
    ["Teslimat: Moda Mah. Bahariye Cd. No.5/3", "address:Moda Mah. Bahariye Cd. No.5/3"],
  ])("finds %s", (text, found) => {
    expect(detected(text)).toEqual([found]);
  });

  it("reads an upper-case ADRESİ: label", () => {
    expect(detected("ADRESİ: Kızılay Mah. Gazi Mustafa Kemal Blv. No:33 Çankaya/Ankara")).toEqual([
      "address:Kızılay Mah. Gazi Mustafa Kemal Blv. No:33 Çankaya/Ankara",
    ]);
  });

  it.each(["Bağdat Caddesi'nde trafik var.", "Atatürk Mah. muhtarlığı toplantı yaptı.", "Cumhuriyet Cad. No:5 kapalı (yol çalışması)."])("leaves %s", (text) => {
    expect(detected(text)).toEqual([]);
  });
});
