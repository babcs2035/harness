import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDb } from '@harness/shared';
import { runClaude } from '../claude.js';
import { JOBS_DIR, PROMPTS_DIR, ensureDir } from '../lib/paths.js';
import { unifiedDiff } from '../lib/diff.js';
import {
  unconsumedTier1,
  markTier1Consumed,
  loadDigest,
  saveDigest,
  upsertPatterns,
} from '../lib/tier.js';

export interface AnalyzePayload {
  kind: string; // 'digest-fold' | 'claude-md-improve' | ...
  scope: 'global' | 'machine' | 'project';
  machine_id?: number;
  project_id?: number;
  job_id?: number; // 呼び出し元 jobs.id（提案に紐付ける）
}

function template(kind: string): string {
  return fs.readFileSync(path.join(PROMPTS_DIR, `${kind}.md`), 'utf8');
}

export async function runAnalyze(payload: AnalyzePayload): Promise<string> {
  const jobDir = path.join(JOBS_DIR, randomUUID());
  const inputDir = ensureDir(path.join(jobDir, 'input'));
  const outputDir = ensureDir(path.join(jobDir, 'output'));

  try {
    switch (payload.kind) {
      case 'digest-fold':
        return await digestFold(payload, jobDir, inputDir, outputDir);
      case 'claude-md-improve':
        return await claudeMdImprove(payload, jobDir, inputDir, outputDir);
      default:
        throw new Error(`未対応の analyze kind: ${payload.kind}`);
    }
  } finally {
    // ジョブディレクトリは使い捨て。成否に関わらず削除（増分は Tier1 に永続）。
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}

async function digestFold(
  payload: AnalyzePayload,
  jobDir: string,
  inputDir: string,
  outputDir: string,
): Promise<string> {
  const incs = unconsumedTier1(payload.machine_id);
  if (incs.length === 0) return 'digest-fold: 未消費の増分なし（スキップ）';

  const incDir = ensureDir(path.join(inputDir, 'increments'));
  let copied = 0;
  for (const inc of incs) {
    if (fs.existsSync(inc.file_path)) {
      fs.copyFileSync(inc.file_path, path.join(incDir, `inc_${inc.id}.json`));
      copied++;
    }
  }
  fs.writeFileSync(
    path.join(inputDir, 'current_digest.json'),
    JSON.stringify(loadDigest(payload.scope, payload.machine_id) ?? {}, null, 2),
  );

  const res = await runClaude(template('digest-fold'), { cwd: jobDir, maxTurns: 30 });
  if (!res.ok) throw new Error(`digest-fold 失敗: ${res.error}`);

  const digestFile = path.join(outputDir, 'digest.json');
  if (!fs.existsSync(digestFile)) throw new Error('digest-fold: output/digest.json が生成されませんでした');
  const digest = JSON.parse(fs.readFileSync(digestFile, 'utf8'));

  const { id: digestId } = saveDigest(payload.scope, digest, { machineId: payload.machine_id ?? null });
  if (Array.isArray(digest.patterns)) {
    upsertPatterns(
      digestId,
      digest.patterns
        .filter((p: unknown): p is { description: string; count?: number } => !!p && typeof (p as { description?: unknown }).description === 'string')
        .map((p: { description: string; count?: number }) => ({ description: p.description, count: p.count })),
    );
  }
  markTier1Consumed(incs.map((i) => i.id));
  return `digest-fold: 増分 ${copied} 件を折り畳み（patterns=${Array.isArray(digest.patterns) ? digest.patterns.length : 0}, cost=$${res.costUsd ?? 0}）`;
}

async function claudeMdImprove(
  payload: AnalyzePayload,
  jobDir: string,
  inputDir: string,
  outputDir: string,
): Promise<string> {
  const db = getDb();
  if (!payload.machine_id) throw new Error('claude-md-improve: machine_id が必要です');

  // 対象 CLAUDE.md のスナップショット（グローバル or プロジェクト）
  let snap: { path: string; hash: string; content: string } | undefined;
  if (payload.scope === 'project') {
    if (!payload.project_id) throw new Error('project スコープには project_id が必要です');
    const proj = db.prepare('SELECT cwd FROM projects WHERE id=?').get(payload.project_id) as { cwd: string } | undefined;
    if (!proj) throw new Error('project が見つかりません');
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
  if (!targetPath) throw new Error('対象の CLAUDE.md スナップショットが見つかりません（先に収集してください）');

  const digest = loadDigest(payload.scope, payload.scope === 'global' ? payload.machine_id : null) ?? loadDigest(payload.scope, payload.machine_id);
  fs.writeFileSync(path.join(inputDir, 'digest.json'), JSON.stringify(digest ?? {}, null, 2));
  fs.writeFileSync(path.join(inputDir, 'current_claude_md.md'), currentContent);
  fs.writeFileSync(
    path.join(inputDir, 'context.md'),
    `対象スコープ: ${payload.scope}\n対象ファイル: ${targetPath}\n`,
  );

  const res = await runClaude(template('claude-md-improve'), { cwd: jobDir, maxTurns: 30 });
  if (!res.ok) throw new Error(`claude-md-improve 失敗: ${res.error}`);

  const newFile = path.join(outputDir, 'claude_md.new');
  if (!fs.existsSync(newFile)) throw new Error('claude-md-improve: output/claude_md.new が生成されませんでした');
  const newContent = fs.readFileSync(newFile, 'utf8');
  const rationaleFile = path.join(outputDir, 'rationale.md');
  const rationale = fs.existsSync(rationaleFile) ? fs.readFileSync(rationaleFile, 'utf8') : '';

  if (newContent.trim() === currentContent.trim()) {
    return 'claude-md-improve: 変更提案なし（現行で十分）';
  }

  const diff = unifiedDiff(currentContent, newContent, path.basename(targetPath));
  const r = db
    .prepare(
      `INSERT INTO proposals(type, machine_id, target_path, base_hash, new_content, diff, rationale, status, job_id, created_at)
       VALUES('claude_md', ?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now'))`,
    )
    .run(payload.machine_id, targetPath, snap?.hash ?? '', newContent, diff, rationale, payload.job_id ?? null);
  return `claude-md-improve: 提案#${Number(r.lastInsertRowid)} を作成（cost=$${res.costUsd ?? 0}）`;
}
