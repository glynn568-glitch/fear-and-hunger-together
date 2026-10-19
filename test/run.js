// Runs every suite, several at once. `npm test`, or `node test/run.js battle death` for some.
// FH_TEST_JOBS=1 runs them one at a time. Every suite has ports of its own, so they never meet.
// A suite that fails is run once more on its own, to tell a flaky test from a broken one;
// either way the run fails. Each suite's whole output goes to test/out/logs (FH_TEST_LOGS_DIR).
// The release gate (test/gate.js) runs this in every way the game is played.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ALL = ['lint', 'server', 'join', 'hostrun', 'four', 'app', 'boot', 'title', 'intro', 'two', 'events', 'transfer', 'follow', 'paste', 'differs', 'midfight', 'dropfight', 'slowlink', 'humans', 'publish', 'followers', 'battle', 'encounter', 'death', 'ending', 'sleep', 'rules', 'trade', 'cast', 'talk', 'chat', 'softlocks', 'doors', 'gaps', 'lifecycle', 'resume', 'reconnect', 'bot', 'ai', 'ai-resume', 'partner', 'setup', 'soak'];
const names = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const jobs = Math.max(1, Number(process.env.FH_TEST_JOBS) || Math.min(6, Math.floor(os.cpus().length / 2)));

// The longest suites start first, by how long each took last time.
const TIMES = path.join(__dirname, 'out', 'times.json');
let times = {};
try { times = JSON.parse(fs.readFileSync(TIMES, 'utf8')); } catch (e) { /* first run */ }
const queue = names.slice().sort((a, b) => (times[b] || 0) - (times[a] || 0));
const LOGS = process.env.FH_TEST_LOGS_DIR || path.join(__dirname, 'out', 'logs');

// One run at a time: two would share every suite's ports and join each other's games.
// The lock is created only if absent (no two can take it at once) and touched every
// 20 s; one untouched for a minute belongs to a run that was killed, and is taken over.
const LOCK = path.join(__dirname, 'out', 'run.lock');
fs.mkdirSync(path.dirname(LOCK), { recursive: true });
function takeLock() {
    try { fs.closeSync(fs.openSync(LOCK, 'wx')); return true; } catch (e) { /* held */ }
    let age = 0;
    try { age = Date.now() - fs.statSync(LOCK).mtimeMs; } catch (e) { return takeLock(); }
    if (age < 60000) return false;
    fs.rmSync(LOCK, { force: true });
    try { fs.closeSync(fs.openSync(LOCK, 'wx')); return true; } catch (e) { return false; }
}
if (!takeLock()) { console.error('Another test run is using the ports (test/out/run.lock). Wait for it, or end it.'); process.exit(2); }
fs.writeFileSync(LOCK, String(process.pid));
setInterval(() => { try { const now = new Date(); fs.utimesSync(LOCK, now, now); } catch (e) { /* gone */ } }, 20000).unref();
process.on('exit', () => { try { if (Number(fs.readFileSync(LOCK, 'utf8')) === process.pid) fs.rmSync(LOCK); } catch (e) { /* gone */ } });

function runOne(name, again) {
    return new Promise((resolve) => {
        const started = Date.now();
        const child = spawn(process.execPath, [path.join(__dirname, name + '.js')], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = '';
        child.stdout.on('data', (d) => { stdout += d; });
        child.stderr.on('data', (d) => { stderr += d; });
        // The whole tree: a suite's own Chrome and servers would otherwise keep its ports.
        const timer = setTimeout(() => {
            stderr += '\nkilled after 10 minutes';
            if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
            else child.kill();
        }, 600000);
        child.on('close', (code) => {
            clearTimeout(timer);
            const secs = Math.round((Date.now() - started) / 1000);
            const ok = code === 0;
            // Every suite's whole output is kept, passed or not, to read afterwards.
            fs.mkdirSync(LOGS, { recursive: true });
            fs.writeFileSync(path.join(LOGS, name + (again ? '.again' : '') + '.txt'), stdout + (stderr ? '\n--- stderr\n' + stderr : ''));
            times[name] = secs;
            const lines = stdout.trim().split('\n');
            let report = `${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(10)} ${secs}s  ${lines[lines.length - 1] || ''}`;
            if (!ok) report += '\n' + lines.filter((l) => /^FAIL|Error/.test(l)).slice(0, 8).map((l) => '       ' + l.slice(0, 300)).join('\n');
            // An exception a suite caught goes to stderr: its first lines say where.
            if (!ok && stderr.trim()) report += '\n' + stderr.trim().split('\n').slice(0, 6).map((l) => '       ' + l.slice(0, 300)).join('\n');
            console.log(report);
            resolve(ok);
        });
    });
}

(async () => {
    const started = Date.now();
    const failed = [];
    await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
        while (queue.length) { const name = queue.shift(); if (!(await runOne(name))) failed.push(name); }
    }));
    fs.mkdirSync(path.dirname(TIMES), { recursive: true });
    fs.writeFileSync(TIMES, JSON.stringify(times, null, 1));
    // Alone, once more: passing now means it is flaky, which still fails the run.
    const flaky = [];
    for (const name of failed) {
        console.log(`again, alone: ${name}`);
        if (await runOne(name, true)) flaky.push(name);
    }
    const broken = failed.filter((n) => flaky.indexOf(n) < 0);
    const wall = `${Math.round((Date.now() - started) / 1000)}s, ${jobs} at a time`;
    console.log(failed.length ? `${failed.length} suite(s) failed (${wall}): broken ${broken.join(' ') || '-'}; flaky (passed alone) ${flaky.join(' ') || '-'}` : `all ${names.length} suites passed (${wall})`);
    if (process.env.FH_TEST_RESULT) fs.writeFileSync(process.env.FH_TEST_RESULT, JSON.stringify({ suites: names.length, broken, flaky, secs: Math.round((Date.now() - started) / 1000) }));
    process.exit(failed.length ? 1 : 0);
})();
