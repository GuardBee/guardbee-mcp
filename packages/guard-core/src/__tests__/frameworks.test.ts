import { describe, expect, it } from "vitest";
import { THREAT_CATEGORIES, classifyEvent } from "../frameworks.js";

describe("classifyEvent", () => {
  it("maps proxy refusals to threat categories", () => {
    expect(classifyEvent({ type: "blocked", reason: "Prompt injection pattern detected: ignore_previous — x" })).toBe("directInjection");
    expect(classifyEvent({ type: "blocked", ruleId: "llm:injection", reason: "x" })).toBe("directInjection");
    expect(classifyEvent({ type: "blocked", reason: "Indirect prompt injection in tool result (MCP06:2025): …" })).toBe("indirectInjection");
    expect(classifyEvent({ type: "blocked", reason: "Prompt injection pattern detected: reveal the system prompt" })).toBe("promptLeak");
    expect(classifyEvent({ type: "blocked", ruleId: "poisoning:hidden_instruction" })).toBe("toolPoisoning");
    expect(classifyEvent({ type: "blocked", reason: 'Tool "x" changed during this session (MCP03:2025).' })).toBe("rugPull");
    expect(classifyEvent({ type: "toxic_flow", reason: "Toxic flow (lethal trifecta): …" })).toBe("dataLeak");
    expect(classifyEvent({ type: "blocked", ruleId: "egress:credential" })).toBe("dataLeak");
    expect(classifyEvent({ type: "blocked", ruleId: "quota:exports" })).toBe("consumption");
    expect(classifyEvent({ type: "blocked", reason: "budget daily reached: 100 requests per 3600s" })).toBe("consumption");
    expect(classifyEvent({ type: "blocked", ruleId: "no-prod" })).toBe("excessiveAgency");
    expect(classifyEvent({ type: "tool_call" })).toBeNull();
    expect(classifyEvent({ type: "warn", reason: "documents:unread" })).toBeNull();
  });

  it("every category has an OWASP and an ATLAS reference", () => {
    for (const category of Object.values(THREAT_CATEGORIES)) {
      expect(category.owasp.length).toBeGreaterThan(0);
      expect(category.atlas.every((a) => /^AML\.T\d{4}(\.\d{3})?$/.test(a.id))).toBe(true);
      expect(category.owasp.every((o) => /^LLM\d{2}:2025$/.test(o.id))).toBe(true);
    }
  });
});
