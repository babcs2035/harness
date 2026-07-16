'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { shortTime } from '@/lib/format';

interface Proposal {
  id: number;
  type: string;
  machine: string;
  machine_id: number;
  target_path: string;
  base_hash: string;
  new_content: string;
  old_content: string;
  diff: string;
  rationale: string;
  status: string;
  created_at: string;
}
interface Machine {
  id: number;
  name: string;
}
interface Pattern {
  id: number;
  description: string;
  count: number;
  status: string;
}

function DiffView({ diff }: { diff: string }) {
  const lines = diff.split('\n');
  return (
    <pre style={{ margin: 0, overflowX: 'auto', fontSize: 12, lineHeight: 1.5 }}>
      {lines.map((l, i) => {
        let color = 'var(--fg)';
        let bg = 'transparent';
        if (l.startsWith('+') && !l.startsWith('+++')) {
          color = '#56d364';
          bg = 'rgba(63,185,80,0.12)';
        } else if (l.startsWith('-') && !l.startsWith('---')) {
          color = '#ff7b72';
          bg = 'rgba(248,81,73,0.12)';
        } else if (l.startsWith('@@')) {
          color = '#8957e5';
        } else if (l.startsWith('+++') || l.startsWith('---')) {
          color = 'var(--muted)';
        }
        return (
          <div key={i} style={{ color, background: bg, whiteSpace: 'pre-wrap' }}>
            {l || ' '}
          </div>
        );
      })}
    </pre>
  );
}

export default function ProposalsPage() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [selMachine, setSelMachine] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<number, string | undefined>>({});

  function reload() {
    api<{ proposals: Proposal[] }>('/api/proposals?status=pending')
      .then((d) => setProposals(d.proposals))
      .catch((e) => setMsg(`エラー: ${e.message ?? e}`));
    api<{ patterns: Pattern[] }>('/api/patterns')
      .then((d) => setPatterns(d.patterns))
      .catch(() => setPatterns([]));
  }
  useEffect(() => {
    reload();
    api<{ machines: Machine[] }>('/api/machines').then((d) => {
      setMachines(d.machines);
      if (d.machines[0]) setSelMachine(d.machines[0].id);
    });
  }, []);

  async function analyze(kind: string) {
    if (!selMachine) {
      setMsg('端末を選択してください');
      return;
    }
    setMsg(null);
    try {
      await api('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({ type: 'analyze', payload: { kind, scope: 'global', machine_id: selMachine } }),
      });
      setMsg(`分析ジョブ(${kind})を投入しました。worker 完了後にここへ提案が出ます（数分後に再読込）。`);
    } catch (e) {
      setMsg(`投入失敗: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function accept(id: number) {
    setMsg(null);
    try {
      const edited = editing[id];
      await api(`/api/proposals/${id}/accept`, {
        method: 'POST',
        body: JSON.stringify(edited !== undefined ? { edited_content: edited } : {}),
      });
      setMsg(`提案#${id} を Accept し、適用ジョブを投入しました。`);
      reload();
    } catch (e) {
      setMsg(`Accept 失敗: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function reject(id: number) {
    try {
      await api(`/api/proposals/${id}/reject`, { method: 'POST' });
      reload();
    } catch (e) {
      setMsg(`Reject 失敗: ${e instanceof Error ? e.message : e}`);
    }
  }

  return (
    <div>
      <h2>Proposals</h2>
      <div className="toolbar">
        <span className="muted">分析対象:</span>
        <select value={selMachine ?? ''} onChange={(e) => setSelMachine(Number(e.target.value))}>
          {machines.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <button className="secondary" onClick={() => analyze('digest-fold')}>
          digest-fold 実行
        </button>
        <button onClick={() => analyze('claude-md-improve')}>CLAUDE.md 改善案</button>
        <button onClick={() => analyze('skill-gen')}>skill 生成</button>
        <button onClick={() => analyze('refactor-scope')}>スコープ再編</button>
        <button className="secondary" onClick={reload}>
          再読込
        </button>
      </div>

      {msg && <div className="panel" style={{ marginBottom: 16 }}>{msg}</div>}

      {patterns.length > 0 && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <h3>繰り返しパターン候補（digest-fold 由来・改善の種）</h3>
          <table>
            <thead>
              <tr>
                <th className="num">出現</th>
                <th>説明</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {patterns.slice(0, 15).map((p) => (
                <tr key={p.id}>
                  <td className="num">{p.count}</td>
                  <td>{p.description}</td>
                  <td>
                    <span className="badge">{p.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {proposals.length === 0 && <div className="panel muted">保留中の提案はありません。</div>}

      {proposals.map((p) => (
        <div className="panel" key={p.id} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div>
              <span className="badge">{p.type}</span>{' '}
              <strong>{p.target_path}</strong> <span className="muted">@ {p.machine}</span>
            </div>
            <span className="muted">{shortTime(p.created_at)}</span>
          </div>

          {p.rationale && (
            <details style={{ marginBottom: 10 }}>
              <summary className="muted">変更理由</summary>
              <pre style={{ whiteSpace: 'pre-wrap', margin: '8px 0', fontSize: 12 }}>{p.rationale}</pre>
            </details>
          )}

          {editing[p.id] === undefined ? (
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, maxHeight: 400, overflowY: 'auto' }}>
              <DiffView diff={p.diff || '(差分表示なし)'} />
            </div>
          ) : (
            <textarea
              value={editing[p.id]}
              onChange={(e) => setEditing({ ...editing, [p.id]: e.target.value })}
              style={{ width: '100%', minHeight: 320, fontFamily: 'monospace' }}
            />
          )}

          <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
            <button onClick={() => accept(p.id)}>{editing[p.id] === undefined ? 'Accept' : 'この内容で Accept'}</button>
            {editing[p.id] === undefined ? (
              <button className="secondary" onClick={() => setEditing({ ...editing, [p.id]: p.new_content })}>
                編集
              </button>
            ) : (
              <button className="secondary" onClick={() => setEditing({ ...editing, [p.id]: undefined })}>
                編集をやめる
              </button>
            )}
            <button className="secondary" onClick={() => reject(p.id)}>
              Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
