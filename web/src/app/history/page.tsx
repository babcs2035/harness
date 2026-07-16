'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { shortTime } from '@/lib/format';

interface ApplyLog {
  id: number;
  proposal_id: number;
  backup_path: string | null;
  applied_at: string | null;
  rolled_back_at: string | null;
  proposal_type: string;
  target_path: string;
  proposal_status: string;
  machine: string;
}
interface Job {
  id: number;
  type: string;
  status: string;
  error_kind: string | null;
  acknowledged: number;
  created_at: string | null;
  finished_at: string | null;
  log: string | null;
  cost_usd: number | null;
}

export default function HistoryPage() {
  const [applyLogs, setApplyLogs] = useState<ApplyLog[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  function reload() {
    api<{ applyLogs: ApplyLog[]; jobs: Job[] }>('/api/history')
      .then((d) => {
        setApplyLogs(d.applyLogs);
        setJobs(d.jobs);
      })
      .catch((e) => setMsg(`エラー: ${e.message ?? e}`));
  }
  useEffect(reload, []);

  async function rollback(applyLogId: number) {
    setMsg(null);
    try {
      await api(`/api/history/${applyLogId}/rollback`, { method: 'POST' });
      setMsg(`ロールバックジョブを投入しました（apply_log#${applyLogId}）。worker が処理します。`);
    } catch (e) {
      setMsg(`ロールバック失敗: ${e instanceof Error ? e.message : e}`);
    }
  }

  const badge = (s: string) =>
    s === 'done' ? 'badge ok' : s === 'failed' ? 'badge err' : 'badge';

  return (
    <div>
      <h2>History</h2>
      {msg && <div className="panel" style={{ marginBottom: 16 }}>{msg}</div>}

      <div className="panel" style={{ marginBottom: 16 }}>
        <h3>適用履歴</h3>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>対象</th>
              <th>端末</th>
              <th>適用</th>
              <th>状態</th>
              <th>バックアップ</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {applyLogs.map((a) => (
              <tr key={a.id}>
                <td>{a.id}</td>
                <td title={a.target_path}>
                  <span className="badge">{a.proposal_type}</span> {a.target_path.split('/').slice(-2).join('/')}
                </td>
                <td>{a.machine}</td>
                <td className="muted">{shortTime(a.applied_at)}</td>
                <td>
                  {a.rolled_back_at ? (
                    <span className="badge warn">rolled back</span>
                  ) : (
                    <span className="badge ok">applied</span>
                  )}
                </td>
                <td className="muted" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }} title={a.backup_path ?? ''}>
                  {a.backup_path?.split('/').slice(-1)[0] ?? '-'}
                </td>
                <td>
                  {!a.rolled_back_at && (
                    <button className="secondary" onClick={() => rollback(a.id)}>
                      ロールバック
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {applyLogs.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  適用履歴はまだありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h3>ジョブログ</h3>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>種別</th>
              <th>状態</th>
              <th>コスト</th>
              <th>完了</th>
              <th>ログ</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td>{j.id}</td>
                <td>{j.type}</td>
                <td>
                  <span className={badge(j.status)}>{j.status}</span>
                  {j.error_kind && <span className="muted"> ({j.error_kind})</span>}
                </td>
                <td className="num">{j.cost_usd ? `$${j.cost_usd.toFixed(3)}` : '-'}</td>
                <td className="muted">{shortTime(j.finished_at)}</td>
                <td className="muted" style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis' }} title={j.log ?? ''}>
                  {j.log ?? ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
