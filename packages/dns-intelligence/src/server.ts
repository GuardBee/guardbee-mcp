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
import type { Finding } from "./dns.js";
import * as dns from "dns/promises";

export async function startServer() {
  const server = new McpServer({
    name: "guardbee-dns-intelligence",
    version: "0.1.0",
  });
  instrumentServer(server, "dns-intelligence");

  server.tool(
    "enumerate_dns",
    "Enumerate all DNS records for a domain and detect misconfigurations: SPF, DMARC, DKIM key strength, MTA-STS/TLS-RPT, MX, DNSSEC (signed / broken / weak algorithms) and CAA (including whether it blocks the CA of the live certificate)",
    {
      domain: z.string().describe("Domain to enumerate (e.g. example.com)"),
    },
    async ({ domain }) => {
      const start = Date.now();
      const result = await enumerateDomain(domain);
      const report = formatDnsReport(result);
      return { content: [{ type: "text", text: `${report}\n\nCompleted in ${Date.now() - start}ms` }] };
    }
  );

  server.tool(
    "enumerate_subdomains",
    "Find subdomains from Certificate Transparency logs and a common-name wordlist, and detect subdomain takeovers: CNAMEs to S3, GitHub Pages, Azure, Heroku, Netlify and other providers whose resource is gone (verified fingerprints), or to targets that no longer exist",
    {
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

  server.tool(
    "check_takeover",
    "Check specific hostnames (e.g. from your DNS zone or certificate logs) for subdomain takeover",
    {
      hosts: z.array(z.string()).min(1).max(200).describe("Hostnames to check, e.g. [\"blog.example.com\"]"),
      httpProbe: z.boolean().optional().describe("Fetch pages to match takeover fingerprints (default: true)"),
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

  server.tool(
    "check_email_security",
    "Check a domain's email security: MX, SPF (nested lookup count), DMARC, DKIM key strength, MTA-STS and TLS-RPT, with remediation advice",
    {
      domain: z.string().describe("Domain to check email security for"),
      dkimSelectors: z
        .array(z.string())
        .optional()
        .describe("Additional DKIM selectors to check (default: common selectors)"),
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

  server.tool(
    "lookup_dns",
    "Perform a targeted DNS lookup for specific record types on a domain",
    {
      domain: z.string().describe("Domain to query"),
      type: z
        .enum(["A", "AAAA", "MX", "NS", "TXT", "CNAME", "SOA"])
        .describe("DNS record type to look up"),
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
