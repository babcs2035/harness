// ジョブ投入 CLI。scheduler（cron）や手動投入から使う。
//   node dist/enqueue.js collect '{"machine_id":1}'
//   node dist/enqueue.js daily          # 全 enabled 端末の collect（Phase 2 以降で提案生成/cleanup も連結）
import { getDb } from '@harness/shared';

function enqueue(type: string, payload: Record<string, unknown>): number {
  const db = getDb();
  const r = db
    .prepare("INSERT INTO jobs(type, payload, status, created_at) VALUES(?, ?, 'queued', datetime('now'))")
    .run(type, JSON.stringify(payload));
  return Number(r.lastInsertRowid);
}

function main(): void {
  const [, , type, rawPayload] = process.argv;
  if (!type) {
    console.error('usage: enqueue <type> [json-payload] | daily');
    process.exit(1);
  }

  if (type === 'daily') {
    const db = getDb();
    const machines = db.prepare('SELECT id, name FROM machines WHERE enabled=1').all() as {
      id: number;
      name: string;
    }[];
    // worker は直列実行。この投入順で「当日の収集を反映した提案」になる:
    //   全機 collect → 全機 digest-fold → 全機 CLAUDE.md 改善提案 → cleanup
    for (const m of machines) enqueue('collect', { machine_id: m.id });
    for (const m of machines) enqueue('analyze', { kind: 'digest-fold', scope: 'global', machine_id: m.id });
    for (const m of machines)
      enqueue('analyze', { kind: 'claude-md-improve', scope: 'global', machine_id: m.id });
    enqueue('cleanup', {});
    console.log(
      `daily: enqueued collect/digest-fold/claude-md-improve for ${machines.length} machines, plus cleanup`,
    );
    return;
  }

  const payload = rawPayload ? JSON.parse(rawPayload) : {};
  const id = enqueue(type, payload);
  console.log(`enqueued job#${id} type=${type}`);
}

main();
