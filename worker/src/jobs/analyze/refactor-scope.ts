// refactor-scope: グローバルとプロジェクトの CLAUDE.md の整合性を再編する。

import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '@harness/shared';
import { runClaude } from '../../claude.js';
import { unifiedDiff } from '../../lib/diff.js';
import { walkFiles } from '../../lib/fs.js';
import { ensureDir, PROMPTS_DIR } from '../../lib/paths.js';

export interface RefactorScopePayload {
  machine_id: number;
  job_id?: number;
  model?: string;
}

function template(kind: string): string {
  return fs.readFileSync(path.join(PROMPTS_DIR, `${kind}.md`), 'utf8');
}

export async function runRefactorScope(
  payload: RefactorScopePayload,
  jobDir: string,
  inputDir: string,
  outputDir: string,
): Promise<string> {
  const db = getDb();
  if (!payload.machine_id) throw new Error('refactor-scope: machine_id is required');

  const globalSnap = db
    .prepare(
      "SELECT path, hash, content FROM snapshots WHERE machine_id=? AND kind='claude_md' AND is_current=1 AND path LIKE '%/.claude/CLAUDE.md' ORDER BY id DESC LIMIT 1",
    )
    .get(payload.machine_id) as { path: string; hash: string; content: string } | undefined;
  fs.writeFileSync(path.join(inputDir, 'global_claude_md.md'), globalSnap?.content ?? '');

  const projDir = ensureDir(path.join(inputDir, 'projects'));
  const projects = db.prepare('SELECT id, cwd FROM projects WHERE machine_id=?').all(payload.machine_id) as {
    id: number;
    cwd: string;
  }[];
  const index: Record<string, { cwd?: string; target_path: string; hash?: string }> = {};
  if (globalSnap) index.global = { target_path: globalSnap.path, hash: globalSnap.hash };

  const projSnap = db.prepare(
    "SELECT hash, content FROM snapshots WHERE machine_id=? AND kind='claude_md' AND is_current=1 AND path=?",
  );
  for (const p of projects) {
    const targetPath = `${p.cwd}/CLAUDE.md`;
    const snap = projSnap.get(payload.machine_id, targetPath) as
      | { hash: string; content: string }
      | undefined;
    if (!snap) continue;
    fs.writeFileSync(path.join(projDir, `${p.id}__${path.basename(p.cwd)}.md`), snap.content ?? '');
    index[String(p.id)] = { cwd: p.cwd, target_path: targetPath, hash: snap.hash };
  }
  fs.writeFileSync(path.join(inputDir, 'index.json'), JSON.stringify(index, null, 2));

  if (Object.keys(index).length === 0) throw new Error('refactor-scope: no target CLAUDE.md found');

  const res = await runClaude(template('refactor-scope'), {
    cwd: jobDir,
    maxTurns: 40,
    model: payload.model,
  });
  if (!res.ok) throw new Error(`refactor-scope failed: ${res.error}`);

  const rationaleFile = path.join(outputDir, 'rationale.md');
  const rationale = fs.existsSync(rationaleFile) ? fs.readFileSync(rationaleFile, 'utf8') : '';
  const filesDir = path.join(outputDir, 'files');
  const outFiles = walkFiles(filesDir);
  if (outFiles.length === 0) return 'refactor-scope: no changes proposed';

  let created = 0;
  for (const f of outFiles) {
    const target = f.rel.replace(/\.md$/, '');
    const meta = index[target];
    if (!meta) continue;
    const newContent = fs.readFileSync(f.abs, 'utf8');
    const cur = db
      .prepare('SELECT content, hash FROM snapshots WHERE machine_id=? AND path=? AND is_current=1')
      .get(payload.machine_id, meta.target_path) as { content: string; hash: string } | undefined;
    if (cur && cur.content.trim() === newContent.trim()) continue;
    const diff = unifiedDiff(cur?.content ?? '', newContent, path.basename(meta.target_path));
    db.prepare(
      `INSERT INTO proposals(type, machine_id, target_path, base_hash, new_content, diff, rationale, status, job_id, created_at)
       VALUES('refactor', ?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now'))`,
    ).run(
      payload.machine_id,
      meta.target_path,
      meta.hash ?? '',
      newContent,
      diff,
      rationale,
      payload.job_id ?? null,
    );
    created++;
  }
  return `refactor-scope: created ${created} proposals (cost=$${res.costUsd ?? 0})`;
}
