// Moved from secret-scanner so the runtime proxy masks the same provider formats the static scanner reports.
export interface SecretRule {
  id: string;
  name: string;
  pattern: RegExp;
  severity: "critical" | "high" | "medium" | "low";
  allowlist?: RegExp[]; // patterns that override (false positives)
  // Connection-string patterns match a whole URL, where a legitimate non-secret
  // component (e.g. an example.com/RFC-2606 hostname) can coincidentally contain
  // a placeholder word even though the credential itself is real — so the global
  // placeholder-value heuristic doesn't apply here; these already have their own
  // domain-specific allowlist above.
  skipPlaceholderCheck?: boolean;
  // Only for low-confidence, format-agnostic patterns (a keyword + any quoted
  // string, or "Bearer " + any token-ish string) — a fixed-format secret
  // (AKIA..., ghp_..., sk-...) found in a test file is exactly as real as one
  // found anywhere else, so this never applies to those.
  lowerSeverityInTestFiles?: boolean;
  /**
   * Format-agnostic or not actually secret (a keyword + any quoted string, any
   * 40-character base64 run, a publishable key). Fine for a code scanner that
   * shows the finding to a person; the runtime proxy does not mask on these,
   * because a false match would also mark the session as holding sensitive data.
   */
  broad?: boolean;
}

