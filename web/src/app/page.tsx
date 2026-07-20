'use client';

import { Card, Col, DatePicker, Row, Segmented, Statistic, Typography } from 'antd';
import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '@/lib/api';
import { comma, compact } from '@/lib/format';

const { Title } = Typography;

interface Daily {
  date: string;
  input_tokens: number;
  output_tokens: number;
  cache_read: number;
  cache_creation: number;
  messages: number;
}
interface StatsResponse {
  daily: Daily[];
  byModel: { model: string; tokens: number; messages: number }[];
  byProject: { project: string; machine: string; tokens: number; messages: number }[];
  sessionsDaily: { date: string; sessions: number }[];
  totals: {
    input_tokens: number;
    output_tokens: number;
    cache_read: number;
    cache_creation: number;
    messages: number;
  };
}

const RANGES = [
  { key: '7d', label: '直近 7 日', days: 7 },
  { key: '30d', label: '直近 30 日', days: 30 },
  { key: 'all', label: '全期間', days: 0 },
  { key: 'custom', label: '期間を指定', days: 0 },
];

const COLORS = {
  output: '#3fb950',
  input: '#4493f8',
  cache_creation: '#d29922',
  sessions: '#8957e5',
};
const BAR_PALETTE = ['#4493f8', '#3fb950', '#d29922', '#8957e5', '#db61a2', '#39c5cf', '#ff7b72'];

function fromDate(days: number): string | undefined {
  if (!days) return undefined;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days + 1);
  return d.toISOString().slice(0, 10);
}

