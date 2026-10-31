import { AsyncLocalStorage } from "async_hooks";

/**
 * Who a gateway request is for, while it runs: upstreams shared by every
 * session pick a per-user connection from it (upstreams.<name>.auth), and
 * record which downstream identity served the call.
 */
export interface CallerScope {
  user?: string;
  /** The caller's inbound access token, for token exchange. Never logged, never sent upstream. */
  token?: string;
  /** Set by an authenticated upstream: who the upstream saw (token subject), for the audit record. */
  upstreamIdentity?: string;
}

export const callerStorage = new AsyncLocalStorage<CallerScope>();

export const currentCaller = (): CallerScope | undefined => callerStorage.getStore();
