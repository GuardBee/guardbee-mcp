/**
 * Live verification: is a found key still accepted by its provider? Each
 * secret goes only to its own provider, to an endpoint that answers "who am
 * I" and changes nothing. CLI only (`--verify`): the MCP tools never send a
 * secret anywhere, so an agent cannot trigger it on its own.
 */

export type Verdict = "live" | "invalid" | "unknown";

interface Verifier {
  url: string;
  method?: "GET" | "POST";
  headers: (secret: string) => Record<string, string>;
  /** Some APIs answer 200 for a bad token and say so in the body. */
  okBody?: (body: unknown) => boolean;
  /** Statuses that mean the key works but lacks a permission (still live). */
  liveStatuses?: number[];
}

const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });

export const VERIFIERS: Record<string, Verifier> = {
  github_pat: { url: "https://api.github.com/user", headers: bearer },
  github_fine_grained_pat: { url: "https://api.github.com/user", headers: bearer },
  github_oauth: { url: "https://api.github.com/user", headers: bearer },
  gitlab_pat: { url: "https://gitlab.com/api/v4/user", headers: (secret) => ({ "private-token": secret }) },
  openai_key: { url: "https://api.openai.com/v1/models", headers: bearer },
  openai_key_v2: { url: "https://api.openai.com/v1/models", headers: bearer },
  anthropic_key: {
    url: "https://api.anthropic.com/v1/models",
    headers: (secret) => ({ "x-api-key": secret, "anthropic-version": "2023-06-01" }),
  },
  slack_token: {
    url: "https://slack.com/api/auth.test",
    method: "POST",
    headers: bearer,
    okBody: (body) => (body as { ok?: unknown })?.ok === true,
  },
  // A restricted key without balance access answers 403: it still works
  stripe_secret: { url: "https://api.stripe.com/v1/balance", headers: bearer, liveStatuses: [403] },
  stripe_restricted: { url: "https://api.stripe.com/v1/balance", headers: bearer, liveStatuses: [403] },
  huggingface_token: { url: "https://huggingface.co/api/whoami-v2", headers: bearer },
  npm_token: { url: "https://registry.npmjs.org/-/whoami", headers: bearer },
  sendgrid_key: { url: "https://api.sendgrid.com/v3/scopes", headers: bearer },
  groq_key: { url: "https://api.groq.com/openai/v1/models", headers: bearer },
  openrouter_key: { url: "https://openrouter.ai/api/v1/key", headers: bearer },
  digitalocean_token: { url: "https://api.digitalocean.com/v2/account", headers: bearer },
};

export function canVerify(patternId: string): boolean {
  return patternId in VERIFIERS;
}

export async function verifySecret(
  patternId: string,
  secret: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<Verdict> {
  const verifier = VERIFIERS[patternId];
  if (!verifier) return "unknown";
  const doFetch = options.fetchImpl ?? fetch;
  try {
    const res = await doFetch(verifier.url, {
      method: verifier.method ?? "GET",
      headers: { "user-agent": "guardbee-secret-scanner (verify)", ...verifier.headers(secret) },
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      redirect: "error",
    });
    if (res.status === 401) return "invalid";
    if (verifier.liveStatuses?.includes(res.status)) return "live";
    if (res.status === 403) return "invalid";
    if (!res.ok) return "unknown";
    if (verifier.okBody) return verifier.okBody(await res.json().catch(() => null)) ? "live" : "invalid";
    return "live";
  } catch {
    return "unknown";
  }
}

/**
 * Verify each distinct secret once, a few at a time. `secrets` maps a
 * finding's valueHash to its rule and raw value; the raw values stay in memory
 * and never reach a finding or the output.
 */
export async function verifyAll(
  secrets: Map<string, { patternId: string; secret: string }>,
  options: { fetchImpl?: typeof fetch; concurrency?: number; timeoutMs?: number } = {},
): Promise<Map<string, Verdict>> {
  const verdicts = new Map<string, Verdict>();
  const queue = [...secrets].filter(([, { patternId }]) => canVerify(patternId));
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [valueHash, { patternId, secret }] = next;
      verdicts.set(valueHash, await verifySecret(patternId, secret, options));
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 4, queue.length) }, worker));
  return verdicts;
}
