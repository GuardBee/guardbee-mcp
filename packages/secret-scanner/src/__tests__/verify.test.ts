import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { scanText } from "../scanner.js";
import { canVerify, VERIFIERS, verifyAll, verifySecret } from "../verify.js";

// Assembled at runtime so the repo's own secret scan does not flag this file
const GH = ["ghp", "u8jzPde0IgxLd6GncfBAepfJBd0Kh8oOOL8d"].join("_");

/** A fetch that records calls and answers from a script. */
function fakeFetch(answer: (url: string) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return answer(String(url));
  }) as typeof fetch;
  return { impl, calls };
}

describe("verifySecret", () => {
  it("live on 2xx, invalid on 401/403, unknown on anything else or a network error", async () => {
    const statuses: [number, string][] = [[200, "live"], [401, "invalid"], [403, "invalid"], [500, "unknown"], [429, "unknown"]];
    for (const [status, verdict] of statuses) {
      const { impl } = fakeFetch(() => new Response("{}", { status }));
      expect(await verifySecret("github_pat", GH, { fetchImpl: impl }), String(status)).toBe(verdict);
    }
    const failing = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    expect(await verifySecret("github_pat", GH, { fetchImpl: failing })).toBe("unknown");
  });

  it("sends the key only to its own provider, read-only, without following redirects", async () => {
    const { impl, calls } = fakeFetch(() => new Response("{}", { status: 200 }));
    await verifySecret("github_pat", GH, { fetchImpl: impl });
    expect(new URL(calls[0]!.url).host).toBe("api.github.com");
    expect(calls[0]!.init.method).toBe("GET");
    expect(calls[0]!.init.redirect).toBe("error");
    expect((calls[0]!.init.headers as Record<string, string>)["authorization"]).toBe(`Bearer ${GH}`);
    for (const verifier of Object.values(VERIFIERS)) expect(new URL(verifier.url).protocol).toBe("https:");
  });

  it("reads Slack's ok flag and counts a Stripe 403 as a working restricted key", async () => {
    const slackBad = fakeFetch(() => new Response(JSON.stringify({ ok: false, error: "invalid_auth" }), { status: 200 }));
    expect(await verifySecret("slack_token", "xoxb-1", { fetchImpl: slackBad.impl })).toBe("invalid");
    const slackGood = fakeFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    expect(await verifySecret("slack_token", "xoxb-1", { fetchImpl: slackGood.impl })).toBe("live");
    const stripe = fakeFetch(() => new Response("{}", { status: 403 }));
    expect(await verifySecret("stripe_restricted", "rk_live_x", { fetchImpl: stripe.impl })).toBe("live");
  });

  it("does nothing for rules it cannot verify", async () => {
    const { impl, calls } = fakeFetch(() => new Response("{}", { status: 200 }));
    expect(canVerify("high_entropy_secret")).toBe(false);
    expect(await verifySecret("high_entropy_secret", "x", { fetchImpl: impl })).toBe("unknown");
    expect(calls).toEqual([]);
  });
});

describe("verifyAll", () => {
  it("asks once per distinct secret, skips unverifiable ones, and limits concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    const { impl, calls } = fakeFetch(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return new Response("{}", { status: 200 });
    });
    const secrets = new Map(
      Array.from({ length: 10 }, (_, i) => [`h${i}`, { patternId: i === 9 ? "high_entropy_secret" : "github_pat", secret: `${GH}${i}` }] as const),
    );
    const verdicts = await verifyAll(new Map(secrets), { fetchImpl: impl, concurrency: 3 });
    expect(calls).toHaveLength(9);
    expect(peak).toBeLessThanOrEqual(3);
    expect(verdicts.get("h0")).toBe("live");
    expect(verdicts.has("h9")).toBe(false);
  });
});

describe("raw secrets stay out of findings", () => {
  it("onSecret receives the raw value; the finding never holds it", () => {
    const seen: string[] = [];
    const findings = scanText(`TOKEN=${GH}\n`, "a.env", "a.env", { onSecret: (_f, secret) => seen.push(secret) });
    expect(seen).toEqual([GH]);
    expect(JSON.stringify(findings)).not.toContain(GH);
  });
});

describe("MCP tools never verify", () => {
  it("the MCP server does not import the verifier", () => {
    const server = readFileSync(resolve(__dirname, "../server.ts"), "utf8");
    expect(server).not.toMatch(/verify/i);
  });
});
