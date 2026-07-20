// 共通ユーティリティ。

/** path の `/.claude/` 以降を論理キーとする（Drift 判定と一致させる）。 */
export function logicalKey(p: string): string {
  const i = p.indexOf('/.claude/');
  return i >= 0 ? p.slice(i + 1) : p;
}
