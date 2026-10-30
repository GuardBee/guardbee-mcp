import { closeSync, openSync, readSync, statSync } from "fs";
import { basename } from "path";
import { kerasConfigFindings } from "./h5Scanner.js";
import { pbMessages, pbString } from "./protobuf.js";
import type { Finding } from "./scanner.js";

const MAX_GRAPH_BYTES = 512 * 1024 * 1024;
const MAX_REPORTED_NODES = 5;

interface OpRisk {
  severity: Finding["severity"];
  category: string;
  why: string;
  /** Only risky when the node's attributes contain one of these (e.g. a file:// output stream). */
  whenAttr?: RegExp;
}

const FILE_DATASET = "Reads files from paths fixed in the graph or fed at run time; a model that should only compute on its inputs does not need it.";

/**
 * Graph ops that reach outside the tensor computation: reading or writing
 * files, calling into Python, or sending data out. Checkpoint save/restore ops
 * are left out because every SavedModel carries them.
 */
export const RISKY_TF_OPS: Record<string, OpRisk> = {
  WriteFile: { severity: "critical", category: "filesystem", why: "Writes a file when the graph runs, for example dropping a script or overwriting configuration on the serving host." },
  ReadFile: { severity: "high", category: "filesystem", why: "Reads any file the serving process can access into a tensor, from where it can come back in model outputs." },
  MatchingFiles: { severity: "medium", category: "filesystem", why: "Lists files matching a glob on the serving host." },
  ImmutableConst: { severity: "medium", category: "filesystem", why: "Memory-maps a file at a path stored in the graph." },
  PyFunc: { severity: "high", category: "code-execution", why: "Calls a Python function registered in the loading process. It cannot be serialized, so its presence means the graph expects custom code at load time." },
  PyFuncStateless: { severity: "high", category: "code-execution", why: "Calls a Python function registered in the loading process." },
  EagerPyFunc: { severity: "high", category: "code-execution", why: "Calls a Python function registered in the loading process." },
  TextLineDataset: { severity: "medium", category: "filesystem", why: FILE_DATASET },
  TextLineDatasetV2: { severity: "medium", category: "filesystem", why: FILE_DATASET },
  TFRecordDataset: { severity: "medium", category: "filesystem", why: FILE_DATASET },
  TFRecordDatasetV2: { severity: "medium", category: "filesystem", why: FILE_DATASET },
  FixedLengthRecordDataset: { severity: "medium", category: "filesystem", why: FILE_DATASET },
  FixedLengthRecordDatasetV2: { severity: "medium", category: "filesystem", why: FILE_DATASET },
  CSVDataset: { severity: "medium", category: "filesystem", why: FILE_DATASET },
  CSVDatasetV2: { severity: "medium", category: "filesystem", why: FILE_DATASET },
  ExperimentalCSVDataset: { severity: "medium", category: "filesystem", why: FILE_DATASET },
  PrintV2: { severity: "medium", category: "filesystem", why: "Prints tensors to a file:// output stream, writing a file on the serving host.", whenAttr: /file:\/\// },
  DebugIdentity: { severity: "medium", category: "network", why: "Sends tensors to a debug URL (grpc:// or file://) whenever the graph runs.", whenAttr: /(grpc|file):\/\// },
  DebugIdentityV2: { severity: "medium", category: "network", why: "Sends tensors to a debug URL (grpc:// or file://) whenever the graph runs.", whenAttr: /(grpc|file):\/\// },
  DebugNanCount: { severity: "medium", category: "network", why: "Sends tensors to a debug URL (grpc:// or file://) whenever the graph runs.", whenAttr: /(grpc|file):\/\// },
  DebugNumericSummary: { severity: "medium", category: "network", why: "Sends tensors to a debug URL (grpc:// or file://) whenever the graph runs.", whenAttr: /(grpc|file):\/\// },
};

interface GraphNode {
  name: string;
  op: string;
  attrs: Buffer[];
  where: string;
}

/** NodeDefs of a GraphDef, including those inside its function library. */
function graphNodes(graphDef: Buffer, out: GraphNode[]): void {
  for (const node of pbMessages(graphDef, 1)) {
    out.push({ name: pbString(node, 1) ?? "?", op: pbString(node, 2) ?? "", attrs: pbMessages(node, 5), where: "graph" });
  }
  for (const library of pbMessages(graphDef, 2)) {
    for (const fn of pbMessages(library, 1)) {
      const sig = pbMessages(fn, 1)[0];
      const fnName = (sig && pbString(sig, 1)) ?? "?";
      for (const node of pbMessages(fn, 3)) {
        out.push({ name: pbString(node, 1) ?? "?", op: pbString(node, 2) ?? "", attrs: pbMessages(node, 5), where: `function ${fnName}` });
      }
    }
  }
}

function opFindings(nodes: GraphNode[], file: string, suffix = ""): Finding[] {
  const hits = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    const risk = RISKY_TF_OPS[n.op];
    if (!risk) continue;
    if (risk.whenAttr && !n.attrs.some((a) => risk.whenAttr!.test(a.toString("latin1")))) continue;
    hits.set(n.op, [...(hits.get(n.op) ?? []), n]);
  }
  return [...hits].map(([op, list]) => {
    const risk = RISKY_TF_OPS[op];
    const shown = list.slice(0, MAX_REPORTED_NODES).map((n) => `${n.name} (${n.where})`).join(", ");
    return {
      patternId: `tf_op_${op.toLowerCase()}`,
      patternName: `TensorFlow graph uses ${op}${suffix}`,
      category: risk.category,
      severity: risk.severity,
      recommendation: `${risk.why} Load this model only from a trusted source, or inspect what the op is wired to before serving it.`,
      file,
      line: 1,
      column: 1,
      match: `${list.length} node(s): ${shown}${list.length > MAX_REPORTED_NODES ? ", …" : ""}`,
      context: "",
    };
  });
}

function readWhole(filePath: string): { buf: Buffer; partial: boolean } {
  const size = statSync(filePath).size;
  const buf = Buffer.alloc(Math.min(size, MAX_GRAPH_BYTES));
  const fd = openSync(filePath, "r");
  try {
    readSync(fd, buf, 0, buf.length, 0);
  } finally {
    closeSync(fd);
  }
  return { buf, partial: buf.length < size };
}

function tooLarge(file: string): Finding {
  return {
    patternId: "tf_graph_too_large", patternName: "TensorFlow graph larger than the scan limit", category: "format-integrity", severity: "low",
    recommendation: `Only graphs up to ${MAX_GRAPH_BYTES / 1024 / 1024} MB are parsed; this one was not checked.`, file, line: 1, column: 1, match: "", context: "",
  };
}

/**
 * A SavedModel's saved_model.pb, a frozen GraphDef (.pb) or the text form
 * (.pbtxt). Returns null when a .pb is not a TensorFlow graph at all, since
 * the extension is shared with every other protobuf.
 */
export function scanTensorflowGraph(filePath: string): Finding[] | null {
  const { buf, partial } = readWhole(filePath);
  if (partial) return [tooLarge(filePath)];
  const name = basename(filePath);

  if (name.endsWith(".pbtxt")) {
    const text = buf.toString("utf8");
    if (!/\bnode\s*\{/.test(text) && !/\bmeta_graphs\s*\{/.test(text)) return null;
    const nodes: GraphNode[] = [];
    for (const m of text.matchAll(/\bname:\s*"([^"]*)"\s*op:\s*"(\w+)"/g)) nodes.push({ name: m[1], op: m[2], attrs: [Buffer.from(text)], where: "graph" });
    return opFindings(nodes, filePath);
  }

  if (name === "keras_metadata.pb") return kerasConfigFindings(buf.toString("latin1"), filePath);

  const nodes: GraphNode[] = [];
  try {
    if (name === "saved_model.pb") {
      for (const meta of pbMessages(buf, 2)) for (const graph of pbMessages(meta, 2)) graphNodes(graph, nodes);
    } else {
      graphNodes(buf, nodes);
    }
  } catch {
    if (name !== "saved_model.pb") return null;
    return [{
      patternId: "tf_saved_model_malformed", patternName: "saved_model.pb is not a valid protobuf", category: "format-integrity", severity: "medium",
      recommendation: "The file could not be parsed as a SavedModel. Verify it before loading.", file: filePath, line: 1, column: 1, match: "", context: "",
    }];
  }
  if (name !== "saved_model.pb" && (nodes.length === 0 || !nodes.every((n) => /^[A-Za-z_][\w>]*$/.test(n.op)))) return null;
  return opFindings(nodes, filePath);
}

/**
 * TensorFlow Lite: a flatbuffer whose builtin ops are all tensor math. Graph
 * ops reach it only through the Flex delegate, named "Flex<Op>" in the
 * custom op codes, so those names are what is checked.
 */
export function scanTfliteFile(filePath: string): Finding[] {
  const { buf, partial } = readWhole(filePath);
  if (buf.length < 8 || buf.toString("latin1", 4, 8) !== "TFL3") {
    return [{
      patternId: "tflite_bad_identifier", patternName: "File has a .tflite extension but no TFL3 identifier", category: "format-integrity", severity: "medium",
      recommendation: "The file does not carry the TensorFlow Lite flatbuffer identifier. Verify what it is before loading.", file: filePath, line: 1, column: 1, match: "", context: "",
    }];
  }
  const text = buf.toString("latin1");
  const nodes: GraphNode[] = [];
  for (const op of Object.keys(RISKY_TF_OPS)) {
    if (RISKY_TF_OPS[op].whenAttr) continue;
    if (new RegExp(`Flex${op}(?![A-Za-z0-9])`).test(text)) nodes.push({ name: `Flex${op}`, op, attrs: [], where: "Flex delegate" });
  }
  const findings = opFindings(nodes, filePath, " (TFLite Flex delegate)");
  if (partial) findings.push(tooLarge(filePath));
  return findings;
}

