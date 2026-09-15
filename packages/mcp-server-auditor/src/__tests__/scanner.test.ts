import { describe, it, expect } from "vitest";
import { scanText } from "../scanner.js";

function idsOf(text: string): string[] {
  return scanText(text).map((f) => f.patternId);
}

describe("scanText — shell_exec_from_tool_input", () => {
  it("yakalar: execSync(input.command)", () => {
    expect(idsOf(`const out = execSync(input.command);`)).toContain("shell_exec_from_tool_input");
  });

  it("yakalar: spawn(params.cmd)", () => {
    expect(idsOf(`spawn(params.cmd, params.args);`)).toContain("shell_exec_from_tool_input");
  });

  it("sabit bir komut çalıştırmayı yakalamaz", () => {
    expect(idsOf(`execSync("ls -la /tmp");`)).not.toContain("shell_exec_from_tool_input");
  });
});

describe("scanText — eval_of_tool_input", () => {
  it("yakalar: eval(input.expression)", () => {
    expect(idsOf(`const result = eval(input.expression);`)).toContain("eval_of_tool_input");
  });

  it("yakalar: new Function(args.code)", () => {
    expect(idsOf(`const fn = new Function(args.code);`)).toContain("eval_of_tool_input");
  });

  it("sabit bir string'i eval etmeyi yakalamaz", () => {
    expect(idsOf(`const result = eval("1 + 1");`)).not.toContain("eval_of_tool_input");
  });
});

describe("scanText — unrestricted_shell_tool_name", () => {
  it("yakalar: server.tool(\"run_shell\", ...)", () => {
    expect(idsOf(`server.tool("run_shell", "runs a shell command", {}, handler);`)).toContain(
      "unrestricted_shell_tool_name"
    );
  });

  it("yakalar: .tool('execute_sql', ...)", () => {
    expect(idsOf(`server.tool('execute_sql', "runs SQL", {}, handler);`)).toContain(
      "unrestricted_shell_tool_name"
    );
  });

  it("zararsız bir tool adını yakalamaz", () => {
    expect(idsOf(`server.tool("query_table", "queries a table", {}, handler);`)).not.toContain(
      "unrestricted_shell_tool_name"
    );
  });
});

describe("scanText — fs_write_from_raw_tool_input", () => {
  it("yakalar: writeFileSync(input.path, data)", () => {
    expect(idsOf(`writeFileSync(input.path, data);`)).toContain("fs_write_from_raw_tool_input");
  });

  it("yakalar: unlinkSync(params.filePath)", () => {
    expect(idsOf(`unlinkSync(params.filePath);`)).toContain("fs_write_from_raw_tool_input");
  });

  it("sabit bir path'e yazmayı yakalamaz", () => {
    expect(idsOf(`writeFileSync("./out.log", data);`)).not.toContain("fs_write_from_raw_tool_input");
  });
});

describe("scanText — ssrf_fetch_from_tool_input", () => {
  it("yakalar: fetch(input.url)", () => {
    expect(idsOf(`await fetch(input.url);`)).toContain("ssrf_fetch_from_tool_input");
  });

  it("yakalar: axios.get(args.target)", () => {
    expect(idsOf(`await axios.get(args.target);`)).toContain("ssrf_fetch_from_tool_input");
  });

  it("sabit bir URL'e fetch'i yakalamaz", () => {
    expect(idsOf(`await fetch("https://api.guardbee.ai/status");`)).not.toContain(
      "ssrf_fetch_from_tool_input"
    );
  });
});

describe("scanText — sql_injection_via_tool_input", () => {
  it("yakalar: SELECT ... ${input.id}", () => {
    const code = "const sql = `SELECT * FROM users WHERE id = ${input.id}`;";
    expect(idsOf(code)).toContain("sql_injection_via_tool_input");
  });

  it("yakalar: DELETE ... ${params.table}", () => {
    const code = "const sql = `DELETE FROM ${params.table} WHERE id = 1`;";
    expect(idsOf(code)).toContain("sql_injection_via_tool_input");
  });

  it("parametrize edilmiş sorguyu yakalamaz", () => {
    const code = `const sql = "SELECT * FROM users WHERE id = $1"; db.query(sql, [input.id]);`;
    expect(idsOf(code)).not.toContain("sql_injection_via_tool_input");
  });
});

describe("scanText — overly_permissive_tool_schema", () => {
  it("yakalar: server.tool(...) içinde z.any()", () => {
    const code = `server.tool("update_row", "desc", { data: z.any() }, handler);`;
    expect(idsOf(code)).toContain("overly_permissive_tool_schema");
  });

  it("yakalar: z.unknown()", () => {
    const code = `server.tool("query_table", "desc", { filter: z.unknown() }, handler);`;
    expect(idsOf(code)).toContain("overly_permissive_tool_schema");
  });

  it("dar bir şemayı yakalamaz", () => {
    const code = `server.tool("query_table", "desc", { table: z.string() }, handler);`;
    expect(idsOf(code)).not.toContain("overly_permissive_tool_schema");
  });
});

describe("scanText — hardcoded_secret_in_tool_schema", () => {
  it("yakalar: apiKey: z.string().default(\"sk-...\")", () => {
    const code = `const schema = { apiKey: z.string().default("sk-1234567890abcdef") };`;
    expect(idsOf(code)).toContain("hardcoded_secret_in_tool_schema");
  });

  it("varsayılansız bir apiKey alanını yakalamaz", () => {
    const code = `const schema = { apiKey: z.string() };`;
    expect(idsOf(code)).not.toContain("hardcoded_secret_in_tool_schema");
  });

  it("PII olmayan kısa bir default'u yakalamaz", () => {
    const code = `const schema = { status: z.string().default("active") };`;
    expect(idsOf(code)).not.toContain("hardcoded_secret_in_tool_schema");
  });
});

describe("scanText — full_env_exposed_to_tool_caller", () => {
  it("yakalar: { ...process.env }", () => {
    expect(idsOf(`return { content: [{ type: "text", text: JSON.stringify({ ...process.env }) }] };`)).toContain(
      "full_env_exposed_to_tool_caller"
    );
  });

  it("yakalar: JSON.stringify(process.env)", () => {
    expect(idsOf(`const dump = JSON.stringify(process.env);`)).toContain("full_env_exposed_to_tool_caller");
  });

  it("yakalar: return process.env;", () => {
    expect(idsOf(`function getEnv() {\n  return process.env;\n}`)).toContain(
      "full_env_exposed_to_tool_caller"
    );
  });

  it("tek bir named env var okumasını yakalamaz", () => {
    expect(idsOf(`const key = process.env.DATABASE_URL;`)).not.toContain("full_env_exposed_to_tool_caller");
  });

  it("destructuring ile named var okumasını yakalamaz", () => {
    expect(idsOf(`const { DATABASE_URL, PORT } = process.env;`)).not.toContain(
      "full_env_exposed_to_tool_caller"
    );
  });
});

describe("scanText — permissive_cors_on_server", () => {
  it("yakalar: Access-Control-Allow-Origin: '*'", () => {
    expect(idsOf(`res.setHeader("Access-Control-Allow-Origin", "*");`)).toContain(
      "permissive_cors_on_server"
    );
  });

  it("yakalar: cors() (opsiyonsuz)", () => {
    expect(idsOf(`app.use(cors());`)).toContain("permissive_cors_on_server");
  });

  it("kısıtlı bir origin'i yakalamaz", () => {
    expect(idsOf(`app.use(cors({ origin: "https://guardbee.ai" }));`)).not.toContain(
      "permissive_cors_on_server"
    );
  });
});
