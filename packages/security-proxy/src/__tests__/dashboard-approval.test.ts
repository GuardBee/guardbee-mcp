import { afterEach, describe, expect, it, vi } from "vitest";
import { chainApprovers, dashboardApprover, type ApprovalOutcome, type ApprovalRequest } from "../gateway/approval.js";
import { parseGatewayYaml } from "../gateway/config.js";

const dashboard = { url: "https://dash.test/api/v1/gateway/events", apiKey: "gb_key", source: "laptop" };
const request: ApprovalRequest = {
  tool: "db__drop_table",
  upstream: "db",
  args: { table: "users", note: "owner TC 10000000146" },
  reason: "policy rule ask-before-drop requires approval",
  sessionId: "sess-1",
};

/** The dashboard: POST creates an approval, GET returns the next status in `statuses`. */
function fakeDashboard(statuses: (string | number | "offline")[], createStatus: number | "offline" = 201) {
  const posts: Record<string, unknown>[] = [];
  const gets: string[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      if (createStatus === "offline") throw new Error("ECONNREFUSED");
      posts.push({ url: String(url), auth: new Headers(init.headers).get("authorization"), body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ data: { id: "appr_1" } }), { status: createStatus });
    }
    gets.push(String(url));
    const next = statuses.shift() ?? "PENDING";
    if (next === "offline") throw new Error("ECONNRESET");
    if (typeof next === "number") return new Response(null, { status: next });
    return new Response(JSON.stringify({ data: { status: next } }), { status: 200 });
  });
  return { impl: impl as unknown as typeof fetch, posts, gets };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dashboardApprover", () => {
  it("creates the request next to the events endpoint and returns the decision", async () => {
    const { impl, posts, gets } = fakeDashboard(["PENDING", 503, "offline", "APPROVED"]);
    const outcome = await dashboardApprover(dashboard, 5, impl, 5)(request);
    expect(outcome).toBe("approved");
    expect(posts[0]).toMatchObject({
      url: "https://dash.test/api/v1/gateway/approvals",
      auth: "Bearer gb_key",
      body: { source: "laptop", sessionId: "sess-1", tool: "db__drop_table", upstream: "db", timeoutSeconds: 5 },
    });
    expect(gets.every((url) => url === "https://dash.test/api/v1/gateway/approvals/appr_1")).toBe(true);
  });

  it("sends a PII-masked argument preview, never the raw values", async () => {
    const { impl, posts } = fakeDashboard(["APPROVED"]);
    await dashboardApprover(dashboard, 5, impl, 5)(request);
    const preview = (posts[0]?.["body"] as { argsPreview: string }).argsPreview;
    expect(preview).toContain("[TC-KİMLİK]");
    expect(preview).not.toContain("10000000146");
  });

  it.each([
    ["DENIED", "declined"],
    ["EXPIRED", "timed-out"],
  ] as const)("maps %s to %s", async (status, outcome) => {
    const { impl } = fakeDashboard([status]);
    expect(await dashboardApprover(dashboard, 5, impl, 5)(request)).toBe(outcome);
  });

  it("times out when nobody answers", async () => {
    const { impl } = fakeDashboard([]);
    expect(await dashboardApprover(dashboard, 1, impl, 50)(request)).toBe("timed-out");
  });

  it.each([
    ["the dashboard is unreachable", "offline" as const],
    ["the key is rejected", 403],
  ])("is unavailable when %s", async (_, createStatus) => {
    const { impl } = fakeDashboard([], createStatus);
    expect(await dashboardApprover(dashboard, 5, impl, 5)(request)).toBe("unavailable");
  });
});

describe("chainApprovers", () => {
  const fixed = (outcome: ApprovalOutcome) => vi.fn(async () => outcome);

  it("falls through unavailable channels to the first that can ask", async () => {
    const elicitation = fixed("unavailable");
    const dash = fixed("declined");
    expect(await chainApprovers([elicitation, dash])(request)).toBe("declined");
    expect(elicitation).toHaveBeenCalledOnce();
  });

  it("stops at the first answer", async () => {
    const dash = fixed("approved");
    expect(await chainApprovers([fixed("approved"), dash])(request)).toBe("approved");
    expect(dash).not.toHaveBeenCalled();
  });

  it("is unavailable when no channel can ask", async () => {
    expect(await chainApprovers([fixed("unavailable"), fixed("unavailable")])(request)).toBe("unavailable");
  });
});

describe("approval.channels config", () => {
  const base = "version: 1\nupstreams: { a: { command: node } }\n";

  it("defaults to elicitation only", () => {
    expect(parseGatewayYaml(base).approval).toEqual({ timeoutSeconds: 120, channels: ["elicitation"] });
  });

  it("needs audit.dashboard for the dashboard channel", () => {
    expect(() => parseGatewayYaml(base + "approval: { channels: [elicitation, dashboard] }")).toThrow("needs audit.dashboard");
    process.env["TEST_GB_APPROVAL_KEY"] = "k";
    const cfg = parseGatewayYaml(
      base +
        "approval: { channels: [elicitation, dashboard] }\naudit: { dashboard: { url: https://x/api/v1/gateway/events, apiKeyEnv: TEST_GB_APPROVAL_KEY } }",
    );
    expect(cfg.approval.channels).toEqual(["elicitation", "dashboard"]);
    delete process.env["TEST_GB_APPROVAL_KEY"];
  });
});
