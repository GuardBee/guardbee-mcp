import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { inspectHost, checkHsts, formatInspectReport } from "./inspector.js";

export async function startServer() {
  const server = new McpServer({
    name: "guardbee-ssl-inspector",
    version: "0.1.0",
  });

  server.tool(
    "inspect_ssl",
    "Inspect TLS certificate, cipher suite, and protocol configuration for a single domain",
    {
      host: z.string().describe("Domain name or IP to inspect (e.g. example.com)"),
      port: z.number().optional().describe("Port to connect to (default: 443)"),
      checkHsts: z.boolean().optional().describe("Also check HSTS header via HTTP HEAD (default: true)"),
    },
    async ({ host, port = 443, checkHsts: doHsts = true }) => {
      const start = Date.now();
      const result = await inspectHost(host, port);

      if (doHsts && result.reachable) {
        const hsts = await checkHsts(host, port);
        result.supportsHsts = hsts.enabled;
        result.hstsMaxAge = hsts.maxAge;
        result.hstsIncludesSubdomains = hsts.includesSubdomains;

        if (!hsts.enabled) {
          result.findings.push({ severity: "medium", code: "NO_HSTS", message: "HSTS header not found; browsers may allow downgrade attacks" });
        } else if ((hsts.maxAge ?? 0) < 15_552_000) {
          result.findings.push({ severity: "low", code: "HSTS_SHORT_MAX_AGE", message: `HSTS max-age is ${hsts.maxAge}s (recommended: ≥ 15552000)` });
        }
      }

      const elapsed = Date.now() - start;
      const report = formatInspectReport([result]);
      return { content: [{ type: "text", text: `${report}\nCompleted in ${elapsed}ms` }] };
    }
  );

  server.tool(
    "inspect_ssl_bulk",
    "Inspect TLS configuration for multiple domains in parallel",
    {
      hosts: z.array(z.string()).describe("List of domain names to inspect"),
      port: z.number().optional().describe("Port to use for all domains (default: 443)"),
    },
    async ({ hosts, port = 443 }) => {
      const start = Date.now();
      const results = await Promise.all(hosts.map((h) => inspectHost(h, port)));

      const totalIssues = results.reduce(
        (sum, r) => sum + r.findings.filter((f) => f.code !== "OK").length,
        0
      );

      const header = `🔍 Inspected ${hosts.length} host(s) — ${totalIssues} issue(s) found (${Date.now() - start}ms)\n`;
      const report = formatInspectReport(results);
      return { content: [{ type: "text", text: header + report }] };
    }
  );

  server.tool(
    "check_cert_expiry",
    "Check certificate expiry for one or more domains and highlight certificates expiring soon",
    {
      hosts: z.array(z.string()).describe("Domain names to check"),
      warnDays: z.number().optional().describe("Warn if expiring within this many days (default: 30)"),
    },
    async ({ hosts, warnDays = 30 }) => {
      const results = await Promise.all(hosts.map((h) => inspectHost(h)));
      const lines: string[] = [`Certificate Expiry Report\n${"─".repeat(40)}`];

      for (const r of results) {
        if (!r.reachable || !r.cert) {
          lines.push(`✗  ${r.host} — unreachable`);
          continue;
        }
        const days = r.cert.daysUntilExpiry;
        const icon = r.cert.isExpired ? "💀" : days < 7 ? "🚨" : days < warnDays ? "⚠️ " : "✅";
        const status = r.cert.isExpired ? `EXPIRED ${Math.abs(days)}d ago` : `expires in ${days}d`;
        lines.push(`${icon}  ${r.host.padEnd(40)} ${status}  (${r.cert.validTo})`);
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  server.tool(
    "get_cert_info",
    "Get detailed certificate information for a domain including fingerprint, SANs, and issuer chain",
    {
      host: z.string().describe("Domain to inspect"),
      port: z.number().optional().describe("Port (default: 443)"),
    },
    async ({ host, port = 443 }) => {
      const result = await inspectHost(host, port);

      if (!result.reachable) {
        return { content: [{ type: "text", text: `Cannot reach ${host}:${port} — ${result.error ?? "unknown error"}` }] };
      }

      if (!result.cert) {
        return { content: [{ type: "text", text: `No certificate returned by ${host}:${port}` }] };
      }

      const c = result.cert;
      const lines = [
        `Certificate for ${host}:${port}`,
        `${"─".repeat(50)}`,
        `Subject     : ${JSON.stringify(c.subject)}`,
        `Issuer      : ${JSON.stringify(c.issuer)}`,
        `Valid From  : ${c.validFrom}`,
        `Valid To    : ${c.validTo}`,
        `Days Left   : ${c.isExpired ? `EXPIRED (${Math.abs(c.daysUntilExpiry)}d ago)` : c.daysUntilExpiry}`,
        `Serial      : ${c.serialNumber}`,
        `Fingerprint : ${c.fingerprint}`,
        `SHA-256     : ${c.fingerprint256}`,
        `SANs        : ${c.subjectAltNames.join(", ") || "none"}`,
        `Chain Depth : ${result.chainDepth ?? "?"}`,
        `Chain Valid : ${result.chainValid ? "yes" : "no"}`,
        `Protocol    : ${result.protocol ?? "?"}`,
        `Cipher      : ${result.cipher ?? "?"} (${result.cipherStrength ?? "?"}bit)`,
      ];

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
