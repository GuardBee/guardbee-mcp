import type { Finding } from "./dns.js";
import { lookup, type DnsResolver } from "./resolver.js";

/** RFC 7208 §4.6.4: at most 10 DNS-querying terms in total, and at most 2 void lookups. */
export const SPF_LOOKUP_LIMIT = 10;
export const SPF_VOID_LIMIT = 2;

/** Terms that cost a DNS lookup. Anchored so "~all" is not read as the "a" mechanism. */
const LOOKUP_TERM = /^[+\-~?]?(include|a|mx|ptr|exists)(?=[:/]|$)|^(redirect)=/i;

export function isSpfRecord(txt: string): boolean {
  return /^v=spf1(\s|$)/i.test(txt);
}

/** Number of DNS-querying terms in one record, not following includes. */
export function countLookupTerms(record: string): number {
  return record.split(/\s+/).slice(1).filter((t) => LOOKUP_TERM.test(t)).length;
}

export interface SpfEvaluation {
  /** DNS-querying terms across the record and everything it includes. */
  lookups: number;
  /** include/redirect lookups that returned no record (NXDOMAIN or empty); a/mx targets are not queried. */
  voidLookups: number;
  /** Domains reached through include/redirect, in evaluation order. */
  included: string[];
  issues: Finding[];
}

/**
 * Evaluate an SPF record the way a receiving server counts it: every
 * include/redirect is fetched and its terms counted too. Stops expanding
 * once the limit is exceeded (receivers stop there with a permerror).
 */
export async function evaluateSpf(
  domain: string,
  record: string,
  resolver: DnsResolver,
  maxDepth = 10
): Promise<SpfEvaluation> {
  const result: SpfEvaluation = { lookups: 0, voidLookups: 0, included: [], issues: [] };
  const visiting = new Set<string>([domain]);
  let unexpandedMacros = 0;

  const walk = async (rec: string, depth: number): Promise<void> => {
    for (const term of rec.split(/\s+/).slice(1)) {
      const m = LOOKUP_TERM.exec(term);
      if (!m) continue;
      result.lookups++;
      const kind = (m[1] ?? m[2])!.toLowerCase();
      const target = term.slice(term.search(/[:=]/) + 1);

      if (kind !== "include" && kind !== "redirect") {
        if (kind === "ptr") {
          result.issues.push({
            severity: "low",
            code: "SPF_PTR",
            message: "SPF uses the 'ptr' mechanism, which RFC 7208 says not to use (slow, unreliable)",
          });
        }
        continue;
      }
      if (target.includes("%")) {
        unexpandedMacros++; // macros depend on the sender; count the lookup, do not follow
        continue;
      }
      if (result.lookups > SPF_LOOKUP_LIMIT || depth >= maxDepth) continue;

      const name = target.toLowerCase().replace(/\.$/, "");
      if (visiting.has(name)) {
        result.issues.push({
          severity: "high",
          code: "SPF_INCLUDE_LOOP",
          message: `SPF ${kind} of ${name} loops back to a record already being evaluated (permerror)`,
        });
        continue;
      }
      const txt = await lookup(() => resolver.resolveTxt(name));
      if (txt.status !== "ok" && txt.status !== "error") {
        result.voidLookups++;
        result.issues.push({
          severity: "high",
          code: "SPF_INCLUDE_MISSING",
          message: `SPF ${kind}:${name} has no SPF record (permerror for every message that reaches it)`,
        });
        continue;
      }
      if (txt.status === "error") {
        result.issues.push({
          severity: "low",
          code: "SPF_INCLUDE_UNRESOLVED",
          message: `Could not fetch SPF ${kind}:${name} (${txt.code}); lookup count may be incomplete`,
        });
        continue;
      }
      const spf = txt.value.map((c) => c.join("")).filter(isSpfRecord);
      if (spf.length !== 1) {
        result.issues.push({
          severity: "high",
          code: spf.length === 0 ? "SPF_INCLUDE_MISSING" : "SPF_INCLUDE_DUPLICATE",
          message:
            spf.length === 0
              ? `SPF ${kind}:${name} has no SPF record (permerror for every message that reaches it)`
              : `SPF ${kind}:${name} publishes ${spf.length} SPF records (permerror)`,
        });
        continue;
      }
      result.included.push(name);
      visiting.add(name);
      await walk(spf[0]!, depth + 1);
      visiting.delete(name);
    }
  };

  await walk(record, 0);

  if (result.lookups > SPF_LOOKUP_LIMIT) {
    result.issues.unshift({
      severity: "high",
      code: "SPF_TOO_MANY_LOOKUPS",
      message: `SPF needs ${result.lookups} DNS lookups including nested includes (limit ${SPF_LOOKUP_LIMIT}); receivers return permerror and SPF fails`,
    });
  } else if (result.lookups === SPF_LOOKUP_LIMIT) {
    result.issues.push({
      severity: "low",
      code: "SPF_AT_LOOKUP_LIMIT",
      message: `SPF uses exactly ${SPF_LOOKUP_LIMIT} DNS lookups including nested includes; one more include will break it`,
    });
  }
  if (result.voidLookups > SPF_VOID_LIMIT) {
    result.issues.push({
      severity: "high",
      code: "SPF_TOO_MANY_VOID_LOOKUPS",
      message: `SPF has ${result.voidLookups} void lookups (limit ${SPF_VOID_LIMIT}); receivers may return permerror`,
    });
  }
  if (unexpandedMacros > 0) {
    result.issues.push({
      severity: "info",
      code: "SPF_MACROS",
      message: `${unexpandedMacros} include/redirect target(s) use macros and were counted but not followed`,
    });
  }
  return result;
}
