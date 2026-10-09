import { createHash, timingSafeEqual } from "crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

/** Who is calling over HTTP. API keys carry no user; OIDC tokens do. */
export interface Identity {
  via: "apiKey" | "oidc";
  /** The user claim of the token (default `sub`); absent for API keys. */
  user?: string;
  groups: string[];
}

export interface OidcConfig {
  /** Token issuer; its discovery document gives the JWKS unless `jwksUri` is set. */
  issuer: string;
  /** Accepted `aud` values: tokens minted for another service are refused. */
  audience: string[];
  jwksUri?: string;
  /** Claim naming the user (default `sub`; `email` or `preferred_username` are common). */
  userClaim: string;
  /** Claim holding the user's groups or roles, a list or a space-separated string (default `groups`). */
  groupsClaim: string;
  /** This gateway's public URL, advertised in the protected resource metadata. */
  resource?: string;
}

export type Authenticate = (authorization: string | undefined) => Promise<Identity | null>;

const digest = (value: string) => createHash("sha256").update(value).digest();

function bearer(authorization: string | undefined): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
  return match?.[1]?.trim() || null;
}

function claimText(payload: JWTPayload, claim: string): string | undefined {
  const value = payload[claim];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function claimList(payload: JWTPayload, claim: string): string[] {
  const value = payload[claim];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") return value.split(/\s+/).filter(Boolean);
  return [];
}

/** The issuer's JWKS, found through its OpenID discovery document unless given. */
function keySet(oidc: OidcConfig, fetchImpl: typeof fetch): JWTVerifyGetKey {
  if (oidc.jwksUri) return createRemoteJWKSet(new URL(oidc.jwksUri));
  let resolved: Promise<JWTVerifyGetKey> | null = null;
  const discover = async (): Promise<JWTVerifyGetKey> => {
    const url = `${oidc.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`OIDC discovery failed: ${url} returned ${res.status}`);
    const jwksUri = ((await res.json()) as { jwks_uri?: unknown }).jwks_uri;
    if (typeof jwksUri !== "string") throw new Error(`OIDC discovery: ${url} has no jwks_uri`);
    return createRemoteJWKSet(new URL(jwksUri));
  };
  return async (header, token) => {
    // Retry discovery on the next request after a failure rather than caching the error
    resolved ??= discover().catch((err) => {
      resolved = null;
      throw err;
    });
    return (await resolved)(header, token);
  };
}

/**
 * Accepts a Bearer API key (constant-time compare against every key) or,
 * with `oidc`, a JWT whose signature, issuer, audience and lifetime check
 * out. No keys and no OIDC means an open loopback listener.
 */
export function createAuthenticator(
  apiKeys: readonly string[],
  oidc?: OidcConfig,
  options: { fetchImpl?: typeof fetch; keys?: JWTVerifyGetKey } = {},
): Authenticate {
  const keyDigests = apiKeys.map(digest);
  const keys = oidc ? (options.keys ?? keySet(oidc, options.fetchImpl ?? fetch)) : null;

  return async (authorization) => {
    if (keyDigests.length === 0 && !oidc) return { via: "apiKey", groups: [] };
    const presented = bearer(authorization);
    if (!presented) return null;

    if (keyDigests.length > 0) {
      const hashed = digest(presented);
      // Check every key so timing does not reveal which one matched.
      if (keyDigests.reduce((ok, key) => timingSafeEqual(key, hashed) || ok, false)) return { via: "apiKey", groups: [] };
    }
    if (!oidc || !keys) return null;
    try {
      const { payload } = await jwtVerify(presented, keys, { issuer: oidc.issuer, audience: oidc.audience });
      const user = claimText(payload, oidc.userClaim);
      if (!user) return null;
      return { via: "oidc", user, groups: claimList(payload, oidc.groupsClaim) };
    } catch {
      return null;
    }
  };
}
