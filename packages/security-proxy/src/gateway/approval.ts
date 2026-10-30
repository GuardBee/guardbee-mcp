import { createHash } from "crypto";
import type { ElicitRequestFormParams, Server } from "@modelcontextprotocol/server";
import { maskPiiInValue } from "@guardbee/guard-core";
import type { DashboardSinkConfig } from "../types.js";

export interface ApprovalRequest {
  tool: string;
  upstream: string;
  args: Record<string, unknown>;
  reason: string;
  /** MCP session (HTTP mode), shown to whoever approves in the dashboard. */
  sessionId?: string;
  /**
   * Where the call stands: `call` before anything reached the server,
   * `result` for what came back, `sampling` while the server's call runs.
   */
  phase?: "call" | "result" | "sampling";
  /** Set for a 2026-07-28 client, which cannot be sent an elicitation request mid-call. */
  deferred?: DeferredApprovals;
}

/**
 * A 2026-07-28 client is asked through the call's own answer (input_required)
 * and sends the call again with the answer. Only a `call`-phase approval can
 * be asked that way: nothing ran yet, so running the call again is safe.
 */
export interface DeferredApprovals {
  /** Answers from earlier rounds of this call, by approvalKey(). */
  answers: ReadonlyMap<string, ApprovalOutcome>;
  /** A round after the first: the call was already counted (anomaly checks). */
  retry: boolean;
  /** The client declared elicitation on this request. */
  canElicit: boolean;
}

export type ApprovalChannel = "elicitation" | "dashboard";

/**
 * `unavailable`: the client cannot show a prompt, so nobody could approve.
 * `input-required`: ask the 2026-07-28 client in the call's answer (see ApprovalRequired).
 */
export type ApprovalOutcome = "approved" | "declined" | "timed-out" | "unavailable" | "input-required";

/** Ties an answer to this exact call: same tool, server, reason and arguments. */
export function approvalKey(request: Pick<ApprovalRequest, "tool" | "upstream" | "reason" | "args">): string {
  return createHash("sha256").update(JSON.stringify([request.tool, request.upstream, request.reason, request.args])).digest("hex");
}

/** Thrown out of Gateway.callTool when the 2026-07-28 client has to be asked first; proxy.ts turns it into input_required. */
export class ApprovalRequired extends Error {
  constructor(
    readonly request: ApprovalRequest,
    readonly key: string,
  ) {
    super(`approval required: ${request.reason}`);
    this.name = "ApprovalRequired";
  }
}

export type Approver = (request: ApprovalRequest) => Promise<ApprovalOutcome>;

const MAX_ARGS_SHOWN = 600;

function describeArgs(args: Record<string, unknown>): string {
  const json = JSON.stringify(args, null, 2);
  return json.length > MAX_ARGS_SHOWN ? `${json.slice(0, MAX_ARGS_SHOWN)}\n… (${json.length - MAX_ARGS_SHOWN} more characters)` : json;
}

/** The form the client shows; the same one for a 2025-11-25 elicitation request and a 2026-07-28 input request. */
export function approvalForm(request: ApprovalRequest): ElicitRequestFormParams {
  return {
    mode: "form",
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
  };
}

/** Only an explicit yes approves; decline, cancel or anything else is no. */
export function approvalAnswer(answer: { action?: unknown; content?: Record<string, unknown> } | undefined): ApprovalOutcome {
  return answer?.action === "accept" && answer.content?.["approve"] === true ? "approved" : "declined";
}

/**
 * Ask the person through MCP elicitation (a form the client shows). Any answer
 * other than an explicit yes — decline, cancel, timeout — counts as no.
 */
export function elicitationApprover(server: Server | undefined, timeoutSeconds: number): Approver {
  return async (request) => {
    if (request.deferred) {
      if (!request.deferred.canElicit) return "unavailable";
      const answered = request.deferred.answers.get(approvalKey(request));
      if (answered) return answered;
      return request.phase === undefined || request.phase === "call" ? "input-required" : "unavailable";
    }
    if (!server?.getClientCapabilities()?.elicitation) return "unavailable";
    try {
      const answer = await server.elicitInput(approvalForm(request), { timeout: timeoutSeconds * 1000 });
      return approvalAnswer(answer);
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
