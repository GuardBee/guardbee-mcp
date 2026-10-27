import { describe, expect, it } from "vitest";
import { runBypass } from "../bypass.js";

describe("bypass suite", () => {
  const { rows, clean } = runBypass();

  it("masks every in-scope form of every identifier", () => {
    const leaks = rows.filter((row) => !row.outOfScope && row.leaked.length > 0).map((row) => `${row.technique}: ${row.leaked.join(", ")}`);
    expect(leaks).toEqual([]);
  });

  it("leaves encoded-looking text with nothing personal unchanged", () => {
    expect(clean.filter((c) => c.changed).map((c) => c.name)).toEqual([]);
  });
});
