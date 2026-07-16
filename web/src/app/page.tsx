'use client';

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
import { compact, comma } from '@/lib/format';

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
];

// カテゴリカル配色（暗背景で識別しやすい・一貫使用）
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

const tooltipStyle = {
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: 8,
  fontSize: 12,
};

export default function OverviewPage() {
  const [range, setRange] = useState('30d');
  const [data, setData] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const days = RANGES.find((r) => r.key === range)?.days ?? 30;
    const from = fromDate(days);
    const qs = from ? `?from=${from}` : '';
    setData(null);
    setError(null);
    api<StatsResponse>(`/api/stats${qs}`)
      .then(setData)
      .catch((e) => setError(String(e.message ?? e)));
  }, [range]);

  return (
    <div>
      <h2>Overview</h2>
      <div className="toolbar">
        {RANGES.map((r) => (
          <button key={r.key} className={r.key === range ? '' : 'secondary'} onClick={() => setRange(r.key)}>
            {r.label}
          </button>
        ))}
      </div>

      {error && <div className="panel badge err">読み込みエラー: {error}</div>}
      {!data && !error && <div className="panel muted">読み込み中…</div>}

      {data && (
        <>
          <div className="stat-row">
            <Stat label="Output トークン" value={compact(data.totals.output_tokens)} />
            <Stat label="Input トークン" value={compact(data.totals.input_tokens)} />
            <Stat label="Cache 作成" value={compact(data.totals.cache_creation)} />
            <Stat label="Cache 読取" value={compact(data.totals.cache_read)} />
            <Stat label="アシスタント応答数" value={comma(data.totals.messages)} />
          </div>

          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="panel">
              <h3>日別トークン（input / output / cache 作成）</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={data.daily} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                  <XAxis dataKey="date" tickFormatter={(d) => String(d).slice(5)} stroke="#8b949e" fontSize={11} />
                  <YAxis tickFormatter={compact} stroke="#8b949e" fontSize={11} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => comma(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="output_tokens" name="output" stackId="t" fill={COLORS.output} />
                  <Bar dataKey="input_tokens" name="input" stackId="t" fill={COLORS.input} />
                  <Bar dataKey="cache_creation" name="cache作成" stackId="t" fill={COLORS.cache_creation} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="panel">
              <h3>セッション数の推移</h3>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={data.sessionsDaily} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                  <XAxis dataKey="date" tickFormatter={(d) => String(d).slice(5)} stroke="#8b949e" fontSize={11} />
                  <YAxis allowDecimals={false} stroke="#8b949e" fontSize={11} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line type="monotone" dataKey="sessions" name="セッション" stroke={COLORS.sessions} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel" style={{ marginTop: 16 }}>
            <h3>プロジェクト別トークン（上位）</h3>
            <ResponsiveContainer width="100%" height={Math.max(160, data.byProject.length * 28)}>
              <BarChart
                layout="vertical"
                data={data.byProject.map((p) => ({ ...p, short: p.project.split('/').pop() || p.project }))}
                margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#21262d" horizontal={false} />
                <XAxis type="number" tickFormatter={compact} stroke="#8b949e" fontSize={11} />
                <YAxis type="category" dataKey="short" width={140} stroke="#8b949e" fontSize={11} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => comma(Number(v))} />
                <Bar dataKey="tokens" name="トークン">
                  {data.byProject.map((_, i) => (
                    <Cell key={i} fill={BAR_PALETTE[i % BAR_PALETTE.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
