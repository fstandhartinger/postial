import { mkdir, writeFile } from 'node:fs/promises';
import { spawn, execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const execFile = promisify(execFileCallback);
const root = process.cwd();
const outputFile = resolve(root, 'work/acceptance.json');
const supervisor = '/home/flori/ventures2/socialmint/ops/run-verification.sh';
const steps = [
  { name: 'tsc --noEmit', command: 'npx', args: ['tsc', '--noEmit'] },
  { name: 'next build', command: 'npm', args: ['run', 'build'] },
  { name: 'verify:all', command: supervisor, args: ['npm', 'run', 'verify:all'] },
  { name: 'verify:http', command: supervisor, args: ['npm', 'run', 'verify:http'] },
];

function redact(value) {
  return String(value)
    .replace(/\b(?:postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?):\/\/[^\s]+/gi, '[REDACTED_CONNECTION]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|pk|sm_live_|whsec_|gh[pousr]_)[A-Za-z0-9._-]+\b/gi, '[REDACTED_KEY]')
    .replace(/(["']?(?:authorization|cookie|token|secret|password|credential|signature|api[-_]?key|access[-_]?token|refresh[-_]?token)["']?\s*[:=]\s*["']?)[^,"'}\s]+/gi, '$1[REDACTED]')
    .replace(/\b(?:private\s+)?payload\b[^,}]*/gi, '[REDACTED_PAYLOAD]')
    .replace(/\b(?:body|content|text|message|caption|media|bytes|rawBody|requestBody)\b\s*[:=]\s*[^,}]+/gi, '$1=[REDACTED]')
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED_EMAIL]')
    .slice(0, 1000);
}

function lastLine(output) {
  const lines = String(output).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return redact(lines.at(-1) ?? '');
}

function runStep(step) {
  return new Promise(resolveStep => {
    const started = performance.now();
    // Name the tree explicitly: the supervisor must verify THIS directory, never a fixed one.
    const child = spawn(step.command, step.args, { cwd: root, env: { ...process.env, VERIFY_TARGET_DIR: root }, shell: false });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', error => resolveStep({ returnCode: 1, durationMs: Math.round(performance.now() - started), lastOutputLine: redact(error.message) }));
    child.on('close', (code, signal) => resolveStep({
      returnCode: code ?? 1,
      durationMs: Math.round(performance.now() - started),
      lastOutputLine: lastLine(output) || (signal ? `terminated by ${signal}` : ''),
    }));
  });
}

async function git(args) {
  const { stdout } = await execFile('git', args, { cwd: root, env: process.env });
  return stdout.trim();
}

const result = { timestamp: new Date().toISOString(), directory: root, commit: '', clean: false, steps: {}, ok: false };
let ok = true;
for (const step of steps) {
  if (!ok) {
    result.steps[step.name] = { returnCode: null, durationMs: 0, lastOutputLine: 'not executed (previous step failed)' };
    continue;
  }
  result.steps[step.name] = process.env.ACCEPTANCE_FAIL_STEP === step.name
    ? { returnCode: 97, durationMs: 0, lastOutputLine: 'intentional acceptance failure' }
    : await runStep(step);
  ok = result.steps[step.name].returnCode === 0;
}
result.commit = await git(['rev-parse', 'HEAD']);
result.clean = (await git(['status', '--porcelain'])) === '';
result.ok = ok;
await mkdir(resolve(root, 'work'), { recursive: true });
await writeFile(outputFile, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
for (const [name, value] of Object.entries(result.steps)) console.log(`${name}: ${value.returnCode === null ? 'not-run' : `rc=${value.returnCode}`} ${value.lastOutputLine}`);
process.exitCode = ok ? 0 : 1;
