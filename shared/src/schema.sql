-- harness Hub の SQLite スキーマ（Tier3 = 永続の小さな正記録）
-- 起動時に IF NOT EXISTS で idempotent に適用する。

-- 開発機（端末）
CREATE TABLE IF NOT EXISTS machines(
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  ssh_host TEXT NOT NULL,
  ssh_user TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  workspace_root TEXT,
  max_depth INTEGER,
  last_collected_at TEXT
);

-- プロジェクト（cwd を正とする）
CREATE TABLE IF NOT EXISTS projects(
  id INTEGER PRIMARY KEY,
  machine_id INTEGER NOT NULL REFERENCES machines(id),
  cwd TEXT NOT NULL,
  encoded_name TEXT,
  last_seen_at TEXT,
  UNIQUE(machine_id, cwd)
);

-- カーソル（Hub が保持。collector はステートレス）
CREATE TABLE IF NOT EXISTS cursors(
  machine_id INTEGER NOT NULL REFERENCES machines(id),
  file_path TEXT NOT NULL,
  byte_offset INTEGER NOT NULL DEFAULT 0,
  head_hash TEXT,
  updated_at TEXT,
  PRIMARY KEY(machine_id, file_path)
);

-- 日別統計
CREATE TABLE IF NOT EXISTS stats_daily(
  date TEXT NOT NULL,
  machine_id INTEGER NOT NULL REFERENCES machines(id),
  project_id INTEGER REFERENCES projects(id),
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read INTEGER NOT NULL DEFAULT 0,
  cache_creation INTEGER NOT NULL DEFAULT 0,
  messages INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(date, machine_id, project_id, model)
);

-- セッション
CREATE TABLE IF NOT EXISTS sessions(
  session_id TEXT PRIMARY KEY,
  machine_id INTEGER NOT NULL REFERENCES machines(id),
  project_id INTEGER REFERENCES projects(id),
  started_at TEXT,
  last_at TEXT,
  message_count INTEGER NOT NULL DEFAULT 0
);

-- スナップショット（同一 (machine,path) の履歴を保持。最新に is_current=1）
CREATE TABLE IF NOT EXISTS snapshots(
  id INTEGER PRIMARY KEY,
  machine_id INTEGER NOT NULL REFERENCES machines(id),
  kind TEXT NOT NULL CHECK(kind IN ('claude_md','rule','skill','memory','settings')),
  path TEXT NOT NULL,
  hash TEXT NOT NULL,
  content TEXT,
  collected_at TEXT,
  is_current INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_snapshots_current
  ON snapshots(machine_id, path) WHERE is_current = 1;

-- Tier1: 転送された生増分の索引（実体は data/increments/）
CREATE TABLE IF NOT EXISTS tier1_increments(
  id INTEGER PRIMARY KEY,
  machine_id INTEGER NOT NULL REFERENCES machines(id),
  project_id INTEGER REFERENCES projects(id),
  file_path TEXT NOT NULL,
  collected_at TEXT,
  consumed_at TEXT,
  delete_after TEXT
);
CREATE INDEX IF NOT EXISTS idx_tier1_gc ON tier1_increments(consumed_at, delete_after);

-- Tier2: ローリングダイジェストの索引（実体は data/digests/・永続）
CREATE TABLE IF NOT EXISTS tier2_digests(
  id INTEGER PRIMARY KEY,
  scope TEXT NOT NULL CHECK(scope IN ('global','machine','project')),
  machine_id INTEGER REFERENCES machines(id),
  project_id INTEGER REFERENCES projects(id),
  period TEXT,
  file_path TEXT NOT NULL,
  updated_at TEXT
);

-- 繰り返しパターン候補（digest-fold が出現回数を更新）
CREATE TABLE IF NOT EXISTS patterns(
  id INTEGER PRIMARY KEY,
  digest_id INTEGER REFERENCES tier2_digests(id),
  description TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  first_seen TEXT,
  last_seen TEXT,
  status TEXT NOT NULL DEFAULT 'candidate' -- candidate|proposed|resolved
);

-- ジョブキュー
CREATE TABLE IF NOT EXISTS jobs(
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,        -- setup|collect|ingest|analyze|apply|rollback|cleanup
  payload TEXT,              -- JSON
  status TEXT NOT NULL DEFAULT 'queued', -- queued|running|done|failed
  error_kind TEXT,           -- auth|rate_limit|transient|fatal など
  acknowledged INTEGER NOT NULL DEFAULT 0, -- 失敗バッジの未確認/確認済み
  created_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  log TEXT,
  tokens_used INTEGER,
  cost_usd REAL
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, id);

-- 提案 Inbox
CREATE TABLE IF NOT EXISTS proposals(
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,        -- claude_md|skill|refactor|drift
  machine_id INTEGER REFERENCES machines(id),
  target_path TEXT,
  base_hash TEXT,
  new_content TEXT,
  diff TEXT,
  rationale TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|accepted|rejected|applied|failed
  job_id INTEGER REFERENCES jobs(id),
  created_at TEXT,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status, id);

-- 適用履歴
CREATE TABLE IF NOT EXISTS apply_logs(
  id INTEGER PRIMARY KEY,
  proposal_id INTEGER REFERENCES proposals(id),
  backup_path TEXT,
  result TEXT,              -- JSON（applied_hash 等）
  applied_at TEXT,
  rolled_back_at TEXT
);

-- 汎用設定（.env で吸収しきれない可変値の上書き）
CREATE TABLE IF NOT EXISTS settings(
  key TEXT PRIMARY KEY,
  value TEXT
);
