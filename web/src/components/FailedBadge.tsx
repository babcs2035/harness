'use client';

import { Badge, Tooltip } from 'antd';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/** 失敗ジョブの未確認件数をヘッダーに表示する（ダッシュボード通知）。 */
export default function FailedBadge() {
  const [n, setN] = useState<number | null>(null);
  const [apiError, setApiError] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ failedUnacked: number }>('/api/jobs')
        .then((d) => {
          if (alive) {
            setN(d.failedUnacked ?? 0);
            setApiError(false);
          }
        })
        .catch(() => {
          if (alive) setApiError(true);
        });
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (n === null) return null;
  if (n <= 0 && !apiError) return null;

  return (
    <Link href="/history" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>
      {apiError ? (
        <Tooltip title="API に接続できません">
          <span style={{ color: '#d29922', cursor: 'pointer' }}>失敗ジョブ: 状態不明</span>
        </Tooltip>
      ) : (
        <Badge count={n} overflowCount={99}>
          <span style={{ color: '#ff7b72', cursor: 'pointer' }}>失敗ジョブ {n} 件（未確認）</span>
        </Badge>
      )}
    </Link>
  );
}
