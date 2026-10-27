import { describe, expect, it } from "vitest";
import { hashTool } from "../hashing.js";

describe("hashTool", () => {
  it("gives the same hash as before it moved to guard-core, so existing baselines still match", () => {
    // Computed with the 0.3 implementation (canonical JSON of name, description, schemas, annotations)
    const tool = { name: "get_weather", description: "Returns the weather", inputSchema: { type: "object", properties: { city: { type: "string" } } }, annotations: { readOnlyHint: true } };
    expect(hashTool(tool)).toBe("481dcdd75d2307fbd66a0c873b36ddb91f6577ab40aa529ba6f9e91986064a80");
    // Key order does not matter
    expect(hashTool({ annotations: { readOnlyHint: true }, inputSchema: { properties: { city: { type: "string" } }, type: "object" }, description: "Returns the weather", name: "get_weather" })).toBe("481dcdd75d2307fbd66a0c873b36ddb91f6577ab40aa529ba6f9e91986064a80");
  });
});
