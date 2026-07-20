import { type ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';
import type { ApplyInput, ApplyResult, CollectorInput, Increment } from '@harness/shared';
import { AGENT_DIR } from './lib/paths.js';

// runProcess で spawn された子プロセスのリスト。シグナル受信時に一括 kill する。
const _children: ChildProcess[] = [];

/** 登録された全ての子プロセスにシグナルを送信し、graceful shutdown を行う。 */
export function shutdown(): void {
  for (const child of _children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  // 5 秒後に強制終了
  setTimeout(() => process.exit(1), 5000).unref();
}

export interface Machine {
  id: number;
  name: string;
  ssh_host: string;
  ssh_user: string;
  workspace_root?: string | null;
  max_depth?: number | null;
}

/** ssh_host が local/localhost の端末は Hub 自身とみなし、ssh を介さず直接実行する。 */
export function isLocal(machine: Machine): boolean {
  return machine.ssh_host === 'local' || machine.ssh_host === 'localhost' || machine.ssh_host === '127.0.0.1';
}

function sshConnectOpts(): string[] {
  const key = process.env.HARNESS_SSH_KEY;
  const args: string[] = [];
  if (key) args.push('-i', key);
  args.push('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15');
  return args;
}

function sshBaseArgs(machine: Machine): string[] {
  return [...sshConnectOpts(), `${machine.ssh_user}@${machine.ssh_host}`];
}

interface SpawnResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * stdin を渡してコマンドを実行し、stdout/stderr をストリームで集める。
 * シグナルハンドラ (index.ts) が SIGTERM/SIGINT を受け取った際、子プロセスを一括 kill する。
 */
function runProcess(cmd: string, args: string[], stdin: string): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    _children.push(child);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', reject);
    child.on('close', (code) => {
      // 終了したらリストから削除（O(n)だが同時実行数は1のため実問題ない）
      const i = _children.indexOf(child);
      if (i >= 0) _children.splice(i, 1);
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      });
    });
    if (stdin) child.stdin.write(stdin);
    child.stdin.end();
  });
}

/**
 * 開発機で collector.py を実行し、増分を回収する。
 * local 端末なら Hub 上の agent/collector.py を直接実行、他は ssh 経由（gate.sh が collector を許可）。
 */
export async function runRemoteCollector(
  machine: Machine,
  cursorInput: CollectorInput,
  opts: { fullResync?: boolean } = {},
): Promise<Increment> {
  const stdin = JSON.stringify(cursorInput);
  let res: SpawnResult;
  if (isLocal(machine)) {
    const args = [path.join(AGENT_DIR, 'collector.py')];
    if (opts.fullResync) args.push('--full-resync');
    res = await runProcess('python3', args, stdin);
  } else {
    const remoteCmd = `python3 ~/.harness/collector.py${opts.fullResync ? ' --full-resync' : ''}`;
    res = await runProcess('ssh', [...sshBaseArgs(machine), remoteCmd], stdin);
  }
  if (res.code !== 0) {
    throw new Error(`collector run failed (code=${res.code}): ${res.stderr.slice(0, 500)}`);
  }
  try {
    return JSON.parse(res.stdout) as Increment;
  } catch {
    throw new Error(`failed to parse collector output as JSON: ${res.stdout.slice(0, 300)}`);
  }
}

/** 承認済み diff を開発機の apply.py に適用させる（Phase 2）。 */
export async function runRemoteApply(machine: Machine, input: ApplyInput): Promise<ApplyResult> {
  const stdin = JSON.stringify(input);
  let res: SpawnResult;
  if (isLocal(machine)) {
    res = await runProcess('python3', [path.join(AGENT_DIR, 'apply.py')], stdin);
  } else {
    res = await runProcess('ssh', [...sshBaseArgs(machine), 'python3 ~/.harness/apply.py'], stdin);
  }
  if (res.code !== 0) {
    return { ok: false, error: `apply run failed (code=${res.code}): ${res.stderr.slice(0, 500)}` };
  }
  try {
    return JSON.parse(res.stdout) as ApplyResult;
  } catch {
    return { ok: false, error: `failed to parse apply output as JSON: ${res.stdout.slice(0, 300)}` };
  }
}

