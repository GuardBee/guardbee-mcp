import { describe, it, expect } from "vitest";
import { scanText } from "../scanner.js";

function idsOf(text: string): string[] {
  return scanText(text).map((f) => f.patternId);
}

describe("scanText — missing max_tokens", () => {
  it("yakalar: max_tokens/max_completion_tokens hiç yok (gerçek bir agent loop alıntısından)", () => {
    const code = `reply = client.chat.completions.create(model=MODEL, messages=messages, tools=TOOLS)`;
    expect(idsOf(code)).toContain("openai_chat_completion_missing_max_tokens");
  });

  it("max_tokens verilmişse yakalamaz", () => {
    const code = `reply = client.chat.completions.create(model=MODEL, messages=messages, max_tokens=300)`;
    expect(idsOf(code)).not.toContain("openai_chat_completion_missing_max_tokens");
  });

  it("max_completion_tokens verilmişse yakalamaz (o1+ reasoning model şekli)", () => {
    const code = `client.chat.completions.create(model="o1", messages=messages, max_completion_tokens=500)`;
    expect(idsOf(code)).not.toContain("openai_chat_completion_missing_max_tokens");
  });

  it("Anthropic .messages.create çağrısını hiç kontrol etmez (SDK zaten max_tokens'ı zorunlu kılıyor)", () => {
    const code = `client.messages.create(model="claude-opus-4", messages=messages)`;
    expect(idsOf(code)).not.toContain("openai_chat_completion_missing_max_tokens");
  });
});

describe("scanText — missing timeout on raw HTTP call to LLM endpoint", () => {
  it("yakalar: requests.post ile api.openai.com'a timeout'suz çağrı", () => {
    const code = `requests.post("https://api.openai.com/v1/chat/completions", json=payload)`;
    expect(idsOf(code)).toContain("raw_http_call_to_llm_endpoint_missing_timeout");
  });

  it("timeout verilmişse yakalamaz", () => {
    const code = `requests.post("https://api.openai.com/v1/chat/completions", json=payload, timeout=30)`;
    expect(idsOf(code)).not.toContain("raw_http_call_to_llm_endpoint_missing_timeout");
  });

  it("axios ile api.anthropic.com'a signal'sız çağrıyı yakalar", () => {
    const code = `await axios.post("https://api.anthropic.com/v1/messages", body);`;
    expect(idsOf(code)).toContain("raw_http_call_to_llm_endpoint_missing_timeout");
  });

  it("AbortController signal'i verilmişse yakalamaz", () => {
    const code = `await fetch("https://api.openai.com/v1/chat/completions", { body, signal: controller.signal });`;
    expect(idsOf(code)).not.toContain("raw_http_call_to_llm_endpoint_missing_timeout");
  });

  it("LLM endpoint'i ile ilgisiz bir fetch/requests çağrısını yakalamaz", () => {
    const code = `requests.post("https://internal.example.com/api/data", json=payload)`;
    expect(idsOf(code)).not.toContain("raw_http_call_to_llm_endpoint_missing_timeout");
  });
});

describe("scanText — unbounded tool-calling loop", () => {
  it("yakalar: gerçek alıntılanan agent loop şekli (dev.to, 70 satırlık agent örneği)", () => {
    const code = `
while True:
    reply = client.chat.completions.create(model=MODEL, messages=messages, tools=TOOLS)
    msg = reply.choices[0].message
    messages.append(msg)
    if not msg.tool_calls:
        return msg.content
    for call in msg.tool_calls:
        result = execute_tool(call)
        messages.append(result)
`;
    expect(idsOf(code)).toContain("unbounded_tool_calling_loop");
  });

  it("iteration cap ipucu varsa yakalamaz", () => {
    const code = `
iterations = 0
while True:
    if iterations >= MAX_ITERATIONS:
        break
    reply = client.chat.completions.create(model=MODEL, messages=messages, tools=TOOLS)
    msg = reply.choices[0].message
    if not msg.tool_calls:
        break
    iterations += 1
`;
    expect(idsOf(code)).not.toContain("unbounded_tool_calling_loop");
  });

  it("tool_calls'a hiç değinmeyen sıradan bir while(true) sunucu döngüsünü yakalamaz", () => {
    const code = `
while (true) {
  const conn = await server.accept();
  handleConnection(conn);
}
`;
    expect(idsOf(code)).not.toContain("unbounded_tool_calling_loop");
  });

  it("JS/TS while(true) + toolCalls şeklini de yakalar", () => {
    const code = `
while (true) {
  const reply = await client.chat.completions.create({ model, messages, tools });
  const msg = reply.choices[0].message;
  if (!msg.toolCalls) return msg.content;
}
`;
    expect(idsOf(code)).toContain("unbounded_tool_calling_loop");
  });
});

