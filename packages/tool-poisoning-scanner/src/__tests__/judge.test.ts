import { describe, expect, it } from "vitest";
import { join } from "path";
import { Judge, judgeFromEnv } from "@guardbee/guard-core";
import { judgeFiles } from "../judge.js";
import { buildSarif } from "../sarif.js";
import { scanFile } from "../scanner.js";

const FIXTURE = join(__dirname, "fixtures", "judge", "notes-server.ts");

/** A judge endpoint that answers by tool name. */
function fakeJudge(answers: Record<string, unknown>) {
  const asked: string[] = [];
  const fetch = async (_url: string, init?: RequestInit) => {
    const user = (JSON.parse(String(init?.body)) as { messages: { content: string }[] }).messages[1]!.content;
    const name = /^NAME: (.+)$/m.exec(user)![1]!;
    asked.push(name);
    return Response.json({ model: "fake-judge", system_fingerprint: "v1", choices: [{ message: { content: JSON.stringify(answers[name]) } }] });
  };
  return { judge: new Judge({ endpoint: "http://127.0.0.1:9/v1", model: "fake-judge" }, { fetch }), asked };
}

describe("LLM judge alignment check", () => {
  it("is not run by a plain scan, whose rules miss the outbound call", () => {
    // appendFile is a write the sink rules know; fetch to a third party is deliberately not a sink
    expect(scanFile(FIXTURE).findings.some((f) => f.patternId.startsWith("judge_"))).toBe(false);
  });

  it("flags a read-only tool whose handler writes a file and sends data out, and only that tool", async () => {
    const { judge, asked } = fakeJudge({
      summarize_notes: {
        aligned: false,
        undisclosed: [
          { behavior: "filesystem-write", evidence: "await appendFile(`${folder}/.summary-log`" },
          { behavior: "data-exfiltration", evidence: 'fetch("https://telemetry.notes-cloud.example/ingest"' },
        ],
        confidence: 0.9,
        reason: "It logs to a file and uploads the notes.",
      },
      count_words: { aligned: true, undisclosed: [], confidence: 0.95, reason: "" },
    });
    const findings = await judgeFiles([FIXTURE], judge);
    expect(asked).toEqual(["summarize_notes", "count_words"]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      patternId: "judge_description_behavior_mismatch",
      severity: "high",
      owasp: "MCP03:2025",
      line: 11,
      judge: { model: "fake-judge", version: "v1", confidence: 0.9 },
    });
    expect(findings[0]!.patternName).toContain("filesystem-write, data-exfiltration");
    const sarif = buildSarif("1.0.0", findings) as { runs: { results: { properties?: Record<string, unknown> }[] }[] };
    expect(sarif.runs[0]!.results[0]!.properties).toMatchObject({ judgeModel: "fake-judge", judgeModelVersion: "v1", judgeConfidence: 0.9 });
  });

  it("ignores low-confidence verdicts and skips tools the judge fails on", async () => {
    const errors: string[] = [];
    const { judge } = fakeJudge({
      summarize_notes: { aligned: false, undisclosed: [{ behavior: "filesystem-write", evidence: "appendFile(`${folder}/.summary-log`" }], confidence: 0.4, reason: "" },
      count_words: "not json",
    });
    expect(await judgeFiles([FIXTURE], judge, { onError: (tool) => errors.push(tool) })).toEqual([]);
    expect(errors).toEqual(["count_words"]);
  });

  // With a local model: GUARDBEE_JUDGE_URL=http://127.0.0.1:11434/v1 GUARDBEE_JUDGE_MODEL=qwen2.5:3b
  const live = judgeFromEnv();
  it.runIf(live)("a real model flags the fixture's misleading tool and not the honest one", async () => {
    const findings = await judgeFiles([FIXTURE], new Judge(live!));
    expect(findings.map((f) => f.match.split(":")[0])).toEqual(['tool "summarize_notes"']);
  }, 120_000);
});
