import fs from "fs";

/**
 * Groups from LDAP / Active Directory for callers the proxy already knows by
 * name (an OIDC user, an LLM gateway key's user). The groups feed the same
 * `group` matches in rules, quotas, LLM access and budgets as token groups.
 */
export interface DirectoryConfig {
  /** ldap://… or ldaps://… */
  url: string;
  bindDn: string;
  bindPassword: string;
  /** Where users live, e.g. ou=people,dc=acme,dc=com */
  baseDn: string;
  /** `{user}` is replaced with the escaped user name, e.g. (|(mail={user})(uid={user})(userPrincipalName={user})) */
  userFilter: string;
  /** Read groups from this attribute of the user entry (AD: memberOf) … */
  groupAttribute?: string;
  /** … or search for them: `{dn}` is the user's DN, `{user}` the name; e.g. (member={dn}) */
  groupSearch?: { baseDn: string; filter: string; nameAttribute: string };
  /** `cn` (default) turns CN=eng,OU=Groups,… into "eng"; `dn` keeps the whole DN. */
  groupName: "cn" | "dn";
  cacheSeconds: number;
  timeoutMs: number;
  /** A private CA for ldaps:// / StartTLS; certificates are always verified. */
  caFile?: string;
  /** No answer from the directory: refuse the request (default) or go on with the token's groups. */
  onError: "deny" | "token-groups";
}

export class DirectoryUnavailable extends Error {
  readonly status = 503;
  constructor(message: string) {
    super(message);
    this.name = "DirectoryUnavailable";
  }
}

/** RFC 4515: a user name must not be able to change the filter. */
export function escapeFilter(value: string): string {
  return value.replace(/[\\*()\0]/g, (ch) => `\\${ch.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

/** CN=Platform Eng,OU=Groups,DC=acme → "Platform Eng" (escaped commas kept). */
export function cnOf(dn: string): string {
  const first = dn.match(/^\s*cn\s*=\s*((?:\\.|[^,])+)/i)?.[1];
  return first ? first.replace(/\\(.)/g, "$1").trim() : dn;
}

/** The part of an LDAP client this module uses; ldapts's Client fits it. */
export interface LdapClient {
  bind(dn: string, password: string): Promise<void>;
  search(base: string, options: { scope: "sub"; filter: string; attributes: string[] }): Promise<{ searchEntries: Record<string, unknown>[] }>;
  unbind(): Promise<void>;
}

export type ClientFactory = (config: DirectoryConfig) => Promise<LdapClient> | LdapClient;

async function ldaptsClient(config: DirectoryConfig): Promise<LdapClient> {
  const { Client } = await import("ldapts");
  const ca = config.caFile ? fs.readFileSync(config.caFile) : undefined;
  return new Client({ url: config.url, timeout: config.timeoutMs, connectTimeout: config.timeoutMs, ...(ca ? { tlsOptions: { ca } } : {}) }) as unknown as LdapClient;
}

const values = (entry: Record<string, unknown>, attribute: string): string[] => {
  const key = Object.keys(entry).find((k) => k.toLowerCase() === attribute.toLowerCase());
  const value = key ? entry[key] : undefined;
  return (Array.isArray(value) ? value : value === undefined ? [] : [value]).map((v) => (Buffer.isBuffer(v) ? v.toString("utf8") : String(v)));
};

export interface Directory {
  /** The user's groups; [] for a user the directory does not know. Throws DirectoryUnavailable. */
  groupsOf(user: string): Promise<string[]>;
}

export function createDirectory(config: DirectoryConfig, factory: ClientFactory = ldaptsClient, now: () => number = Date.now): Directory {
  const cache = new Map<string, { at: number; groups: Promise<string[]> }>();

  const lookup = async (user: string): Promise<string[]> => {
    const client = await factory(config);
    try {
      await client.bind(config.bindDn, config.bindPassword);
      const escaped = escapeFilter(user);
      const { searchEntries } = await client.search(config.baseDn, {
        scope: "sub",
        filter: config.userFilter.split("{user}").join(escaped),
        attributes: ["dn", ...(config.groupAttribute ? [config.groupAttribute] : [])],
      });
      const entry = searchEntries[0];
      if (!entry) return [];
      let groups = config.groupAttribute ? values(entry, config.groupAttribute) : [];
      if (config.groupSearch) {
        const dn = String(entry["dn"] ?? "");
        const found = await client.search(config.groupSearch.baseDn, {
          scope: "sub",
          filter: config.groupSearch.filter.split("{dn}").join(escapeFilter(dn)).split("{user}").join(escaped),
          attributes: [config.groupSearch.nameAttribute],
        });
        groups = [...groups, ...found.searchEntries.flatMap((group) => (config.groupSearch!.nameAttribute.toLowerCase() === "dn" ? [String(group["dn"])] : values(group, config.groupSearch!.nameAttribute)))];
      }
      const names = config.groupName === "cn" ? groups.map(cnOf) : groups;
      return [...new Set(names)];
    } finally {
      await client.unbind().catch(() => {});
    }
  };

  return {
    async groupsOf(user) {
      const at = now();
      const hit = cache.get(user);
      if (hit && at - hit.at < config.cacheSeconds * 1000) return hit.groups;
      const groups = lookup(user);
      cache.set(user, { at, groups });
      if (cache.size > 10_000) cache.delete(cache.keys().next().value!);
      try {
        return await groups;
      } catch (err) {
        cache.delete(user); // do not cache a failure
        throw new DirectoryUnavailable(`directory lookup failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}

/** Token groups plus directory groups, with listen.ldap.onError deciding what a failure means. */
export async function withDirectoryGroups(directory: Directory | null, onError: DirectoryConfig["onError"], user: string | undefined, groups: string[]): Promise<string[]> {
  if (!directory || !user) return groups;
  try {
    return [...new Set([...groups, ...(await directory.groupsOf(user))])];
  } catch (err) {
    if (onError === "token-groups") return groups;
    throw err;
  }
}
