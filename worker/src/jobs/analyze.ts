import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '@harness/shared';
import { runClaude } from '../claude.js';
import { unifiedDiff } from '../lib/diff.js';
import { ensureDir, JOBS_DIR, PROMPTS_DIR } from '../lib/paths.js';
import { loadDigest, markTier1Consumed, saveDigest, unconsumedTier1, upsertPatterns } from '../lib/tier.js';

export interface AnalyzePayload {
  kind: string; // 'digest-fold' | 'claude-md-improve' | 'skill-gen' | 'refactor-scope' | 'drift-resolve'
  scope: 'global' | 'machine' | 'project';
  machine_id?: number;
  project_id?: number;
  key?: string; // drift-resolve: 対象の論理キー（'.claude/CLAUDE.md' 等）
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
      case 'skill-gen':
        return await skillGen(payload, jobDir, inputDir, outputDir);
      case 'refactor-scope':
        return await refactorScope(payload, jobDir, inputDir, outputDir);
      case 'drift-resolve':
        return await driftResolve(payload, jobDir, inputDir, outputDir);
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
        .filter(
          (p: unknown): p is { description: string; count?: number } =>
            !!p && typeof (p as { description?: unknown }).description === 'string',
        )
        .map((p: { description: string; count?: number }) => ({
          description: p.description,
          count: p.count,
        })),
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
    const proj = db.prepare('SELECT cwd FROM projects WHERE id=?').get(payload.project_id) as
      | { cwd: string }
      | undefined;
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
  if (!targetPath)
    throw new Error('対象の CLAUDE.md スナップショットが見つかりません（先に収集してください）');

  const digest =
    loadDigest(payload.scope, payload.scope === 'global' ? payload.machine_id : null) ??
    loadDigest(payload.scope, payload.machine_id);
  fs.writeFileSync(path.join(inputDir, 'digest.json'), JSON.stringify(digest ?? {}, null, 2));
  fs.writeFileSync(path.join(inputDir, 'current_claude_md.md'), currentContent);
  fs.writeFileSync(
    path.join(inputDir, 'context.md'),
    `対象スコープ: ${payload.scope}\n対象ファイル: ${targetPath}\n`,
  );

  const res = await runClaude(template('claude-md-improve'), { cwd: jobDir, maxTurns: 30 });
  if (!res.ok) throw new Error(`claude-md-improve 失敗: ${res.error}`);

  const newFile = path.join(outputDir, 'claude_md.new');
  if (!fs.existsSync(newFile))
    throw new Error('claude-md-improve: output/claude_md.new が生成されませんでした');
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
    .run(
      payload.machine_id,
      targetPath,
      snap?.hash ?? '',
      newContent,
      diff,
      rationale,
      payload.job_id ?? null,
    );
  return `claude-md-improve: 提案#${Number(r.lastInsertRowid)} を作成（cost=$${res.costUsd ?? 0}）`;
}

/** ディレクトリ以下のファイルを {abs, rel} で再帰列挙。 */
function walkFiles(root: string): { abs: string; rel: string }[] {
  const acc: { abs: string; rel: string }[] = [];
  const walk = (dir: string, prefix: string) => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (fs.statSync(abs).isDirectory()) walk(abs, rel);
      else acc.push({ abs, rel });
    }
  };
  walk(root, '');
  return acc;
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

async function skillGen(
  payload: AnalyzePayload,
  jobDir: string,
  inputDir: string,
  outputDir: string,
): Promise<string> {
  const db = getDb();
  if (!payload.machine_id) throw new Error('skill-gen: machine_id が必要です');
  const claudeDir = claudeDirOf(payload.machine_id);
  if (!claudeDir) throw new Error('skill-gen: ~/.claude を特定できません（先に収集してください）');

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

  const res = await runClaude(template('skill-gen'), { cwd: jobDir, maxTurns: 40 });
  if (!res.ok) throw new Error(`skill-gen 失敗: ${res.error}`);

  const skillsOut = path.join(outputDir, 'skills');
  const files = walkFiles(skillsOut).map((f) => ({
    rel_path: f.rel,
    content: fs.readFileSync(f.abs, 'utf8'),
  }));
  if (files.length === 0) return 'skill-gen: 生成された skill はありませんでした';

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
  return `skill-gen: 提案#${Number(r.lastInsertRowid)}（${files.length} ファイル, cost=$${res.costUsd ?? 0}）`;
}

