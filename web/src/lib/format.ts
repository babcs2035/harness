/** トークン等の大きな整数を 1.2M / 34k のように短縮表示する。 */
export function compact(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(v);
}

/** 3 桁区切りのフル表示。 */
export function comma(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString('en-US');
}

/** バイト数を人間可読に。 */
export function bytes(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (v >= 1 << 20) return `${(v / (1 << 20)).toFixed(1)} MiB`;
  if (v >= 1 << 10) return `${(v / (1 << 10)).toFixed(1)} KiB`;
  return `${v} B`;
}

/** ISO 文字列を YYYY-MM-DD HH:MM に。空なら '-'。 */
export function shortTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  return iso.replace('T', ' ').slice(0, 16);
}
