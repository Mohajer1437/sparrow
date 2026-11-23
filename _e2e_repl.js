const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const task = process.argv.slice(2).join(' ')
  || 'In app/page.tsx keep the home-page footer data-testid=sandbox-vv-footer with exact visible text Sandbox VnV repair marker. Do not add authentication, payment, new routes, or unrelated files.';
const logDir = path.join(__dirname, 'logs');
fs.mkdirSync(logDir, { recursive: true });
const logPath = process.env.E2E_LOG || path.join(logDir, '_e2e_execute.log');
fs.writeFileSync(logPath, '');

const proc = spawn('node', ['E:\\agentic\\dist\\cli\\main.js', 'repl'], {
  cwd: 'E:\\new-test-2',
  windowsHide: true,
  env: { ...process.env, AGENT_QUALITY_PROFILE: 'PRODUCTION' },
});

let buf = '';
let sentExecute = false;
let sentExit = false;
const started = Date.now();

function log(chunk) {
  const text = chunk.toString();
  buf += text;
  process.stdout.write(text);
  fs.appendFileSync(logPath, text);
}

proc.stdout.on('data', log);
proc.stderr.on('data', log);

const timer = setInterval(() => {
  if (!sentExecute && /agent>\s*$/m.test(buf)) {
    sentExecute = true;
    const cmd = '/execute ' + task + '\n';
    process.stdout.write('\n[driver] sending execute\n');
    proc.stdin.write(cmd);
  }
  const done = /PIPELINE COMPLETED SUCCESSFULLY|PIPELINE FAILED|Pipeline error:/.test(buf);
  if (sentExecute && done && !sentExit) {
    sentExit = true;
    proc.stdin.write('/exit\n');
  }
  if (Date.now() - started > 55 * 60 * 1000 && !sentExit) {
    sentExit = true;
    process.stdout.write('\n[driver] timeout, exiting\n');
    proc.stdin.write('/exit\n');
    setTimeout(() => proc.kill(), 5000);
  }
}, 500);

proc.on('exit', (code) => {
  clearInterval(timer);
  process.stdout.write('\n[driver] exit ' + code + '\n');
  process.exit(code || 0);
});
