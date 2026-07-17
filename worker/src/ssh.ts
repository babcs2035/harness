import { spawn } from 'node:child_process';
import path from 'node:path';
import type { ApplyInput, ApplyResult, CollectorInput, Increment } from '@harness/shared';
import { AGENT_DIR } from './lib/paths.js';

export interface Machine {
  id: number;
  name: string;
  ssh_host: string;
  ssh_user: string;
  workspace_root?: string | null;
  max_depth?: number | null;
}

/** ssh_host が local/localhost の端末は Hub 自身とみなし、ssh を介さず直接実行する。 */
function isLocal(machine: Machine): boolean {
  return machine.ssh_host === 'local' || machine.ssh_host === 'localhost' || machine.ssh_host === '127.0.0.1';
}

function sshBaseArgs(machine: Machine): string[] {
  const key = process.env.HARNESS_SSH_KEY;
  const args: string[] = [];
  if (key) args.push('-i', key);
  args.push(
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'ConnectTimeout=15',
    `${machine.ssh_user}@${machine.ssh_host}`,
  );
  return args;
}

interface SpawnResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** stdin を渡してコマンドを実行し、stdout/stderr をストリームで集める。 */
function runProcess(cmd: string, args: string[], stdin: string): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', reject);
    child.on('close', (code) => {
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
    throw new Error(`collector 実行失敗 (code=${res.code}): ${res.stderr.slice(0, 500)}`);
  }
  try {
    return JSON.parse(res.stdout) as Increment;
  } catch {
    throw new Error(`collector 出力の JSON パース失敗: ${res.stdout.slice(0, 300)}`);
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
    return { ok: false, error: `apply 実行失敗 (code=${res.code}): ${res.stderr.slice(0, 500)}` };
  }
  try {
    return JSON.parse(res.stdout) as ApplyResult;
  } catch {
    return { ok: false, error: `apply 出力の JSON パース失敗: ${res.stdout.slice(0, 300)}` };
  }
}

/** 開発機の apply.py にロールバックを指示する（Phase 2）。 */
export async function runRemoteRollback(machine: Machine, backupPath: string): Promise<ApplyResult> {
  let res: SpawnResult;
  if (isLocal(machine)) {
    res = await runProcess('python3', [path.join(AGENT_DIR, 'apply.py'), '--rollback', backupPath], '');
  } else {
    res = await runProcess(
      'ssh',
      [...sshBaseArgs(machine), `python3 ~/.harness/apply.py --rollback ${backupPath}`],
      '',
    );
  }
  if (res.code !== 0) {
    return { ok: false, error: `rollback 失敗 (code=${res.code}): ${res.stderr.slice(0, 500)}` };
  }
  try {
    return JSON.parse(res.stdout) as ApplyResult;
  } catch {
    return { ok: true, backup_path: backupPath };
  }
}