async function refactorScope(
  payload: AnalyzePayload,
  jobDir: string,
  inputDir: string,
  outputDir: string,
): Promise<string> {
  const db = getDb();
  if (!payload.machine_id) throw new Error('refactor-scope: machine_id が必要です');

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

  if (Object.keys(index).length === 0) throw new Error('refactor-scope: 対象の CLAUDE.md がありません');

  const res = await runClaude(template('refactor-scope'), { cwd: jobDir, maxTurns: 40 });
  if (!res.ok) throw new Error(`refactor-scope 失敗: ${res.error}`);

  const rationaleFile = path.join(outputDir, 'rationale.md');
  const rationale = fs.existsSync(rationaleFile) ? fs.readFileSync(rationaleFile, 'utf8') : '';
  const filesDir = path.join(outputDir, 'files');
  const outFiles = walkFiles(filesDir);
  if (outFiles.length === 0) return 'refactor-scope: 変更提案なし';

  let created = 0;
  for (const f of outFiles) {
    const target = f.rel.replace(/\.md$/, ''); // 'global' or '<project-id>'
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
  return `refactor-scope: ${created} 件の提案を作成（cost=$${res.costUsd ?? 0}）`;
}

/** path の `/.claude/` 以降を論理キーとする（Drift 判定と一致させる）。 */
function logicalKey(p: string): string {
  const i = p.indexOf('/.claude/');
  return i >= 0 ? p.slice(i + 1) : p;
}

async function driftResolve(
  payload: AnalyzePayload,
  jobDir: string,
  inputDir: string,
  outputDir: string,
): Promise<string> {
  const db = getDb();
  if (!payload.key) throw new Error('drift-resolve: key が必要です');

  const rows = db
    .prepare(
      `SELECT s.machine_id, m.name AS machine, s.path, s.hash, s.content
       FROM snapshots s JOIN machines m ON m.id=s.machine_id
       WHERE s.is_current=1 AND s.kind IN ('claude_md','skill','memory','settings')`,
    )
    .all() as { machine_id: number; machine: string; path: string; hash: string; content: string }[];
  const variants = rows.filter((r) => logicalKey(r.path) === payload.key);
  if (variants.length < 2) return 'drift-resolve: 分岐している端末が 2 未満のためスキップ';

  const varDir = ensureDir(path.join(inputDir, 'variants'));
  for (const v of variants) fs.writeFileSync(path.join(varDir, `${v.machine}.md`), v.content ?? '');
  fs.writeFileSync(
    path.join(inputDir, 'context.md'),
    `論理キー: ${payload.key}\n端末: ${variants.map((v) => v.machine).join(', ')}\n`,
  );

  const res = await runClaude(template('drift-resolve'), { cwd: jobDir, maxTurns: 30 });
  if (!res.ok) throw new Error(`drift-resolve 失敗: ${res.error}`);

  const mergedFile = path.join(outputDir, 'merged.md');
  if (!fs.existsSync(mergedFile)) throw new Error('drift-resolve: output/merged.md が生成されませんでした');
  const merged = fs.readFileSync(mergedFile, 'utf8');
  const rationaleFile = path.join(outputDir, 'rationale.md');
  const rationale = fs.existsSync(rationaleFile) ? fs.readFileSync(rationaleFile, 'utf8') : '';

  let created = 0;
  const ins = db.prepare(
    `INSERT INTO proposals(type, machine_id, target_path, base_hash, new_content, diff, rationale, status, job_id, created_at)
     VALUES('drift', ?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now'))`,
  );
  for (const v of variants) {
    if ((v.content ?? '').trim() === merged.trim()) continue; // 既に一致
    const diff = unifiedDiff(v.content ?? '', merged, path.basename(v.path));
    ins.run(v.machine_id, v.path, v.hash, merged, diff, rationale, payload.job_id ?? null);
    created++;
  }
  return `drift-resolve(${payload.key}): ${created} 端末へ統合提案を作成（cost=$${res.costUsd ?? 0}）`;
}
