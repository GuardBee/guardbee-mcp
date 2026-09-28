import { describe, it, expect } from "vitest";
import { scanText } from "../scanner.js";

function idsOf(text: string): string[] {
  return scanText(text).map((f) => f.patternId);
}

describe("scanText — webhook SSRF (direct)", () => {
  it("yakalar: push-notification config'inin url'inin doğrudan fetch'e verilmesi", () => {
    const code = `const response = await fetch(pushConfig.url, { method: "POST", body: JSON.stringify(task) });`;
    expect(idsOf(code)).toContain("webhook_url_direct_fetch_no_allowlist");
  });

  it("yakalar: webhookConfig.url'in axios.post'a verilmesi", () => {
    const code = `await axios.post(webhookConfig.url, task);`;
    expect(idsOf(code)).toContain("webhook_url_direct_fetch_no_allowlist");
  });

  it("ilgisiz bir sabit URL'e yapılan fetch'i yakalamaz", () => {
    const code = `await fetch("https://api.example.com/data");`;
    expect(idsOf(code)).not.toContain("webhook_url_direct_fetch_no_allowlist");
  });
});

describe("scanText — webhook SSRF (indirect)", () => {
  it("yakalar: url değişkeninin pushConfig.url'den atanıp birkaç satır sonra fetch edilmesi (gerçek referans sender şekli)", () => {
    const code = `
class DefaultPushNotificationSender {
  async send(task, pushConfig) {
    const url = pushConfig.url;
    const response = await fetch(url, { method: "POST", body: JSON.stringify(task) });
  }
}`;
    expect(idsOf(code)).toContain("webhook_url_indirect_fetch_no_allowlist");
  });

  it("aradaki bir allowlist kontrolü varsa yakalamaz", () => {
    const code = `
const url = pushConfig.url;
if (!isAllowedHost(url)) throw new Error("blocked");
const response = await fetch(url, { method: "POST" });`;
    expect(idsOf(code)).not.toContain("webhook_url_indirect_fetch_no_allowlist");
  });

  it("push/webhook config'inden gelmeyen sıradan bir url değişkenini yakalamaz", () => {
    const code = `
const url = "https://api.example.com/data";
const response = await fetch(url);`;
    expect(idsOf(code)).not.toContain("webhook_url_indirect_fetch_no_allowlist");
  });
});

describe("scanText — no authentication (UserBuilder)", () => {
  it("yakalar: UserBuilder.noAuthentication kullanımı (resmi örnek agent'ın kendi şekli)", () => {
    const code = `app.use(jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));`;
    expect(idsOf(code)).toContain("no_authentication_user_builder");
  });

  it("özel bir userBuilder kullanılırsa yakalamaz", () => {
    const code = `app.use(jsonRpcHandler({ requestHandler, userBuilder: myBearerUserBuilder }));`;
    expect(idsOf(code)).not.toContain("no_authentication_user_builder");
  });
});

describe("scanText — empty Agent Card security (TS)", () => {
  it("yakalar: boş securitySchemes ve boş securityRequirements birlikte (resmi örnek agent'ın kendi şekli)", () => {
    const code = `
const movieAgentCard = {
  name: "Movie Agent",
  securitySchemes: {}, // Or define actual security schemes if any
  securityRequirements: [],
  capabilities: { streaming: true },
};`;
    expect(idsOf(code)).toContain("empty_agent_card_security");
  });

  it("dolu securitySchemes/securityRequirements'ı yakalamaz", () => {
    const code = `
const agentCard = {
  securityRequirements: [{ schemes: { Bearer: { list: [] } } }],
  securitySchemes: { Bearer: { scheme: { value: { scheme: "bearer" } } } },
};`;
    expect(idsOf(code)).not.toContain("empty_agent_card_security");
  });
});

describe("scanText — Python AgentCard no-auth", () => {
  it("yakalar: security_schemes/security_requirements kwarg'ları olmayan bir AgentCard() çağrısı (gerçek dice_agent örneği)", () => {
    const code = `
agent_card = AgentCard(
    name="Dice Agent", url=f"http://{host}:{port}/", version="1.0.0",
    capabilities=AgentCapabilities(streaming=True), skills=skills,
    preferred_transport=TransportProtocol.http_json,
)`;
    expect(idsOf(code)).toContain("python_agent_card_no_auth");
  });

  it("security_schemes verilmiş bir AgentCard() çağrısını yakalamaz", () => {
    const code = `
agent_card = AgentCard(
    name="Secure Agent",
    security_schemes={"Bearer": HTTPAuthSecurityScheme(scheme="bearer")},
    security_requirements=[SecurityRequirement(schemes={"Bearer": []})],
)`;
    expect(idsOf(code)).not.toContain("python_agent_card_no_auth");
  });
});

describe("scanText — Agent Card'a gömülü credential", () => {
  it("yakalar: agentCard nesnesi içine gömülü düz metin apiKey", () => {
    const code = `
const agentCard = {
  name: "Weather Agent",
  apiKey: "sk-live-abcdef1234567890",
  capabilities: { streaming: true },
};`;
    expect(idsOf(code)).toContain("agent_card_credential_in_metadata");
  });

  it("yakalar: bileşik isimli değişkende de (movieAgentCard) gömülü credential — camelCase word-boundary tuzağı", () => {
    const code = `
const movieAgentCard = {
  name: "Movie Agent",
  securitySchemes: {},
  apiKey: "sk-live-abcdef1234567890",
};`;
    expect(idsOf(code)).toContain("agent_card_credential_in_metadata");
  });

  it("securitySchemes kullanan (credential literal'i olmayan) bir agentCard'ı yakalamaz", () => {
    const code = `
const agentCard = {
  name: "Weather Agent",
  securitySchemes: { Bearer: { scheme: "bearer" } },
};`;
    expect(idsOf(code)).not.toContain("agent_card_credential_in_metadata");
  });
});

describe("scanText — genel", () => {
  it("güvenli/doğru yazılmış bir A2A agent'ında hiçbir bulgu döndürmez", () => {
    const code = `
const url = pushConfig.url;
if (!isAllowedHost(url)) throw new Error("blocked host");
await fetch(url, { method: "POST" });

const agentCard = {
  name: "Secure Agent",
  securitySchemes: { Bearer: { scheme: { value: { scheme: "bearer" } } } },
  securityRequirements: [{ schemes: { Bearer: { list: [] } } }],
};

app.use(jsonRpcHandler({ requestHandler, userBuilder: bearerUserBuilder }));
`;
    expect(scanText(code)).toHaveLength(0);
  });

  it("her bulgu recommendation içerir", () => {
    const findings = scanText(`await fetch(pushConfig.url, { method: "POST" });`);
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) expect(f.recommendation.length).toBeGreaterThan(10);
  });

  it("label verilirse file alanına yansır", () => {
    const findings = scanText(`await fetch(pushConfig.url, { method: "POST" });`, "agent.ts");
    expect(findings[0]?.file).toBe("agent.ts");
  });
});
