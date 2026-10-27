import fs from "node:fs";
import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { parseGatewayYaml } from "../gateway/config.js";
import { buildAibom } from "../report/aibom.js";

// The official CycloneDX 1.6 JSON schema (with the SPDX and JSF schemas it references)
const schema = (name: string) => JSON.parse(fs.readFileSync(new URL(`./fixtures/cyclonedx/${name}`, import.meta.url), "utf8")) as Record<string, unknown>;
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(schema("spdx.schema.json"), "spdx.schema.json");
ajv.addSchema(schema("jsf-0.82.schema.json"), "jsf-0.82.schema.json");
const validate = ajv.compile(schema("bom-1.6.schema.json"));

process.env["AIBOM_TEST_OPENAI"] = "sk-test-not-a-real-key";
process.env["AIBOM_TEST_TOKEN"] = "ghp_testtokenthatmustnotleak";
const config = parseGatewayYaml(`version: 1
listen: { transport: http, host: 127.0.0.1, port: 8787 }
upstreams:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github@2025.4.8"]
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: "\${AIBOM_TEST_TOKEN}" }
  fetch:
    command: uvx
    args: ["mcp-server-fetch==2026.10.24"]
  container:
    command: docker
    args: ["run", "-i", "--rm", "ghcr.io/github/github-mcp-server@sha256:250bc6ce70788207608ef74cef4397230ff2e8481218da74d6093e4bd9101132"]
  local:
    command: node
    args: ["./server.js"]
  linear:
    url: https://mcp.linear.app/mcp
    headers: { Authorization: "Bearer \${AIBOM_TEST_TOKEN}" }
llm:
  providers:
    openai: { api: openai, baseUrl: https://api.openai.com/v1, apiKeyEnv: AIBOM_TEST_OPENAI }
  routes:
    - { model: "gpt-4o*", provider: openai }
`);

const bom = buildAibom(config, {
  version: "1.28.0",
  now: new Date("2026-10-26T00:00:00Z"),
  serialNumber: "urn:uuid:3e671687-395b-41f5-a30f-a58921a69b79",
  pins: {
    github: {
      serverInfo: { name: "github-mcp-server", version: "2025.4.8" },
      tools: {
        create_issue: { hash: "a".repeat(64), firstSeen: "2026-10-01T00:00:00Z", snapshot: { name: "create_issue", description: "Create an issue", annotations: { readOnlyHint: false, destructiveHint: false } } },
        get_issue: { hash: "b".repeat(64), firstSeen: "2026-10-01T00:00:00Z", snapshot: { name: "get_issue", description: "Read an issue", annotations: { readOnlyHint: true } } },
      },
    },
  },
  provenance: (artifact) =>
    artifact === "npm:@modelcontextprotocol/server-github@2025.4.8" ? { status: "verified", sourceRepository: "https://github.com/modelcontextprotocol/servers", sourceCommit: "abc123" } : undefined,
}) as { components: Record<string, unknown>[]; services: Record<string, unknown>[]; dependencies: { ref: string; dependsOn: string[] }[] };

const property = (item: Record<string, unknown>, name: string) => (item["properties"] as { name: string; value: string }[]).find((p) => p.name === name)?.value;

describe("buildAibom", () => {
  it("is valid CycloneDX 1.6", () => {
    const ok = validate(bom);
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  it("names each server by package URL, with provenance when it was checked", () => {
    const byRef = Object.fromEntries(bom.components.map((c) => [c["bom-ref"], c]));
    expect(byRef["server:github"]).toMatchObject({ type: "application", group: "@modelcontextprotocol", name: "server-github", version: "2025.4.8", purl: "pkg:npm/%40modelcontextprotocol/server-github@2025.4.8" });
    expect(property(byRef["server:github"]!, "guardbee:provenance:status")).toBe("verified");
    expect(byRef["server:github"]!["externalReferences"]).toEqual([{ type: "vcs", url: "https://github.com/modelcontextprotocol/servers", comment: "commit abc123" }]);
    expect(byRef["server:fetch"]).toMatchObject({ purl: "pkg:pypi/mcp-server-fetch@2026.10.24" });
    expect(byRef["server:container"]).toMatchObject({ type: "container", purl: expect.stringMatching(/^pkg:oci\/github-mcp-server@sha256%3A250bc6/) });
    expect(byRef["server:local"]).toMatchObject({ type: "application", name: "local" });
  });

  it("lists pinned tools under their server, and remote servers as services with endpoints", () => {
    const github = bom.services.find((s) => s["name"] === "github")!;
    const tools = github["services"] as Record<string, unknown>[];
    expect(tools.map((t) => t["name"])).toEqual(["create_issue", "get_issue"]);
    expect(property(tools[1]!, "guardbee:tool:sha256")).toBe("b".repeat(64));
    expect(property(tools[1]!, "guardbee:tool:readOnlyHint")).toBe("true");
    expect(bom.services.find((s) => s["name"] === "linear")).toMatchObject({ endpoints: ["https://mcp.linear.app/mcp"], authenticated: true, "x-trust-boundary": true });
  });

  it("lists LLM routes as models and ties everything to the gateway", () => {
    expect(bom.components.find((c) => c["type"] === "machine-learning-model")).toMatchObject({ name: "gpt-4o*", supplier: { name: "openai", url: ["https://api.openai.com/v1"] } });
    expect(bom.dependencies[0]!.ref).toBe("guardbee-gateway");
    expect(bom.dependencies[0]!.dependsOn).toEqual(expect.arrayContaining(["upstream:github", "upstream:linear", "model:0:gpt-4o*"]));
  });

  it("holds no secret: no environment values, headers or keys", () => {
    const text = JSON.stringify(bom);
    expect(text).not.toContain("ghp_testtokenthatmustnotleak");
    expect(text).not.toContain("sk-test-not-a-real-key");
    expect(text).not.toContain("Bearer");
  });
});
