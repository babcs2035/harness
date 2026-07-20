// unified diff の生成。`diff -u` コマンドに依存する。

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** diff コマンドが利用可能かチェック。 */
export function hasDiffCommand(): boolean {
  try {
    const r = spawnSync('diff', ['--version'], { timeout: 5_000 });
    return r.status === 0;
  } catch {
    return false;
  }
}

/**
 * 2 つの文字列の unified diff を返す（表示用）。`diff -u` を利用。
 * 差分なしなら空文字。diff コマンドは差分ありで exit 1 を返すため異常終了扱いにしない。
 * diff コマンドが利用不可能な場合は空文字を返す。
 */
export function unifiedDiff(oldStr: string, newStr: string, label = 'CLAUDE.md'): string {
  if (!hasDiffCommand()) return '';

  const dir = mkdtempSync(path.join(tmpdir(), 'harness-diff-'));
  try {
    const a = path.join(dir, 'a');
    const b = path.join(dir, 'b');
    writeFileSync(a, oldStr);
    writeFileSync(b, newStr);
    const r = spawnSync('diff', ['-u', '--label', `a/${label}`, '--label', `b/${label}`, a, b], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    return r.stdout ?? '';
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
