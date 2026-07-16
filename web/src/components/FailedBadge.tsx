'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

/** 失敗ジョブの未確認件数をサイドバーに表示する（ダッシュボード通知）。 */
export default function FailedBadge() {
  const [n, setN] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ failedUnacked: number }>('/api/jobs')
        .then((d) => {
          if (alive) setN(d.failedUnacked ?? 0);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (n <= 0) return null;
  return (
    <Link href="/history" className="badge err" style={{ display: 'block', marginTop: 12, textAlign: 'center' }}>
      失敗ジョブ {n} 件（未確認）
    </Link>
  );
}
