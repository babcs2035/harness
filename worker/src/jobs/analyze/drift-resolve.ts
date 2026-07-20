// drift-resolve: 端末間で分岐したファイルの統合案を生成する。

import fs from 'node:fs';
import path from 'node:path';
import { getDb, logicalKey } from '@harness/shared';
import { runClaude } from '../../claude.js';
import { unifiedDiff } from '../../lib/diff.js';
import { ensureDir, PROMPTS_DIR } from '../../lib/paths.js';

export interface DriftResolvePayload {
  key: string; // drift-resolve: 対象の論理キー（'.claude/CLAUDE.md' 等）
  job_id?: number;
  model?: string;
}

function template(kind: string): string {
  return fs.readFileSync(path.join(PROMPTS_DIR, `${kind}.md`), 'utf8');
}

export async function runDriftResolve(
  payload: DriftResolvePayload,
  jobDir: string,
  inputDir: string,
  outputDir: string,
): Promise<string> {
  const db = getDb();
  if (!payload.key) throw new Error('drift-resolve: key is required');

  const rows = db
    .prepare(
      `SELECT s.machine_id, m.name AS machine, s.path, s.hash, s.content
       FROM snapshots s JOIN machines m ON m.id=s.machine_id
       WHERE s.is_current=1 AND s.kind IN ('claude_md','skill','memory','settings')`,
    )
    .all() as { machine_id: number; machine: string; path: string; hash: string; content: string }[];
  const variants = rows.filter((r) => logicalKey(r.path) === payload.key);
  if (variants.length < 2) return 'drift-resolve: fewer than 2 diverged machines, skipped';

  const varDir = ensureDir(path.join(inputDir, 'variants'));
  for (const v of variants) fs.writeFileSync(path.join(varDir, `${v.machine}.md`), v.content ?? '');
  fs.writeFileSync(
    path.join(inputDir, 'context.md'),
    `論理キー: ${payload.key}\n端末: ${variants.map((v) => v.machine).join(', ')}\n`,
  );

  const res = await runClaude(template('drift-resolve'), { cwd: jobDir, maxTurns: 30, model: payload.model });
  if (!res.ok) throw new Error(`drift-resolve failed: ${res.error}`);

  const mergedFile = path.join(outputDir, 'merged.md');
  if (!fs.existsSync(mergedFile)) throw new Error('drift-resolve: output/merged.md was not generated');
  const merged = fs.readFileSync(mergedFile, 'utf8');
  const rationaleFile = path.join(outputDir, 'rationale.md');
  const rationale = fs.existsSync(rationaleFile) ? fs.readFileSync(rationaleFile, 'utf8') : '';

  let created = 0;
  const ins = db.prepare(
    `INSERT INTO proposals(type, machine_id, target_path, base_hash, new_content, diff, rationale, status, job_id, created_at)
     VALUES('drift', ?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now'))`,
  );
  // 複数 proposal をアトミックに作成（1つでも失敗すると全体がロールバック）
  const tx = db.transaction(() => {
    let c = 0;
    for (const v of variants) {
      if ((v.content ?? '').trim() === merged.trim()) continue;
      const diff = unifiedDiff(v.content ?? '', merged, path.basename(v.path));
      ins.run(v.machine_id, v.path, v.hash, merged, diff, rationale, payload.job_id ?? null);
      c++;
    }
    return c;
  });
  created = tx();
  return `drift-resolve(${payload.key}): created merge proposals for ${created} machines (cost=$${res.costUsd ?? 0})`;
}
