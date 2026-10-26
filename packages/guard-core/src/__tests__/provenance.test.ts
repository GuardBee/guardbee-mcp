import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkNpmProvenance, normalizeRepositoryUrl, parseLaunch, resolveNpmVersion, type BundleVerifier } from "../provenance.js";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/provenance/${name}`, import.meta.url), "utf8")) as Record<string, unknown>;
const manifest = fixture("guard-core-1.1.0.json") as { dist: Record<string, unknown>; repository: unknown };
const attestations = fixture("guard-core-1.1.0.attestations.json");

const REGISTRY = "https://registry.test";
const RELEASE_SAN = "https://github.com/GuardBee/guardbee-mcp/.github/workflows/release.yml@refs/heads/main";
const signedBy = (san: string): BundleVerifier => async () => ({ subjectAlternativeName: san, issuer: "https://token.actions.githubusercontent.com" });

/** A registry serving @guardbee/guard-core 1.0.0 and 1.1.0, with `version` replaced as given. */
function registry(version: Record<string, unknown> = manifest, served: Record<string, unknown> = attestations) {
  const routes: Record<string, unknown> = {
    [`${REGISTRY}/@guardbee%2fguard-core`]: { "dist-tags": { latest: "1.1.0", next: "1.1.0" }, versions: { "1.0.0": {}, "1.1.0": {} } },
    [`${REGISTRY}/@guardbee%2fguard-core/1.1.0`]: version,
    "https://registry.npmjs.org/-/npm/v1/attestations/@guardbee%2fguard-core@1.1.0": served,
  };
  return async (url: string) => (url in routes ? new Response(JSON.stringify(routes[url])) : new Response("not found", { status: 404 }));
}

const check = (options: { verifyBundle?: BundleVerifier; fetch?: ReturnType<typeof registry> } = {}, spec = "") =>
  checkNpmProvenance("@guardbee/guard-core", spec, { verifyBundle: options.verifyBundle ?? signedBy(RELEASE_SAN), fetch: options.fetch ?? registry(), registry: REGISTRY });

describe("parseLaunch", () => {
  it.each([
    ["npx", ["-y", "@modelcontextprotocol/server-github"], { ecosystem: "npm", name: "@modelcontextprotocol/server-github", spec: "", argIndex: 1 }],
    ["npx", ["--yes", "mcp-server@1.2.3", "--port", "1"], { ecosystem: "npm", name: "mcp-server", spec: "1.2.3", argIndex: 1 }],
    ["npx", ["-y", "-p", "@scope/pkg@^2", "pkg-bin"], { ecosystem: "npm", name: "@scope/pkg", spec: "^2", argIndex: 2 }],
    ["/usr/local/bin/npx.cmd", ["--package=tool@next", "tool"], { ecosystem: "npm", name: "tool", spec: "next", argIndex: 0 }],
    ["pnpm", ["dlx", "server-x"], { ecosystem: "npm", name: "server-x", spec: "", argIndex: 1 }],
    ["uvx", ["mcp-server-fetch==2025.1.0"], { ecosystem: "pypi", name: "mcp-server-fetch", spec: "2025.1.0", argIndex: 0 }],
    ["uvx", ["--from", "git-mcp", "git-mcp-server"], { ecosystem: "pypi", name: "git-mcp", spec: "", argIndex: 1 }],
    ["docker", ["run", "-i", "--rm", "-e", "TOKEN", "mcp/github"], { ecosystem: "oci", reference: "mcp/github", argIndex: 5 }],
  ])("%s %j", (command, args, expected) => {
    expect(parseLaunch(command, args)).toEqual(expected);
  });

  it("reads a digest-pinned image, and ignores commands with no registry artifact", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    expect(parseLaunch("docker", ["run", "--rm", `mcp/fetch@${digest}`])).toMatchObject({ ecosystem: "oci", digest });
    expect(parseLaunch("node", ["server.js"])).toBeUndefined();
    expect(parseLaunch("npx", ["-y", "./local-dir"])).toBeUndefined();
  });
});

describe("resolveNpmVersion", () => {
  const doc = { "dist-tags": { latest: "1.4.0", beta: "2.0.0-beta.1" }, versions: { "1.3.0": {}, "1.4.0": {}, "1.5.0-rc.1": {}, "2.0.0-beta.1": {} } };
  it.each([
    ["", "1.4.0"],
    ["1.3.0", "1.3.0"],
    ["9.9.9", undefined],
    ["beta", "2.0.0-beta.1"],
    ["^1.3.0", "1.4.0"],
    ["~1.3.0", "1.3.0"],
  ])("%j → %s", (spec, expected) => {
    expect(resolveNpmVersion(doc, spec)).toBe(expected);
  });
});

describe("normalizeRepositoryUrl", () => {
  it.each([
    [{ type: "git", url: "git+https://github.com/GuardBee/guardbee-mcp.git" }, "https://github.com/guardbee/guardbee-mcp"],
    ["git@github.com:Owner/Repo.git", "https://github.com/owner/repo"],
    ["github:owner/repo", "https://github.com/owner/repo"],
    ["owner/repo", "https://github.com/owner/repo"],
    ["git+ssh://git@github.com/owner/repo.git", "https://github.com/owner/repo"],
  ])("%j → %s", (input, expected) => {
    expect(normalizeRepositoryUrl(input)).toBe(expected);
  });
});

describe("checkNpmProvenance", () => {
  it("verifies a package whose signed provenance names its tarball and repository", async () => {
    const result = await check();
    expect(result).toMatchObject({
      status: "verified",
      artifact: "npm:@guardbee/guard-core@1.1.0",
      version: "1.1.0",
      sourceRepository: "https://github.com/guardbee/guardbee-mcp",
      sourceCommit: "3aea0bc81b19b3b7095c631b97b607fa2468e0ac",
    });
  });

  it("resolves ranges and tags to the version it checks", async () => {
    expect((await check({}, "^1.0.0")).version).toBe("1.1.0");
    expect((await check({}, "next")).version).toBe("1.1.0");
    expect(await check({}, "7.0.0")).toMatchObject({ status: "error", reason: expect.stringMatching(/no version/) });
  });

  it("reports a version published without provenance as unsigned", async () => {
    const { attestations: _none, ...dist } = manifest.dist;
    expect((await check({ fetch: registry({ ...manifest, dist }) })).status).toBe("unsigned");
  });

  it("refuses a signature that does not verify", async () => {
    const result = await check({ verifyBundle: async () => Promise.reject(new Error("signature mismatch")) });
    expect(result).toMatchObject({ status: "invalid", reason: expect.stringMatching(/signature mismatch/) });
  });

  it("refuses provenance for another tarball", async () => {
    const result = await check({ fetch: registry({ ...manifest, dist: { ...manifest.dist, integrity: `sha512-${Buffer.alloc(64).toString("base64")}` } }) });
    expect(result).toMatchObject({ status: "invalid", reason: expect.stringMatching(/another tarball/) });
  });

  it("refuses a statement signed by a workflow of another repository", async () => {
    const result = await check({ verifyBundle: signedBy("https://github.com/attacker/fork/.github/workflows/release.yml@refs/heads/main") });
    expect(result).toMatchObject({ status: "invalid", reason: expect.stringMatching(/not by a workflow of/) });
  });

  it("refuses a package whose repository field names another repository", async () => {
    const result = await check({ fetch: registry({ ...manifest, repository: "github:someone/else" }) });
    expect(result).toMatchObject({ status: "invalid", reason: expect.stringMatching(/package.json names/) });
  });

  it("refuses a name that is not an npm package name, before any request", async () => {
    const result = await checkNpmProvenance("@a/b/../../-/x", "", { verifyBundle: signedBy(RELEASE_SAN), fetch: async () => Promise.reject(new Error("must not be called")) });
    expect(result).toMatchObject({ status: "error", reason: expect.stringMatching(/not an npm package name/) });
  });

  it("reports an unreachable registry as an error, not as unsigned", async () => {
    const result = await check({ fetch: async () => new Response("down", { status: 503 }) });
    expect(result.status).toBe("error");
  });
});
