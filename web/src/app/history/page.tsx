'use client';

import { Button, Card, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { shortTime } from '@/lib/format';

const { Title, Text } = Typography;

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

  const statusTag = (s: string, kind?: string) => {
    if (s === 'done') return <Tag color="green">{s}</Tag>;
    if (s === 'failed')
      return (
        <Tag color="red">
          {s}
          {kind ? ` (${kind})` : ''}
        </Tag>
      );
    return <Tag>{s}</Tag>;
  };

  const applyColumns: ColumnsType<ApplyLog> = [
    { title: '#', dataIndex: 'id', key: 'id', width: 60 },
    {
      title: '対象',
      key: 'target',
      render: (_, r) => (
        <span>
          <Tag>{r.proposal_type}</Tag> {r.target_path.split('/').slice(-2).join('/')}
        </span>
      ),
    },
    { title: '端末', dataIndex: 'machine', key: 'machine' },
    {
      title: '適用',
      dataIndex: 'applied_at',
      key: 'applied_at',
      render: (v) => <Text type="secondary">{shortTime(v)}</Text>,
    },
    {
      title: '状態',
      dataIndex: 'rolled_back_at',
      key: 'status',
      width: 120,
      render: (_, r) =>
        r.rolled_back_at ? <Tag color="orange">rolled back</Tag> : <Tag color="green">applied</Tag>,
    },
    {
      title: 'バックアップ',
      dataIndex: 'backup_path',
      key: 'backup',
      width: 200,
      ellipsis: true,
      render: (v) => v?.split('/').slice(-1)[0] ?? '-',
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_, r) =>
        !r.rolled_back_at ? (
          <Button size="small" onClick={() => rollback(r.id)}>
            ロールバック
          </Button>
        ) : null,
    },
  ];

  const jobColumns: ColumnsType<Job> = [
    { title: '#', dataIndex: 'id', key: 'id', width: 60 },
    { title: '種別', dataIndex: 'type', key: 'type', width: 100 },
    {
      title: '状態',
      dataIndex: 'status',
      key: 'status',
      width: 140,
      render: (_, r) => statusTag(r.status, r.error_kind ?? undefined),
    },
    {
      title: 'コスト',
      dataIndex: 'cost_usd',
      key: 'cost_usd',
      width: 80,
      align: 'right',
      render: (v) => (v ? `$${v.toFixed(3)}` : '-'),
    },
    {
      title: '完了',
      dataIndex: 'finished_at',
      key: 'finished_at',
      render: (v) => <Text type="secondary">{shortTime(v)}</Text>,
    },
    { title: 'ログ', dataIndex: 'log', key: 'log', ellipsis: true, render: (v) => v ?? '' },
  ];

  return (
    <div>
      <Title level={2} style={{ margin: '0 0 18px' }}>
        History
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
          適用履歴
        </Title>
        <Table<ApplyLog>
          dataSource={applyLogs}
          columns={applyColumns}
          rowKey="id"
          pagination={false}
          locale={{ emptyText: '適用履歴はまだありません。' }}
        />
      </Card>

      <Card>
        <Title level={3} style={{ margin: '0 0 12px', color: '#8b949e', fontSize: 14 }}>
          ジョブログ
        </Title>
        <Table<Job> dataSource={jobs} columns={jobColumns} rowKey="id" pagination={false} />
      </Card>
    </div>
  );
}
