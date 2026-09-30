import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

export interface ApprovalRequest {
  tool: string;
  upstream: string;
  args: Record<string, unknown>;
  reason: string;
}

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
