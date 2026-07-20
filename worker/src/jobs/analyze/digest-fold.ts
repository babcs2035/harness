// digest-fold: Tier1 増分を Tier2 ダイジェストに折り畳む。

import fs from 'node:fs';
import path from 'node:path';
import { runClaude } from '../../claude.js';
import { ensureDir, PROMPTS_DIR } from '../../lib/paths.js';
import {
  loadDigest,
  markTier1Consumed,
  saveDigest,
  unconsumedTier1,
  upsertPatterns,
} from '../../lib/tier.js';

function template(kind: string): string {
  return fs.readFileSync(path.join(PROMPTS_DIR, `${kind}.md`), 'utf8');
}

export interface DigestFoldPayload {
  scope: 'global' | 'machine' | 'project';
  machine_id?: number;
  job_id?: number;
  model?: string;
}

export async function runDigestFold(
  payload: DigestFoldPayload,
  jobDir: string,
  inputDir: string,
  outputDir: string,
): Promise<string> {
  const incs = unconsumedTier1(payload.machine_id);
  if (incs.length === 0) return 'digest-fold: no unconsumed increments, skipped';

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

  const res = await runClaude(template('digest-fold'), { cwd: jobDir, maxTurns: 30, model: payload.model });
  if (!res.ok) throw new Error(`digest-fold failed: ${res.error}`);

  const digestFile = path.join(outputDir, 'digest.json');
  if (!fs.existsSync(digestFile)) throw new Error('digest-fold: output/digest.json was not generated');
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
  return `digest-fold: folded ${copied} increments (patterns=${Array.isArray(digest.patterns) ? digest.patterns.length : 0}, cost=$${res.costUsd ?? 0})`;
}
