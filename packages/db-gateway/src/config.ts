import { z } from "zod";

/**
 * Per-field masking rule.
 * - "redact"  → field tamamen silinir
 * - "mask"    → değerin ortası yıldızlanır  (ahm***ar@example.com)
 * - "hash"    → SHA-256 ile hash'lenir (analiz için tekrar tanınabilir)
 * - "allow"   → olduğu gibi geçer (whitelist)
 */
export const MaskingStrategySchema = z.enum(["redact", "mask", "hash", "allow"]);
export type MaskingStrategy = z.infer<typeof MaskingStrategySchema>;

export const FieldRuleSchema = z.object({
  /** Exact field name or glob pattern, e.g. "*Password*", "tc_kimlik" */
  field: z.string(),
  strategy: MaskingStrategySchema,
  /** Optional: only apply when table matches */
  table: z.string().optional(),
});
export type FieldRule = z.infer<typeof FieldRuleSchema>;

/**
 * Bir tablo/rol için hangi write operasyonlarının açık olduğu.
 * Belirtilmeyen operasyon `false` sayılır — write varsayılan olarak kapalıdır,
 * her tablo/rol için ayrı ayrı açılması gerekir.
 */
export const WritePermissionSchema = z.object({
  insert: z.boolean().default(false),
  update: z.boolean().default(false),
  delete: z.boolean().default(false),
});
export type WritePermission = z.infer<typeof WritePermissionSchema>;

export const TableRuleSchema = z.object({
  table: z.string(),
  /** "deny" = bu tablodan hiç veri geçmez */
  access: z.enum(["allow", "deny"]),
  /** Max row count LLM'e döndürülebilir */
  maxRows: z.number().int().positive().optional(),
  /** Bu tablo için açık write operasyonları. Belirtilmezse hiçbiri açık değildir. */
  write: WritePermissionSchema.optional(),
});
export type TableRule = z.infer<typeof TableRuleSchema>;

export const RoleSchema = z.object({
  name: z.string().min(1),

  /**
   * Beyaz liste: tanımlanmışsa sadece bu tablolara erişim açık.
   * Tanımlanmamışsa tüm tablolar erişilebilir (denyTables hariç).
   */
  allowTables: z.array(z.string()).optional(),

  /** Kara liste: bu tablolar bu rol için her zaman engellenir. */
  denyTables: z.array(z.string()).optional(),

  /**
   * Rol bazlı field kuralları — global kuralların önünde uygulanır.
   * Örnek: admin rolü için email alanını allow'a çekebilirsiniz.
   */
  fieldRules: z.array(FieldRuleSchema).optional(),

  /** Bu rol için max satır limiti (global defaultMaxRows'un üzerine yazar). */
  maxRows: z.number().int().positive().optional(),

  /**
   * Bu rol için write operasyonları. fieldRules'ın aksine burada "override"
   * değil "AND" mantığı geçerlidir: bir aktif rol varken write'a izin
   * verilmesi için hem tablonun `write` alanı HEM DE rolün `write` alanı
   * o operasyonu true olarak işaretlemiş olmalıdır. Rol write'ı hiç
   * tanımlamamışsa (undefined) o rol için hiçbir write izni yok demektir —
   * tablo write'a açık olsa bile.
   */
  write: WritePermissionSchema.optional(),
});
export type Role = z.infer<typeof RoleSchema>;

export const RateLimitConfigSchema = z.object({
  enabled: z.boolean().default(true),
  /** Pencere süresi (ms). Default: 60 saniye. */
  windowMs: z.number().int().positive().default(60_000),
  /** Pencere başına global max istek sayısı. Default: 100. */
  maxRequests: z.number().int().positive().default(100),
  /** Pencere başına tablo başına max istek sayısı. Default: 20. */
  maxRequestsPerTable: z.number().int().positive().default(20),
  /** Pencere başına global max write (insert/update/delete) sayısı. Reads'ten ayrı, daha sıkı. Default: 20. */
  maxWrites: z.number().int().positive().default(20),
  /** Pencere başına tablo başına max write sayısı. Default: 5. */
  maxWritesPerTable: z.number().int().positive().default(5),
});
export type RateLimitConfig = z.infer<typeof RateLimitConfigSchema>;

