// Runs every suite, several at once. `npm test`, or `node test/run.js battle death` for some.
// FH_TEST_JOBS=1 runs them one at a time. Every suite has ports of its own, so they never meet.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ALL = ['lint', 'server', 'join', 'four', 'app', 'boot', 'title', 'intro', 'two', 'events', 'transfer', 'follow', 'paste', 'differs', 'followers', 'battle', 'encounter', 'death', 'ending', 'sleep', 'rules', 'trade', 'cast', 'talk', 'softlocks', 'doors', 'gaps', 'lifecycle', 'resume', 'reconnect', 'bot', 'ai', 'ai-resume', 'partner', 'setup', 'soak'];
const names = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const jobs = Math.max(1, Number(process.env.FH_TEST_JOBS) || Math.min(6, Math.floor(os.cpus().length / 2)));

// The longest suites start first, by how long each took last time.
const TIMES = path.join(__dirname, 'out', 'times.json');
let times = {};
try { times = JSON.parse(fs.readFileSync(TIMES, 'utf8')); } catch (e) { /* first run */ }
const queue = names.slice().sort((a, b) => (times[b] || 0) - (times[a] || 0));

function runOne(name) {
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
    let failed = 0;
    await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
        while (queue.length) if (!(await runOne(queue.shift()))) failed++;
    }));
    fs.mkdirSync(path.dirname(TIMES), { recursive: true });
    fs.writeFileSync(TIMES, JSON.stringify(times, null, 1));
    const wall = `${Math.round((Date.now() - started) / 1000)}s, ${jobs} at a time`;
    console.log(failed ? `${failed} suite(s) failed (${wall})` : `all ${names.length} suites passed (${wall})`);
    process.exit(failed ? 1 : 0);
})();
