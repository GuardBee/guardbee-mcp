import { createServer, request as httpRequest, type Server } from "http";
import { request as httpsRequest } from "https";
import { URL } from "url";
import { scanBody, redactBody } from "./scanner.js";
import type { Finding } from "./scanner.js";

export type ProxyMode = "monitor" | "redact" | "block";

export interface ProxyOptions {
  port: number;
  /** Base URL of the real LLM API this proxy sits in front of, e.g. https://api.openai.com */
  upstream: string;
  mode: ProxyMode;
  /** In "block" mode, the minimum severity that triggers a block (default: "high"). */
  failOnSeverity?: Finding["severity"];
  onAudit?: (event: AuditEvent) => void;
}

export interface AuditEvent {
  timestamp: string;
  method: string;
  path: string;
  mode: ProxyMode;
  blocked: boolean;
  findingCount: number;
  findingCodes: string[];
}

const SEV_RANK: Record<Finding["severity"], number> = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * A reverse proxy that sits between your application and a real LLM API
 * (OpenAI/Anthropic-compatible). It buffers and inspects only the outbound
 * REQUEST body — message/system text fields — for leaked credentials and PII,
 * then streams the upstream response straight back unmodified (so SSE/streaming
 * completions pass through untouched; only the prompt going *out* is inspected).
 *
 * The audit trail never stores the actual matched text — only which pattern
 * fired and where — so the proxy's own logs can't become a second copy of the
 * leak it just caught.
 */
export function startProxy(options: ProxyOptions): Server {
  const upstreamUrl = new URL(options.upstream);
  const isHttps = upstreamUrl.protocol === "https:";
  const failOnRank = SEV_RANK[options.failOnSeverity ?? "high"] ?? 1;

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const rawBody = Buffer.concat(chunks);
      let parsedBody: unknown = null;
      let bodyToSend = rawBody;
      let findings: Finding[] = [];

      const contentType = String(req.headers["content-type"] ?? "");
      if (contentType.includes("application/json") && rawBody.length > 0) {
        try {
          parsedBody = JSON.parse(rawBody.toString("utf8"));
        } catch {
          parsedBody = null;
        }
      }

      if (parsedBody) {
        if (options.mode === "redact") {
          const result = redactBody(parsedBody);
          findings = result.findings;
          bodyToSend = Buffer.from(JSON.stringify(result.redactedBody), "utf8");
        } else {
          findings = scanBody(parsedBody).findings;
        }
      }

      const blocked = options.mode === "block" && findings.some((f) => SEV_RANK[f.severity] <= failOnRank);

      options.onAudit?.({
        timestamp: new Date().toISOString(),
        method: req.method ?? "GET",
        path: req.url ?? "/",
        mode: options.mode,
        blocked,
        findingCount: findings.length,
        findingCodes: [...new Set(findings.map((f) => f.patternId))],
      });

      if (blocked) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({
          error: "blocked_by_guardbee_prompt_leak_scanner",
          message: `Request blocked: ${findings.length} finding(s) at or above '${options.failOnSeverity ?? "high"}' severity`,
          findings: findings.map((f) => ({ patternId: f.patternId, severity: f.severity, location: f.location })),
        }, null, 2));
        return;
      }

      const forwardHeaders: Record<string, string | string[] | undefined> = { ...req.headers };
      delete forwardHeaders.host;
      forwardHeaders["content-length"] = String(bodyToSend.length);

      const doRequest = isHttps ? httpsRequest : httpRequest;
      const upstreamReq = doRequest(
        {
          protocol: upstreamUrl.protocol,
          hostname: upstreamUrl.hostname,
          port: upstreamUrl.port || (isHttps ? 443 : 80),
          path: req.url,
          method: req.method,
          headers: forwardHeaders,
        },
        (upstreamRes) => {
          res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
          upstreamRes.pipe(res);
        }
      );
      upstreamReq.on("error", (err: Error) => {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "upstream_request_failed", message: err.message }));
      });
      upstreamReq.end(bodyToSend);
    });
  });

  server.listen(options.port);
  return server;
}
