import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProvenanceCache, checkUpstreamProvenance, provenanceSarif, sigstoreVerifier, type CheckOptions } from "../gateway/provenance.js";

// Real data: mcp-server-fetch 2026.10.24 (PEP 740) and ghcr.io/github/github-mcp-server (cosign keyless)
const dir = new URL("./fixtures/provenance-ext/", import.meta.url);
const bytes = (name: string) => fs.readFileSync(new URL(name, dir));
const json = (name: string) => JSON.parse(bytes(name).toString("utf8")) as Record<string, unknown>;
const verifyBundle = sigstoreVerifier({ trustedRoot: JSON.parse(fs.readFileSync(new URL("./fixtures/sigstore-trusted-root.json", import.meta.url), "utf8")) });

const WHEEL = "mcp_server_fetch-2026.10.24-py3-none-any.whl";
const SDIST = "mcp_server_fetch-2026.10.24.tar.gz";
const DIGEST = "sha256:250bc6ce70788207608ef74cef4397230ff2e8481218da74d6093e4bd9101132";
const sigManifest = json("oci-sig-manifest.json") as { layers: { digest: string }[] };

type Route = Response | (() => Response);
function server(overrides: Record<string, Route | null> = {}) {
  const routes: Record<string, Route | null> = {
    "https://pypi.org/pypi/mcp-server-fetch/json": new Response(bytes("pypi-release.json")),
    "https://pypi.org/pypi/mcp-server-fetch/2026.10.24/json": new Response(bytes("pypi-release.json")),
    [`https://pypi.org/integrity/mcp-server-fetch/2026.10.24/${WHEEL}/provenance`]: new Response(bytes(`pypi-${WHEEL}.provenance.json`)),
    [`https://pypi.org/integrity/mcp-server-fetch/2026.10.24/${SDIST}/provenance`]: new Response(bytes(`pypi-${SDIST}.provenance.json`)),
    // ghcr.io asks for a token first, like the real registry
    "https://ghcr.io/v2/github/github-mcp-server/manifests/latest": () => new Response(bytes("oci-index.json")),
    [`https://ghcr.io/v2/github/github-mcp-server/manifests/${DIGEST.replace(":", "-")}.sig`]: () => new Response(bytes("oci-sig-manifest.json")),
    [`https://ghcr.io/v2/github/github-mcp-server/blobs/${sigManifest.layers[0]!.digest}`]: () => new Response(bytes("oci-sig-payload.json")),
    ...overrides,
  };
  return async (url: string, init?: RequestInit) => {
    if (url.startsWith("https://ghcr.io/token")) return new Response(JSON.stringify({ token: "anonymous" }));
    const route = routes[url];
    if (!route) return new Response("not found", { status: 404 });
    if (url.startsWith("https://ghcr.io/v2/") && !(new Headers(init?.headers).get("authorization") ?? "").startsWith("Bearer ")) {
      return new Response("", { status: 401, headers: { "www-authenticate": 'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:github/github-mcp-server:pull"' } });
    }
    return (typeof route === "function" ? route() : route).clone();
  };
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function options(overrides: Partial<CheckOptions> = {}): CheckOptions {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "guardbee-provenance-ext-"));
  dirs.push(d);
  return { verifyBundle, cache: new ProvenanceCache(path.join(d, "cache.json")), offline: false, fetch: server(), ...overrides };
}

describe("PyPI (PEP 740)", () => {
  const uvx = { command: "uvx", args: ["--python", "3.12", "mcp-server-fetch"] };

  it("verifies every file of the release against its Trusted Publisher and pins uvx to the version", async () => {
    const checked = await checkUpstreamProvenance(uvx, "require", options());
    expect(checked).toMatchObject({ action: "allow", result: { status: "verified", sourceRepository: "https://github.com/modelcontextprotocol/servers", version: "2026.10.24" } });
    expect(checked.server.args).toEqual(["--python", "3.12", "mcp-server-fetch==2026.10.24"]);
  });

  it("calls a release with an unattested file unsigned", async () => {
    const checked = await checkUpstreamProvenance(uvx, "require", options({ fetch: server({ [`https://pypi.org/integrity/mcp-server-fetch/2026.10.24/${SDIST}/provenance`]: null }) }));
    expect(checked).toMatchObject({ action: "block", result: { status: "unsigned", reason: expect.stringMatching(/1 of 2 files/) } });
  });

  it("refuses an attestation for another file", async () => {
    const release = json("pypi-release.json") as { info: unknown; urls: { filename: string; digests: { sha256: string } }[] };
    release.urls[0]!.digests.sha256 = "0".repeat(64);
    const swapped = server({ "https://pypi.org/pypi/mcp-server-fetch/json": new Response(JSON.stringify(release)) });
    const checked = await checkUpstreamProvenance(uvx, "warn", options({ fetch: swapped }));
    expect(checked.result).toMatchObject({ status: "invalid", reason: expect.stringMatching(/another file or hash/) });
  });
});