/** 開発機の apply.py にロールバックを指示する（Phase 2）。 */
export async function runRemoteRollback(machine: Machine, backupPath: string): Promise<ApplyResult> {
  let res: SpawnResult;
  if (isLocal(machine)) {
    res = await runProcess('python3', [path.join(AGENT_DIR, 'apply.py'), '--rollback', backupPath], '');
  } else {
    // backupPath を base64 環境変数経由で渡す（shell injection 完全回避）。
    // 単一引用で囲み、base64 文字列内の特殊文字を shell から保護。
    const envBackup = Buffer.from(backupPath).toString('base64');
    res = await runProcess(
      'ssh',
      [
        ...sshBaseArgs(machine),
        `HARNESS_ROLLBACK_PATH='${envBackup}' python3 ~/.harness/apply.py --rollback`,
      ],
      '',
    );
  }
  if (res.code !== 0) {
    return { ok: false, error: `rollback failed (code=${res.code}): ${res.stderr.slice(0, 500)}` };
  }
  try {
    return JSON.parse(res.stdout) as ApplyResult;
  } catch {
    return { ok: false, error: `failed to parse apply output as JSON: ${res.stdout.slice(0, 300)}` };
  }
}

/**
 * 開発機に collector.py / apply.py / gate.sh を配布し、settings.json の
 * cleanupPeriodDays をマージする（Machines 登録時に自動投入される setup ジョブから呼ばれる）。
 * local 端末（Hub 自身）は agent/ を直接参照するため何もしない。
 */
export async function runRemoteSetup(machine: Machine): Promise<string> {
  if (isLocal(machine)) {
    return `machine#${machine.id}(${machine.name}) is Hub itself, setup skipped`;
  }
  const target = `${machine.ssh_user}@${machine.ssh_host}`;

  const mkdirRes = await runProcess(
    'ssh',
    [...sshBaseArgs(machine), 'mkdir -p ~/.harness ~/.claude ~/.ssh'],
    '',
  );
  if (mkdirRes.code !== 0) {
    throw new Error(`failed to create ~/.harness (code=${mkdirRes.code}): ${mkdirRes.stderr.slice(0, 500)}`);
  }

  const scpRes = await runProcess(
    'scp',
    [
      ...sshConnectOpts(),
      path.join(AGENT_DIR, 'collector.py'),
      path.join(AGENT_DIR, 'apply.py'),
      path.join(AGENT_DIR, 'gate.sh'),
      path.join(AGENT_DIR, 'settings-merge.py'),
      `${target}:~/.harness/`,
    ],
    '',
  );
  if (scpRes.code !== 0) {
    throw new Error(
      `failed to distribute collector.py/apply.py/gate.sh/settings-merge.py (code=${scpRes.code}): ${scpRes.stderr.slice(0, 500)}`,
    );
  }

  const chmodRes = await runProcess('ssh', [...sshBaseArgs(machine), 'chmod +x ~/.harness/gate.sh'], '');
  if (chmodRes.code !== 0) {
    throw new Error(`failed to chmod +x gate.sh (code=${chmodRes.code}): ${chmodRes.stderr.slice(0, 500)}`);
  }

  // settings-merge.py を SSH 経由で実行（環境変数 CLEANUP_DAYS で日数を指定）
  const cleanupDays = process.env.CLEANUP_PERIOD_DAYS || '90';
  const mergeRes = await runProcess(
    'ssh',
    [...sshBaseArgs(machine), `CLEANUP_DAYS=${cleanupDays} python3 ~/.harness/settings-merge.py`],
    '',
  );
  if (mergeRes.code !== 0) {
    throw new Error(
      `failed to update settings.json (code=${mergeRes.code}): ${mergeRes.stderr.slice(0, 500)}`,
    );
  }

  return `distributed collector.py/apply.py/gate.sh/settings-merge.py to machine#${machine.id}(${machine.name}); ${mergeRes.stdout.trim()}`;
}