export const SECRET_RULES: SecretRule[] = [
  // ── Cloud providers ────────────────────────────────────────────────────────
  {
    id: "aws_access_key",
    name: "AWS Access Key ID",
    pattern: /\b(AKIA|ABIA|ACCA|AIPA|AKIA|ANPA|ANVA|APKA)[0-9A-Z]{16}\b/g,
    severity: "critical",
  },
  {
    id: "aws_secret_key",
    broad: true,
    name: "AWS Secret Access Key",
    pattern: /(?<![A-Za-z0-9/+])([A-Za-z0-9/+]{40})(?![A-Za-z0-9/+])/g,
    severity: "critical",
    allowlist: [/^[A-Za-z0-9+/]{40}={0,2}$/], // base64 payloads
  },
  {
    id: "google_api_key",
    name: "Google API Key",
    pattern: /AIza[0-9A-Za-z\-_]{35}/g,
    severity: "critical",
  },
  {
    id: "google_oauth",
    name: "Google OAuth Client Secret",
    pattern: /GOCSPX-[0-9A-Za-z\-_]{28}/g,
    severity: "critical",
  },

  // ── Version control & CI ───────────────────────────────────────────────────
  {
    id: "github_pat",
    name: "GitHub Personal Access Token",
    pattern: /ghp_[0-9A-Za-z]{36}/g,
    severity: "critical",
  },
  {
    id: "github_oauth",
    name: "GitHub OAuth Token",
    pattern: /gho_[0-9A-Za-z]{36}/g,
    severity: "critical",
  },
  {
    id: "github_app_token",
    name: "GitHub App Token",
    pattern: /ghs_[0-9A-Za-z]{36}/g,
    severity: "critical",
  },
  {
    id: "github_refresh_token",
    name: "GitHub Refresh Token",
    pattern: /ghr_[0-9A-Za-z]{36}/g,
    severity: "high",
  },
  {
    id: "gitlab_pat",
    name: "GitLab Personal Access Token",
    pattern: /glpat-[0-9A-Za-z\-_]{20}/g,
    severity: "critical",
  },

  // ── Payment ────────────────────────────────────────────────────────────────
  {
    id: "stripe_secret",
    name: "Stripe Secret Key (live)",
    pattern: /sk_live_[0-9A-Za-z]{24,}/g,
    severity: "critical",
  },
  {
    id: "stripe_secret_test",
    // Stripe'ın kendi dokümantasyonu test-mode key'lerini kod örneklerine
    // gömmenin güvenli olduğunu belirtiyor — gerçek parasal etkisi yok,
    // sadece sandbox hesabına erişim. Yine de görünürlük için raporlanıyor.
    name: "Stripe Secret Key (test mode)",
    pattern: /sk_test_[0-9A-Za-z]{24,}/g,
    severity: "low",
  },
  {
    id: "stripe_publishable",
    broad: true,
    name: "Stripe Publishable Key",
    pattern: /pk_(live|test)_[0-9A-Za-z]{24,}/g,
    severity: "medium",
  },
  {
    id: "stripe_restricted",
    name: "Stripe Restricted Key (live)",
    pattern: /rk_live_[0-9A-Za-z]{24,}/g,
    severity: "critical",
  },
  {
    id: "stripe_restricted_test",
    name: "Stripe Restricted Key (test mode)",
    pattern: /rk_test_[0-9A-Za-z]{24,}/g,
    severity: "low",
  },

  // ── AI / ML ────────────────────────────────────────────────────────────────
  {
    id: "openai_key",
    name: "OpenAI API Key",
    pattern: /sk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}/g,
    severity: "critical",
  },
  {
    id: "openai_key_v2",
    name: "OpenAI API Key (v2)",
    pattern: /sk-proj-[A-Za-z0-9\-_]{50,}/g,
    severity: "critical",
  },
  {
    id: "anthropic_key",
    name: "Anthropic API Key",
    pattern: /sk-ant-[A-Za-z0-9\-_]{32,}/g,
    severity: "critical",
  },
  {
    id: "huggingface_token",
    name: "HuggingFace Token",
    pattern: /hf_[A-Za-z0-9]{34}/g,
    severity: "high",
  },

  // ── Communication ──────────────────────────────────────────────────────────
  {
    id: "slack_token",
    name: "Slack Token",
    pattern: /xox[baprs]-([0-9a-zA-Z]{10,48})/g,
    severity: "critical",
  },
  {
    id: "slack_webhook",
    name: "Slack Webhook URL",
    pattern: /https:\/\/hooks\.slack\.com\/services\/T[0-9A-Z]{8}\/B[0-9A-Z]{8}\/[0-9a-zA-Z]{24}/g,
    severity: "high",
  },
  {
    id: "twilio_account_sid",
    broad: true,
    name: "Twilio Account SID",
    pattern: /AC[0-9a-f]{32}/g,
    severity: "high",
  },
  {
    id: "twilio_auth_token",
    name: "Twilio Auth Token",
    pattern: /[Tt][Ww][Ii][Ll][Ii][Oo].{0,20}[0-9a-f]{32}/g,
    severity: "critical",
  },
  {
    id: "sendgrid_key",
    name: "SendGrid API Key",
    pattern: /SG\.[0-9A-Za-z\-_]{22}\.[0-9A-Za-z\-_]{43}/g,
    severity: "critical",
  },

  // ── Database URLs ──────────────────────────────────────────────────────────
  {
    id: "db_url_postgres",
    name: "PostgreSQL Connection String with credentials",
    pattern: /postgres(?:ql)?:\/\/[^:]+:[^@\s]+@[^\s"']+/gi,
    severity: "critical",
    allowlist: [/localhost/, /127\.0\.0\.1/, /\$\{/, /<[^<>]{1,80}>/],
    skipPlaceholderCheck: true,
  },
  {
    id: "db_url_mysql",
    name: "MySQL Connection String with credentials",
    pattern: /mysql:\/\/[^:]+:[^@\s]+@[^\s"']+/gi,
    severity: "critical",
    allowlist: [/localhost/, /127\.0\.0\.1/, /\$\{/, /<[^<>]{1,80}>/],
    skipPlaceholderCheck: true,
  },
  {
    id: "db_url_mongodb",
    name: "MongoDB Connection String with credentials",
    pattern: /mongodb(?:\+srv)?:\/\/[^:]+:[^@\s]+@[^\s"']+/gi,
    severity: "critical",
    allowlist: [/localhost/, /127\.0\.0\.1/, /\$\{/, /<[^<>]{1,80}>/],
    skipPlaceholderCheck: true,
  },
  {
    id: "db_url_redis",
    name: "Redis Connection String with credentials",
    pattern: /redis:\/\/[^:]+:[^@\s]+@[^\s"']+/gi,
    severity: "high",
    allowlist: [/localhost/, /127\.0\.0\.1/, /\$\{/, /<[^<>]{1,80}>/],
    skipPlaceholderCheck: true,
  },

  // ── Private keys ───────────────────────────────────────────────────────────
  {
    id: "private_key_rsa",
    name: "RSA Private Key",
    pattern: /-----BEGIN RSA PRIVATE KEY-----/g,
    severity: "critical",
  },
  {
    id: "private_key_ec",
    name: "EC Private Key",
    pattern: /-----BEGIN EC PRIVATE KEY-----/g,
    severity: "critical",
  },
  {
    id: "private_key_openssh",
    name: "OpenSSH Private Key",
    pattern: /-----BEGIN OPENSSH PRIVATE KEY-----/g,
    severity: "critical",
  },
  {
    id: "private_key_generic",
    name: "Generic Private Key",
    pattern: /-----BEGIN PRIVATE KEY-----/g,
    severity: "critical",
  },
  {
    id: "pgp_private_key",
    name: "PGP Private Key Block",
    pattern: /-----BEGIN PGP PRIVATE KEY BLOCK-----/g,
    severity: "critical",
  },

  // ── Auth tokens & JWTs ─────────────────────────────────────────────────────
  {
    id: "jwt",
    name: "JSON Web Token",
    pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    severity: "high",
  },
  {
    id: "bearer_token",
    broad: true,
    name: "Bearer Token in code",
    // Gerçek bearer token'lar (JWT, OAuth2 opak token) neredeyse hiç 20
    // karakterin altına inmez — testlerdeki "Bearer alpha"/"Bearer test-token"
    // gibi kısa sahte değerleri eleyip gürültüyü büyük ölçüde azaltıyor.
    pattern: /['"](Bearer\s+[A-Za-z0-9\-._~+/]{20,}=*)['"]/gi,
    severity: "high",
    lowerSeverityInTestFiles: true,
  },

  // ── DevOps & infra ─────────────────────────────────────────────────────────
  {
    id: "npm_token",
    name: "npm Access Token",
    pattern: /npm_[A-Za-z0-9]{36}/g,
    severity: "critical",
  },
  {
    id: "docker_pat",
    name: "Docker Hub Personal Access Token",
    pattern: /dckr_pat_[A-Za-z0-9\-_]{27}/g,
    severity: "high",
  },
  {
    id: "vercel_token",
    broad: true,
    name: "Vercel API Token",
    pattern: /vercel(?:[._-])?(?:token|api)['":\s=]+([A-Za-z0-9]{24})/gi,
    severity: "high",
  },

  // ── More providers (formats from gitleaks, MIT, narrowed where a match ──────
  // would also hit ordinary data the proxy masks — e.g. no bare "EAAA" Square
  // prefix, which base64 image data contains) ───────────────────────────────
  // Source control, packages, infrastructure
  { id: "github_fine_grained_pat", name: "GitHub Fine-Grained Token", pattern: /github_pat_\w{82}/g, severity: "critical" },
  { id: "gitlab_runner_token", name: "GitLab Runner Token", pattern: /glrt-[0-9a-zA-Z_-]{20}/g, severity: "high" },
  { id: "pypi_token", name: "PyPI Upload Token", pattern: /pypi-AgEIcHlwaS5vcmc[\w-]{50,1000}/g, severity: "critical" },
  { id: "vault_token", name: "HashiCorp Vault Token", pattern: /\bhvs\.[\w-]{90,120}/g, severity: "critical" },
  { id: "terraform_cloud_token", name: "Terraform Cloud Token", pattern: /\b[a-z0-9]{14}\.atlasv1\.[a-z0-9_=-]{60,70}/gi, severity: "critical" },
  { id: "pulumi_token", name: "Pulumi Access Token", pattern: /\bpul-[a-f0-9]{40}\b/g, severity: "high" },
  { id: "doppler_token", name: "Doppler Personal Token", pattern: /\bdp\.pt\.[A-Za-z0-9]{43}\b/g, severity: "critical" },
  { id: "onepassword_service_token", name: "1Password Service Account Token", pattern: /\bops_eyJ[A-Za-z0-9+/]{250,}={0,3}/g, severity: "critical" },
  { id: "age_secret_key", name: "age Secret Key", pattern: /AGE-SECRET-KEY-1[QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L]{58}/g, severity: "critical" },
  // Cloud and hosting
  {
    id: "azure_ad_client_secret",
    name: "Azure AD (Entra ID) Client Secret",
    pattern: /(?<![\w~.])[a-zA-Z0-9_~.]{3}\dQ~[a-zA-Z0-9_~.-]{31,34}(?![\w~.-])/g,
    severity: "critical",
  },
  { id: "azure_storage_key", name: "Azure Storage Account Key", pattern: /AccountKey=[A-Za-z0-9+/]{86}==/g, severity: "critical" },
  { id: "digitalocean_token", name: "DigitalOcean Token", pattern: /\bdo[por]_v1_[a-f0-9]{64}\b/g, severity: "critical" },
  { id: "heroku_api_key", name: "Heroku API Key", pattern: /\bHRKU-AA[0-9a-zA-Z_-]{58}\b/g, severity: "critical" },
  { id: "flyio_token", name: "Fly.io Access Token", pattern: /\b(?:fo1_[\w-]{43}|fm1[ar]_[A-Za-z0-9+/]{100,}={0,3}|fm2_[A-Za-z0-9+/]{100,}={0,3})/g, severity: "high" },
  { id: "cloudflare_origin_ca_key", name: "Cloudflare Origin CA Key", pattern: /\bv1\.0-[a-f0-9]{24}-[a-f0-9]{146}\b/g, severity: "high" },
  { id: "supabase_access_token", name: "Supabase Access Token", pattern: /\bsbp_[a-f0-9]{40}\b/g, severity: "critical" },
  { id: "planetscale_token", name: "PlanetScale Service Token", pattern: /\bpscale_tkn_[\w=.-]{32,64}/g, severity: "critical" },
  // AI providers
  { id: "openrouter_key", name: "OpenRouter API Key", pattern: /\bsk-or-v1-[a-f0-9]{64}\b/g, severity: "critical" },
  { id: "groq_key", name: "Groq API Key", pattern: /\bgsk_[A-Za-z0-9]{52}\b/g, severity: "critical" },
  { id: "perplexity_key", name: "Perplexity API Key", pattern: /\bpplx-[a-zA-Z0-9]{48}\b/g, severity: "critical" },
  { id: "replicate_token", name: "Replicate API Token", pattern: /\br8_[A-Za-z0-9]{37}\b/g, severity: "critical" },
  { id: "huggingface_org_token", name: "Hugging Face Organization Token", pattern: /\bapi_org_[a-zA-Z]{34}\b/g, severity: "high" },
  // SaaS, payments, messaging
  { id: "stripe_webhook_secret", name: "Stripe Webhook Signing Secret", pattern: /\bwhsec_[A-Za-z0-9]{32,}/g, severity: "critical" },
  { id: "square_token", name: "Square Access Token", pattern: /\bsq0atp-[\w-]{22,60}/g, severity: "critical" },
  { id: "shopify_token", name: "Shopify Access Token", pattern: /\bshp(?:at|ca|pa|ss)_[a-fA-F0-9]{32}\b/g, severity: "critical" },
  { id: "twilio_api_key", name: "Twilio API Key", pattern: /\bSK[0-9a-fA-F]{32}\b/g, severity: "high" },
  { id: "linear_api_key", name: "Linear API Key", pattern: /\blin_api_[A-Za-z0-9]{40}\b/g, severity: "high" },
  { id: "notion_token", name: "Notion Integration Token", pattern: /\bntn_\d{11}[A-Za-z0-9]{35}\b/g, severity: "high" },
  { id: "atlassian_api_token", name: "Atlassian API Token", pattern: /\bATATT3[A-Za-z0-9_=-]{186}/g, severity: "high" },
  { id: "sentry_user_token", name: "Sentry User Auth Token", pattern: /\bsntryu_[a-f0-9]{64}\b/g, severity: "high" },
  { id: "grafana_service_token", name: "Grafana Service Account Token", pattern: /\bglsa_[A-Za-z0-9]{32}_[A-Fa-f0-9]{8}\b/g, severity: "high" },
  { id: "postman_api_key", name: "Postman API Key", pattern: /\bPMAK-[a-f0-9]{24}-[a-f0-9]{34}\b/gi, severity: "high" },
  {
    id: "discord_webhook",
    name: "Discord Webhook URL",
    pattern: /https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d{17,20}\/[\w-]{60,70}/g,
    severity: "high",
  },
  { id: "telegram_bot_token", name: "Telegram Bot Token", pattern: /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/g, severity: "high" },

  // ── Turkish providers ──────────────────────────────────────────────────────
  // Their keys have no distinctive prefix, so these match on the variable
  // name: broad, so the proxy does not mask on them.
  {
    id: "iyzico_key",
    broad: true,
    name: "iyzico API / Secret Key",
    pattern: /\b(?:iyzico|iyzipay|iyzi)[\w.-]{0,30}?(?:api|secret)[_-]?key\b["']?\s*[:=]\s*["'`]?[A-Za-z0-9-]{20,}/gi,
    severity: "high",
    // Sandbox keys only reach the iyzico test environment
    allowlist: [/sandbox-/i],
    lowerSeverityInTestFiles: true,
  },
  {
    id: "paytr_merchant_key",
    broad: true,
    name: "PayTR Merchant Key / Salt",
    pattern: /\bpaytr[\w.-]{0,30}?merchant[_-]?(?:key|salt)\b["']?\s*[:=]\s*["'`]?[A-Za-z0-9]{12,}/gi,
    severity: "high",
    lowerSeverityInTestFiles: true,
  },
  {
    id: "netgsm_credentials",
    broad: true,
    name: "Netgsm Password / API Key",
    pattern: /\bnetgsm[\w.-]{0,30}?(?:pass(?:word)?|sifre|api[_-]?key|secret)\b["']?\s*[:=]\s*["'`]?[^\s"'`]{6,}/gi,
    severity: "high",
    allowlist: [/process\.env/, /\$\{/, /getenv/, /<[^<>]{1,40}>/],
    lowerSeverityInTestFiles: true,
  },
  {
    id: "iletimerkezi_key",
    broad: true,
    name: "İleti Merkezi API Key / Hash",
    pattern: /\biletimerkezi[\w.-]{0,30}?(?:key|hash|secret)\b["']?\s*[:=]\s*["'`]?[A-Za-z0-9]{16,}/gi,
    severity: "high",
    lowerSeverityInTestFiles: true,
  },

  // ── Generic patterns ───────────────────────────────────────────────────────
  {
    id: "generic_secret_assignment",
    broad: true,
    name: "Hardcoded secret assignment",
    pattern:
      /(?:password|passwd|secret|api[_-]?key|auth[_-]?token|access[_-]?token|private[_-]?key)\s*[:=]\s*['"][^'"]{8,}['"]/gi,
    severity: "medium",
    allowlist: [
      /process\.env/,
      /\$\{/,
      /os\.environ/,
      /getenv/,
      /placeholder/i,
      /example/i,
      /your[-_]?/i,
      /<[^<>]{1,80}>/,
      /\*{3,}/,
    ],
    lowerSeverityInTestFiles: true,
  },
];
