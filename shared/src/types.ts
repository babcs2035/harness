// Hub と collector/apply の間でやり取りする JSON の型定義。
// collector.py（Python）と apply.py の入出力契約もここに集約する。

/** Hub が保持し collector へ渡すカーソル（差分収集の起点） */
export interface CollectorInput {
  session_cursors: SessionCursor[];
  /** path -> sha256。これと異なるスナップショットのみ全文回収する */
  snapshot_hashes: Record<string, string>;
  workspace_root: string;
  max_depth: number;
  /** 直近何セッションを assistant 応答込みで全文収集するか */
  recent_full_sessions?: number;
  /** true で全カーソル無視の全量再収集 */
  full_resync?: boolean;
}

export interface SessionCursor {
  file: string;
  byte_offset: number;
  /** 先頭 4KB の sha256。ローテーション/改変検知に使う */
  head_hash: string;
}

/** collector が返す増分 */
export interface Increment {
  collector_version: string;
  machine_ts: string;
  stats: StatRow[];
  sessions: SessionRow[];
  new_cursors: SessionCursor[];
  changed_snapshots: ChangedSnapshot[];
  deleted_files: string[];
  env: EnvSummary;
}

export interface StatRow {
  date: string;
  project_cwd: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read: number;
  cache_creation: number;
  messages: number;
}

export interface SessionRow {
  session_id: string;
  project_cwd: string;
  started_at: string;
  last_at: string;
  user_messages: string[];
  /** recent_full=true のセッションのみ、assistant 応答テキストの抜粋を含む */
  assistant_excerpts?: string[];
  /** true なら assistant 応答要旨も含む直近セッション */
  recent_full: boolean;
  message_count: number;
}

export type SnapshotKind = 'claude_md' | 'rule' | 'skill' | 'memory' | 'settings';

export interface ChangedSnapshot {
  path: string;
  kind: SnapshotKind;
  hash: string;
  content: string;
}

export interface EnvSummary {
  claude_dir_bytes: number;
  session_file_count: number;
}

/** apply.py への入力（承認済み diff の適用） */
export interface ApplyInput {
  target_path: string;
  base_hash: string;
  new_content: string;
  proposal_id: number;
  /** skill 一式など複数ファイルの適用時に使用 */
  files?: { rel_path: string; content: string }[];
}

export interface ApplyResult {
  ok: boolean;
  backup_path?: string;
  applied_hash?: string;
  error?: string;
}

/** claude -p --output-format json の応答（実フィールドは Phase 2 で確定） */
export interface ClaudeResult {
  result: string;
  session_id?: string;
  total_cost_usd?: number;
  structured_output?: unknown;
}

export type JobType = 'collect' | 'ingest' | 'analyze' | 'apply' | 'rollback' | 'cleanup';

export interface JobPayloadMap {
  collect: { machine_id: number; full_resync?: boolean };
  ingest: { machine_id: number; increment_path: string };
  analyze: {
    kind: string;
    scope: 'global' | 'machine' | 'project';
    machine_id?: number;
    project_id?: number;
  };
  apply: { proposal_id: number; edited_content?: string };
  rollback: { apply_log_id: number };
  cleanup: Record<string, never>;
}
