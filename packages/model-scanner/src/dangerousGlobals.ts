export type GlobalRiskCategory =
  | "code-execution"
  | "process-execution"
  | "network"
  | "filesystem"
  | "reflection"
  | "deserialization";

export interface DangerousGlobalRule {
  module: string;
  /** Exact function/class name, or "*" to match any name from this module. */
  name: string;
  category: GlobalRiskCategory;
  severity: "critical" | "high" | "medium";
  recommendation: string;
}

/**
 * A pickled model file can reference arbitrary Python globals via GLOBAL/STACK_GLOBAL
 * opcodes; the interpreter resolves and typically calls them (via REDUCE) while
 * unpickling. None of these modules are needed to reconstruct tensors/weights — a
 * reference to any of them is a strong signal of a malicious payload, not a false
 * positive from normal ML deserialization.
 */
export const DANGEROUS_GLOBALS: DangerousGlobalRule[] = [
  {
    module: "os",
    name: "*",
    category: "process-execution",
    severity: "critical",
    recommendation:
      "The 'os' module reached during unpickling can run shell commands or manipulate the filesystem the instant the file is loaded. A legitimate ML checkpoint never needs it.",
  },
  {
    module: "posix",
    name: "*",
    category: "process-execution",
    severity: "critical",
    recommendation: "Same risk as 'os' — this is CPython's POSIX-only os-module implementation.",
  },
  {
    module: "nt",
    name: "*",
    category: "process-execution",
    severity: "critical",
    recommendation: "Same risk as 'os' — this is CPython's Windows-only os-module implementation.",
  },
  {
    module: "subprocess",
    name: "*",
    category: "process-execution",
    severity: "critical",
    recommendation: "Spawns an arbitrary process on load. Not part of any legitimate tensor/weight deserialization path.",
  },
  {
    module: "pty",
    name: "spawn",
    category: "process-execution",
    severity: "critical",
    recommendation: "Spawns an interactive shell on load.",
  },
  {
    module: "commands",
    name: "*",
    category: "process-execution",
    severity: "critical",
    recommendation: "Python 2 shell-command execution module.",
  },
  {
    module: "platform",
    name: "popen",
    category: "process-execution",
    severity: "critical",
    recommendation: "Runs a shell command via platform.popen on load.",
  },
  {
    module: "builtins",
    name: "eval",
    category: "code-execution",
    severity: "critical",
    recommendation: "Evaluates arbitrary Python source on load.",
  },
  {
    module: "__builtin__",
    name: "eval",
    category: "code-execution",
    severity: "critical",
    recommendation: "Evaluates arbitrary Python source on load (Python 2 builtins).",
  },
  {
    module: "builtins",
    name: "exec",
    category: "code-execution",
    severity: "critical",
    recommendation: "Executes arbitrary Python source on load.",
  },
  {
    module: "__builtin__",
    name: "exec",
    category: "code-execution",
    severity: "critical",
    recommendation: "Executes arbitrary Python source on load (Python 2 builtins).",
  },
  {
    module: "builtins",
    name: "compile",
    category: "code-execution",
    severity: "critical",
    recommendation: "Compiles arbitrary source into a code object — almost always chained into eval/exec.",
  },
  {
    module: "__builtin__",
    name: "compile",
    category: "code-execution",
    severity: "critical",
    recommendation: "Compiles arbitrary source into a code object (Python 2 builtins).",
  },
  {
    module: "builtins",
    name: "__import__",
    category: "code-execution",
    severity: "critical",
    recommendation: "Imports an arbitrary module by name at load time.",
  },
  {
    module: "__builtin__",
    name: "__import__",
    category: "code-execution",
    severity: "critical",
    recommendation: "Imports an arbitrary module by name at load time (Python 2 builtins).",
  },
  {
    module: "builtins",
    name: "getattr",
    category: "code-execution",
    severity: "high",
    recommendation:
      "A common gadget for indirectly reaching a dangerous attribute (e.g. __globals__, __builtins__) during unpickling.",
  },
  {
    module: "builtins",
    name: "open",
    category: "filesystem",
    severity: "high",
    recommendation:
      "Opens an arbitrary path on load; chained with a later write/read call this can exfiltrate or overwrite files.",
  },
  {
    module: "builtins",
    name: "input",
    category: "code-execution",
    severity: "medium",
    recommendation: "Unusual in a model file; can be used to hang or otherwise manipulate load-time behavior.",
  },
  {
    module: "runpy",
    name: "*",
    category: "code-execution",
    severity: "critical",
    recommendation: "Runs a module or script as __main__ on load.",
  },
  {
    module: "importlib",
    name: "*",
    category: "reflection",
    severity: "high",
    recommendation: "Can dynamically import and execute arbitrary modules at load time.",
  },
  {
    module: "ctypes",
    name: "*",
    category: "code-execution",
    severity: "critical",
    recommendation: "Loads and calls native code directly — bypasses the Python interpreter's process boundary entirely.",
  },
  {
    module: "socket",
    name: "*",
    category: "network",
    severity: "critical",
    recommendation: "Opens a raw network connection on load — a classic reverse-shell/exfiltration primitive.",
  },
  {
    module: "webbrowser",
    name: "open",
    category: "network",
    severity: "high",
    recommendation: "Opens a URL in a browser on load — can be used for phishing or to trigger another exploit chain.",
  },
  {
    module: "urllib.request",
    name: "urlopen",
    category: "network",
    severity: "high",
    recommendation: "Fetches an arbitrary URL on load — SSRF or payload-staging risk.",
  },
  {
    module: "urllib2",
    name: "urlopen",
    category: "network",
    severity: "high",
    recommendation: "Fetches an arbitrary URL on load (Python 2).",
  },
  {
    module: "requests",
    name: "*",
    category: "network",
    severity: "high",
    recommendation: "Makes an arbitrary HTTP request on load — commonly used to exfiltrate data or fetch a second-stage payload.",
  },
  {
    module: "http.client",
    name: "*",
    category: "network",
    severity: "medium",
    recommendation: "Low-level HTTP client reachable during unpickling — unusual for a model file.",
  },
  {
    module: "shutil",
    name: "*",
    category: "filesystem",
    severity: "high",
    recommendation: "Can delete, move, or overwrite arbitrary files/directories on load (e.g. shutil.rmtree).",
  },
  {
    module: "pickle",
    name: "loads",
    category: "deserialization",
    severity: "critical",
    recommendation:
      "Recursively deserializes another, nested pickle payload — a common technique for hiding the real payload from a shallow scan.",
  },
  {
    module: "marshal",
    name: "loads",
    category: "deserialization",
    severity: "critical",
    recommendation: "Loads a raw Python code object and can execute it directly — a classic Keras Lambda-layer and pickle exploit primitive.",
  },
  {
    module: "code",
    name: "InteractiveInterpreter",
    category: "code-execution",
    severity: "high",
    recommendation: "Can be used to build an interactive Python interpreter/eval loop at load time.",
  },
  {
    module: "multiprocessing",
    name: "*",
    category: "process-execution",
    severity: "medium",
    recommendation: "Can spawn additional processes at load time — unusual for weight deserialization.",
  },
];

