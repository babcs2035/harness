import path from 'node:path';
import { mkdirSync } from 'node:fs';

/** data ルート（DB_PATH の親）。Tier1/Tier2/ジョブ入出力の実体を置く。 */
export const DATA_DIR = process.env.DATA_DIR || path.dirname(process.env.DB_PATH || '/data/harness.db');
export const INCREMENTS_DIR = process.env.INCREMENTS_DIR || path.join(DATA_DIR, 'increments');
export const DIGESTS_DIR = process.env.DIGESTS_DIR || path.join(DATA_DIR, 'digests');
export const JOBS_DIR = process.env.JOBS_DIR || path.join(DATA_DIR, 'jobs');
/** 開発機に配布する collector.py / apply.py の在処（Hub 上） */
export const AGENT_DIR = process.env.AGENT_DIR || path.resolve(process.cwd(), '../agent');
export const PROMPTS_DIR = process.env.PROMPTS_DIR || path.resolve(process.cwd(), '../prompts');

export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}