describe("scanText — unbounded retry loop", () => {
  it("yakalar: except + continue, attempt sayacı yok", () => {
    const code = `
while True:
    try:
        response = llm.call(prompt)
        break
    except Exception:
        continue
`;
    expect(idsOf(code)).toContain("unbounded_retry_loop");
  });

  it("attempt sayacı varsa yakalamaz", () => {
    const code = `
attempts = 0
while True:
    try:
        response = llm.call(prompt)
        break
    except Exception:
        attempts += 1
        if attempts > max_retries:
            raise
        continue
`;
    expect(idsOf(code)).not.toContain("unbounded_retry_loop");
  });

  it("continue içermeyen bir except bloğunu yakalamaz (hata zaten yukarı fırlatılıyor)", () => {
    const code = `
while True:
    try:
        response = llm.call(prompt)
        break
    except Exception as e:
        raise e
`;
    expect(idsOf(code)).not.toContain("unbounded_retry_loop");
  });

  it("JS/TS catch + continue şeklini de yakalar", () => {
    const code = `
while (true) {
  try {
    const response = await llm.call(prompt);
    break;
  } catch (err) {
    continue;
  }
}
`;
    expect(idsOf(code)).toContain("unbounded_retry_loop");
  });
});

describe("scanText — disabled framework safety limits", () => {
  it("yakalar: LangChain AgentExecutor max_iterations=None (gerçek kaynağın _should_continue'una göre kapağı tamamen kaldırır)", () => {
    const code = `agent_executor = AgentExecutor(agent=agent, tools=tools, max_iterations=None)`;
    expect(idsOf(code)).toContain("langchain_max_iterations_disabled");
  });

  it("sayısal bir max_iterations değerini yakalamaz", () => {
    const code = `agent_executor = AgentExecutor(agent=agent, tools=tools, max_iterations=15)`;
    expect(idsOf(code)).not.toContain("langchain_max_iterations_disabled");
  });

  it("yakalar: openai-agents-python Runner.run max_turns=None (SDK issue #551'de doğrulandı)", () => {
    const code = `result = await Runner.run(agent, input, max_turns=None)`;
    expect(idsOf(code)).toContain("openai_agents_max_turns_disabled");
  });

  it("sayısal bir max_turns değerini yakalamaz", () => {
    const code = `result = await Runner.run(agent, input, max_turns=10)`;
    expect(idsOf(code)).not.toContain("openai_agents_max_turns_disabled");
  });
});

describe("scanText — MCP tool handler with no visible rate limiting", () => {
  it("yakalar: server.tool() handler'ı billable bir LLM çağrısı yapıyor, rate limit izi yok", () => {
    const code = `
server.tool("summarize", "Summarizes text", { text: z.string() }, async ({ text }) => {
  const res = await openai.chat.completions.create({ model: "gpt-4o", messages: [{ role: "user", content: text }] });
  return { content: [{ type: "text", text: res.choices[0].message.content }] };
});
`;
    expect(idsOf(code)).toContain("mcp_tool_billable_call_no_rate_limit");
  });

  it("rate limiter izi varsa yakalamaz", () => {
    const code = `
server.tool("summarize", "Summarizes text", { text: z.string() }, async ({ text }, extra) => {
  await limiter.check(extra.callerId);
  const res = await openai.chat.completions.create({ model: "gpt-4o", messages: [{ role: "user", content: text }] });
  return { content: [{ type: "text", text: res.choices[0].message.content }] };
});
`;
    expect(idsOf(code)).not.toContain("mcp_tool_billable_call_no_rate_limit");
  });

  it("billable bir çağrı içermeyen bir tool handler'ı yakalamaz", () => {
    const code = `
server.tool("get_time", "Returns the current time", {}, async () => {
  return { content: [{ type: "text", text: new Date().toISOString() }] };
});
`;
    expect(idsOf(code)).not.toContain("mcp_tool_billable_call_no_rate_limit");
  });

  it("Python @mcp.tool() dekoratörlü handler'ı da yakalar", () => {
    const code = `
@mcp.tool()
def summarize(text: str) -> str:
    res = openai.chat.completions.create(model="gpt-4o", messages=[{"role": "user", "content": text}])
    return res.choices[0].message.content
`;
    expect(idsOf(code)).toContain("mcp_tool_billable_call_no_rate_limit");
  });
});
