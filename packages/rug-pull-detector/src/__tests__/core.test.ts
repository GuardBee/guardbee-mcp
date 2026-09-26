import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { baselineServer, checkServer } from "../core.js";
import type { ConnectionTarget } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, "fixtures", "mock-server.mjs");

function targetFor(mode: "v1" | "v2"): ConnectionTarget {
  return {
    type: "stdio",
    command: process.execPath,
    args: [fixturePath],
    env: { ...getDefaultEnvironment(), FIXTURE_MODE: mode },
  };
}

const dirs: string[] = [];
function tempBaseDir(): string {
  const d = mkdtempSync(join(tmpdir(), "gb-rug-pull-"));
  dirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("baselineServer + checkServer — gerçek stdio MCP server round trip", () => {
  it("baseline hiç yoksa otomatik oluşturur ve isNewBaseline=true döner", async () => {
    const baseDir = tempBaseDir();
    const result = await checkServer(targetFor("v1"), "fixture-server", baseDir);
    expect(result.isNewBaseline).toBe(true);
    expect(result.toolCount).toBe(1);
    expect(result.findings).toHaveLength(0);
  }, 15000);

  it("aynı sunucuya karşı ikinci check'te drift bulunmaz", async () => {
    const baseDir = tempBaseDir();
    await baselineServer(targetFor("v1"), "fixture-server", baseDir);
    const result = await checkServer(targetFor("v1"), "fixture-server", baseDir);
    expect(result.isNewBaseline).toBe(false);
    expect(result.findings).toHaveLength(0);
  }, 15000);

  it("v1'i baseline'lar, v2'ye karşı description drift'ini VE yeni tool'u yakalar", async () => {
    const baseDir = tempBaseDir();
    const baselineResult = await baselineServer(targetFor("v1"), "fixture-server", baseDir);
    expect(baselineResult.toolCount).toBe(1);

    const result = await checkServer(targetFor("v2"), "fixture-server", baseDir);
    expect(result.isNewBaseline).toBe(false);

    const ids = result.findings.map((f) => f.patternId);
    expect(ids).toContain("tool_definition_drift");
    expect(ids).toContain("tool_added");

    const driftFinding = result.findings.find((f) => f.patternId === "tool_definition_drift");
    expect(driftFinding?.severity).toBe("critical");
    expect(driftFinding?.toolName).toBe("get_weather");
    expect(driftFinding?.detail).toContain("id_rsa");
  }, 15000);

  it("baseline'daki bir tool artık sunulmuyorsa tool_removed bulgusu üretir", async () => {
    const baseDir = tempBaseDir();
    await baselineServer(targetFor("v2"), "fixture-server", baseDir);
    const result = await checkServer(targetFor("v1"), "fixture-server", baseDir);
    const ids = result.findings.map((f) => f.patternId);
    expect(ids).toContain("tool_removed");
    const removed = result.findings.find((f) => f.patternId === "tool_removed");
    expect(removed?.toolName).toBe("extra_tool");
  }, 15000);

  it("farklı label'lar farklı baseline dosyalarına ayrılır", async () => {
    const baseDir = tempBaseDir();
    await baselineServer(targetFor("v1"), "server-a", baseDir);
    const result = await checkServer(targetFor("v1"), "server-b", baseDir);
    expect(result.isNewBaseline).toBe(true); // server-b hiç baseline'lanmamış, server-a'nınkiyle karışmadı
  }, 15000);
});
