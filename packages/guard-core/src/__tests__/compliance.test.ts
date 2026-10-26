import { describe, expect, it } from "vitest";
import { CAPABILITY_TITLES, COMPLIANCE_FRAMEWORKS, COMPLIANCE_FRAMEWORK_IDS } from "../compliance.js";
import { THREAT_CATEGORIES } from "../frameworks.js";

describe("compliance mappings", () => {
  it.each(COMPLIANCE_FRAMEWORK_IDS)("%s maps every threat category and capability to controls it defines, each with a citation", (id) => {
    const framework = COMPLIANCE_FRAMEWORKS[id];
    expect(Object.keys(framework.findings).sort()).toEqual(Object.keys(THREAT_CATEGORIES).sort());
    expect(Object.keys(framework.capabilities).sort()).toEqual(Object.keys(CAPABILITY_TITLES).sort());
    for (const list of [...Object.values(framework.findings), ...Object.values(framework.capabilities)]) {
      expect(list.length).toBeGreaterThan(0);
      for (const control of list) expect(framework.controls[control], `${id}: ${control}`).toBeDefined();
    }
    for (const control of Object.values(framework.controls)) expect(control.citation).toContain(control.id.replace(/^Art\. /, "Article ").replace(/\(\d+\)$/, ""));
  });

  it("uses every control it defines", () => {
    for (const framework of Object.values(COMPLIANCE_FRAMEWORKS)) {
      const used = new Set([...Object.values(framework.findings), ...Object.values(framework.capabilities)].flat());
      expect(Object.keys(framework.controls).filter((c) => !used.has(c))).toEqual([]);
    }
  });
});
