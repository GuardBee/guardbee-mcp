import { describe, expect, it } from "vitest";
import { scanUrl } from "../live.js";

const minified = Array.from({ length: 300 }, (_, i) => `function a${i}(b){return b+${i}}`).join(";");
const mapWithSources = JSON.stringify({ version: 3, mappings: "AAAA", sources: ["src/checkout/pricing.ts"], sourcesContent: ["export const discount = 0.3"] });

function site(routes: Record<string, string>): { fetchImpl: typeof fetch; requested: string[] } {
  const requested: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    const url = String(input);
    requested.push(url);
    const body = routes[url];
    return new Response(body ?? "not found", { status: body === undefined ? 404 : 200 });
  }) as typeof fetch;
  return { fetchImpl, requested };
}

describe("scanUrl", () => {
  it("follows a sourceMappingURL to a public map that embeds sources", async () => {
    const { fetchImpl } = site({
      "https://shop.example.com/": '<html><script type="module" src="/assets/app.js"></script></html>',
      "https://shop.example.com/assets/app.js": `${minified}\n//# sourceMappingURL=app.js.map`,
      "https://shop.example.com/assets/app.js.map": mapWithSources,
    });
    const r = await scanUrl("https://shop.example.com/", { fetchImpl });
    expect(r.findings.map((f) => f.patternId)).toEqual(["sourcemap_embeds_source"]);
    expect(r.findings[0].match).toContain("https://shop.example.com/assets/app.js.map");
    expect(r.grade).toBe("F");
  });

  it("tries <bundle>.map even when the comment was stripped", async () => {
    const { fetchImpl } = site({
      "https://shop.example.com/": '<script src="https://cdn.example.com/app.js?v=3"></script>',
      "https://cdn.example.com/app.js?v=3": minified,
      "https://cdn.example.com/app.js.map": JSON.stringify({ version: 3, mappings: "AAAA", sources: ["src/a.ts"] }),
    });
    const r = await scanUrl("https://shop.example.com/", { fetchImpl });
    expect(r.findings.map((f) => f.patternId)).toEqual(["sourcemap_publicly_reachable"]);
    expect(r.findings[0].match).toContain("not referenced by the bundle, but served");
  });

  it("keeps a low reference finding when the referenced map is not served", async () => {
    const { fetchImpl } = site({
      "https://shop.example.com/": '<script src="/app.js"></script>',
      "https://shop.example.com/app.js": `${minified}\n//# sourceMappingURL=app.js.map`,
    });
    const r = await scanUrl("https://shop.example.com/", { fetchImpl });
    expect(r.findings.map((f) => f.patternId)).toEqual(["sourcemap_reference"]);
  });

  it("does not fetch third-party scripts, and checks inline scripts", async () => {
    const { fetchImpl, requested } = site({
      "https://shop.example.com/": '<script src="https://www.googletagmanager.com/gtag/js"></script><script>window.API="http://10.1.2.3:8080"</script>',
    });
    const r = await scanUrl("https://shop.example.com/", { fetchImpl });
    expect(requested).toEqual(["https://shop.example.com/"]);
    expect(r.findings.map((f) => f.patternId)).toEqual(["internal_endpoint"]);
    expect(r.notes).toContain("1 third-party script(s) not checked");
  });

  it("caps the number of scripts and reports the rest", async () => {
    const tags = Array.from({ length: 5 }, (_, i) => `<script src="/c${i}.js"></script>`).join("");
    const routes: Record<string, string> = { "https://shop.example.com/": tags };
    for (let i = 0; i < 5; i++) routes[`https://shop.example.com/c${i}.js`] = minified;
    const r = await scanUrl("https://shop.example.com/", { fetchImpl: site(routes).fetchImpl, maxScripts: 2 });
    expect(r.scannedFiles).toBe(2);
    expect(r.truncated).toBe(true);
  });

  it("rejects non-http URLs", async () => {
    await expect(scanUrl("file:///etc/passwd")).rejects.toThrow(/Only http/);
  });
});
