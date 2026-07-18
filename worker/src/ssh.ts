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
    // backupPath はコード生成（timestamp_proposalId）のため単一引用で囲むだけで安全。
    // 環境変数経由で渡すのは SSH 文字列补間が複雑になるため、引用で対応。
    res = await runProcess(
      'ssh',
      [...sshBaseArgs(machine), `python3 ~/.harness/apply.py --rollback '${backupPath}'`],
      '',
    );
  }
  if (res.code !== 0) {
    return { ok: false, error: `rollback failed (code=${res.code}): ${res.stderr.slice(0, 500)}` };
  }
  try {
    return JSON.parse(res.stdout) as ApplyResult;
  } catch {
    return { ok: false, error: `failed to parse rollback output as JSON: ${res.stdout.slice(0, 300)}` };
  }
}

// deploy/setup-machine.sh の settings.json マージ処理と同一のロジック。
// authorized_keys への鍵登録はここでは行わない（HARNESS_SSH_KEY は既に各開発機に
// 登録済みの前提で運用しているため）。
const SETTINGS_MERGE_SCRIPT = `
import json, os, time
p = os.path.expanduser("~/.claude/settings.json")
days = int(os.environ.get("CLEANUP_DAYS", "90"))
if days <= 0:
    raise SystemExit("cleanupPeriodDays must be greater than 0")
data = {}
if os.path.isfile(p):
    with open(p, encoding="utf-8") as f:
        try:
            data = json.load(f)
        except ValueError:
            data = {}
    with open(p + f".harness.bak.{int(time.time())}", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
data["cleanupPeriodDays"] = days
os.makedirs(os.path.dirname(p), exist_ok=True)
with open(p, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
print("settings.json updated: cleanupPeriodDays =", days)
`;

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

  const mkdirRes = await runProcess('ssh', [...sshBaseArgs(machine), 'mkdir -p ~/.harness ~/.claude'], '');
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
      `${target}:~/.harness/`,
    ],
    '',
  );
  if (scpRes.code !== 0) {
    throw new Error(
      `failed to distribute collector.py/apply.py/gate.sh (code=${scpRes.code}): ${scpRes.stderr.slice(0, 500)}`,
    );
  }

  const chmodRes = await runProcess('ssh', [...sshBaseArgs(machine), 'chmod +x ~/.harness/gate.sh'], '');
  if (chmodRes.code !== 0) {
    throw new Error(`failed to chmod +x gate.sh (code=${chmodRes.code}): ${chmodRes.stderr.slice(0, 500)}`);
  }

  const cleanupDays = process.env.CLEANUP_PERIOD_DAYS || '90';
  const mergeRes = await runProcess(
    'ssh',
    [...sshBaseArgs(machine), `CLEANUP_DAYS=${cleanupDays} python3 -`],
    SETTINGS_MERGE_SCRIPT,
  );
  if (mergeRes.code !== 0) {
    throw new Error(
      `failed to update settings.json (code=${mergeRes.code}): ${mergeRes.stderr.slice(0, 500)}`,
    );
  }

  return `distributed collector.py/apply.py/gate.sh to machine#${machine.id}(${machine.name}); ${mergeRes.stdout.trim()}`;
}
