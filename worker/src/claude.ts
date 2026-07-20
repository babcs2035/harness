import { spawn } from 'node:child_process';
import path from 'node:path';

/**
 * Hub 上で `claude -p`（headless・Claude Code サブスク認証）を実行するランナー。
 *
 * 認証:
 * - Hub(Linux コンテナ) では keychain が無いため、環境変数 CLAUDE_CODE_OAUTH_TOKEN
 *   （`claude setup-token` 発行物）を注入して認証する。
 * - ローカル macOS 開発では keychain fallback により CLAUDE_CODE_OAUTH_TOKEN 無しでも動く。
 * CLAUDE_CONFIG_DIR を分離することで、分析実行が Hub の ~/.claude を汚染しない。
 *
 * 出力 JSON（--output-format json）の主要フィールド:
 *   { result, session_id, total_cost_usd, usage:{input_tokens,output_tokens,...}, is_error, subtype, structured_output? }
 */
export interface ClaudeRunOptions {
  cwd: string;
  /** 追加で許可するツール（既定は Read/Write/Grep/Glob） */
  allowedTools?: string[];
  maxTurns?: number;
  /** JSON 成果物を強制する JSON Schema（指定時 structured_output に検証済みデータが入る） */
  jsonSchema?: object;
  timeoutMs?: number;
  /** 使用モデル（--model にそのまま渡す。省略時は claude CLI の既定モデル） */
  model?: string;
}

export interface ClaudeRunResult {
  ok: boolean;
  result: string;
  sessionId?: string;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  structuredOutput?: unknown;
  error?: string;
}

const DEFAULT_TOOLS = ['Read', 'Write', 'Grep', 'Glob'];

export function runClaude(prompt: string, opts: ClaudeRunOptions): Promise<ClaudeRunResult> {
  const args = [
    '-p',
    prompt,
    '--output-format',
    'json',
    '--allowedTools',
    (opts.allowedTools ?? DEFAULT_TOOLS).join(','),
    '--max-turns',
    String(opts.maxTurns ?? 30),
  ];
  // --dangerously-skip-permissions はサンドボックス化されたコンテナ内でのみ使う。
  // worker コンテナで HARNESS_SKIP_PERMISSIONS=1 を設定して opt-in する。
  // ホスト実行では付けない（--allowedTools だけで Read/Write/Grep/Glob は自動承認される）。
  if (process.env.HARNESS_SKIP_PERMISSIONS === '1') {
    args.push('--dangerously-skip-permissions');
  }
  if (opts.jsonSchema) {
    args.push('--json-schema', JSON.stringify(opts.jsonSchema));
  }
  if (opts.model) {
    args.push('--model', opts.model);
  }

  // CLAUDE_CONFIG_DIR は docker-compose / 環境で /data/claude-config に固定済み
  const env = { ...process.env };

  // cwd は絶対パスであること（相対パスでの実行を防ぐ）
  const cwd = path.isAbsolute(opts.cwd) ? opts.cwd : path.resolve(opts.cwd);

  return new Promise((resolve) => {
    const child = spawn('claude', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs ?? 10 * 60_000);

    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, result: '', error: `failed to launch claude: ${e.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8');
      if (code !== 0) {
        resolve({
          ok: false,
          result: '',
          error: `claude exited abnormally (code=${code}): stderr=${stderr.slice(0, 400)} stdout=${stdout.slice(0, 400)}`,
        });
        return;
      }
      try {
        // --output-format json はバージョンにより (a) 単一 result オブジェクト、
        // (b) イベント配列（最後が type:'result'）のいずれか。両対応する。
        const parsed = JSON.parse(stdout);
        const j = Array.isArray(parsed)
          ? (parsed.filter((e) => e && e.type === 'result').pop() ?? parsed[parsed.length - 1] ?? {})
          : parsed;
        if (j.is_error) {
          resolve({ ok: false, result: j.result ?? '', error: `claude is_error: ${j.subtype ?? ''}` });
          return;
        }
        resolve({
          ok: true,
          result: j.result ?? '',
          sessionId: j.session_id,
          costUsd: j.total_cost_usd,
          inputTokens: j.usage?.input_tokens,
          outputTokens: j.usage?.output_tokens,
          structuredOutput: j.structured_output,
        });
      } catch {
        resolve({
          ok: false,
          result: '',
          error: `failed to parse claude output as JSON: ${stdout.slice(0, 300)}`,
        });
      }
    });
  });
}
