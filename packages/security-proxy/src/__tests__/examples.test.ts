import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseGatewayYaml } from "../gateway/config.js";

// The policies in examples/proxy are what people copy first: they must stay valid
const dir = fileURLToPath(new URL("../../../../examples/proxy/", import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith(".yaml"));

/** The variables a file reads: `${VAR}` references and `*Env: VAR` settings. */
const envOf = (source: string) => [...source.matchAll(/\$\{(\w+)\}|\w+Env:\s*(\w+)/g)].map((m) => (m[1] ?? m[2])!);

describe("examples/proxy", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("has examples", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s parses", (file) => {
    const source = readFileSync(join(dir, file), "utf8");
    for (const name of envOf(source)) vi.stubEnv(name, "example-value");
    expect(() => parseGatewayYaml(source, file)).not.toThrow();
    // The commented-out blocks are meant to be switched on: they must parse too
    const uncommented = source.replace(/^# ((?:ner|  url|  timeoutMs)\b)/gm, "$1");
    expect(() => parseGatewayYaml(uncommented, file)).not.toThrow();
  });
});
