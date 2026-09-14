import { describe, it, expect } from "vitest";
import { scanText } from "../scanner.js";

function idsOf(text: string): string[] {
  return scanText(text).map((f) => f.patternId);
}

describe("scanText — openai_dangerously_allow_browser", () => {
  it("yakalar: dangerouslyAllowBrowser: true", () => {
    const code = `const client = new OpenAI({ apiKey: key, dangerouslyAllowBrowser: true });`;
    expect(idsOf(code)).toContain("openai_dangerously_allow_browser");
  });

  it("normal client init'i yakalamaz", () => {
    const code = `const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });`;
    expect(idsOf(code)).not.toContain("openai_dangerously_allow_browser");
  });
});

describe("scanText — client_bundled_ai_api_key", () => {
  it("yakalar: NEXT_PUBLIC_OPENAI_API_KEY", () => {
    expect(idsOf(`const key = process.env.NEXT_PUBLIC_OPENAI_API_KEY;`)).toContain(
      "client_bundled_ai_api_key"
    );
  });

  it("yakalar: VITE_ANTHROPIC_API_KEY", () => {
    expect(idsOf(`const key = import.meta.env.VITE_ANTHROPIC_API_KEY;`)).toContain(
      "client_bundled_ai_api_key"
    );
  });

  it("server-only env var'ı yakalamaz", () => {
    expect(idsOf(`const key = process.env.OPENAI_API_KEY;`)).not.toContain(
      "client_bundled_ai_api_key"
    );
  });

  it("AI olmayan bir client-bundled env var'ı yakalamaz", () => {
    expect(idsOf(`const url = process.env.NEXT_PUBLIC_API_URL;`)).not.toContain(
      "client_bundled_ai_api_key"
    );
  });
});

describe("scanText — eval_llm_output", () => {
  it("yakalar: eval(response.choices[0].message.content)", () => {
    const code = `const result = eval(response.choices[0].message.content);`;
    expect(idsOf(code)).toContain("eval_llm_output");
  });

  it("yakalar: new Function(completion.content)", () => {
    const code = `const fn = new Function(completion.content);`;
    expect(idsOf(code)).toContain("eval_llm_output");
  });

  it("normal eval kullanımını (LLM olmayan) yakalamaz", () => {
    const code = `const result = eval(userConfig.expression);`;
    expect(idsOf(code)).not.toContain("eval_llm_output");
  });
});

describe("scanText — exec_llm_output", () => {
  it("yakalar: execSync(message.content)", () => {
    const code = `const out = execSync(aiMessage.content);`;
    expect(idsOf(code)).toContain("exec_llm_output");
  });

  it("normal execSync kullanımını yakalamaz", () => {
    const code = `const out = execSync("git status");`;
    expect(idsOf(code)).not.toContain("exec_llm_output");
  });
});

describe("scanText — llm_output_dangerously_set_inner_html", () => {
  it("yakalar: dangerouslySetInnerHTML ile llm-ish değişken", () => {
    const code = `<div dangerouslySetInnerHTML={{ __html: aiResponse.content }} />`;
    expect(idsOf(code)).toContain("llm_output_dangerously_set_inner_html");
  });

  it("normal (LLM olmayan) dangerouslySetInnerHTML'i yakalamaz", () => {
    const code = `<div dangerouslySetInnerHTML={{ __html: sanitizedMarkdown }} />`;
    expect(idsOf(code)).not.toContain("llm_output_dangerously_set_inner_html");
  });
});

describe("scanText — llm_json_no_validation", () => {
  it("yakalar: JSON.parse(completion.content)", () => {
    const code = `const data = JSON.parse(completion.content);`;
    expect(idsOf(code)).toContain("llm_json_no_validation");
  });

  it("normal JSON.parse kullanımını yakalamaz", () => {
    const code = `const data = JSON.parse(fs.readFileSync("config.json", "utf8"));`;
    expect(idsOf(code)).not.toContain("llm_json_no_validation");
  });
});

describe("scanText — excessive_agency_tool_name", () => {
  it("yakalar: server.tool('execute_command', ...)", () => {
    const code = `server.tool("execute_command", "Runs a shell command", schema, handler);`;
    expect(idsOf(code)).toContain("excessive_agency_tool_name");
  });

  it("yakalar: name: 'run_shell' fonksiyon tanımında", () => {
    const code = `const tools = [{ name: "run_shell", description: "..." }];`;
    expect(idsOf(code)).toContain("excessive_agency_tool_name");
  });

  it("zararsız bir tool adını yakalamaz", () => {
    const code = `server.tool("get_weather", "Returns weather", schema, handler);`;
    expect(idsOf(code)).not.toContain("excessive_agency_tool_name");
  });
});

describe("scanText — unbounded_agent_loop", () => {
  it("yakalar: while(true) içinde chat.completions.create", () => {
    const code = `
      while (true) {
        const res = await openai.chat.completions.create({ model, messages });
      }
    `;
    expect(idsOf(code)).toContain("unbounded_agent_loop");
  });

  it("iterasyon sınırı olan bir döngüyü yakalamaz (uzak LLM çağrısı)", () => {
    const code = `
      for (let i = 0; i < maxIterations; i++) {
        const res = await openai.chat.completions.create({ model, messages });
      }
    `;
    expect(idsOf(code)).not.toContain("unbounded_agent_loop");
  });
});

describe("scanText — pii_field_in_llm_prompt", () => {
  it("yakalar: content template literal'inde email interpolasyonu", () => {
    const code = "const msg = { content: `Kullanıcı bilgisi: ${user.email}` };";
    expect(idsOf(code)).toContain("pii_field_in_llm_prompt");
  });

  it("yakalar: prompt içinde tcKimlik", () => {
    const code = "const prompt = `TC: ${customer.tcKimlik}`;";
    expect(idsOf(code)).toContain("pii_field_in_llm_prompt");
  });

  it("PII içermeyen bir content'i yakalamaz", () => {
    const code = "const msg = { content: `Sipariş durumu: ${order.status}` };";
    expect(idsOf(code)).not.toContain("pii_field_in_llm_prompt");
  });
});

describe("scanText — unsanitized_input_in_system_prompt", () => {
  it("yakalar: system rolünde req.body interpolasyonu", () => {
    const code = 'const messages = [{ role: "system", content: `Context: ${req.body.context}` }];';
    expect(idsOf(code)).toContain("unsanitized_input_in_system_prompt");
  });

  it("sabit bir system prompt'u yakalamaz", () => {
    const code = 'const messages = [{ role: "system", content: "You are a helpful assistant." }];';
    expect(idsOf(code)).not.toContain("unsanitized_input_in_system_prompt");
  });
});

describe("scanText — genel", () => {
  it("temiz kodda hiçbir bulgu döndürmez", () => {
    const code = `
      import OpenAI from "openai";
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      export async function ask(question: string) {
        const res = await client.chat.completions.create({
          model: "gpt-5",
          messages: [{ role: "user", content: question }],
        });
        return res.choices[0]?.message.content ?? "";
      }
    `;
    expect(scanText(code)).toEqual([]);
  });

  it("her bulgu recommendation ve category alanı içerir", () => {
    const code = `dangerouslyAllowBrowser: true`;
    const findings = scanText(code);
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.recommendation.length).toBeGreaterThan(10);
      expect(f.category).toBeTruthy();
    }
  });

  it("label verilirse file alanına yansır", () => {
    const findings = scanText(`dangerouslyAllowBrowser: true`, "src/ai.ts");
    expect(findings[0]?.file).toBe("src/ai.ts");
  });
});
