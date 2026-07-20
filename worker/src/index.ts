// worker: jobs テーブルをポーリングして直列実行する常駐ループ。
// レート枠と DB 競合を単純化するため同時 1 ジョブ。
import { getDb } from '@harness/shared';
import { runAnalyze } from './jobs/analyze.js';
import { runApply, runRollback } from './jobs/apply.js';
import { runCleanup } from './jobs/cleanup.js';
import { runCollect } from './jobs/collect.js';
import { runSetup } from './jobs/setup.js';
import { shutdown } from './ssh.js';

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_MS || 3000);
/** ジョブが zombie（running 状態のまま長時間経過）とみなす秒数。デフォルト 1 時間。 */
const ZOMBIE_THRESHOLD_S = Number(process.env.WORKER_ZOMBIE_THRESHOLD_S || 3600);

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
  // より具体的なパターンを先にチェック（"rate limit exceeded: unauthorized" 等の複合エラー対策）
  if (/(rate.?limit|429|quota|usage.?limit)/.test(m)) return 'rate_limit';
  if (/(unauthorized|forbidden|permission.?denied|invalid.?token|login.?fail)/.test(m)) return 'auth';
  if (/(timeout|econnrefused|enetunreach|connection.?reset|temporary.?failure)/.test(m)) return 'transient';
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
      throw new Error(`unsupported job type: ${job.type}`);
  }
}

async function runOne(db: ReturnType<typeof getDb>): Promise<boolean> {
  // queued のジョブがない場合、zombie（running 状態が長時間継続）を再実行対象に含める
  const job = db
    .prepare(
      `SELECT id, type, payload FROM jobs
       WHERE status='queued'
       ORDER BY id LIMIT 1`,
    )
    .get() as JobRow | undefined;

  if (!job) {
    // zombie ジョブを検出: started_at が ZOMBIE_THRESHOLD_S 秒より前の running ジョブ
    const cutoff = new Date(Date.now() - ZOMBIE_THRESHOLD_S * 1000).toISOString();
    const zombie = db
      .prepare(
        `SELECT id, type, payload FROM jobs
         WHERE status='running' AND started_at < ?
         ORDER BY id LIMIT 1`,
      )
      .get(cutoff) as JobRow | undefined;
    if (zombie) {
      console.log(`[worker] zombie job#${zombie.id} detected, resetting to queued`);
      db.prepare("UPDATE jobs SET status='queued', started_at=NULL WHERE id=?").run(zombie.id);
    }
    return false;
  }

  db.prepare("UPDATE jobs SET status='running', started_at=datetime('now') WHERE id=?").run(job.id);
  console.log(`[worker] job#${job.id} ${job.type} started`);
  try {
    const log = await dispatch(job);
    db.prepare("UPDATE jobs SET status='done', finished_at=datetime('now'), log=? WHERE id=?").run(
      log,
      job.id,
    );
    console.log(`[worker] job#${job.id} done: ${log}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const kind = classifyError(msg);
    db.prepare(
      "UPDATE jobs SET status='failed', finished_at=datetime('now'), log=?, error_kind=?, acknowledged=0 WHERE id=?",
    ).run(msg, kind, job.id);
    console.error(`[worker] job#${job.id} failed (${kind}): ${msg}`);
  }
  return true;
}

async function main(): Promise<void> {
  // グローバルシグナルハンドラ: SIGTERM/SIGINT で子プロセスを一括 kill 後終了
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  const db = getDb();
  console.log('[worker] started, polling jobs');
  for (;;) {
    let worked = false;
    try {
      worked = await runOne(db);
    } catch (err) {
      console.error('[worker] loop error', err);
    }
    if (!worked) await sleep(POLL_INTERVAL_MS);
  }
}

main().catch((err) => {
  console.error('[worker] fatal error', err);
  process.exit(1);
});
