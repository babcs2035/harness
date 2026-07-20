'use client';

import { Button, Card, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { shortTime } from '@/lib/format';

const { Title, Text } = Typography;

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

const EMPTY_FORM = { name: '', ssh_host: '', ssh_user: '', workspace_root: '', max_depth: '' };

export default function MachinesPage() {
  const [machines, setMachines] = useState<Machine[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);

  function reload() {
    api<{ machines: Machine[] }>('/api/machines')
      .then((d) => setMachines(d.machines))
      .catch((e) => setMsg(`エラー: ${e.message ?? e}`));
  }
  useEffect(reload, []);

  function startEdit(m: Machine) {
    setEditingId(m.id);
    setForm({
      name: m.name,
      ssh_host: m.ssh_host,
      ssh_user: m.ssh_user,
      workspace_root: m.workspace_root ?? '',
      max_depth: m.max_depth != null ? String(m.max_depth) : '',
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const payload = {
      name: form.name,
      ssh_host: form.ssh_host,
      ssh_user: form.ssh_user,
      workspace_root: form.workspace_root || null,
      max_depth: form.max_depth ? Number(form.max_depth) : null,
    };
    try {
      if (editingId) {
        await api(`/api/machines/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) });
        setMsg(`端末#${editingId} を更新しました。`);
      } else {
        await api('/api/machines', { method: 'POST', body: JSON.stringify(payload) });
        setMsg('端末を登録しました。setup ジョブを自動投入しています。');
      }
      cancelEdit();
      reload();
    } catch (e) {
      setMsg(`${editingId ? '更新' : '登録'}失敗: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function collect(id: number) {
    setMsg(null);
    try {
      await api('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({ type: 'collect', payload: { machine_id: id } }),
      });
      setMsg(`収集ジョブを投入しました（machine#${id}）。worker が処理します。`);
    } catch (e) {
      setMsg(`投入失敗: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function setup(id: number) {
    setMsg(null);
    try {
      await api('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({ type: 'setup', payload: { machine_id: id } }),
      });
      setMsg(`初期設定ジョブを投入しました（machine#${id}）。collector.py 等を配布します。`);
    } catch (e) {
      setMsg(`投入失敗: ${e instanceof Error ? e.message : e}`);
    }
  }

  const columns: ColumnsType<Machine> = [
    { title: '名前', dataIndex: 'name', key: 'name' },
    {
      title: '接続先',
      dataIndex: 'ssh_host',
      key: 'ssh_host',
      width: 200,
      render: (_, r) => (
        <Text type="secondary">
          {r.ssh_user}@{r.ssh_host}
        </Text>
      ),
    },
    {
      title: 'Proj',
      dataIndex: 'project_count',
      key: 'project_count',
      width: 60,
      align: 'right',
      className: 'num',
    },
    {
      title: 'Sess',
      dataIndex: 'session_count',
      key: 'session_count',
      width: 60,
      align: 'right',
      className: 'num',
    },
    {
      title: '最終収集',
      dataIndex: 'last_collected_at',
      key: 'last_collected_at',
      width: 160,
      render: (v) => <Text type="secondary">{shortTime(v)}</Text>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 240,
      render: (_, r) => (
        <Space>
          <Button size="small" type="primary" onClick={() => collect(r.id)}>
            収集
          </Button>
          <Button size="small" onClick={() => setup(r.id)}>
            初期設定
          </Button>
          <Button size="small" onClick={() => startEdit(r)}>
            編集
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={2} style={{ margin: '0 0 18px' }}>
        Machines
      </Title>

      {msg && (
        <div
          style={{
            padding: 12,
            marginBottom: 16,
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: 6,
          }}
        >
          {msg}
        </div>
      )}

      <Card style={{ marginBottom: 16 }}>
        <Title level={3} style={{ margin: '0 0 12px', color: '#8b949e', fontSize: 14 }}>
          登録済み端末
        </Title>
        <Table
          dataSource={machines ?? []}
          columns={columns}
          rowKey="id"
          pagination={false}
          locale={{
            emptyText: '端末がありません。下のフォームから登録してください（Hub 自身は ssh_host=local）。',
          }}
        />
      </Card>

      <Card>
        <Title level={3} style={{ margin: '0 0 12px', color: '#8b949e', fontSize: 14 }}>
          {editingId ? `端末#${editingId} を編集` : '端末を追加'}
        </Title>
        <form className="stack" onSubmit={submitForm}>
          <label htmlFor="machine-name">
            名前
            <input
              id="machine-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </label>
          <label htmlFor="machine-ssh-host">
            SSH ホスト（Hub 自身なら local）
            <input
              id="machine-ssh-host"
              value={form.ssh_host}
              onChange={(e) => setForm({ ...form, ssh_host: e.target.value })}
              required
            />
          </label>
          <label htmlFor="machine-ssh-user">
            SSH ユーザー
            <input
              id="machine-ssh-user"
              value={form.ssh_user}
              onChange={(e) => setForm({ ...form, ssh_user: e.target.value })}
              required
            />
          </label>
          <label htmlFor="machine-workspace-root">
            workspace ルート（省略時 ~/workspace）
            <input
              id="machine-workspace-root"
              value={form.workspace_root}
              onChange={(e) => setForm({ ...form, workspace_root: e.target.value })}
              placeholder="/home/user/workspace"
            />
          </label>
          <label htmlFor="machine-max-depth">
            走査深度（省略時 6）
            <input
              id="machine-max-depth"
              type="number"
              value={form.max_depth}
              onChange={(e) => setForm({ ...form, max_depth: e.target.value })}
            />
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button type="primary" htmlType="submit">
              {editingId ? '更新' : '登録'}
            </Button>
            {editingId && <Button onClick={cancelEdit}>キャンセル</Button>}
          </div>
        </form>
      </Card>
    </div>
  );
}
