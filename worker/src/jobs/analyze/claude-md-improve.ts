// claude-md-improve: CLAUDE.md の改善案を生成する。

import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '@harness/shared';
import { runClaude } from '../../claude.js';
import { unifiedDiff } from '../../lib/diff.js';
import { PROMPTS_DIR } from '../../lib/paths.js';
import { loadDigest } from '../../lib/tier.js';

export interface ClaudeMdImprovePayload {
  scope: 'global' | 'machine' | 'project';
  machine_id: number;
  project_id?: number;
  job_id?: number;
  model?: string;
}

function template(kind: string): string {
  return fs.readFileSync(path.join(PROMPTS_DIR, `${kind}.md`), 'utf8');
}

export async function runClaudeMdImprove(
  payload: ClaudeMdImprovePayload,
  jobDir: string,
  inputDir: string,
  outputDir: string,
): Promise<string> {
  const db = getDb();
  if (!payload.machine_id) throw new Error('claude-md-improve: machine_id is required');

  // 対象 CLAUDE.md のスナップショット（グローバル or プロジェクト）
  let snap: { path: string; hash: string; content: string } | undefined;
  if (payload.scope === 'project') {
    if (!payload.project_id) throw new Error('project_id is required for project scope');
    const proj = db.prepare('SELECT cwd FROM projects WHERE id=?').get(payload.project_id) as
      | { cwd: string }
      | undefined;
    if (!proj) throw new Error('project not found');
    snap = db
      .prepare(
        "SELECT path, hash, content FROM snapshots WHERE machine_id=? AND kind='claude_md' AND is_current=1 AND path=?",
      )
      .get(payload.machine_id, `${proj.cwd}/CLAUDE.md`) as typeof snap;
  } else {
    // グローバル: ~/.claude/CLAUDE.md
    snap = db
      .prepare(
        "SELECT path, hash, content FROM snapshots WHERE machine_id=? AND kind='claude_md' AND is_current=1 AND path LIKE '%/.claude/CLAUDE.md' ORDER BY id DESC LIMIT 1",
      )
      .get(payload.machine_id) as typeof snap;
  }

  const currentContent = snap?.content ?? '';
  const targetPath = snap?.path ?? '';
  if (!targetPath) throw new Error('target CLAUDE.md snapshot not found (run collect first)');

  const digest =
    loadDigest(payload.scope, payload.scope === 'global' ? payload.machine_id : null) ??
    loadDigest(payload.scope, payload.machine_id);
  fs.writeFileSync(path.join(inputDir, 'digest.json'), JSON.stringify(digest ?? {}, null, 2));
  fs.writeFileSync(path.join(inputDir, 'current_claude_md.md'), currentContent);
  fs.writeFileSync(
    path.join(inputDir, 'context.md'),
    `対象スコープ: ${payload.scope}\n対象ファイル: ${targetPath}\n`,
  );

  const res = await runClaude(template('claude-md-improve'), {
    cwd: jobDir,
    maxTurns: 30,
    model: payload.model,
  });
  if (!res.ok) throw new Error(`claude-md-improve failed: ${res.error}`);

  const newFile = path.join(outputDir, 'claude_md.new');
  if (!fs.existsSync(newFile)) throw new Error('claude-md-improve: output/claude_md.new was not generated');
  const newContent = fs.readFileSync(newFile, 'utf8');
  const rationaleFile = path.join(outputDir, 'rationale.md');
  const rationale = fs.existsSync(rationaleFile) ? fs.readFileSync(rationaleFile, 'utf8') : '';

  if (newContent.trim() === currentContent.trim()) {
    return 'claude-md-improve: no changes proposed (current content is sufficient)';
  }

  const diff = unifiedDiff(currentContent, newContent, path.basename(targetPath));
  const r = db
    .prepare(
      `INSERT INTO proposals(type, machine_id, target_path, base_hash, new_content, diff, rationale, status, job_id, created_at)
       VALUES('claude_md', ?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now'))`,
    )
    .run(
      payload.machine_id,
      targetPath,
      snap?.hash ?? '',
      newContent,
      diff,
      rationale,
      payload.job_id ?? null,
    );
  return `claude-md-improve: created proposal#${Number(r.lastInsertRowid)} (cost=$${res.costUsd ?? 0})`;
}
