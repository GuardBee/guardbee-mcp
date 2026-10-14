import { describe, expect, it } from "vitest";
import { PERSONAL_DATA_CATEGORIES, PII_PATTERNS, maskPiiInText } from "../pii.js";

const ALL_OPT_IN = new Set(["ip_address", "mac_address", "plate_tr"]);
const found = (text: string, include?: ReadonlySet<string>) => {
  const names: string[] = [];
  maskPiiInText(text, (name) => (names.push(name), `[${name}]`), include);
  return names;
};
const masked = (text: string, include?: ReadonlySet<string>) => maskPiiInText(text, (name) => `[${name}]`, include);

describe("label-gated identifiers", () => {
  it("passport numbers after a label, TR and EN", () => {
    expect(masked("Pasaport No: U12345678")).toBe("Pasaport No: [passport]");
    expect(masked("passport number 123456789 issued")).toBe("passport number [passport] issued");
    expect(found("U12345678 is the order code")).toEqual([]);
  });

  it("SGK / SSK / Bağ-Kur numbers after a label", () => {
    expect(masked("SGK sicil no: 1234567890")).toBe("SGK sicil no: [sgk_no]");
    expect(masked("Bağ-Kur No 12345678")).toBe("Bağ-Kur No [sgk_no]");
    expect(found("SGK prim tutarı 1234567")).toEqual([]);
  });

  it("MERSİS numbers after a label, before a 16-digit card check can claim them", () => {
    expect(masked("MERSİS No: 0123 4567 8901 2345")).toBe("MERSİS No: [mersis]");
    expect(masked("Mersis numarası 0123456789012345")).toBe("Mersis numarası [mersis]");
  });

  it("birth dates after a label", () => {
    expect(masked("Doğum tarihi: 12.05.1990")).toBe("Doğum tarihi: [birth_date]");
    expect(masked("DOB 1990-05-12")).toBe("DOB [birth_date]");
    expect(found("Fatura tarihi: 12.05.2024")).toEqual([]);
  });

  it("street addresses after a label, not IP / e-mail / web addresses", () => {
    expect(masked("Adres: Atatürk Mah. 12. Sok. No:5 Kadıköy\nTel yok")).toBe("Adres: [address]\nTel yok");
    expect(masked("Address: 221B Baker Street, London")).toBe("Address: [address]");
    expect(found("IP address: 10.0.0.1 is fine")).toEqual([]);
    expect(found("E-mail address: see profile page")).toEqual([]);
    expect(found("Wallet address: 0xabc123def4567890")).toEqual([]);
    expect(found("Address: https://acme.com/contact-page")).toEqual([]);
    expect(found("address: unknown at the moment")).toEqual([]);
  });

  it("KEP addresses as their own category", () => {
    expect(found("Tebligat: acme@hs01.kep.tr adresine")).toEqual(["kep"]);
    expect(found("ali@example.com")).toEqual(["email"]);
  });
});

describe("opt-in network identifiers and plates", () => {
  it("are off by default", () => {
    expect(found("host 192.168.1.10 mac aa:bb:cc:dd:ee:ff plaka 34 ABC 123")).toEqual([]);
  });

  it("IPv4 and IPv6 when included, not versions or times", () => {
    expect(masked("from 192.168.1.10 and 2001:db8::8a2e:370:7334", ALL_OPT_IN)).toBe("from [ip_address] and [ip_address]");
    expect(masked("fe80:0:0:0:200:f8ff:fe21:67cf", ALL_OPT_IN)).toBe("[ip_address]");
    expect(found("node 1.2.3.4.5 at 12:30:45, v300.1.1.1x", ALL_OPT_IN)).toEqual([]);
    expect(found("std::vector<int>", ALL_OPT_IN)).toEqual([]);
  });

  it("MAC addresses when included", () => {
    expect(masked("ether 00:1A:2b:3C:4d:5E up", ALL_OPT_IN)).toBe("ether [mac_address] up");
    expect(masked("00-1A-2B-3C-4D-5E", ALL_OPT_IN)).toBe("[mac_address]");
    expect(found("00:1A-2B:3C:4D:5E", ALL_OPT_IN)).toEqual([]);
  });

  it("Turkish plates by letter/digit combination, not units", () => {
    expect(masked("34 ABC 123, 06 AB 1234, 35 A 12345", ALL_OPT_IN)).toBe("[plate_tr], [plate_tr], [plate_tr]");
    expect(found("16 GB 2400, 34 AB 12, 99 ABC 123, 34 QWX 123, 12 MB 512", ALL_OPT_IN)).toEqual([]);
  });
});

describe("categories", () => {
  it("every personal-data category has a detector, and opt-in ones are marked", () => {
    const names = new Set(PII_PATTERNS.map((p) => p.name));
    for (const category of PERSONAL_DATA_CATEGORIES) expect(names.has(category)).toBe(true);
    expect(PII_PATTERNS.filter((p) => p.optIn).map((p) => p.name).sort()).toEqual([...ALL_OPT_IN].sort());
  });
});
