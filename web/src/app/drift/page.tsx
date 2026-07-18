'use client';

import { Button, Card, Spin, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

const { Title, Text } = Typography;

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
      await api('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({ type: 'analyze', payload: { kind: 'drift-resolve', scope: 'global', key } }),
      });
      setMsg(`統合ジョブを投入しました（${key}）。worker 完了後 Proposals に統合提案が出ます。`);
    } catch (e) {
      setMsg(`投入失敗: ${e instanceof Error ? e.message : e}`);
    }
  }

  const hashColor = (h: string | undefined) => {
    if (!h) return '#8b949e';
    let n = 0;
    for (const c of h) n = (n + c.charCodeAt(0)) % 6;
    return ['#4493f8', '#3fb950', '#d29922', '#8957e5', '#db61a2', '#39c5cf'][n];
  };

  const columns: ColumnsType<KeyRow> = [
    {
      title: '種別',
      dataIndex: 'kind',
      key: 'kind',
      width: 100,
      render: (v) => <Tag>{v}</Tag>,
    },
    {
      title: '論理キー',
      dataIndex: 'key',
      key: 'key',
      render: (v, r) => (
        <span>
          {v} {r.diverged && <Tag color="orange">分岐</Tag>}
        </span>
      ),
    },
    ...machines.map((m) => ({
      title: m,
      key: m,
      width: 100,
      render: (r: KeyRow) => (
        <span style={{ color: hashColor(r.cells[m]), fontFamily: 'monospace' }}>
          {shortHash(r.cells[m]) || '—'}
        </span>
      ),
    })),
    {
      title: '操作',
      key: 'actions',
      width: 140,
      render: (r) =>
        r.diverged ? (
          <Button size="small" onClick={() => resolve(r.key)}>
            統合案を生成
          </Button>
        ) : null,
    },
  ];

  return (
    <div>
      <Title level={2} style={{ margin: '0 0 8px' }}>
        Drift
      </Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        端末間で内容が分岐した CLAUDE.md / skills / memory を検出します（同じ hash＝一致）。
      </Text>

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

      <Spin spinning={!keys.length && !msg}>
        <Card>
          <Table<KeyRow>
            dataSource={keys}
            columns={columns}
            rowKey="key"
            pagination={false}
            locale={{ emptyText: '比較対象がありません。複数端末を収集すると差分が表示されます。' }}
            rowClassName={(r) => (r.diverged ? 'diverged' : '')}
          />
        </Card>
      </Spin>
    </div>
  );
}
