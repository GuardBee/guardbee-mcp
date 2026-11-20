import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

/** This package's version, from its package.json next to dist/. */
export function packageVersion(): string {
  try {
    const dir = dirname(fileURLToPath(import.meta.url));
    return (JSON.parse(readFileSync(resolve(dir, "../package.json"), "utf8")) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}
