import { describe, expect, it } from "vitest";
import { combineWithClassifier, DEFAULT_CLASSIFIER_THRESHOLDS as T } from "../injection-classifier.js";

describe("combineWithClassifier", () => {
  it("never clears a rule's block", () => {
    expect(combineWithClassifier({ action: "block", reason: "rule" }, 0, T, "block", "m")).toEqual({ action: "block", reason: "rule" });
  });
  it("adds a block above blockAt (a warning in warn mode), a warning above warnAt", () => {
    expect(combineWithClassifier({ action: "allow" }, 0.95, T, "block", "m").action).toBe("block");
    expect(combineWithClassifier({ action: "allow" }, 0.95, T, "warn", "m").action).toBe("warn");
    expect(combineWithClassifier({ action: "allow" }, 0.6, T, "block", "m")).toMatchObject({ action: "warn", reason: expect.stringContaining("60%") });
    expect(combineWithClassifier({ action: "allow" }, 0.2, T, "block", "m")).toEqual({ action: "allow" });
  });
  it("keeps the rule's own warning when the score adds nothing", () => {
    expect(combineWithClassifier({ action: "warn", reason: "generic phrase" }, 0.6, T, "block", "m")).toEqual({ action: "warn", reason: "generic phrase" });
    expect(combineWithClassifier({ action: "warn", reason: "generic phrase" }, 0.95, T, "block", "m").action).toBe("block");
  });
});
