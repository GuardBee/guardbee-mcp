#!/usr/bin/env node
import { parseArgs } from "node:util";
import { DEFAULT_MODEL, defaultModelDir, downloadModel, verifyModel } from "./model-files.js";

const USAGE = `guardbee-ner — local Turkish person-name detection for GuardBee

  guardbee-ner download [--dir <path>]     fetch the pinned model (~186 MB) and check its hashes
  guardbee-ner verify   [--dir <path>]     check a model directory against the pinned hashes
  guardbee-ner serve    [--dir <path>] [--port 8765] [--host 127.0.0.1]
                                           run the sidecar; GUARDBEE_NER_TOKEN requires a bearer token
  guardbee-ner detect   [--dir <path>] <text>
                                           print the names found in <text>

Model directory: --dir, else GUARDBEE_NER_CACHE, else ~/.cache/guardbee/ner.
Copy that directory to an offline host and point --dir at it.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    dir: { type: "string" },
    port: { type: "string", default: "8765" },
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
      const [{ NerModel }, { createNerServer }] = await Promise.all([import("./ner.js"), import("./server.js")]);
      const model = await NerModel.load({ dir });
      const token = process.env["GUARDBEE_NER_TOKEN"];
      const server = createNerServer(model, { ...(token ? { token } : {}), model: `${DEFAULT_MODEL.repo}@${DEFAULT_MODEL.revision.slice(0, 12)}` });
      server.listen(Number(values.port), values.host, () => console.error(`guardbee-ner listening on http://${values.host}:${values.port}`));
      return;
    }
    case "detect": {
      const { NerModel } = await import("./ner.js");
      const text = rest.join(" ");
      const [spans] = await (await NerModel.load({ dir })).detect([text]);
      for (const span of spans!) console.log(`${span.detector}\t${span.start}-${span.end}\t${text.slice(span.start, span.end)}`);
      return;
    }
    default:
      console.log(USAGE);
      if (!values.help) process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(`guardbee-ner: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
