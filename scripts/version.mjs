#!/usr/bin/env node
// `changeset version`, then bring server.json along (see sync-server-json.mjs).
// The Release workflow's changesets/action calls this for the Version Packages PR.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

execFileSync("npx", ["changeset", "version"], { stdio: "inherit" });
execFileSync("node", [fileURLToPath(new URL("./sync-server-json.mjs", import.meta.url))], { stdio: "inherit" });
