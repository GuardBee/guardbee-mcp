import { describe, it, expect } from "vitest";
import { toFinding } from "../scanner.js";

describe("toFinding — paket bulunamadı", () => {
  it("registry'de hiç olmayan bir paket için critical bulgu döner", () => {
    const f = toFinding("definitely-hallucinated-pkg-xyz", false, "npm", false, undefined);
    expect(f?.patternId).toBe("dependency_not_found");
    expect(f?.severity).toBe("critical");
  });

  it("dev bağımlılığı olduğu bilgisini korur", () => {
    const f = toFinding("fake-dev-pkg", true, "npm", false, undefined);
    expect(f?.isDev).toBe(true);
  });

  it("PyPI için de aynı şekilde çalışır", () => {
    const f = toFinding("fake-pypi-pkg", false, "PyPI", false, undefined);
    expect(f?.ecosystem).toBe("PyPI");
    expect(f?.severity).toBe("critical");
  });
});

describe("toFinding — yeni yayınlanmış paket", () => {
  it("30 günden yeni bir pakette low severity bulgu döner", () => {
    const f = toFinding("brand-new-pkg", false, "npm", true, 5);
    expect(f?.patternId).toBe("dependency_recently_published");
    expect(f?.severity).toBe("low");
    expect(f?.ageDays).toBe(5);
  });

  it("tam 30 gün eşiğinde bulgu DÖNMEZ (eşik değeri dahil değil)", () => {
    const f = toFinding("thirty-days-old-pkg", false, "npm", true, 30);
    expect(f).toBeNull();
  });

  it("29 günlük bir pakette hâlâ bulgu döner", () => {
    const f = toFinding("twentynine-days-old-pkg", false, "npm", true, 29);
    expect(f).not.toBeNull();
  });
});

describe("toFinding — olgun/gerçek paket", () => {
  it("var olan ve eski (react gibi) bir paket için hiçbir bulgu döndürmez", () => {
    const f = toFinding("react", false, "npm", true, 5000);
    expect(f).toBeNull();
  });

  it("ageDays bilgisi olmayan (örn. registry hatası nedeniyle) var olan bir paketi de güvenli sayar", () => {
    const f = toFinding("some-package", false, "npm", true, undefined);
    expect(f).toBeNull();
  });
});