/**
 * Modules that legitimate ML pickle streams routinely reference to reconstruct
 * tensors/arrays/objects (numpy dtypes, torch storage rebuilders, pandas/sklearn
 * estimator classes, etc). A prefix match keeps this list short instead of
 * enumerating every framework symbol.
 */
const SAFE_MODULE_PREFIXES = [
  "numpy",
  "torch",
  "collections",
  "copyreg",
  "_codecs",
  "sklearn",
  "scipy",
  "pandas",
  "xgboost",
  "lightgbm",
  "catboost",
  "joblib",
  "functools",
  "types",
  "argparse",
  "transformers",
  "huggingface_hub",
  "tokenizers",
  "safetensors",
];

const SAFE_BUILTIN_NAMES = new Set([
  "list",
  "dict",
  "tuple",
  "set",
  "frozenset",
  "bytearray",
  "bytes",
  "complex",
  "slice",
  "range",
  "object",
  "type",
  "str",
  "int",
  "float",
  "bool",
  "enumerate",
  "property",
  "staticmethod",
  "classmethod",
  "super",
]);

export interface GlobalClassification {
  status: "dangerous" | "unknown" | "safe";
  rule?: DangerousGlobalRule;
}

export function classifyGlobal(module: string, name: string): GlobalClassification {
  for (const rule of DANGEROUS_GLOBALS) {
    if (rule.module === module && (rule.name === "*" || rule.name === name)) {
      return { status: "dangerous", rule };
    }
  }

  if (module === "builtins" || module === "__builtin__") {
    return SAFE_BUILTIN_NAMES.has(name) ? { status: "safe" } : { status: "unknown" };
  }

  if (SAFE_MODULE_PREFIXES.some((p) => module === p || module.startsWith(p + "."))) {
    return { status: "safe" };
  }

  return { status: "unknown" };
}
