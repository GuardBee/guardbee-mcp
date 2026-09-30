import { describe, it, expect } from "vitest";
import { classifyTool } from "../classify.js";

describe("classifyTool — snake_case names", () => {
  it.each([
    ["drop_table", "destructive"],
    ["read_vault_secret", "sensitive-data"],
    ["send_email", "exfiltration"],
    ["get_customer_iban", "sensitive-data"],
  ] as const)("%s → %s from the name alone", (name, capability) => {
    expect(classifyTool({ name })).toContain(capability);
  });

  it("finds sensitive field names inside the input schema", () => {
    const tool = {
      name: "lookup",
      inputSchema: { type: "object", properties: { customer_email: { type: "string" } } },
    };
    expect(classifyTool(tool)).toContain("sensitive-data");
  });

  it("labels a pull request as exfiltration (the GitHub MCP exploit's sink)", () => {
    expect(classifyTool({ name: "create_pull_request", description: "Create a new pull request" })).toContain("exfiltration");
  });

  it("does not label a plain read-only tool", () => {
    expect(classifyTool({ name: "get_weather", description: "Returns the forecast for a city" })).toEqual([]);
  });
});