describe("container images (cosign)", () => {
  const docker = { command: "docker", args: ["run", "-i", "--rm", "ghcr.io/github/github-mcp-server"] };

  it("resolves the tag, verifies the keyless signature by the owner's workflow, and pins the digest", async () => {
    const checked = await checkUpstreamProvenance(docker, "require", options());
    expect(checked.result).toMatchObject({ status: "verified", version: DIGEST, sourceRepository: "https://github.com/github/github-mcp-server" });
    expect(checked.server.args?.at(-1)).toBe(`ghcr.io/github/github-mcp-server@${DIGEST}`);
  });

  it("refuses a signature by someone other than the configured signer", async () => {
    const checked = await checkUpstreamProvenance(docker, "require", options({ signers: { "ghcr.io/github/*": "https://github.com/someone-else/" } }));
    expect(checked).toMatchObject({ action: "block", result: { status: "invalid", reason: expect.stringMatching(/not by https:\/\/github.com\/someone-else/) } });
  });

  it("calls an image without a signature unsigned", async () => {
    const checked = await checkUpstreamProvenance(docker, "warn", options({ fetch: server({ [`https://ghcr.io/v2/github/github-mcp-server/manifests/${DIGEST.replace(":", "-")}.sig`]: null }) }));
    expect(checked.result?.status).toBe("unsigned");
  });

  it("refuses a signature payload that was swapped", async () => {
    const forged = Buffer.from(bytes("oci-sig-payload.json").toString("utf8").replace("github-mcp-server", "github-mcp-servex"));
    const checked = await checkUpstreamProvenance(docker, "warn", options({ fetch: server({ [`https://ghcr.io/v2/github/github-mcp-server/blobs/${sigManifest.layers[0]!.digest}`]: () => new Response(forged) }) }));
    expect(checked.result).toMatchObject({ status: "invalid", reason: expect.stringMatching(/does not match its digest/) });
  });

  it("answers offline from the cache for a digest-pinned image", async () => {
    const shared = options();
    await checkUpstreamProvenance(docker, "require", shared);
    const pinned = { command: "docker", args: ["run", "-i", "--rm", `ghcr.io/github/github-mcp-server@${DIGEST}`] };
    const offline = { ...shared, offline: true, fetch: async () => Promise.reject(new Error("no network")) };
    expect((await checkUpstreamProvenance(pinned, "require", offline)).action).toBe("allow");
    expect((await checkUpstreamProvenance(docker, "require", offline)).result?.reason).toMatch(/offline/);
  });
});

describe("provenanceSarif", () => {
  it("reports each unverified upstream once, with its rule and level, and leaves verified ones out", () => {
    const sarif = provenanceSarif(
      [
        { upstream: "ok", result: { status: "verified", artifact: "npm:a@1.0.0", reason: "built from x" } },
        { upstream: "bad", result: { status: "invalid", artifact: "npm:b@1.0.0", reason: "signed by someone else" } },
        { upstream: "plain", result: { status: "unsigned", artifact: "oci:docker.io/mcp/fetch@sha256:1", reason: "no signature" } },
      ],
      "1.0.0",
      "guardbee-proxy.yaml",
    ) as { runs: { tool: { driver: { rules: { id: string }[] } }; results: { ruleId: string; level: string; message: { text: string } }[] }[] };
    const run = sarif.runs[0]!;
    expect(run.tool.driver.rules.map((r) => r.id)).toEqual(["provenance/invalid", "provenance/unsigned"]);
    expect(run.results.map((r) => [r.ruleId, r.level])).toEqual([["provenance/invalid", "error"], ["provenance/unsigned", "warning"]]);
    expect(run.results[0]!.message.text).toContain("upstreams.bad");
  });
});
