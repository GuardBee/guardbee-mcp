// Records the current GuardBee scores as the regression baseline. Run after an intended change:
//   pnpm --filter @guardbee/injection-bench exec tsx src/snapshot.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { regressionScores } from "./regression.js";

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "results", "regression.json");
fs.writeFileSync(file, JSON.stringify(await regressionScores(), null, 2) + "\n");
process.stdout.write(`wrote ${file}\n`);
