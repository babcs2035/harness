'use client';

import { Button, Card, Select, Space, Table, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { shortTime } from '@/lib/format';

const { Title, Text } = Typography;

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

const ANALYZE_KINDS = [
  { key: 'digest-fold', label: 'digest-fold（増分の折り畳み）' },
  { key: 'claude-md-improve', label: 'CLAUDE.md 改善案' },
  { key: 'skill-gen', label: 'skill 生成' },
  { key: 'refactor-scope', label: 'スコープ再編' },
];

const MODELS = [
  { key: '', label: '既定モデル' },
  { key: 'claude-opus-4-8', label: 'Opus 4.8' },
  { key: 'claude-sonnet-5', label: 'Sonnet 5' },
  { key: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
];

function DiffView({ diff }: { diff: string }) {
  const lines = diff.split('\n');
  return (
    <pre style={{ margin: 0, overflowX: 'auto', fontSize: 12, lineHeight: 1.5 }}>
      {lines.map((l, i) => {
        let color = '#e6edf3';
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
          color = '#8b949e';
        }
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: diff 行は同一内容が繰り返されうるため行番号以外に安定した key を持たない
          <div key={`diff-${i}`} style={{ color, background: bg, whiteSpace: 'pre-wrap' }}>
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
  const [selKind, setSelKind] = useState(ANALYZE_KINDS[0]?.key ?? '');
  const [selModel, setSelModel] = useState(MODELS[0]?.key ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<number, string | undefined>>({});

  const reload = useCallback(() => {
    api<{ proposals: Proposal[] }>('/api/proposals?status=pending')
      .then((d) => setProposals(d.proposals))
      .catch((e) => setMsg(`エラー: ${e.message ?? e}`));
    api<{ patterns: Pattern[] }>('/api/patterns')
      .then((d) => setPatterns(d.patterns))
      .catch(() => setPatterns([]));
  }, []);
  useEffect(() => {
    reload();
    api<{ machines: Machine[] }>('/api/machines').then((d) => {
      setMachines(d.machines);
      if (d.machines[0]) setSelMachine(d.machines[0].id);
    });
  }, [reload]);

  async function analyze() {
    if (!selMachine) {
      setMsg('端末を選択してください');
      return;
    }
    setMsg(null);
    try {
      await api('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({
          type: 'analyze',
          payload: { kind: selKind, scope: 'global', machine_id: selMachine, model: selModel || undefined },
        }),
      });
      setMsg(`分析ジョブ(${selKind})を投入しました。worker 完了後にここへ提案が出ます（数分後に再読込）。`);
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
      <Title level={2} style={{ margin: '0 0 18px' }}>
        Proposals
      </Title>

      <Card style={{ marginBottom: 16 }}>
        <Title level={3} style={{ margin: '0 0 12px', color: '#8b949e', fontSize: 14 }}>
          分析を実行
        </Title>
        <Space wrap style={{ marginBottom: 0 }}>
          <Space>
            <Text type="secondary">対象端末</Text>
            <Select
              value={selMachine ?? undefined}
              onChange={(v) => setSelMachine(v)}
              style={{ width: 160 }}
              placeholder="端末選択"
              options={machines.map((m) => ({ value: m.id, label: m.name }))}
            />
          </Space>
          <Space>
            <Text type="secondary">分析種別</Text>
            <Select
              value={selKind}
              onChange={setSelKind}
              style={{ width: 200 }}
              options={ANALYZE_KINDS.map((k) => ({ value: k.key, label: k.label }))}
            />
          </Space>
          <Space>
            <Text type="secondary">モデル</Text>
            <Select
              value={selModel}
              onChange={setSelModel}
              style={{ width: 140 }}
              options={MODELS.map((m) => ({ value: m.key, label: m.label }))}
            />
          </Space>
          <Button type="primary" onClick={analyze}>
            実行
          </Button>
          <Button onClick={reload}>再読込</Button>
        </Space>
      </Card>

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

      {patterns.length > 0 && (
        <Card style={{ marginBottom: 16 }}>
          <Title level={3} style={{ margin: '0 0 12px', color: '#8b949e', fontSize: 14 }}>
            繰り返しパターン候補（digest-fold 由来・改善の種）
          </Title>
          <Table
            dataSource={patterns.slice(0, 15)}
            rowKey="id"
            pagination={false}
            size="small"
            columns={[
              { title: '出現', dataIndex: 'count', key: 'count', width: 80, align: 'right' },
              { title: '説明', dataIndex: 'description', key: 'description' },
              { title: '状態', dataIndex: 'status', key: 'status', width: 100 },
            ]}
          />
        </Card>
      )}

      {proposals.length === 0 && (
        <div
          style={{
            padding: 12,
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: 6,
            color: '#8b949e',
          }}
        >
          保留中の提案はありません。
        </div>
      )}

      {proposals.map((p) => (
        <Card key={p.id} style={{ marginBottom: 16 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 10,
            }}
          >
            <div>
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: 999,
                  fontSize: 11,
                  border: '1px solid #30363d',
                  background: 'rgba(68,147,248,0.15)',
                  color: '#4493f8',
                }}
              >
                {p.type}
              </span>{' '}
              <strong>{p.target_path}</strong> <Text type="secondary">@ {p.machine}</Text>
            </div>
            <Text type="secondary">{shortTime(p.created_at)}</Text>
          </div>

          {p.rationale && (
            <details style={{ marginBottom: 10 }}>
              <summary style={{ color: '#8b949e', fontSize: 13, cursor: 'pointer' }}>変更理由</summary>
              <pre style={{ whiteSpace: 'pre-wrap', margin: '8px 0', fontSize: 12 }}>{p.rationale}</pre>
            </details>
          )}

          {editing[p.id] === undefined ? (
            <div
              style={{
                border: '1px solid #30363d',
                borderRadius: 8,
                padding: 10,
                maxHeight: 400,
                overflowY: 'auto',
              }}
            >
              <DiffView diff={p.diff || '(差分表示なし)'} />
            </div>
          ) : (
            <textarea
              value={editing[p.id]}
              onChange={(e) => setEditing({ ...editing, [p.id]: e.target.value })}
              style={{
                width: '100%',
                minHeight: 320,
                fontFamily: 'monospace',
                background: '#0e1116',
                color: '#e6edf3',
                border: '1px solid #30363d',
                borderRadius: 6,
                padding: 8,
              }}
            />
          )}

          <Space style={{ marginTop: 12 }}>
            <Button type="primary" onClick={() => accept(p.id)}>
              {editing[p.id] === undefined ? 'Accept' : 'この内容で Accept'}
            </Button>
            {editing[p.id] === undefined ? (
              <Button onClick={() => setEditing({ ...editing, [p.id]: p.new_content })}>編集</Button>
            ) : (
              <Button onClick={() => setEditing({ ...editing, [p.id]: undefined })}>編集をやめる</Button>
            )}
            <Button danger onClick={() => reject(p.id)}>
              Reject
            </Button>
          </Space>
        </Card>
      ))}
    </div>
  );
}
