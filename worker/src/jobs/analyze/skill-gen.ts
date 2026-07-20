// skill-gen: 利用実態から skill を生成する。

import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '@harness/shared';
import { runClaude } from '../../claude.js';
import { walkFiles } from '../../lib/fs.js';
import { ensureDir, PROMPTS_DIR } from '../../lib/paths.js';
import { loadDigest } from '../../lib/tier.js';

export interface SkillGenPayload {
  machine_id: number;
  job_id?: number;
  model?: string;
}

function template(kind: string): string {
  return fs.readFileSync(path.join(PROMPTS_DIR, `${kind}.md`), 'utf8');
}

/** 対象マシンの ~/.claude ディレクトリを、グローバル CLAUDE.md スナップショットのパスから導出。 */
function claudeDirOf(machineId: number): string | null {
  const db = getDb();
  const snap = db
    .prepare(
      "SELECT path FROM snapshots WHERE machine_id=? AND kind='claude_md' AND is_current=1 AND path LIKE '%/.claude/CLAUDE.md' ORDER BY id DESC LIMIT 1",
    )
    .get(machineId) as { path: string } | undefined;
  return snap ? path.dirname(snap.path) : null;
}

export async function runSkillGen(
  payload: SkillGenPayload,
  jobDir: string,
  inputDir: string,
  outputDir: string,
): Promise<string> {
  const db = getDb();
  if (!payload.machine_id) throw new Error('skill-gen: machine_id is required');
  const claudeDir = claudeDirOf(payload.machine_id);
  if (!claudeDir) throw new Error('skill-gen: could not locate ~/.claude (run collect first)');

  fs.writeFileSync(
    path.join(inputDir, 'digest.json'),
    JSON.stringify(loadDigest('global', payload.machine_id) ?? {}, null, 2),
  );
  const memDir = ensureDir(path.join(inputDir, 'memory'));
  const mems = db
    .prepare("SELECT path, content FROM snapshots WHERE machine_id=? AND kind='memory' AND is_current=1")
    .all(payload.machine_id) as { path: string; content: string }[];
  mems.forEach((m, i) => {
    fs.writeFileSync(path.join(memDir, `mem_${i}_${path.basename(m.path)}`), m.content ?? '');
  });

  const latestInc = db
    .prepare('SELECT file_path FROM tier1_increments WHERE machine_id=? ORDER BY id DESC LIMIT 1')
    .get(payload.machine_id) as { file_path: string } | undefined;
  let materials: unknown = { sessions: [] };
  if (latestInc && fs.existsSync(latestInc.file_path)) {
    try {
      const inc = JSON.parse(fs.readFileSync(latestInc.file_path, 'utf8'));
      materials = { sessions: inc.sessions ?? [] };
    } catch {
      /* ignore */
    }
  }
  fs.writeFileSync(path.join(inputDir, 'materials.json'), JSON.stringify(materials));

  const res = await runClaude(template('skill-gen'), { cwd: jobDir, maxTurns: 40, model: payload.model });
  if (!res.ok) throw new Error(`skill-gen failed: ${res.error}`);

  const skillsOut = path.join(outputDir, 'skills');
  const files = walkFiles(skillsOut).map((f) => ({
    rel_path: f.rel,
    content: fs.readFileSync(f.abs, 'utf8'),
  }));
  if (files.length === 0) return 'skill-gen: no skill was generated';

  const rationaleFile = path.join(outputDir, 'rationale.md');
  const rationale = fs.existsSync(rationaleFile) ? fs.readFileSync(rationaleFile, 'utf8') : '';
  const targetPath = path.join(claudeDir, 'skills');
  const diff = files.map((f) => `+ ${f.rel_path} (${f.content.length} bytes)`).join('\n');

  const r = db
    .prepare(
      `INSERT INTO proposals(type, machine_id, target_path, base_hash, new_content, diff, rationale, status, job_id, created_at)
       VALUES('skill', ?, ?, '', ?, ?, ?, 'pending', ?, datetime('now'))`,
    )
    .run(payload.machine_id, targetPath, JSON.stringify({ files }), diff, rationale, payload.job_id ?? null);
  return `skill-gen: created proposal#${Number(r.lastInsertRowid)} (${files.length} files, cost=$${res.costUsd ?? 0})`;
}
