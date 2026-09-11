import type { FieldRule, GatewayConfig, Role } from "./config";

export type TableAccessResult =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Rol tabanlı erişim kontrol katmanı.
 *
 * Rol belirleme: config.activeRole → config.roles listesinde eşleştirme.
 * Aktif rol yoksa tüm kısıtlamalar atlanır.
 *
 * Kural önceliği (yüksekten düşüğe):
 *   1. Global tableRules (deny)        ← pipeline zaten kontrol eder
 *   2. Role.denyTables                 ← bu sınıf kontrol eder
 *   3. Role.allowTables (whitelist)    ← bu sınıf kontrol eder
 *   4. Role.fieldRules                 ← global kuralların önünde uygulanır
 *   5. Global fieldRules               ← fallback
 */
export class RoleResolver {
  private readonly activeRole: Role | null;

  constructor(private readonly config: GatewayConfig) {
    this.activeRole = config.activeRole
      ? (config.roles.find((r) => r.name === config.activeRole) ?? null)
      : null;

    if (config.activeRole && !this.activeRole) {
      console.error(
        `[guardbee-gateway] Warning: activeRole "${config.activeRole}" not found in roles config.`
      );
    }
  }

  /** Aktif rol bilgisi (monitoring / gateway_status için). */
  get role(): Role | null {
    return this.activeRole;
  }

  /**
   * Tablonun bu rol için erişilebilir olup olmadığını kontrol eder.
   * Global tableRules deny zaten pipeline'ın 1. adımında kontrol edilir;
   * burası sadece rol bazlı kısıtlamaları ekler.
   */
  checkTableAccess(table: string): TableAccessResult {
    const role = this.activeRole;
    if (!role) return { allowed: true };

    if (role.denyTables?.includes(table)) {
      return {
        allowed: false,
        reason: `Table '${table}' is denied for role '${role.name}'.`,
      };
    }

    if (role.allowTables && !role.allowTables.includes(table)) {
      return {
        allowed: false,
        reason: `Table '${table}' is not in the allowed table list for role '${role.name}'.`,
      };
    }

    return { allowed: true };
  }

  /**
   * Tablo listesini aktif rolün kısıtlamalarına göre filtreler.
   * list_tables tool'u tarafından kullanılır.
   */
  filterTables(tables: string[]): string[] {
    const role = this.activeRole;
    if (!role) return tables;

    return tables.filter((t) => {
      if (role.denyTables?.includes(t)) return false;
      if (role.allowTables && !role.allowTables.includes(t)) return false;
      return true;
    });
  }

  /**
   * Birleştirilmiş field kuralları.
   * Rol bazlı kurallar önce gelir (daha yüksek öncelik), ardından global kurallar.
   *
   * Örnek: global'de email → mask, ama admin rolünde email → allow ise
   * admin için allow uygulanır çünkü rol kuralı önce eşleşir.
   */
  get mergedFieldRules(): FieldRule[] {
    const roleRules = this.activeRole?.fieldRules ?? [];
    if (roleRules.length === 0) return this.config.fieldRules;
    return [...roleRules, ...this.config.fieldRules];
  }

  /**
   * Efektif max satır sayısı.
   * Öncelik: rol maxRows → tablo kuralı maxRows → global defaultMaxRows
   */
  effectiveMaxRows(tableMaxRows?: number): number {
    if (this.activeRole?.maxRows !== undefined) return this.activeRole.maxRows;
    return tableMaxRows ?? this.config.defaultMaxRows;
  }
}
