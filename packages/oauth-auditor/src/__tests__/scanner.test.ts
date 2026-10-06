import { describe, it, expect } from "vitest";
import { scanText } from "../scanner.js";

function idsOf(text: string): string[] {
  return scanText(text).map((f) => f.patternId);
}

describe("scanText — token passthrough", () => {
  it("yakalar: gelen Authorization header'ının değişmeden downstream'e forward edilmesi", () => {
    const code = `
const result = await fetch("https://downstream-api.example.com/data", {
  headers: { Authorization: req.headers.authorization },
});`;
    expect(idsOf(code)).toContain("token_passthrough_to_downstream");
  });

  it("bracket-notation header erişimini de yakalar", () => {
    const code = `await fetch(url, { headers: { Authorization: req.headers['authorization'] } });`;
    expect(idsOf(code)).toContain("token_passthrough_to_downstream");
  });

  it("token yeniden alınıp (exchange) kullanılırsa yakalamaz", () => {
    const code = `
const scopedToken = await exchangeToken(req.headers.authorization, "downstream-scope");
await fetch(url, { headers: { Authorization: \`Bearer \${scopedToken}\` } });`;
    expect(idsOf(code)).not.toContain("token_passthrough_to_downstream");
  });
});

describe("scanText — discovery SSRF", () => {
  it("yakalar: discovery URL'inin request'ten türetilmiş bir değerle kurulması", () => {
    const code = `
const config = await fetch(\`\${issuer}/.well-known/oauth-authorization-server?resource=\${req.query.resource}\`);`;
    expect(idsOf(code)).toContain("oauth_discovery_ssrf");
  });

  it("sabit, güvenilir bir issuer ile discovery yapılırsa yakalamaz", () => {
    const code = `const config = await fetch(\`https://auth.mycompany.com/.well-known/openid-configuration\`);`;
    expect(idsOf(code)).not.toContain("oauth_discovery_ssrf");
  });
});

describe("scanText — redirect_uri validation", () => {
  it("yakalar: redirect_uri'nin startsWith ile kontrol edilmesi", () => {
    const code = `if (!redirect_uri.startsWith(allowedPrefix)) throw new Error("bad redirect");`;
    expect(idsOf(code)).toContain("loose_redirect_uri_validation");
  });

  it("yakalar: redirect_uri'nin includes ile kontrol edilmesi", () => {
    const code = `const ok = allowedList.some(a => redirect_uri.includes(a));`;
    expect(idsOf(code)).toContain("loose_redirect_uri_validation");
  });

  it("tam eşitlik kontrolü yakalanmaz", () => {
    const code = `if (redirect_uri !== registeredRedirectUri) throw new Error("bad redirect");`;
    expect(idsOf(code)).not.toContain("loose_redirect_uri_validation");
  });
});

describe("scanText — hardcoded client secret", () => {
  it("yakalar: sabit bir client_secret literal'i", () => {
    const code = `const client_secret = "sk_live_abcdefgh12345678";`;
    expect(idsOf(code)).toContain("hardcoded_oauth_client_secret");
  });

  it("env'den okunan bir client_secret'i yakalamaz", () => {
    const code = `const client_secret = process.env.OAUTH_CLIENT_SECRET;`;
    expect(idsOf(code)).not.toContain("hardcoded_oauth_client_secret");
  });
});

describe("scanText — missing audience validation", () => {
  it("yakalar: audience seçeneği olmayan bir jwt.verify çağrısı", () => {
    const code = `const decoded = jwt.verify(token, publicKey, { algorithms: ["RS256"] });`;
    expect(idsOf(code)).toContain("missing_audience_validation");
  });

  it("2-argümanlı jwt.verify çağrısını da yakalar", () => {
    const code = `const decoded = jwt.verify(token, secret);`;
    expect(idsOf(code)).toContain("missing_audience_validation");
  });

  it("audience seçeneği olan bir jwt.verify çağrısını yakalamaz", () => {
    const code = `const decoded = jwt.verify(token, publicKey, { algorithms: ["RS256"], audience: "https://my-mcp-server.example.com" });`;
    expect(idsOf(code)).not.toContain("missing_audience_validation");
  });

  it("yakalar: audience= olmayan PyJWT jwt.decode", () => {
    const code = `decoded = jwt.decode(token, key, algorithms=["RS256"])`;
    expect(idsOf(code)).toContain("python_missing_audience_validation");
  });

  it("audience= olan PyJWT jwt.decode yakalamaz", () => {
    const code = `decoded = jwt.decode(token, key, algorithms=["RS256"], audience="https://mcp.example.com")`;
    expect(idsOf(code)).not.toContain("python_missing_audience_validation");
  });
});

describe("scanText — Python OAuth patterns", () => {
  it("yakalar: requests ile Authorization passthrough", () => {
    const code = `requests.get(url, headers={"Authorization": request.headers["authorization"]})`;
    expect(idsOf(code)).toContain("python_token_passthrough_to_downstream");
  });

  it("yakalar: redirect_uri.startswith", () => {
    const code = `if redirect_uri.startswith(allowed): pass`;
    expect(idsOf(code)).toContain("python_loose_redirect_uri_validation");
  });
});

describe("scanText — missing PKCE", () => {
  it("yakalar: code_challenge olmadan response_type=code içeren bir authorization URL'i", () => {
    const code = `const authUrl = \`https://auth.example.com/authorize?response_type=code&client_id=\${clientId}&redirect_uri=\${redirectUri}\`;`;
    expect(idsOf(code)).toContain("missing_pkce_on_auth_request");
  });

  it("code_challenge içeren bir authorization URL'ini yakalamaz", () => {
    const code = `const authUrl = \`https://auth.example.com/authorize?response_type=code&client_id=\${clientId}&code_challenge=\${challenge}&code_challenge_method=S256\`;`;
    expect(idsOf(code)).not.toContain("missing_pkce_on_auth_request");
  });
});

describe("scanText — genel", () => {
  it("güvenli/doğru yazılmış bir OAuth akışında hiçbir bulgu döndürmez", () => {
    const code = `
const authUrl = \`https://auth.example.com/authorize?response_type=code&client_id=\${clientId}&code_challenge=\${challenge}&code_challenge_method=S256&redirect_uri=\${encodeURIComponent(registeredRedirectUri)}\`;

function validateRedirect(candidate) {
  return candidate === registeredRedirectUri;
}

const decoded = jwt.verify(token, publicKey, { algorithms: ["RS256"], audience: "https://my-mcp-server.example.com", issuer: "https://auth.example.com" });

const clientSecret = process.env.OAUTH_CLIENT_SECRET;

const oidcConfig = await fetch("https://auth.example.com/.well-known/openid-configuration");
`;
    expect(scanText(code)).toHaveLength(0);
  });

  it("her bulgu recommendation içerir", () => {
    const findings = scanText(`const client_secret = "sk_live_abcdefgh12345678";`);
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) expect(f.recommendation.length).toBeGreaterThan(10);
  });

  it("label verilirse file alanına yansır", () => {
    const findings = scanText(`const client_secret = "sk_live_abcdefgh12345678";`, "oauth.ts");
    expect(findings[0]?.file).toBe("oauth.ts");
  });
});
