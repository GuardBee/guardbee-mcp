/**
 * Ortak DB adapter arayüzü.
 * Prisma, pg veya herhangi bir custom adapter bu interface'i implement eder.
 *
 * insert/update/delete opsiyoneldir — bir adapter bunları implement etmezse
 * gateway ilgili write tool'unu "bu adapter yazma desteklemiyor" diyerek reddeder.
 * Böylece mevcut salt-okunur adapter'lar (örn. yayınlanmış Prisma adapter'ı
 * genişletmeyen özel entegrasyonlar) kırılmadan çalışmaya devam eder.
 */
export type DbAdapter = {
  /** Tablodan satır sorgula. filter boş ise tüm satırlar döner. */
  query(table: string, filter: Record<string, unknown>, limit: number): Promise<Record<string, unknown>[]>;
  /** Kullanılabilir tablo/model adlarını döner. */
  tables(): Promise<string[]>;
  /** Tek satır ekler, eklenen satırı (varsa üretilen id/default'larla) döner. */
  insert?(table: string, data: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** filter'a uyan satırları günceller, etkilenen satır sayısını döner. */
  update?(table: string, filter: Record<string, unknown>, data: Record<string, unknown>): Promise<number>;
  /** filter'a uyan satırları siler, silinen satır sayısını döner. */
  delete?(table: string, filter: Record<string, unknown>): Promise<number>;
};