export default function OverviewPage() {
  const [range, setRange] = useState('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [data, setData] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isCustom = !!(customFrom || customTo);

  useEffect(() => {
    const qs = new URLSearchParams();
    if (isCustom) {
      if (customFrom) qs.set('from', customFrom);
      if (customTo) qs.set('to', customTo);
    } else if (range !== 'custom') {
      const days = RANGES.find((r) => r.key === range)?.days ?? 30;
      const from = fromDate(days);
      if (from) qs.set('from', from);
    }
    const qsStr = qs.toString();
    setData(null);
    setError(null);
    api<StatsResponse>(`/api/stats${qsStr ? `?${qsStr}` : ''}`)
      .then(setData)
      .catch((e) => setError(String(e.message ?? e)));
  }, [range, customFrom, customTo, isCustom]);

  function selectRange(key: string) {
    setCustomFrom('');
    setCustomTo('');
    setRange(key);
  }

  return (
    <div>
      <Title level={2} style={{ margin: '0 0 18px' }}>
        Overview
      </Title>

      <Segmented
        value={isCustom ? 'custom' : range}
        onChange={(v) => {
          if (v === 'custom') {
            return;
          }
          selectRange(v as string);
        }}
        options={RANGES.map((r) => ({ label: r.label, value: r.key }))}
        style={{ marginBottom: 16 }}
      />
      <DatePicker.RangePicker
        onChange={(dates) => {
          if (!dates?.[0] || !dates[1]) {
            setRange('30d');
            setCustomFrom('');
            setCustomTo('');
            return;
          }
          setRange('');
          setCustomFrom(dates[0].format('YYYY-MM-DD'));
          setCustomTo(dates[1].format('YYYY-MM-DD'));
        }}
        format="YYYY-MM-DD"
        style={{ marginBottom: 16 }}
      />

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
      {!data && !error && (
        <div
          style={{
            padding: 12,
            marginBottom: 16,
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: 6,
            color: '#8b949e',
          }}
        >
          読み込み中…
        </div>
      )}

      {data && (
        <>
          <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
            <Col span={4}>
              <Card>
                <Statistic
                  title="Output トークン"
                  value={compact(data.totals.output_tokens)}
                  valueStyle={{ fontSize: 22 }}
                />
              </Card>
            </Col>
            <Col span={4}>
              <Card>
                <Statistic
                  title="Input トークン"
                  value={compact(data.totals.input_tokens)}
                  valueStyle={{ fontSize: 22 }}
                />
              </Card>
            </Col>
            <Col span={4}>
              <Card>
                <Statistic
                  title="Cache 作成"
                  value={compact(data.totals.cache_creation)}
                  valueStyle={{ fontSize: 22 }}
                />
              </Card>
            </Col>
            <Col span={4}>
              <Card>
                <Statistic
                  title="Cache 読取"
                  value={compact(data.totals.cache_read)}
                  valueStyle={{ fontSize: 22 }}
                />
              </Card>
            </Col>
            <Col span={4}>
              <Card>
                <Statistic
                  title="アシスタント応答数"
                  value={comma(data.totals.messages)}
                  valueStyle={{ fontSize: 22 }}
                />
              </Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]} style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Col span={12}>
              <Card>
                <Title level={3} style={{ margin: '0 0 12px', color: '#8b949e', fontSize: 14 }}>
                  日別トークン（input / output / cache 作成）
                </Title>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.daily} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(d) => String(d).slice(5)}
                      stroke="#8b949e"
                      fontSize={11}
                    />
                    <YAxis tickFormatter={compact} stroke="#8b949e" fontSize={11} />
                    <Tooltip
                      contentStyle={{
                        background: '#161b22',
                        border: '1px solid #30363d',
                        borderRadius: 8,
                        fontSize: 12,
                        color: '#e6edf3',
                      }}
                      labelStyle={{ color: '#e6edf3' }}
                      itemStyle={{ color: '#e6edf3' }}
                      formatter={(v) => comma(Number(v))}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="output_tokens" name="output" stackId="t" fill={COLORS.output} />
                    <Bar dataKey="input_tokens" name="input" stackId="t" fill={COLORS.input} />
                    <Bar dataKey="cache_creation" name="cache作成" stackId="t" fill={COLORS.cache_creation} />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </Col>

            <Col span={12}>
              <Card>
                <Title level={3} style={{ margin: '0 0 12px', color: '#8b949e', fontSize: 14 }}>
                  セッション数の推移
                </Title>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={data.sessionsDaily} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(d) => String(d).slice(5)}
                      stroke="#8b949e"
                      fontSize={11}
                    />
                    <YAxis allowDecimals={false} stroke="#8b949e" fontSize={11} />
                    <Tooltip
                      contentStyle={{
                        background: '#161b22',
                        border: '1px solid #30363d',
                        borderRadius: 8,
                        fontSize: 12,
                        color: '#e6edf3',
                      }}
                      labelStyle={{ color: '#e6edf3' }}
                      itemStyle={{ color: '#e6edf3' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="sessions"
                      name="セッション"
                      stroke={COLORS.sessions}
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </Card>
            </Col>
          </Row>

          <Card style={{ marginTop: 16 }}>
            <Title level={3} style={{ margin: '0 0 12px', color: '#8b949e', fontSize: 14 }}>
              プロジェクト別トークン（上位）
            </Title>
            <ResponsiveContainer width="100%" height={Math.max(160, data.byProject.length * 28)}>
              <BarChart
                layout="vertical"
                data={data.byProject.map((p) => ({ ...p, short: p.project.split('/').pop() || p.project }))}
                margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#21262d" horizontal={false} />
                <XAxis type="number" tickFormatter={compact} stroke="#8b949e" fontSize={11} />
                <YAxis type="category" dataKey="short" width={140} stroke="#8b949e" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    background: '#161b22',
                    border: '1px solid #30363d',
                    borderRadius: 8,
                    fontSize: 12,
                    color: '#e6edf3',
                  }}
                  formatter={(v) => comma(Number(v))}
                />
                <Bar dataKey="tokens" name="トークン">
                  {data.byProject.map((p, i) => (
                    <Cell key={p.project} fill={BAR_PALETTE[i % BAR_PALETTE.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </>
      )}
    </div>
  );
}
