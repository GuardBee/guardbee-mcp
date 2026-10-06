import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import {
  discoverShadowMcp,
  isAllowed,
  parseAllowlist,
  type HostConfigPath,
} from "../discover.js";
import type { ParsedServer } from "../types.js";

const FIXTURE_ROOT = join(fileURLToPath(new URL("../../", import.meta.url)), ".tmp-discover");

function server(partial: Partial<ParsedServer> & { name: string }): ParsedServer {
  return {
    args: [],
    env: {},
    headers: {},
    autoApprove: undefined,
    ...partial,
  };
}

describe("parseAllowlist", () => {
  it("JSON names/packages/hosts okur", () => {
    const al = parseAllowlist(
      JSON.stringify({
        names: ["filesystem"],
        packages: ["@modelcontextprotocol/server-github@1.0.0"],
        hosts: ["https://mcp.example.com/sse"],
      })
    );
    expect(al.names.has("filesystem")).toBe(true);
    expect(al.packages.has("@modelcontextprotocol/server-github")).toBe(true);
    expect(al.hosts.has("mcp.example.com")).toBe(true);
  });

  it("satır biçimini okur", () => {
    const al = parseAllowlist(`
# org allowlist
name:filesystem
package:@guardbee/mcp-secret-scanner
host:tools.internal
github
`);
    expect(al.names.has("filesystem")).toBe(true);
    expect(al.names.has("github")).toBe(true);
    expect(al.packages.has("@guardbee/mcp-secret-scanner")).toBe(true);
    expect(al.hosts.has("tools.internal")).toBe(true);
  });
});

describe("isAllowed", () => {
  const al = parseAllowlist(
    JSON.stringify({
      names: ["ok-name"],
      packages: ["@scope/pkg"],
      hosts: ["allowed.example"],
    })
  );

  it("isme göre izin verir", () => {
    expect(isAllowed(server({ name: "ok-name", command: "node", args: ["x.js"] }), al)).toBe(true);
  });

  it("pakete göre izin verir", () => {
    expect(
      isAllowed(server({ name: "other", command: "npx", args: ["-y", "@scope/pkg@1.2.3"] }), al)
    ).toBe(true);
  });

  it("host'a göre izin verir", () => {
    expect(isAllowed(server({ name: "remote", url: "https://allowed.example/mcp" }), al)).toBe(true);
  });

  it("allowlist dışı server'ı reddeder", () => {
    expect(
      isAllowed(server({ name: "shadow", command: "npx", args: ["-y", "evil-mcp@1.0.0"] }), al)
    ).toBe(false);
  });
});

describe("discoverShadowMcp", () => {
  it("allowlist dışı server'ı shadow_mcp_server olarak işaretler", () => {
    mkdirSync(FIXTURE_ROOT, { recursive: true });
    const home = mkdtempSync(join(FIXTURE_ROOT, "case-"));
    try {
      const configPath = join(home, "cursor-mcp.json");
      writeFileSync(
        configPath,
        JSON.stringify({
          mcpServers: {
            approved: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem@0.6.2"] },
            rouge: { command: "npx", args: ["-y", "totally-unknown-mcp@1.0.0"] },
          },
        })
      );
      const allowlist = parseAllowlist(
        JSON.stringify({
          names: ["approved"],
          packages: ["@modelcontextprotocol/server-filesystem"],
        })
      );
      const paths: HostConfigPath[] = [{ client: "cursor", path: configPath }];
      const result = discoverShadowMcp({ home, paths, allowlist });
      expect(result.scannedFiles).toBe(1);
      const ids = result.findings.map((f) => f.patternId);
      expect(ids).toContain("shadow_mcp_server");
      expect(ids).not.toContain("allowlist_not_configured");
      const shadow = result.findings.find((f) => f.patternId === "shadow_mcp_server");
      expect(shadow?.server).toBe("rouge");
      expect(shadow?.owasp).toBe("MCP09:2025");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("allowlist yokken allowlist_not_configured ve unreviewed üretir", () => {
    mkdirSync(FIXTURE_ROOT, { recursive: true });
    const home = mkdtempSync(join(FIXTURE_ROOT, "case-"));
    try {
      const configPath = join(home, "cursor-mcp.json");
      writeFileSync(
        configPath,
        JSON.stringify({
          mcpServers: {
            only: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem@0.6.2"] },
          },
        })
      );
      const paths: HostConfigPath[] = [{ client: "cursor", path: configPath }];
      const result = discoverShadowMcp({ home, paths, allowlist: null });
      const ids = result.findings.map((f) => f.patternId);
      expect(ids).toContain("allowlist_not_configured");
      expect(ids).toContain("unreviewed_mcp_server");
      expect(ids).not.toContain("shadow_mcp_server");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("farklı client'larda aynı ad farklı backend → drift", () => {
    mkdirSync(FIXTURE_ROOT, { recursive: true });
    const home = mkdtempSync(join(FIXTURE_ROOT, "case-"));
    try {
      const cursorPath = join(home, "cursor.json");
      const vscodePath = join(home, "vscode.json");
      writeFileSync(
        cursorPath,
        JSON.stringify({
          mcpServers: { github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github@1.0.0"] } },
        })
      );
      writeFileSync(
        vscodePath,
        JSON.stringify({
          mcpServers: { github: { command: "npx", args: ["-y", "evil-github-mcp@1.0.0"] } },
        })
      );
      const paths: HostConfigPath[] = [
        { client: "cursor", path: cursorPath },
        { client: "vscode", path: vscodePath },
      ];
      const allowlist = parseAllowlist(JSON.stringify({ names: ["github"] }));
      const result = discoverShadowMcp({ home, paths, allowlist });
      expect(result.findings.map((f) => f.patternId)).toContain("mcp_server_drift_across_clients");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
