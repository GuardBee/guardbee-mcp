import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface ModelFile {
  path: string;
  sha256: string;
  size: number;
}

export interface ModelSpec {
  /** Model id and version, as audit events and SARIF report it. */
  id: string;
  /** Where the files are downloaded from: `${baseUrl}/${path}`. Immutable (a release, never a branch). */
  baseUrl: string;
  files: ModelFile[];
}

/**
 * GuardBee's injection classifier: intfloat/multilingual-e5-small (MIT) fine-tuned
 * on English and Turkish prompt injections, jailbreaks and benign prompts,
 * int8-quantized ONNX. Training data and numbers: packages/injection-model/README.md.
 */
export const DEFAULT_MODEL: ModelSpec = {
  id: "guardbee/injection-classifier-tr-en@0.1.0",
  baseUrl: "https://github.com/GuardBee/guardbee-mcp/releases/download/injection-model-v0.1.0",
  files: [
    { path: "config.json", sha256: "37408ed762cefcc6c4a23db99d4fe690f3ca28ea58b6e895154000dbcefca0ba", size: 939 },
    { path: "tokenizer.json", sha256: "41621bfd5ef0f4b2914cb0224f08a63a208ff71283fee803bfd251e2e2b7388d", size: 17_082_890 },
    { path: "tokenizer_config.json", sha256: "f6d356fe7682af6408f2b37dea63ce584d3f4c35f27e0e410dc268cbe333120a", size: 598 },
    { path: "model_quantized.onnx", sha256: "912ffe90f611b729917f9e7f1e0c13d0dd55d6d880ac05be0eec2fed0a28e325", size: 118_243_085 },
  ],
};

/** Where downloaded models live: GUARDBEE_INJECTION_MODEL_CACHE, else ~/.cache/guardbee/injection-model. */
export function defaultModelDir(spec: ModelSpec = DEFAULT_MODEL): string {
  const root = process.env["GUARDBEE_INJECTION_MODEL_CACHE"] || join(homedir(), ".cache", "guardbee", "injection-model");
  return join(root, spec.id.replace(/[^\w.-]+/g, "--"));
}

async function sha256Of(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** Files missing from `dir` or not matching their hash. */
export async function verifyModel(dir: string, spec: ModelSpec = DEFAULT_MODEL): Promise<string[]> {
  const bad: string[] = [];
  for (const file of spec.files) {
    const path = join(dir, file.path);
    if (!existsSync(path) || statSync(path).size !== file.size || (await sha256Of(path)) !== file.sha256) bad.push(file.path);
  }
  return bad;
}

/**
 * Download the model's files into `dir`, checking each against its pinned
 * hash before it is moved into place. Files already there and intact are kept.
 * This is the only network access; loading and scoring are offline.
 */
export async function downloadModel(dir: string = defaultModelDir(), spec: ModelSpec = DEFAULT_MODEL, log: (line: string) => void = () => {}): Promise<string> {
  for (const file of spec.files) {
    if (!(await verifyModel(dir, { ...spec, files: [file] })).length) continue;
    const target = join(dir, file.path);
    const partial = `${target}.partial`;
    mkdirSync(dirname(target), { recursive: true });
    log(`downloading ${file.path} (${(file.size / 1e6).toFixed(1)} MB)`);
    const response = await fetch(`${spec.baseUrl}/${file.path}`);
    if (!response.ok || !response.body) throw new Error(`download of ${file.path} failed: HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), createWriteStream(partial));
    const digest = await sha256Of(partial);
    if (digest !== file.sha256) {
      rmSync(partial, { force: true });
      throw new Error(`${file.path} does not match its pinned hash (got ${digest})`);
    }
    renameSync(partial, target);
  }
  return dir;
}
