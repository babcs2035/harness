// worker: jobs テーブルをポーリングして直列実行する常駐ループ。
// レート枠と DB 競合を単純化するため同時 1 ジョブ。
import { getDb } from '@harness/shared';
import { runAnalyze } from './jobs/analyze.js';
import { runApply, runRollback } from './jobs/apply.js';
import { runCleanup } from './jobs/cleanup.js';
import { runCollect } from './jobs/collect.js';
import { runSetup } from './jobs/setup.js';

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_MS || 3000);

interface JobRow {
  id: number;
  type: string;
  payload: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** エラーメッセージから再試行可能性の種別を粗く分類する（ダッシュボード表示・運用判断用）。 */
export function classifyError(message: string): string {
  const m = message.toLowerCase();
  if (/(unauthor|forbidden|permission|auth|token|login)/.test(m)) return 'auth';
  if (/(rate.?limit|429|quota|usage limit)/.test(m)) return 'rate_limit';
  if (/(timeout|econnrefused|enetunreach|temporar|connection|reset)/.test(m)) return 'transient';
  return 'fatal';
}

async function dispatch(job: JobRow): Promise<string> {
  const payload = job.payload ? JSON.parse(job.payload) : {};
  switch (job.type) {
    case 'setup':
      return runSetup(payload);
    case 'collect':
      return runCollect(payload.machine_id, { fullResync: !!payload.full_resync });
    case 'analyze':
      return runAnalyze({ ...payload, job_id: job.id });
    case 'apply':
      return runApply(payload);
    case 'rollback':
      return runRollback(payload);
    case 'cleanup':
      return runCleanup();
    default:
      throw new Error(`未対応のジョブ種別: ${job.type}`);
  }
}

async function runOne(db: ReturnType<typeof getDb>): Promise<boolean> {
  const job = db
    .prepare("SELECT id, type, payload FROM jobs WHERE status='queued' ORDER BY id LIMIT 1")
    .get() as JobRow | undefined;
  if (!job) return false;

  db.prepare("UPDATE jobs SET status='running', started_at=datetime('now') WHERE id=?").run(job.id);
  console.log(`[worker] job#${job.id} ${job.type} 開始`);
  try {
    const log = await dispatch(job);
    db.prepare("UPDATE jobs SET status='done', finished_at=datetime('now'), log=? WHERE id=?").run(
      log,
      job.id,
    );
    console.log(`[worker] job#${job.id} 完了: ${log}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const kind = classifyError(msg);
    db.prepare(
      "UPDATE jobs SET status='failed', finished_at=datetime('now'), log=?, error_kind=?, acknowledged=0 WHERE id=?",
    ).run(msg, kind, job.id);
    console.error(`[worker] job#${job.id} 失敗 (${kind}): ${msg}`);
  }
  return true;
}

async function main(): Promise<void> {
  const db = getDb();
  console.log('[worker] 起動。jobs をポーリングします');
  for (;;) {
    let worked = false;
    try {
      worked = await runOne(db);
    } catch (err) {
      console.error('[worker] ループエラー', err);
    }
    if (!worked) await sleep(POLL_INTERVAL_MS);
  }
}

main().catch((err) => {
  console.error('[worker] 致命的エラー', err);
  process.exit(1);
});
