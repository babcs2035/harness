'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface KeyRow {
  key: string;
  kind: string;
  cells: Record<string, string>;
  present_on: number;
  diverged: boolean;
}

function shortHash(h: string | undefined): string {
  if (!h) return '';
  return h.replace('sha256:', '').slice(0, 7);
}

export default function DriftPage() {
  const [machines, setMachines] = useState<string[]>([]);
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  function reload() {
    api<{ machines: string[]; keys: KeyRow[] }>('/api/drift')
      .then((d) => {
        setMachines(d.machines);
        setKeys(d.keys);
      })
      .catch((e) => setMsg(`エラー: ${e.message ?? e}`));
  }
  useEffect(reload, []);

  async function resolve(key: string) {
    setMsg(null);
    try {
      // drift-resolve はマシン非依存だが、投入経路の都合で任意の端末 id は不要。
      await api('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({ type: 'analyze', payload: { kind: 'drift-resolve', scope: 'global', key } }),
      });
      setMsg(`統合ジョブを投入しました（${key}）。worker 完了後 Proposals に統合提案が出ます。`);
    } catch (e) {
      setMsg(`投入失敗: ${e instanceof Error ? e.message : e}`);
    }
  }

  // 色分け: 端末ごとに hash を色に対応させ、分岐を視認しやすくする
  const hashColor = (h: string | undefined) => {
    if (!h) return 'var(--muted)';
    let n = 0;
    for (const c of h) n = (n + c.charCodeAt(0)) % 6;
    return ['#4493f8', '#3fb950', '#d29922', '#8957e5', '#db61a2', '#39c5cf'][n];
  };

  return (
    <div>
      <h2>Drift</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        端末間で内容が分岐した CLAUDE.md / skills / memory を検出します（同じ hash＝一致）。
      </p>
      {msg && (
        <div className="panel" style={{ marginBottom: 16 }}>
          {msg}
        </div>
      )}

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>種別</th>
              <th>論理キー</th>
              {machines.map((m) => (
                <th key={m}>{m}</th>
              ))}
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.key} style={{ background: k.diverged ? 'rgba(210,153,34,0.08)' : 'transparent' }}>
                <td>
                  <span className="badge">{k.kind}</span>
                </td>
                <td title={k.key}>
                  {k.key} {k.diverged && <span className="badge warn">分岐</span>}
                </td>
                {machines.map((m) => (
                  <td key={m} style={{ color: hashColor(k.cells[m]), fontFamily: 'monospace' }}>
                    {shortHash(k.cells[m]) || '—'}
                  </td>
                ))}
                <td>
                  {k.diverged && (
                    <button type="button" className="secondary" onClick={() => resolve(k.key)}>
                      統合案を生成
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {keys.length === 0 && (
              <tr>
                <td colSpan={machines.length + 3} className="muted">
                  比較対象がありません。複数端末を収集すると差分が表示されます。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
