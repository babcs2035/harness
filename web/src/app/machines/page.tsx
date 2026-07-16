'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { shortTime } from '@/lib/format';

interface Machine {
  id: number;
  name: string;
  ssh_host: string;
  ssh_user: string;
  enabled: number;
  workspace_root: string | null;
  max_depth: number | null;
  last_collected_at: string | null;
  session_count: number;
  project_count: number;
}

export default function MachinesPage() {
  const [machines, setMachines] = useState<Machine[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', ssh_host: '', ssh_user: '', workspace_root: '', max_depth: '' });

  function reload() {
    api<{ machines: Machine[] }>('/api/machines')
      .then((d) => setMachines(d.machines))
      .catch((e) => setMsg(`エラー: ${e.message ?? e}`));
  }
  useEffect(reload, []);

  async function addMachine(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await api('/api/machines', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          ssh_host: form.ssh_host,
          ssh_user: form.ssh_user,
          workspace_root: form.workspace_root || null,
          max_depth: form.max_depth ? Number(form.max_depth) : null,
        }),
      });
      setForm({ name: '', ssh_host: '', ssh_user: '', workspace_root: '', max_depth: '' });
      setMsg('端末を登録しました。');
      reload();
    } catch (e) {
      setMsg(`登録失敗: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function collect(id: number, fullResync: boolean) {
    setMsg(null);
    try {
      await api('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({ type: 'collect', payload: { machine_id: id, full_resync: fullResync } }),
      });
      setMsg(`収集ジョブを投入しました（machine#${id}${fullResync ? ' / full-resync' : ''}）。worker が処理します。`);
    } catch (e) {
      setMsg(`投入失敗: ${e instanceof Error ? e.message : e}`);
    }
  }

  return (
    <div>
      <h2>Machines</h2>
      {msg && (
        <div className="panel" style={{ marginBottom: 16 }}>
          {msg}
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: '1fr 420px' }}>
        <div className="panel">
          <h3>登録済み端末</h3>
          <table>
            <thead>
              <tr>
                <th>名前</th>
                <th>接続先</th>
                <th className="num">Proj</th>
                <th className="num">Sess</th>
                <th>最終収集</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {machines?.map((m) => (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td className="muted">
                    {m.ssh_user}@{m.ssh_host}
                  </td>
                  <td className="num">{m.project_count}</td>
                  <td className="num">{m.session_count}</td>
                  <td className="muted">{shortTime(m.last_collected_at)}</td>
                  <td>
                    <button onClick={() => collect(m.id, false)}>収集</button>{' '}
                    <button className="secondary" onClick={() => collect(m.id, true)}>
                      full
                    </button>
                  </td>
                </tr>
              ))}
              {machines?.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    端末がありません。右のフォームから登録してください（Hub 自身は ssh_host=local）。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h3>端末を追加</h3>
          <form className="stack" onSubmit={addMachine}>
            <label>
              名前
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label>
              SSH ホスト（Hub 自身なら local）
              <input value={form.ssh_host} onChange={(e) => setForm({ ...form, ssh_host: e.target.value })} required />
            </label>
            <label>
              SSH ユーザー
              <input value={form.ssh_user} onChange={(e) => setForm({ ...form, ssh_user: e.target.value })} required />
            </label>
            <label>
              workspace ルート（省略時 ~/workspace）
              <input
                value={form.workspace_root}
                onChange={(e) => setForm({ ...form, workspace_root: e.target.value })}
                placeholder="/home/user/workspace"
              />
            </label>
            <label>
              走査深度（省略時 6）
              <input
                type="number"
                value={form.max_depth}
                onChange={(e) => setForm({ ...form, max_depth: e.target.value })}
              />
            </label>
            <button type="submit">登録</button>
          </form>
        </div>
      </div>
    </div>
  );
}
