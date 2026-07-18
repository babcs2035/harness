'use client';

import { Card, Spin, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { bytes, comma, shortTime } from '@/lib/format';

const { Title, Text } = Typography;

interface Project {
  id: number;
  cwd: string;
  machine: string;
  sessions: number;
  messages: number;
  last_seen_at: string | null;
  has_claude_md: boolean;
  claude_md_size: number;
  claude_md_updated: string | null;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ projects: Project[] }>('/api/projects')
      .then((d) => setProjects(d.projects))
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  const columns: ColumnsType<Project> = [
    {
      title: 'プロジェクト',
      dataIndex: 'cwd',
      key: 'cwd',
      render: (cwd) => cwd.split('/').slice(-2).join('/') || cwd,
    },
    { title: '端末', dataIndex: 'machine', key: 'machine' },
    {
      title: 'セッション',
      dataIndex: 'sessions',
      key: 'sessions',
      width: 100,
      align: 'right',
      render: (v) => comma(v),
    },
    {
      title: '応答数',
      dataIndex: 'messages',
      key: 'messages',
      width: 100,
      align: 'right',
      render: (v) => comma(v),
    },
    {
      title: 'CLAUDE.md',
      dataIndex: 'has_claude_md',
      key: 'has_claude_md',
      width: 80,
      render: (v) => (v ? <Tag color="green">あり</Tag> : <Tag color="orange">なし</Tag>),
    },
    {
      title: 'サイズ',
      dataIndex: 'claude_md_size',
      key: 'claude_md_size',
      width: 100,
      align: 'right',
      render: (v, r) => (r.has_claude_md ? bytes(v) : '-'),
    },
    {
      title: '最終収集',
      dataIndex: 'last_seen_at',
      key: 'last_seen_at',
      render: (v) => <Text type="secondary">{shortTime(v)}</Text>,
    },
  ];

  return (
    <div>
      <Title level={2} style={{ margin: '0 0 8px' }}>
        Projects
      </Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        「よく使うのに CLAUDE.md が薄い」プロジェクトほど上位に並びます（改善の候補）。
      </Text>

      {error && (
        <div
          style={{
            padding: 12,
            marginBottom: 16,
            background: 'rgba(248,81,73,0.15)',
            border: '1px solid #f85149',
            borderRadius: 6,
            color: '#ff7b72',
          }}
        >
          読み込みエラー: {error}
        </div>
      )}
      {!projects && !error && <Spin />}
      {projects && (
        <Card>
          <Table<Project>
            dataSource={projects}
            columns={columns}
            rowKey="id"
            pagination={false}
            locale={{
              emptyText: 'まだプロジェクトがありません。Machines で端末を登録して収集してください。',
            }}
          />
        </Card>
      )}
    </div>
  );
}
