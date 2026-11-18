import { describe, expect, it } from "vitest";
import { parseGatewayYaml } from "../gateway/config.js";

const base = `
version: 1
upstreams:
  fs:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
`;

describe("profile: strict", () => {
  it("keeps the availability-first defaults without a profile", () => {
    const cfg = parseGatewayYaml(base);
    expect(cfg.provenance).toEqual({ mode: "warn", offline: false });
  });

  it("requires provenance", () => {
    const cfg = parseGatewayYaml(`profile: strict\n${base}`);
    expect(cfg.provenance?.mode).toBe("require");
  });

  it("refuses when Redis, the classifier or the judge cannot answer", () => {
    const cfg = parseGatewayYaml(`profile: strict
${base}
state: { backend: redis, url: "redis://127.0.0.1:6379" }
classifier: { url: "http://127.0.0.1:8790" }
judge: { endpoint: "http://127.0.0.1:11434/v1", model: "llama3" }
`);
    expect(cfg.state?.onError).toBe("fail-closed");
    expect(cfg.classifier?.onError).toBe("closed");
    expect(cfg.judge?.onError).toBe("closed");
  });

  it("does not add sections the file leaves out", () => {
    const cfg = parseGatewayYaml(`profile: strict\n${base}`);
    expect(cfg.state).toBeUndefined();
    expect(cfg.classifier).toBeUndefined();
    expect(cfg.judge).toBeUndefined();
  });

  it("lets a setting written in the file win", () => {
    const cfg = parseGatewayYaml(`profile: strict
${base}
provenance: { mode: warn }
state: { backend: redis, url: "redis://127.0.0.1:6379", onError: local }
`);
    expect(cfg.provenance?.mode).toBe("warn");
    expect(cfg.state?.onError).toBe("local");
  });

  it("rejects an unknown profile", () => {
    expect(() => parseGatewayYaml(`profile: paranoid\n${base}`)).toThrow(/profile/);
  });
});
