/**
 * Ortak DB adapter arayüzü.
 * Prisma, pg veya herhangi bir custom adapter bu interface'i implement eder.
 */
export type DbAdapter = {
  /** Tablodan satır sorgula. filter boş ise tüm satırlar döner. */
  query(table: string, filter: Record<string, unknown>, limit: number): Promise<Record<string, unknown>[]>;
  /** Kullanılabilir tablo/model adlarını döner. */
  tables(): Promise<string[]>;
};
