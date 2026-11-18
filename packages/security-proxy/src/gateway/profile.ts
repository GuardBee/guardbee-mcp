/**
 * `profile: strict` hardens the security-critical defaults that favor
 * availability: an unverified package does not start, and a check that cannot
 * run refuses the call instead of letting it through. It only fills what the
 * file leaves out; a setting written in the file always wins.
 */
export const PROFILES = ["default", "strict"] as const;
export type Profile = (typeof PROFILES)[number];

type Raw = Record<string, unknown>;

const isObject = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);

/** Set `key` on `section` of `root` when it is absent; `create` also adds a missing section. */
function fill(root: Raw, section: string, key: string, value: unknown, create = false): void {
  const current = root[section];
  if (current === undefined || current === null) {
    if (create) root[section] = { [key]: value };
    return;
  }
  if (isObject(current) && current[key] === undefined) root[section] = { ...current, [key]: value };
}

/** The YAML as parsed, with the profile's defaults filled in; anything that is not an object is returned as it is. */
export function applyProfile(raw: unknown): unknown {
  if (!isObject(raw) || raw["profile"] !== "strict") return raw;
  const out: Raw = { ...raw };
  fill(out, "provenance", "mode", "require", true);
  fill(out, "state", "onError", "fail-closed");
  fill(out, "classifier", "onError", "closed");
  fill(out, "judge", "onError", "closed");
  return out;
}