export const AuditConfigSchema = z.object({
  enabled: z.boolean().default(true),
  /** "console" | "file" | "http" */
  sink: z.enum(["console", "file", "http"]).default("console"),
  /** file sink için log dosyası yolu */
  filePath: z.string().optional(),
  /** http sink için webhook URL */
  webhookUrl: z.string().url().optional(),
});
export type AuditConfig = z.infer<typeof AuditConfigSchema>;

export const GatewayConfigSchema = z.object({
  /** Database connection URL — müşterinin kendi DB'si. Demo adapter kullanılıyorsa boş bırakılabilir. */
  databaseUrl: z.string().optional(),

  /**
   * KVKK / GDPR kuralları için otomatik field maskeleme.
   * Sıra önemli: ilk eşleşen kural uygulanır.
   */
  fieldRules: z.array(FieldRuleSchema).default([
    // Türkiye — KVKK özel kategoriler
    { field: "tcKimlik",       strategy: "redact" },
    { field: "tc_kimlik",      strategy: "redact" },
    { field: "nationalId",     strategy: "redact" },
    { field: "iban",           strategy: "mask" },
    { field: "IBAN",           strategy: "mask" },
    // Genel PII
    { field: "email",          strategy: "mask" },
    { field: "phone",          strategy: "mask" },
    { field: "phoneNumber",    strategy: "mask" },
    { field: "mobile",         strategy: "mask" },
    { field: "address",        strategy: "mask" },
    { field: "birthDate",      strategy: "redact" },
    { field: "dateOfBirth",    strategy: "redact" },
    // Credentials
    { field: "password",       strategy: "redact" },
    { field: "passwordHash",   strategy: "redact" },
    { field: "hashedPassword", strategy: "redact" },
    { field: "refreshToken",   strategy: "redact" },
    { field: "accessToken",    strategy: "redact" },
    { field: "apiKey",         strategy: "redact" },
    { field: "secretKey",      strategy: "redact" },
    { field: "privateKey",     strategy: "redact" },
  ]),

  /** Tablo bazlı erişim kuralları */
  tableRules: z.array(TableRuleSchema).default([]),

  /** Varsayılan max satır sayısı (tablo kuralı yoksa) */
  defaultMaxRows: z.number().int().positive().default(50),

  /** Audit log ayarları */
  audit: AuditConfigSchema.default(() => ({ enabled: true, sink: "console" as const })),

  /** Rate limiting ayarları */
  rateLimit: RateLimitConfigSchema.default(() => ({
    enabled: true,
    windowMs: 60_000,
    maxRequests: 100,
    maxRequestsPerTable: 20,
    maxWrites: 20,
    maxWritesPerTable: 5,
  })),

  /**
   * Global write kill-switch. `false` (default) iken insert_row/update_row/
   * delete_row tool'ları hiç register edilmez — tableRules/roles'te write
   * açık olsa bile. Write desteğini kullanmak için bilinçli olarak `true`
   * yapılması gerekir.
   */
  writesEnabled: z.boolean().default(false),

  /**
   * update_row/delete_row bir filtreye uyan satırlardan en fazla kaçını
   * etkileyebilir. Bu limit aşılırsa (filtre çok geniş demektir) işlem hiç
   * yapılmadan reddedilir — "filtreyi daraltın" hatası döner. Yanlışlıkla
   * tüm tabloyu güncelleme/silmeye karşı asıl güvenlik ağı budur.
   */
  maxAffectedRowsPerWrite: z.number().int().positive().default(10),

  /** Tanımlı roller listesi */
  roles: z.array(RoleSchema).default([]),

  /**
   * Aktif rol adı. GATEWAY_ROLE env var'ından veya config'den okunur.
   * Eşleşen rol bulunamazsa ya da tanımlanmamışsa kısıtlama uygulanmaz.
   */
  activeRole: z.string().optional(),

  /** MCP server adı */
  serverName: z.string().default("guardbee-db-gateway"),
});

export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;

/** Config'i env'den veya doğrudan obje olarak yükle */
export function loadConfig(overrides?: Partial<GatewayConfig>): GatewayConfig {
  const raw = {
    databaseUrl: process.env.DATABASE_URL ?? "",
    serverName: process.env.GATEWAY_SERVER_NAME,
    activeRole: process.env.GATEWAY_ROLE,
    ...overrides,
  };
  return GatewayConfigSchema.parse(raw);
}
