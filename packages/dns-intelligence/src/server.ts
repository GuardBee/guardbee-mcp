import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { instrumentServer } from "@guardbee/mcp-telemetry";
import { z } from "zod";
import {
  enumerateDomain,
  enumerateSubdomainsDetailed,
  formatDnsReport,
  formatSubdomainReport,
  TAKEOVER_LABEL,
} from "./dns.js";
import { normalizeDomain, systemResolver } from "./resolver.js";
import { checkTakeover } from "./takeover.js";
import { DKIM_SELECTORS, suggestSpf } from "./email.js";
import { gradeFindings, formatGrade, formatGradeTable } from "./grade.js";
import type { Finding } from "./dns.js";
import * as dns from "dns/promises";

export async function startServer() {
  const server = new McpServer({
    name: "guardbee-dns-intelligence",
    version: "0.1.0",
  });
  instrumentServer(server, "dns-intelligence");
  registerTools(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/** This package's MCP tools on `server`; @guardbee/security-suite serves several packages' tools from one process this way. */
export function registerTools(server: McpServer): void {
  server.registerTool(
    "enumerate_dns",
    {
      description: "Enumerate all DNS records for a domain and detect misconfigurations: SPF, DMARC, DKIM key strength, MTA-STS/TLS-RPT, MX, DNSSEC (signed / broken / weak algorithms) and CAA (including whether it blocks the CA of the live certificate) and nameservers (lame delegation, anonymous zone transfer, open recursion)",
      inputSchema: {
        domain: z.string().describe("Domain to enumerate (e.g. example.com)"),
        nameserverProbe: z
          .boolean()
          .optional()
          .describe("Query each nameserver directly for lame delegation, SOA serial drift, anonymous zone transfer (AXFR) and open recursion (default: true)"),
      },
    },
    async ({ domain, nameserverProbe }) => {
      const start = Date.now();
      const result = await enumerateDomain(domain, { nsProbe: nameserverProbe });
      const report = formatDnsReport(result);
      return { content: [{ type: "text", text: `${report}\n\nCompleted in ${Date.now() - start}ms` }] };
    }
  );

  server.registerTool(
    "audit_domains",
    {
      description: "Audit several domains at once (e.g. every brand or country domain) and compare them: an A–F grade per domain from all DNS, email, DNSSEC, CAA and nameserver checks, plus each domain's most serious findings",
      inputSchema: {
        domains: z.array(z.string()).min(1).max(20).describe("Domains to audit, e.g. [\"example.com\", \"example.de\"]"),
        nameserverProbe: z.boolean().optional().describe("Query nameservers directly (default: true)"),
      },
    },
    async ({ domains, nameserverProbe }) => {
      const start = Date.now();
      const names = [...new Set(domains.map(normalizeDomain))];
      const results = [];
      for (const d of names) results.push(await enumerateDomain(d, { nsProbe: nameserverProbe }));

      const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as const;
      const lines = [`Domain audit: ${names.length} domain(s)`, "", formatGradeTable(results), ""];
      for (const r of results) {
        const top = r.findings
          .filter((f) => f.severity !== "info")
          .sort((a, b) => order[a.severity] - order[b.severity])
          .slice(0, 5);
        lines.push(`── ${r.domain}: ${formatGrade(gradeFindings(r.findings))}`);
        for (const f of top) lines.push(`  [${f.severity.toUpperCase()}] ${f.message}`);
        const more = r.findings.filter((f) => f.severity !== "info").length - top.length;
        if (more > 0) lines.push(`  … ${more} more (run enumerate_dns on ${r.domain} for the full report)`);
        lines.push("");
      }
      lines.push(`Completed in ${Date.now() - start}ms`);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  server.registerTool(
    "enumerate_subdomains",
    {
      description: "Find subdomains from Certificate Transparency logs and a common-name wordlist, and detect subdomain takeovers: CNAMEs to S3, GitHub Pages, Azure, Heroku, Netlify and other providers whose resource is gone (verified fingerprints), or to targets that no longer exist",
      inputSchema: {
        domain: z.string().describe("Root domain to enumerate subdomains for (e.g. example.com)"),
        httpProbe: z
          .boolean()
          .optional()
          .describe("Fetch pages behind provider CNAMEs to match takeover fingerprints (default: true)"),
        certificateTransparency: z
          .boolean()
          .optional()
          .describe("Add names found in Certificate Transparency logs via crt.sh and Cert Spotter (default: true; sends only the domain name)"),
      },
    },
    async ({ domain, httpProbe, certificateTransparency }) => {
      const start = Date.now();
      const name = normalizeDomain(domain);
      const { results, wildcard, ct } = await enumerateSubdomainsDetailed(name, 20, {
        http: httpProbe,
        ct: certificateTransparency !== false,
      });
      const report = formatSubdomainReport(name, results, wildcard, ct);
      return { content: [{ type: "text", text: `${report}\n\nCompleted in ${Date.now() - start}ms` }] };
    }
  );

  server.registerTool(
    "check_takeover",
    {
      description: "Check specific hostnames (e.g. from your DNS zone or certificate logs) for subdomain takeover",
      inputSchema: {
        hosts: z.array(z.string()).min(1).max(200).describe("Hostnames to check, e.g. [\"blog.example.com\"]"),
        httpProbe: z.boolean().optional().describe("Fetch pages to match takeover fingerprints (default: true)"),
      },
    },
    async ({ hosts, httpProbe }) => {
      const lines: string[] = [];
      const found = await Promise.all(
        hosts.map(async (h) => {
          const host = normalizeDomain(h);
          return { host, takeover: await checkTakeover(host, systemResolver, { http: httpProbe }) };
        })
      );
      for (const { host, takeover } of found) {
        if (!takeover) {
          lines.push(`✅  ${host}  no takeover indicators`);
          continue;
        }
        lines.push(`⚠️  ${host}  ${takeover.provider} (${TAKEOVER_LABEL[takeover.risk]})`);
        lines.push(`      └─ ${takeover.evidence}`);
        lines.push(`      └─ CNAME chain: ${[host, ...takeover.chain].join(" → ")}`);
        if (takeover.risk !== "stale") lines.push(`      └─ Fix: delete the CNAME record, or reclaim the ${takeover.provider} resource it points to.`);
      }
      const n = found.filter((x) => x.takeover && x.takeover.risk !== "stale").length;
      lines.unshift(`Subdomain takeover check: ${found.length} host(s), ${n} with indicators`, "");
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  server.registerTool(
    "check_email_security",
    {
      description: "Check a domain's email security: MX, SPF (nested lookup count), DMARC, DKIM key strength, MTA-STS and TLS-RPT, with remediation advice",
      inputSchema: {
        domain: z.string().describe("Domain to check email security for"),
        dkimSelectors: z
          .array(z.string())
          .optional()
          .describe("Additional DKIM selectors to check (default: common selectors)"),
      },
    },
    async ({ domain: input, dkimSelectors: extraSelectors }) => {
      const start = Date.now();
      const domain = normalizeDomain(input);
      const result = await enumerateDomain(domain, {
        dkimSelectors: extraSelectors?.length ? [...DKIM_SELECTORS, ...extraSelectors] : undefined,
      });
      if (result.exists === false) {
        return { content: [{ type: "text", text: `${domain} does not exist (NXDOMAIN); there is nothing to check.` }] };
      }

      const lines: string[] = [`Email Security Check: ${domain}`, "─".repeat(50)];
      const issuesFor = (re: RegExp) => result.findings.filter((f) => re.test(f.code) && f.severity !== "info");
      const push = (fs: Finding[]) => {
        for (const f of fs) lines.push(`  [${f.severity.toUpperCase()}] ${f.message}`);
      };

      // MX
      lines.push("\n── MX ──────────────────────────────────────────");
      const mx = result.records["MX"] ?? [];
      if (result.nullMx) lines.push("✓ Null MX: the domain accepts no mail");
      else if (mx.length === 0) lines.push("– No MX records: the domain does not receive mail");
      else lines.push(`✓ ${mx.map((m) => m.value).join(", ")}`);
      push(issuesFor(/^MX_/));

      // SPF
      lines.push("\n── SPF ─────────────────────────────────────────");
      if (!result.spf) {
        lines.push("✗ No SPF record found");
        const hosts = result.nullMx ? [] : mx.map((m) => m.value.split(" ")[1]!.replace(/\.$/, ""));
        lines.push(`  Add:  ${suggestSpf(hosts)}${hosts.length ? "   (plus every other service that sends as this domain)" : "   (the domain sends no mail)"}`);
      } else {
        lines.push(`✓ ${result.spf.raw}`);
        if (result.spf.totalLookups !== undefined) {
          lines.push(`  DNS lookups: ${result.spf.totalLookups}/10 including nested includes`);
        }
      }
      push(issuesFor(/^SPF_/));

      // DMARC
      lines.push("\n── DMARC ───────────────────────────────────────");
      if (!result.dmarc) {
        lines.push("✗ No usable DMARC record found at _dmarc." + domain);
        lines.push("  Add:  v=DMARC1; p=quarantine; rua=mailto:dmarc@" + domain);
      } else {
        lines.push(`✓ ${result.dmarc.raw}${result.dmarc.inheritedFrom ? `  (inherited from ${result.dmarc.inheritedFrom})` : ""}`);
      }
      push(issuesFor(/^DMARC_/));

      // DKIM
      lines.push("\n── DKIM ────────────────────────────────────────");
      const keys = result.dkimKeys ?? [];
      if (keys.length === 0) {
        lines.push("✗ No DKIM key found under common selectors");
        lines.push("  Configure DKIM signing with your mail provider, or pass its selector in dkimSelectors");
      } else {
        for (const k of keys) {
          lines.push(k.revoked ? `– ${k.selector}: revoked` : `✓ ${k.selector}: ${k.keyType}${k.bits ? ` ${k.bits}-bit` : ""}${k.testing ? " (t=y)" : ""}`);
        }
      }
      push(issuesFor(/^DKIM_/));

      // Transport security
      lines.push("\n── MTA-STS / TLS-RPT ───────────────────────────");
      const p = result.mtaSts?.policy;
      lines.push(
        result.mtaSts?.record
          ? `✓ MTA-STS ${p ? `mode ${p.mode}, mx ${p.mx.join(" ")}, max_age ${p.maxAge}` : "announced (policy not loaded)"}`
          : "– MTA-STS not set up"
      );
      lines.push(result.tlsRpt?.record ? `✓ ${result.tlsRpt.record}` : "– TLS-RPT not set up");
      push(issuesFor(/^(MTA_STS|TLSRPT)_/));

      const totalIssues = result.findings.filter((f) => /^(SPF|DMARC|DKIM|MX|MTA_STS|TLSRPT)_/.test(f.code) && f.severity !== "info").length;
      lines.push(`\n${totalIssues === 0 ? "✅ Email security looks good!" : `⚠️  ${totalIssues} issue(s) need attention`}`);
      lines.push(`\nCompleted in ${Date.now() - start}ms`);

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  server.registerTool(
    "lookup_dns",
    {
      description: "Perform a targeted DNS lookup for specific record types on a domain",
      inputSchema: {
        domain: z.string().describe("Domain to query"),
        type: z
          .enum(["A", "AAAA", "MX", "NS", "TXT", "CNAME", "SOA"])
          .describe("DNS record type to look up"),
      },
    },
    async ({ domain: input, type }) => {
      try {
        const domain = normalizeDomain(input);
        let result: string;
        switch (type) {
          case "A": {
            const recs = await dns.resolve4(domain, { ttl: true });
            result = recs.map((r) => `${r.address}  (TTL ${r.ttl}s)`).join("\n");
            break;
          }
          case "AAAA": {
            const recs = await dns.resolve6(domain, { ttl: true }) as Array<{ address: string; ttl: number }>;
            result = recs.map((r) => `${r.address}  (TTL ${r.ttl}s)`).join("\n");
            break;
          }
          case "MX": {
            const recs = await dns.resolveMx(domain);
            result = recs.sort((a, b) => a.priority - b.priority).map((r) => `${r.priority} ${r.exchange}`).join("\n");
            break;
          }
          case "NS": {
            const recs = await dns.resolveNs(domain);
            result = recs.join("\n");
            break;
          }
          case "TXT": {
            const recs = await dns.resolveTxt(domain);
            result = recs.map((chunks) => `"${chunks.join("")}"`).join("\n");
            break;
          }
          case "CNAME": {
            const recs = await dns.resolveCname(domain);
            result = recs.join("\n");
            break;
          }
          case "SOA": {
            const soa = await dns.resolveSoa(domain);
            result = `nsname: ${soa.nsname}\nhostmaster: ${soa.hostmaster}\nserial: ${soa.serial}\nrefresh: ${soa.refresh}\nretry: ${soa.retry}\nexpire: ${soa.expire}\nminttl: ${soa.minttl}`;
            break;
          }
        }
        return { content: [{ type: "text", text: `${type} records for ${domain}:\n${result}` }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `No ${type} records found for ${input}: ${msg}` }] };
      }
    }
  );
}
