import type { DataMatch } from "./fingerprints.js";
import type { Label } from "./labels.js";

export type TaintMode = "strict" | "approve" | "warn" | "off";
/** capability: tool labels decide; data: the egress arguments must carry data the session saw. */
export type TaintBasis = "capability" | "data";

export interface TaintSnapshot {
  sawUntrusted: boolean;
  sawSensitive: boolean;
}

/**
 * Tracks which legs of the lethal trifecta a session has already touched.
 * Flags only ever turn on: once the model has read untrusted content, every
 * later decision it makes may be steered by that content.
 */
export class TaintTracker {
  private untrustedFrom: string | null = null;
  private sensitiveFrom: string | null = null;

  get sawUntrusted(): boolean {
    return this.untrustedFrom !== null;
  }

  get sawSensitive(): boolean {
    return this.sensitiveFrom !== null;
  }

  /** Both data legs are open: an egress call now would complete the trifecta. */
  get tainted(): boolean {
    return this.sawUntrusted && this.sawSensitive;
  }

  /** Record what a tool result (or resource read) brought into the model's context. */
  observe(source: string, labels: readonly Label[], piiFound: boolean): void {
    if (labels.includes("untrusted") && !this.untrustedFrom) this.untrustedFrom = source;
    if ((labels.includes("sensitive") || piiFound) && !this.sensitiveFrom) this.sensitiveFrom = source;
  }

  completesTrifecta(labels: readonly Label[]): boolean {
    return labels.includes("egress") && this.tainted;
  }

  describe(egressTool: string): string {
    return (
      `Toxic flow (lethal trifecta): untrusted content from "${this.untrustedFrom}" and ` +
      `sensitive data from "${this.sensitiveFrom}" are in this session, and "${egressTool}" can send data out`
    );
  }

  /** The toxic flow with its evidence: which earlier result the outgoing data came from. */
  describeData(egressTool: string, match: DataMatch): string {
    const what = match.kind === "pii" ? "personal data or a credential" : match.kind === "id" ? "an identifier" : "text";
    return (
      `Toxic flow (data): ${what} from "${match.source}" is in the arguments of "${egressTool}", which can send data out` +
      (this.untrustedFrom ? `, and untrusted content from "${this.untrustedFrom}" is in this session` : "")
    );
  }

  snapshot(): TaintSnapshot {
    return { sawUntrusted: this.sawUntrusted, sawSensitive: this.sawSensitive };
  }
}
