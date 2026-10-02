import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { maskPiiInValue } from "@guardbee/guard-core";
import type { DashboardSinkConfig } from "../types.js";

export interface ApprovalRequest {
  tool: string;
  upstream: string;
  args: Record<string, unknown>;
  reason: string;
  /** MCP session (HTTP mode), shown to whoever approves in the dashboard. */
  sessionId?: string;
}

export type ApprovalChannel = "elicitation" | "dashboard";

/** `unavailable`: the client cannot show a prompt, so nobody could approve. */
export type ApprovalOutcome = "approved" | "declined" | "timed-out" | "unavailable";

export type Approver = (request: ApprovalRequest) => Promise<ApprovalOutcome>;

const MAX_ARGS_SHOWN = 600;

function describeArgs(args: Record<string, unknown>): string {
  const json = JSON.stringify(args, null, 2);
  return json.length > MAX_ARGS_SHOWN ? `${json.slice(0, MAX_ARGS_SHOWN)}\n… (${json.length - MAX_ARGS_SHOWN} more characters)` : json;
}

/**
 * Ask the person through MCP elicitation (a form the client shows). Any answer
 * other than an explicit yes — decline, cancel, timeout — counts as no.
 */
export function elicitationApprover(server: Server, timeoutSeconds: number): Approver {
  return async (request) => {
    if (!server.getClientCapabilities()?.elicitation) return "unavailable";
    try {
      const answer = await server.elicitInput(
        {
          message:
            `GuardBee: approve this tool call?\n\n` +
            `Tool: ${request.tool}\nWhy approval is needed: ${request.reason}\n\nArguments:\n${describeArgs(request.args)}`,
          requestedSchema: {
            type: "object",
            properties: {
              approve: { type: "boolean", title: "Approve this call", default: false },
            },
            required: ["approve"],
          },
        },
        { timeout: timeoutSeconds * 1000 },
      );
      return answer.action === "accept" && answer.content?.["approve"] === true ? "approved" : "declined";
    } catch (err) {
      return err instanceof Error && /timed? ?out/i.test(err.message) ? "timed-out" : "declined";
    }
  };
}

const MAX_PREVIEW = 2000;
type Fetch = typeof fetch;

/**
 * Ask in the GuardBee dashboard: create an approval request, then poll until
 * someone approves or denies it, it expires, or the timeout passes. The
 * dashboard sees the arguments with PII masked, never the raw values.
 * `unavailable` when the dashboard cannot be reached or rejects the key, so
 * a chain can fall through to the next channel.
 */
export function dashboardApprover(
  dashboard: DashboardSinkConfig,
  timeoutSeconds: number,
  fetchImpl: Fetch = fetch,
  pollMs = 2000,
): Approver {
  const endpoint = new URL("approvals", dashboard.url).toString();
  const headers = { authorization: `Bearer ${dashboard.apiKey}`, "content-type": "application/json" };

  return async (request) => {
    const preview = JSON.stringify(maskPiiInValue(request.args), null, 2);
    let id: string | undefined;
    try {
      const created = await fetchImpl(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          source: dashboard.source,
          sessionId: request.sessionId,
          tool: request.tool,
          upstream: request.upstream,
          reason: request.reason,
          argsPreview: preview.length > MAX_PREVIEW ? `${preview.slice(0, MAX_PREVIEW)}\n…` : preview,
          timeoutSeconds,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!created.ok) return "unavailable";
      id = ((await created.json()) as { data?: { id?: string } }).data?.id;
    } catch {
      return "unavailable";
    }
    if (!id) return "unavailable";

    const deadline = Date.now() + timeoutSeconds * 1000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      try {
        const res = await fetchImpl(`${endpoint}/${encodeURIComponent(id)}`, { headers, signal: AbortSignal.timeout(10_000) });
        if (!res.ok) continue; // a transient error must not count as an answer
        const status = ((await res.json()) as { data?: { status?: string } }).data?.status;
        if (status === "APPROVED") return "approved";
        if (status === "DENIED") return "declined";
        if (status === "EXPIRED") return "timed-out";
      } catch {
        // keep polling until the deadline
      }
    }
    return "timed-out";
  };
}

/** Try each channel in order; the first one that can actually ask gives the answer. */
export function chainApprovers(approvers: readonly Approver[]): Approver {
  return async (request) => {
    for (const approver of approvers) {
      const outcome = await approver(request);
      if (outcome !== "unavailable") return outcome;
    }
    return "unavailable";
  };
}
