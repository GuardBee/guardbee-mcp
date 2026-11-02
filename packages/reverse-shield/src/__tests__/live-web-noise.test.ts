import { describe, expect, it } from "vitest";
import { scanUrl } from "../live.js";
import { findSecrets } from "../secrets.js";
import { analyzeJavaScript, parseSourceMap } from "../web.js";

const minified = Array.from({ length: 300 }, (_, i) => `function a${i}(b){return b+${i}}`).join(";");
const ownSourceMap = JSON.stringify({ version: 3, mappings: "AAAA", sources: ["src/checkout/pricing.ts"], sourcesContent: ["export const discount = 0.3"] });

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

function jwt(payload: object): string {
  return `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.dGhpcy1pcy1hLXNpZ25hdHVyZS12YWx1ZQ`;
}

describe("live web scan noise", () => {
  it("skips platform-hosted and open-source library scripts", async () => {
    const { fetchImpl, requested } = site({
      "https://shop.example.com/":
        '<script src="/hs/hsstatic/content-cwv-embed/static-1.1293/embed.js"></script>' +
        '<script src="/wp-content/themes/x/vendor/bootstrap.bundle.min.js?ver=5"></script>' +
        '<script src="/assets/app.js"></script>',
      "https://shop.example.com/assets/app.js": minified,
      "https://shop.example.com/assets/app.js.map": ownSourceMap,
    });
    const r = await scanUrl("https://shop.example.com/", { fetchImpl });
    expect(requested.some((u) => u.includes("hsstatic") || u.includes("bootstrap"))).toBe(false);
    expect(r.notes).toContain("2 platform or open-source library script(s) not checked");
    expect(r.findings.map((f) => f.patternId)).toEqual(["sourcemap_embeds_source"]);
  });

  it("ignores a reachable map that only covers dependencies", async () => {
    const { fetchImpl } = site({
      "https://shop.example.com/": '<script src="/_next/static/chunks/a6dad97d.js"></script>',
      "https://shop.example.com/_next/static/chunks/a6dad97d.js": minified,
      "https://shop.example.com/_next/static/chunks/a6dad97d.js.map": JSON.stringify({
        version: 3,
        mappings: "AAAA",
        sources: ["turbopack:///node_modules/next/dist/build/polyfills/polyfill-nomodule.js"],
        sourcesContent: ["/* polyfill */"],
      }),
    });
    const r = await scanUrl("https://shop.example.com/", { fetchImpl });
    expect(r.findings).toEqual([]);
    expect(parseSourceMap(ownSourceMap)?.dependenciesOnly).toBe(false);
  });

  it("keeps the site's own internal hosts and drops loopback and vendor dev URLs", () => {
    const js = `${minified};fetch("http://localhost:9999/api");fetch("https://dev.visualwebsiteoptimizer.com/x");fetch("http://192.168.1.4/a");fetch("https://staging.shop.example.com/b");`;
    const scoped = analyzeJavaScript(js, "app.js", { siteHost: "www.shop.example.com" }).find((f) => f.patternId === "internal_endpoint");
    expect(scoped?.match).toBe("http://192.168.1.4, https://staging.shop.example.com");
    // Without a site (file and archive scans) every internal-looking host still counts.
    const unscoped = analyzeJavaScript(js, "app.js").find((f) => f.patternId === "internal_endpoint");
    expect(unscoped?.match).toContain("http://localhost:9999");
    expect(analyzeJavaScript(`${minified};fetch("http://localhost:3000")`, "app.js", { siteHost: "shop.example.com" }).some((f) => f.patternId === "internal_endpoint")).toBe(false);
  });
});

describe("browser-facing secrets", () => {
  it("skips Supabase anon keys and keeps service_role keys", () => {
    const anon = findSecrets(`const k="${jwt({ iss: "supabase", ref: "abc", role: "anon" })}"`, "app.js");
    expect(anon).toEqual([]);
    const service = findSecrets(`const k="${jwt({ iss: "supabase", ref: "abc", role: "service_role" })}"`, "app.js");
    expect(service.map((f) => f.patternId)).toEqual(["bundle_secret"]);
  });

  it("reports a Google browser key in a web page as medium with referrer guidance", () => {
    const key = "AIzaSyB3x9Qm2Lk7PzR4tVw8nYc1dEf6GhJkLmN";
    const [web] = findSecrets(`maps("${key}")`, "index.html", { target: "web", browser: true });
    expect(web.severity).toBe("medium");
    expect(web.context).toContain("HTTP referrers");
    const [server] = findSecrets(`maps("${key}")`, "server.js");
    expect(server.severity).toBe("critical");
  });
});
