// worker: jobs テーブルをポーリングして直列実行する常駐ループ。
// Phase 0 は足場のみ（キューが空なら待機）。ジョブ実装は Phase 1 以降。
import { getDb } from '@harness/shared';

const POLL_INTERVAL_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const db = getDb();
  console.log('[worker] 起動。jobs をポーリングします');

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const job = db
      .prepare("SELECT id, type FROM jobs WHERE status='queued' ORDER BY id LIMIT 1")
      .get() as { id: number; type: string } | undefined;

    if (!job) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    console.log(`[worker] job#${job.id} type=${job.type}（Phase 1 以降で実処理を実装）`);
    // 未実装ジョブはスキップ扱いにして無限ループを防ぐ
    db.prepare("UPDATE jobs SET status='failed', log='handler 未実装', finished_at=datetime('now') WHERE id=?").run(
      job.id,
    );
  }
}

main().catch((err) => {
  console.error('[worker] 致命的エラー', err);
  process.exit(1);
});
