#!/usr/bin/env node
import { parseArgs } from "node:util";
import { DEFAULT_MODEL, defaultModelDir, downloadModel, verifyModel } from "./model-files.js";

const USAGE = `guardbee-injection-model — local prompt-injection / jailbreak classifier (Turkish + English) for GuardBee

  guardbee-injection-model download [--dir <path>]     fetch the pinned model and check its hashes
  guardbee-injection-model verify   [--dir <path>]     check a model directory against the pinned hashes
  guardbee-injection-model serve    [--dir <path>] [--port 8766] [--host 127.0.0.1]
                                                       run the sidecar; GUARDBEE_INJECTION_MODEL_TOKEN requires a bearer token
  guardbee-injection-model classify [--dir <path>] <text>
                                                       print P(injection) for <text>

Model directory: --dir, else GUARDBEE_INJECTION_MODEL_CACHE, else ~/.cache/guardbee/injection-model.
Copy that directory to an offline host and point --dir at it.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    dir: { type: "string" },
    port: { type: "string", default: "8766" },
    host: { type: "string", default: "127.0.0.1" },
    help: { type: "boolean", short: "h" },
  },
});

const [command, ...rest] = positionals;
const dir = values.dir ?? defaultModelDir();

async function main(): Promise<void> {
  switch (values.help ? undefined : command) {
    case "download":
      await downloadModel(dir, DEFAULT_MODEL, (line) => console.error(line));
      console.log(dir);
      return;
    case "verify": {
      const bad = await verifyModel(dir);
      if (bad.length > 0) throw new Error(`missing or altered in ${dir}: ${bad.join(", ")}`);
      console.log(`ok: ${dir}`);
      return;
    }
    case "serve": {
      const [{ InjectionModel }, { createClassifierServer }] = await Promise.all([import("./model.js"), import("./server.js")]);
      const model = await InjectionModel.load({ dir });
      const token = process.env["GUARDBEE_INJECTION_MODEL_TOKEN"];
      const server = createClassifierServer(model, { ...(token ? { token } : {}), model: model.model });
      server.listen(Number(values.port), values.host, () => console.error(`guardbee-injection-model listening on http://${values.host}:${values.port}`));
      return;
    }
    case "classify": {
      const { InjectionModel } = await import("./model.js");
      const [score] = await (await InjectionModel.load({ dir })).classify([rest.join(" ")]);
      console.log(score!.toFixed(4));
      return;
    }
    default:
      console.log(USAGE);
      if (!values.help) process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(`guardbee-injection-model: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
