import { describe, expect, it } from "vitest";
import { scanText } from "../scanner.js";
import { buildSarif } from "../sarif.js";

const ids = (code: string) => scanText(code).map((f) => f.patternId);

// MCP spec Security Best Practices attacks: each rule with a vulnerable and a clean case
describe.each([
  {
    rule: "predictable_state_handle",
    vulnerable: `const state = Math.random().toString(36).slice(2);`,
    clean: `const state = crypto.randomUUID();`,
  },
  {
    rule: "python_predictable_state_handle",
    vulnerable: `state = str(random.randint(0, 10**9))`,
    clean: `state = secrets.token_urlsafe(32)`,
  },
  {
    rule: "state_handle_not_bound_to_user",
    vulnerable: `const flow = flows.get(args.sessionHandle);\nreturn resume(flow);`,
    clean: `const flow = flows.get(args.sessionHandle);\nif (flow?.userId !== extra.authInfo.clientId) throw new Error("not yours");`,
  },
  {
    rule: "missing_iss_validation",
    vulnerable: `const code = url.searchParams.get("code");\nawait fetch(tokenUrl, { body: new URLSearchParams({ grant_type: "authorization_code", code }) });`,
    clean: `const code = url.searchParams.get("code");\nif (url.searchParams.get("iss") !== expectedIssuer) throw new Error("mix-up");\nawait fetch(tokenUrl, { body: new URLSearchParams({ grant_type: "authorization_code", code }) });`,
  },
  {
    rule: "auth_url_scheme_not_validated",
    vulnerable: `const { authorizationUrl } = await startAuth(server);\nawait open(authorizationUrl);`,
    clean: `const { authorizationUrl } = await startAuth(server);\nif (new URL(authorizationUrl).protocol !== "https:") throw new Error("refusing");\nawait open(authorizationUrl);`,
  },
  {
    rule: "auth_url_opened_via_shell",
    vulnerable: "exec(`open ${authorizationUrl}`);",
    clean: "execFile(\"open\", [authorizationUrl]);",
  },
  {
    rule: "local_http_server_unauthenticated",
    vulnerable: `const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), enableDnsRebindingProtection: true, allowedHosts: ["127.0.0.1"] });`,
    clean: `app.use("/mcp", requireBearerAuth({ verifier }));\nconst transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), enableDnsRebindingProtection: true, allowedHosts: ["127.0.0.1"] });`,
  },
  {
    rule: "missing_host_origin_check",
    vulnerable: `app.use("/mcp", requireBearerAuth({ verifier }));\nconst transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });`,
    clean: `app.use("/mcp", requireBearerAuth({ verifier }));\nconst transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), enableDnsRebindingProtection: true, allowedHosts: ["127.0.0.1"] });`,
  },
  {
    rule: "listen_all_interfaces",
    vulnerable: `const server = new McpServer({ name: "x", version: "1" });\napp.listen(port, "0.0.0.0");`,
    clean: `const server = new McpServer({ name: "x", version: "1" });\napp.listen(port, "127.0.0.1");`,
  },
])("$rule", ({ rule, vulnerable, clean }) => {
  it("finds the vulnerable form", () => {
    expect(ids(vulnerable)).toContain(rule);
  });
  it("leaves the clean form", () => {
    expect(ids(clean)).not.toContain(rule);
  });
});

describe("findings", () => {
  it("carry their OWASP id and MCP spec section, and SARIF tags them", () => {
    const [shell] = scanText("exec(`xdg-open ${url}`);");
    expect(shell?.owasp).toBe("MCP05:2025");
    expect(shell?.reference).toBe("https://modelcontextprotocol.io/specification/draft/basic/security_best_practices#oauth-authorization-url-validation");
    const [state] = scanText("const handle = Date.now();");
    expect(state?.owasp).toBe("MCP07:2025");
    const sarif = buildSarif("1.0.0", [shell!, state!]) as { runs: { tool: { driver: { rules: { helpUri: string; properties: { tags: string[] } }[] } } }[] };
    const rules = sarif.runs[0]!.tool.driver.rules;
    expect(rules.map((r) => r.properties.tags.at(-1))).toEqual(["MCP05:2025", "MCP07:2025"]);
    expect(rules[1]!.helpUri).toContain("#state-handle-hijacking");
  });

  it("do not take fs.open or a non-URL argument for a browser open", () => {
    expect(ids(`const fd = fs.open(filePath, "r");\nawait open(reportPath);`)).not.toContain("auth_url_scheme_not_validated");
  });
});
