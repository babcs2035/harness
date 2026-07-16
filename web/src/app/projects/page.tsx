'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { bytes, comma, shortTime } from '@/lib/format';

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

  return (
    <div>
      <h2>Projects</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        「よく使うのに CLAUDE.md が薄い」プロジェクトほど上位に並びます（改善の候補）。
      </p>
      {error && <div className="panel badge err">読み込みエラー: {error}</div>}
      {!projects && !error && <div className="panel muted">読み込み中…</div>}
      {projects && (
        <div className="panel">
          <table>
            <thead>
              <tr>
                <th>プロジェクト</th>
                <th>端末</th>
                <th className="num">セッション</th>
                <th className="num">応答数</th>
                <th>CLAUDE.md</th>
                <th className="num">サイズ</th>
                <th>最終収集</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td title={p.cwd}>{p.cwd.split('/').slice(-2).join('/') || p.cwd}</td>
                  <td>{p.machine}</td>
                  <td className="num">{comma(p.sessions)}</td>
                  <td className="num">{comma(p.messages)}</td>
                  <td>
                    {p.has_claude_md ? (
                      <span className="badge ok">あり</span>
                    ) : (
                      <span className="badge warn">なし</span>
                    )}
                  </td>
                  <td className="num">{p.has_claude_md ? bytes(p.claude_md_size) : '-'}</td>
                  <td className="muted">{shortTime(p.last_seen_at)}</td>
                </tr>
              ))}
              {projects.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    まだプロジェクトがありません。Machines で端末を登録して収集してください。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
