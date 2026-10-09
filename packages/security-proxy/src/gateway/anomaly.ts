import { createHash } from "crypto";
import { stable } from "../interceptors/definition-drift.js";
import type { Label } from "./labels.js";

/**
 * Behavioural checks over one session's own calls. They catch what no single
 * call shows: an agent stuck in a loop or burning budget (call burst), one
 * reading a sensitive store record by record (sensitive sweep), one deleting
 * in bulk (destructive burst), and one probing the policy until something
 * gets through (repeated blocks).
 */
export type AnomalyKind = "call_burst" | "sensitive_sweep" | "destructive_burst" | "repeated_blocks";

export interface AnomalyWindow {
  /** The most events allowed within the window; one more trips the check. */
  count: number;
  windowSeconds: number;
}

export interface AnomalyConfig {
  enabled: boolean;
  /** `warn` logs the anomaly; `block` refuses the call — and after repeated blocks, the rest of the session. */
  action: "block" | "warn";
  callBurst?: AnomalyWindow;
  sensitiveSweep?: AnomalyWindow;
  destructiveBurst?: AnomalyWindow;
  repeatedBlocks?: AnomalyWindow;
}

export const ANOMALY_DEFAULTS: Record<AnomalyKind, AnomalyWindow> = {
  call_burst: { count: 60, windowSeconds: 60 },
  sensitive_sweep: { count: 25, windowSeconds: 300 },
  destructive_burst: { count: 5, windowSeconds: 60 },
  repeated_blocks: { count: 5, windowSeconds: 300 },
};

export interface Anomaly {
  kind: AnomalyKind;
  reason: string;
  /** First time the check tripped since it last fell below its threshold: log it. Later trips stay quiet. */
  fresh: boolean;
}

/** Timestamps inside a sliding window. */
class Window {
  private readonly times: number[] = [];
  private readonly keys: string[] = [];

  constructor(readonly limit: AnomalyWindow) {}

  /** Add an event and return how many are in the window (distinct keys when keys are given). */
  push(now: number, key = ""): number {
    this.prune(now);
    this.times.push(now);
    this.keys.push(key);
    return key ? new Set(this.keys).size : this.times.length;
  }

  private prune(now: number): void {
    const since = now - this.limit.windowSeconds * 1000;
    while (this.times.length > 0 && this.times[0]! <= since) {
      this.times.shift();
      this.keys.shift();
    }
  }
}

function argsKey(tool: string, args: Record<string, unknown>): string {
  return createHash("sha256").update(`${tool}\0${stable(args)}`).digest("hex");
}

const WHAT: Record<AnomalyKind, string> = {
  call_burst: "tool calls",
  sensitive_sweep: "different reads of sensitive tools",
  destructive_burst: "destructive tool calls",
  repeated_blocks: "blocked or refused calls",
};

export class AnomalyDetector {
  private readonly windows = new Map<AnomalyKind, Window>();
  /** Checks currently over their threshold, so a burst logs once rather than on every call. */
  private readonly firing = new Set<AnomalyKind>();
  private lockedReason: string | null = null;

  constructor(
    private readonly config: AnomalyConfig,
    private readonly now: () => number = Date.now,
  ) {
    const configured: Record<AnomalyKind, AnomalyWindow | undefined> = {
      call_burst: config.callBurst,
      sensitive_sweep: config.sensitiveSweep,
      destructive_burst: config.destructiveBurst,
      repeated_blocks: config.repeatedBlocks,
    };
    for (const kind of Object.keys(ANOMALY_DEFAULTS) as AnomalyKind[]) {
      this.windows.set(kind, new Window(configured[kind] ?? ANOMALY_DEFAULTS[kind]));
    }
  }

  get blocking(): boolean {
    return this.config.action === "block";
  }

  /** Set once repeated blocks tripped in `block` mode: every later call in the session is refused. */
  get locked(): string | null {
    return this.lockedReason;
  }

  /** Count a call the agent is about to make; returns the checks it trips. */
  observeCall(tool: string, labels: readonly Label[], args: Record<string, unknown>): Anomaly[] {
    const at = this.now();
    const found: Anomaly[] = [];
    this.check("call_burst", this.window("call_burst").push(at), tool, found);
    if (labels.includes("sensitive")) {
      // Distinct arguments: re-reading the same record is not a sweep.
      this.check("sensitive_sweep", this.window("sensitive_sweep").push(at, argsKey(tool, args)), tool, found);
    }
    if (labels.includes("destructive")) {
      this.check("destructive_burst", this.window("destructive_burst").push(at), tool, found);
    }
    return found;
  }

  /** Count a call the gateway blocked or the person refused. */
  observeBlocked(tool: string): Anomaly | null {
    const found: Anomaly[] = [];
    this.check("repeated_blocks", this.window("repeated_blocks").push(this.now()), tool, found);
    const anomaly = found[0] ?? null;
    if (anomaly && this.blocking && !this.lockedReason) {
      this.lockedReason = `${anomaly.reason}; the session is locked — start a new session`;
    }
    return anomaly;
  }

  private window(kind: AnomalyKind): Window {
    return this.windows.get(kind)!;
  }

  private check(kind: AnomalyKind, seen: number, tool: string, found: Anomaly[]): void {
    const { count, windowSeconds } = this.window(kind).limit;
    if (seen <= count) {
      this.firing.delete(kind);
      return;
    }
    const fresh = !this.firing.has(kind);
    this.firing.add(kind);
    found.push({
      kind,
      fresh,
      reason: `Anomaly (${kind}): ${seen} ${WHAT[kind]} in ${windowSeconds}s (limit ${count}), latest "${tool}"`,
    });
  }
}
