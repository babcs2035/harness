// ファイルシステム操作の共通ユーティリティ。

import fs from 'node:fs';
import path from 'node:path';

/** ディレクトリ以下のファイルを {abs, rel} で列挙（反復でスタックオーバーフロー防止）。 */
export function walkFiles(root: string): { abs: string; rel: string }[] {
  const acc: { abs: string; rel: string }[] = [];
  const stack: { dir: string; prefix: string }[] = [{ dir: root, prefix: '' }];
  while (stack.length > 0) {
    const item = stack.pop();
    if (!item) continue;
    const { dir, prefix } = item;
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (fs.statSync(abs).isDirectory()) {
        stack.push({ dir: abs, prefix: rel });
      } else {
        acc.push({ abs, rel });
      }
    }
  }
  return acc;
}
