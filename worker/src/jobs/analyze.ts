// analyze: 分析ジョブのルーティング。各種別は analyze/ 配下の個別ファイルに実装。

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, JOBS_DIR } from '../lib/paths.js';
import { runClaudeMdImprove } from './analyze/claude-md-improve.js';
import { runDigestFold } from './analyze/digest-fold.js';
import { runDriftResolve } from './analyze/drift-resolve.js';
import { runRefactorScope } from './analyze/refactor-scope.js';
import { runSkillGen } from './analyze/skill-gen.js';

export interface AnalyzePayload {
  kind: string;
  scope: 'global' | 'machine' | 'project';
  machine_id?: number;
  project_id?: number;
  key?: string;
  job_id?: number;
  model?: string;
}

export async function runAnalyze(payload: AnalyzePayload): Promise<string> {
  const jobDir = path.join(JOBS_DIR, randomUUID());
  const inputDir = ensureDir(path.join(jobDir, 'input'));
  const outputDir = ensureDir(path.join(jobDir, 'output'));

  try {
    switch (payload.kind) {
      case 'digest-fold':
        return await runDigestFold(
          {
            scope: payload.scope,
            machine_id: payload.machine_id,
            job_id: payload.job_id,
            model: payload.model,
          },
          jobDir,
          inputDir,
          outputDir,
        );
      case 'claude-md-improve':
        return await runClaudeMdImprove(
          {
            scope: payload.scope,
            machine_id: payload.machine_id as number,
            project_id: payload.project_id,
            job_id: payload.job_id,
            model: payload.model,
          },
          jobDir,
          inputDir,
          outputDir,
        );
      case 'skill-gen':
        return await runSkillGen(
          { machine_id: payload.machine_id as number, job_id: payload.job_id, model: payload.model },
          jobDir,
          inputDir,
          outputDir,
        );
      case 'refactor-scope':
        return await runRefactorScope(
          { machine_id: payload.machine_id as number, job_id: payload.job_id, model: payload.model },
          jobDir,
          inputDir,
          outputDir,
        );
      case 'drift-resolve':
        return await runDriftResolve(
          { key: payload.key as string, job_id: payload.job_id, model: payload.model },
          jobDir,
          inputDir,
          outputDir,
        );
      default:
        throw new Error(`unsupported analyze kind: ${payload.kind}`);
    }
  } finally {
    // ジョブディレクトリは使い捨て。成否に関わらず削除（増分は Tier1 に永続）。
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}
