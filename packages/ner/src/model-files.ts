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
  /** Hugging Face repository. */
  repo: string;
  /** A commit, never a branch: the files below are checked against these hashes. */
  revision: string;
  files: ModelFile[];
  /** Model entity types to keep, and the detector name each one becomes. */
  types: Record<string, string>;
}

/**
 * akdeniz27/bert-base-turkish-cased-ner, int8-quantized (MIT): BERTurk
 * fine-tuned on a reviewed Turkish news NER set. Picked on the pii-bench
 * numbers (packages/pii-bench, "Choosing the NER model"): tied with the best
 * candidate on names, with a documented training set and test results.
 */
export const DEFAULT_MODEL: ModelSpec = {
  repo: "akdeniz27/bert-base-turkish-cased-ner-quantized",
  revision: "fb6a421c9d97b3370d19e84cad3af4cfcbda5274",
  files: [
    { path: "config.json", sha256: "5c667760725113aa12371e2388c99c344f5b2a37049ec43b31eba5a1e8adf8b9", size: 966 },
    { path: "tokenizer.json", sha256: "65ef5a17a6dd815398d703d17a66a3ca5e1c87dd89baf69cba64f108f16a3cbd", size: 754_624 },
    { path: "tokenizer_config.json", sha256: "0804ad6d0c85866d81b013da3036f29bc590b5deb16e5ee1df5ffbd6eb42f91a", size: 412 },
    { path: "model_quantized.onnx", sha256: "0c405f17cb12fcfc4b5bd880b85fc07a42ad782f6b12666c5dd85f313fb05225", size: 185_521_291 },
  ],
  types: { PER: "person_name" },
};

/** Where downloaded models live: GUARDBEE_NER_CACHE, else ~/.cache/guardbee/ner. */
export function defaultModelDir(spec: ModelSpec = DEFAULT_MODEL): string {
  const root = process.env["GUARDBEE_NER_CACHE"] || join(homedir(), ".cache", "guardbee", "ner");
  return join(root, `${spec.repo.replace("/", "--")}@${spec.revision.slice(0, 12)}`);
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
 * Download the model's files into `dir` at the pinned revision, checking each
 * against its hash before it is moved into place. Files already there and
 * intact are kept.
 */
export async function downloadModel(dir: string = defaultModelDir(), spec: ModelSpec = DEFAULT_MODEL, log: (line: string) => void = () => {}): Promise<string> {
  for (const file of spec.files) {
    if (!(await verifyModel(dir, { ...spec, files: [file] })).length) continue;
    const target = join(dir, file.path);
    const partial = `${target}.partial`;
    mkdirSync(dirname(target), { recursive: true });
    const url = `https://huggingface.co/${spec.repo}/resolve/${spec.revision}/${file.path}`;
    log(`downloading ${file.path} (${(file.size / 1e6).toFixed(1)} MB)`);
    const response = await fetch(url);
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
