import { describe, expect, it } from "vitest";
import { maskPiiInText } from "../pii.js";
import { PII_PRESETS, piiScope } from "../presets.js";
import { SPECIAL_CATEGORIES, type SpecialCategory } from "../special.js";

const SENSITIVE = piiScope({ preset: "KVKK_SENSITIVE" });
const mask = (text: string) => maskPiiInText(text, undefined, SENSITIVE);

// One sentence about a person and one with the same word and no one behind it, per category
const CASES: Record<SpecialCategory, { person: [string, string]; nobody: string }> = {
  health: { person: ["Hastanın tip 2 diyabeti var, insülin kullanıyor.", "Hastanın [SAĞLIK] var, [SAĞLIK] kullanıyor."], nobody: "Diyabet hastaları için beslenme rehberi güncellendi." },
  religion_belief: { person: ["Başvurucu ateist olduğunu belirtti.", "Başvurucu [DİN-İNANÇ] olduğunu belirtti."], nobody: "Alevi kültürü üzerine panel düzenlenecek." },
  ethnic_origin: { person: ["Müşteri Ermeni asıllı olduğunu söyledi.", "Müşteri [ETNİK-KÖKEN] olduğunu söyledi."], nobody: "Ermeni mimarisi sergisi açıldı." },
  political_opinion: { person: ["Çalışan muhalefet partisinin ilçe yöneticisi.", "Çalışan [SİYASİ-GÖRÜŞ]."], nobody: "Seçim sonuçları gece açıklanacak." },
  union_membership: { person: ["Personel metal işçileri sendikası üyesi.", "Personel [SENDİKA]."], nobody: "Sendika üyeliği hakkında toplantı yapılacak." },
  criminal_record: { person: ["Adayın dolandırıcılık suçundan mahkûmiyeti var.", "Adayın [SABIKA] var."], nobody: "Adli sicil kaydı belgesi e-Devlet'ten alınabilir." },
  sex_life: { person: ["Danışan biseksüel olduğunu anlattı.", "Danışan [CİNSEL-HAYAT] olduğunu anlattı."], nobody: "Eşcinsel evlilik anketi yayımlandı." },
  biometric: { person: ["Çalışanın parmak izi şablonu silinmedi.", "Çalışanın [BİYOMETRİK] silinmedi."], nobody: "Parmak izi okuyuculu turnikelerin teklifi geldi." },
  genetic: { person: ["Hastanın BRCA1 gen mutasyonu bulundu.", "Hastanın [GENETİK] bulundu."], nobody: "Genetik test fiyatları arttı." },
};

describe("KVKK Art. 6 special categories", () => {
  for (const category of SPECIAL_CATEGORIES) {
    const { person, nobody } = CASES[category];
    it(`${category}: masked when the text is about a person, not otherwise`, () => {
      expect(mask(person[0])).toBe(person[1]);
      expect(mask(nobody)).toBe(nobody);
    });
  }

  it("are opt-in: not in ALL or KVKK, all in KVKK_SENSITIVE (with the rest of KVKK)", () => {
    for (const category of SPECIAL_CATEGORIES) {
      expect(PII_PRESETS.ALL).not.toContain(category);
      expect(PII_PRESETS.KVKK).not.toContain(category);
      expect(PII_PRESETS.KVKK_SENSITIVE).toContain(category);
    }
    expect(PII_PRESETS.KVKK_SENSITIVE).toEqual(expect.arrayContaining([...PII_PRESETS.KVKK]));
    expect(maskPiiInText("Hastanın diyabeti var.")).toBe("Hastanın diyabeti var.");
    // A plain set adds them to the default detectors, like the other opt-in ones
    expect(maskPiiInText("Hastanın diyabeti var.", undefined, new Set(["health"]))).toBe("Hastanın [SAĞLIK] var.");
  });

  it("takes a person from a name the model found, or from an identifier", () => {
    const text = "Ayşe Yılmaz diyabet tedavisi görüyor.";
    expect(mask(text)).toBe(text);
    expect(maskPiiInText(text, undefined, SENSITIVE, undefined, () => [{ start: 0, end: 11, detector: "person_name" }])).toBe("[KİŞİ] [SAĞLIK] tedavisi görüyor.");
    expect(mask("TC 10000000146, migren hastası.")).toBe("TC [TC-KİMLİK], [SAĞLIK] hastası.");
  });

  it("does not take a group, an illness or a hospital for a person", () => {
    for (const text of ["Kanser hastaları için destek hattı açıldı.", "Kronik hastalıklar teminat kapsamında: diyabet, astım.", "Hastanede HIV testi ücretsiz."]) {
      expect(mask(text)).toBe(text);
    }
  });

  it("finds upper-case and inflected terms", () => {
    expect(mask("Çalışanın HIV pozitif olduğu bilgisi gizli.")).toBe("Çalışanın [SAĞLIK] olduğu bilgisi gizli.");
    expect(mask("Leyla Hanım Cemevi'ne gidiyor.")).toBe("Leyla Hanım [DİN-İNANÇ] gidiyor.");
    expect(mask("SANIĞIN SABIKA KAYDI VAR.")).toBe("SANIĞIN [SABIKA] VAR.");
  });

  it("leaves words that only start like a term", () => {
    // "gey" is a whole word ("geyik" is not); "kürtaj" is health, not "kürt" + aj
    expect(mask("Müşteri geyik muhabbeti yaptı.")).toBe("Müşteri geyik muhabbeti yaptı.");
    expect(mask("Hasta kürtaj olduğunu söyledi.")).toBe("Hasta [SAĞLIK] olduğunu söyledi.");
  });

  it("hands each find to the replacer under its category", () => {
    const seen: string[] = [];
    maskPiiInText("Personel sendika üyesi ve Alevi.", (name, match) => (seen.push(`${name}:${match}`), match), SENSITIVE);
    expect(seen).toEqual(["union_membership:sendika üyesi", "religion_belief:Alevi"]);
  });
});
