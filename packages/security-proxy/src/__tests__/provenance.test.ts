import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseGatewayYaml } from "../gateway/config.js";
import { ProvenanceCache, checkUpstreamProvenance, sigstoreVerifier, type CheckOptions } from "../gateway/provenance.js";

const fixture = (name: string) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as Record<string, unknown>;
const manifest = fixture("guard-core-1.1.0.json") as { dist: Record<string, unknown> };
const attestations = fixture("guard-core-1.1.0.attestations.json") as { attestations: { predicateType: string; bundle: { dsseEnvelope: { payload: string } } }[] };
// The Sigstore public-good trust root, so the real signature check runs offline
const verifyBundle = sigstoreVerifier({ trustedRoot: fixture("sigstore-trusted-root.json") });
const slsa = () => structuredClone(attestations.attestations.find((a) => a.predicateType.startsWith("https://slsa.dev/"))!);

const REGISTRY = "https://registry.test";
function registry(version: Record<string, unknown> = manifest, served: unknown = attestations) {
  const routes: Record<string, unknown> = {
    [`${REGISTRY}/@guardbee%2fguard-core`]: { "dist-tags": { latest: "1.1.0" }, versions: { "1.0.0": {}, "1.1.0": {} } },
    [`${REGISTRY}/@guardbee%2fguard-core/1.1.0`]: version,
    "https://registry.npmjs.org/-/npm/v1/attestations/@guardbee%2fguard-core@1.1.0": served,
  };
  return async (url: string) => (url in routes ? new Response(JSON.stringify(routes[url])) : new Response("not found", { status: 404 }));
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function options(overrides: Partial<CheckOptions> = {}): CheckOptions {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guardbee-provenance-"));
  dirs.push(dir);
  return { verifyBundle, cache: new ProvenanceCache(path.join(dir, "provenance.json")), offline: false, registry: REGISTRY, fetch: registry(), ...overrides };
}

const npx = { command: "npx", args: ["-y", "@guardbee/guard-core", "--stdio"] };

describe("sigstoreVerifier", () => {
  it("verifies a real npm provenance bundle and names the signing workflow", async () => {
    const signer = await verifyBundle(slsa().bundle);
    expect(signer).toEqual({
      subjectAlternativeName: "https://github.com/GuardBee/guardbee-mcp/.github/workflows/release.yml@refs/heads/main",
      issuer: "https://token.actions.githubusercontent.com",
    });
  });

  it("rejects a bundle whose statement was changed after signing", async () => {
    const tampered = slsa();
    const statement = JSON.parse(Buffer.from(tampered.bundle.dsseEnvelope.payload, "base64").toString("utf8")) as { subject: { name: string }[] };
    statement.subject[0]!.name = "pkg:npm/evil@1.0.0";
    tampered.bundle.dsseEnvelope.payload = Buffer.from(JSON.stringify(statement)).toString("base64");
    await expect(verifyBundle(tampered.bundle)).rejects.toThrow();
  });
});

describe("checkUpstreamProvenance", () => {
  it("starts a verified package pinned to the version it checked", async () => {
    const checked = await checkUpstreamProvenance(npx, "require", options());
    expect(checked.action).toBe("allow");
    expect(checked.result?.status).toBe("verified");
    expect(checked.server.args).toEqual(["-y", "@guardbee/guard-core@1.1.0", "--stdio"]);
  });

  it("refuses an unsigned package under require, and warns (still pinned) under warn", async () => {
    const { attestations: _none, ...dist } = manifest.dist;
    const unsigned = options({ fetch: registry({ ...manifest, dist }) });
    expect((await checkUpstreamProvenance(npx, "require", unsigned)).action).toBe("block");
    const warned = await checkUpstreamProvenance(npx, "warn", unsigned);
    expect(warned).toMatchObject({ action: "warn", result: { status: "unsigned" } });
    expect(warned.server.args?.[1]).toBe("@guardbee/guard-core@1.1.0");
  });

  it("refuses a tampered attestation (real signature check)", async () => {
    const tampered = slsa();
    tampered.bundle.dsseEnvelope.payload = Buffer.from("{}").toString("base64");
    const checked = await checkUpstreamProvenance(npx, "require", options({ fetch: registry(manifest, { attestations: [tampered] }) }));
    expect(checked).toMatchObject({ action: "block", result: { status: "invalid" } });
  });

  it("treats another tarball under a version it verified before as tampering", async () => {
    const shared = options();
    expect((await checkUpstreamProvenance(npx, "require", shared)).result?.status).toBe("verified");
    const swapped = { ...manifest, dist: { ...manifest.dist, integrity: `sha512-${Buffer.alloc(64, 1).toString("base64")}` } };
    const checked = await checkUpstreamProvenance(npx, "warn", { ...shared, fetch: registry(swapped) });
    expect(checked.result).toMatchObject({ status: "invalid", reason: expect.stringMatching(/integrity changed/) });
  });

  it("answers offline from the cache for an exact version, and says why otherwise", async () => {
    const shared = options();
    await checkUpstreamProvenance(npx, "require", shared);
    const offline = { ...shared, offline: true, fetch: async () => Promise.reject(new Error("no network")) };
    const pinned = { command: "npx", args: ["-y", "@guardbee/guard-core@1.1.0"] };
    expect((await checkUpstreamProvenance(pinned, "require", offline)).action).toBe("allow");
    const floating = await checkUpstreamProvenance(npx, "require", offline);
    expect(floating).toMatchObject({ action: "block", result: { status: "error", reason: expect.stringMatching(/offline/) } });
  });

  it("flags PyPI packages and images it cannot check yet, and leaves local commands alone", async () => {
    expect((await checkUpstreamProvenance({ command: "uvx", args: ["mcp-server-fetch"] }, "warn", options())).result?.status).toBe("unsupported");
    const image = await checkUpstreamProvenance({ command: "docker", args: ["run", "-i", "--rm", "mcp/github"] }, "require", options());
    expect(image).toMatchObject({ action: "block", result: { reason: expect.stringMatching(/not pinned by digest/) } });
    expect(await checkUpstreamProvenance({ command: "node", args: ["server.js"] }, "require", options())).toEqual({ action: "allow", server: { command: "node", args: ["server.js"] } });
  });

  it("does nothing when off", async () => {
    const checked = await checkUpstreamProvenance(npx, "off", options({ fetch: async () => Promise.reject(new Error("must not be called")) }));
    expect(checked).toEqual({ action: "allow", server: npx });
  });
});

describe("provenance config", () => {
  it("defaults to warn, and takes a per-upstream mode on stdio upstreams", () => {
    const config = parseGatewayYaml("version: 1\nupstreams:\n  gh:\n    command: npx\n    args: [-y, pkg]\n    provenance: require\n");
    expect(config.provenance).toEqual({ mode: "warn", offline: false });
    expect(config.upstreams["gh"]).toMatchObject({ provenance: "require" });
  });

  it("refuses provenance on an HTTP upstream", () => {
    expect(() => parseGatewayYaml("version: 1\nupstreams:\n  web:\n    url: https://mcp.example.com/mcp\n    provenance: require\n")).toThrow(/provenance applies to stdio upstreams/);
  });
});
