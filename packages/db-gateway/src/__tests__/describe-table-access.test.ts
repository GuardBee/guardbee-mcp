import { describe, expect, it } from "vitest";
import { loadConfig } from "../config";
import { GatewayPipeline } from "../gateway/pipeline";
import { describeTableAccessError } from "../tools/db-tools";

describe("describe_table access", () => {
  it("rejects a table outside the active role allow-list before any query", () => {
    const config = loadConfig({
      activeRole: "ai-agent",
      roles: [{ name: "ai-agent", allowTables: ["orders"] }],
    });
    const pipeline = new GatewayPipeline(config);
    expect(describeTableAccessError(config, pipeline, "users")).toBe("Table 'users' is not accessible.");
    expect(describeTableAccessError(config, pipeline, "orders")).toBeNull();
  });

  it("still honors a global table deny", () => {
    const config = loadConfig({
      tableRules: [{ table: "users", access: "deny" }],
    });
    const pipeline = new GatewayPipeline(config);
    expect(describeTableAccessError(config, pipeline, "users")).toBe("Table 'users' is not accessible.");
  });
});
