import { describe, it, expect } from "vitest";
import { scanHfRepo, parseHfTarget, HfError } from "../hf.js";
import { buildPickle, buildZip } from "./testFixtures.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";

/** A fake hub: repo files by path, Range support, and a log of requested URLs and ranges. */
function fakeHub(files: Record<string, Buffer>, opts: { status?: number } = {}) {
  const requests: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const range = new Headers(init?.headers).get("range");
    requests.push(range ? `${url} ${range}` : url);
    if (url.includes("/api/models/")) {
      if (opts.status) return new Response("", { status: opts.status });
      const siblings = Object.entries(files).map(([rfilename, b]) => ({ rfilename, size: b.length }));
      return Response.json({ sha: SHA, siblings: [...siblings, { rfilename: "README.md", size: 10 }] });
    }
    const path = decodeURIComponent(url.split(`/resolve/${SHA}/`)[1] ?? "");
    const body = files[path];
    if (!body) return new Response("", { status: 404 });
    const m = /bytes=(\d+)-(\d+)/.exec(range ?? "");
    if (!m) return new Response(new Uint8Array(body));
    return new Response(new Uint8Array(body.subarray(Number(m[1]), Number(m[2]) + 1)), { status: 206 });
  }) as typeof fetch;
  return { fetchImpl, requests };
}

describe("scanHfRepo", () => {
  it("pins the revision to a commit and reports findings under hf:// paths", async () => {
    const hub = fakeHub({ "evil.pkl": buildPickle(["os", "system"]), "sub/clean.pkl": buildPickle(["collections", "OrderedDict"]) });
    const r = await scanHfRepo("org/model", { revision: "v1.0", fetchImpl: hub.fetchImpl, token: "" });
    expect(r.sha).toBe(SHA);
    expect(r.modelFiles).toEqual(["evil.pkl", "sub/clean.pkl"]);
    expect(r.scannedFiles).toBe(2);
    expect(r.findings.map((f) => f.file)).toEqual([`hf://org/model@${SHA}/evil.pkl`]);
    expect(hub.requests[0]).toContain("/api/models/org/model/revision/v1.0");
    expect(hub.requests.slice(1).every((u) => u.includes(`/resolve/${SHA}/`))).toBe(true);
  });

  it("fetches only the start of a large file, and the end too when it is a zip", async () => {
    const big = Buffer.concat([buildPickle(["os", "system"]), Buffer.alloc(4096)]);
    const zip = buildZip("archive/data.pkl", buildPickle(["subprocess", "Popen"]));
    const hub = fakeHub({ "legacy.bin": big, "model.pt": zip });
    const r = await scanHfRepo("org/model", { fetchImpl: hub.fetchImpl, fullBytes: 64, edgeBytes: 64, token: "" });
    expect(r.partialFiles.sort()).toEqual(["legacy.bin", "model.pt"]);
    expect(hub.requests.filter((u) => u.includes("legacy.bin"))).toHaveLength(1);
    expect(hub.requests.filter((u) => u.includes("model.pt"))).toHaveLength(2);
    expect(r.findings.map((f) => f.patternId)).toContain("pickle_dangerous_global_os_system");
  });

  it("respects maxFiles", async () => {
    const hub = fakeHub({ "a.pkl": buildPickle(), "b.pkl": buildPickle() });
    const r = await scanHfRepo("org/model", { maxFiles: 1, fetchImpl: hub.fetchImpl, token: "" });
    expect(r.scannedFiles).toBe(1);
    expect(r.notScanned).toEqual(["b.pkl"]);
  });

  it("rejects bad ids and explains access errors", async () => {
    await expect(scanHfRepo("../etc", { fetchImpl: fakeHub({}).fetchImpl })).rejects.toThrow(HfError);
    await expect(scanHfRepo("org/model", { revision: "../main", fetchImpl: fakeHub({}).fetchImpl })).rejects.toThrow(HfError);
    await expect(scanHfRepo("org/gated", { fetchImpl: fakeHub({}, { status: 401 }).fetchImpl, token: "" })).rejects.toThrow(/HF_TOKEN/);
  });

  it("never writes outside its temp directory", async () => {
    const hub = fakeHub({ "../escape.pkl": buildPickle(["os", "system"]), "ok.pkl": buildPickle() });
    const r = await scanHfRepo("org/model", { fetchImpl: hub.fetchImpl, token: "" });
    expect(r.modelFiles).toEqual(["ok.pkl"]);
  });
});

describe("parseHfTarget", () => {
  it("splits repo and revision", () => {
    expect(parseHfTarget("hf://org/model@refs/pr/1")).toEqual({ repo: "org/model", revision: "refs/pr/1" });
    expect(parseHfTarget("hf://gpt2")).toEqual({ repo: "gpt2", revision: undefined });
    expect(parseHfTarget("./models")).toBeNull();
  });
});
