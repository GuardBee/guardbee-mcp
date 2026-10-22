import { cpSync, mkdtempSync, readdirSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The lockfile fixtures are real lockfiles with known-vulnerable versions on
 * purpose. They are stored as `<name>.fixture` so dependency scanners (OSV,
 * OpenSSF Scorecard, Dependabot) do not report them as this repository's own
 * dependencies; tests get a copy under the real names.
 */
const SOURCE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "lockfiles");
let copy: string | undefined;

/** The fixture directory `name` (npm, pnpm, uv, cargo, …) with its files under their real names. */
export function fixture(name: string): string {
  if (!copy) {
    copy = mkdtempSync(join(tmpdir(), "guardbee-lockfiles-"));
    cpSync(SOURCE, copy, { recursive: true });
    for (const dir of readdirSync(copy)) {
      for (const file of readdirSync(join(copy, dir))) {
        if (file.endsWith(".fixture")) renameSync(join(copy, dir, file), join(copy, dir, file.slice(0, -".fixture".length)));
      }
    }
  }
  return join(copy, name);
}
