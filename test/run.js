// Runs every suite, several at once. `npm test`, or `node test/run.js battle death` for some.
// FH_TEST_JOBS=1 runs them one at a time. Every suite has ports of its own, so they never meet.
// A suite that fails is run three more times on its own: all three passing = flaky (named,
// the run passes), anything else = broken (the run fails). Each suite's whole output goes to test/out/logs (FH_TEST_LOGS_DIR).
// The release gate (test/gate.js) runs this in every way the game is played.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ALL = ['lint', 'server', 'join', 'hostrun', 'four', 'app', 'boot', 'title', 'intro', 'two', 'events', 'kept', 'loadfade', 'frontdoor', 'lobbyroom', 'lobby', 'lobbysave', 'lobbysoak', 'ghost', 'crow', 'holds', 'refight', 'reports', 'scenes', 'slips', 'lift', 'walk', 'meterline', 'transfer', 'follow', 'paste', 'differs', 'strange', 'midfight', 'dropfight', 'slowlink', 'deafwatch', 'humans', 'publish', 'pointer', 'pad', 'deck', 'import', 'buckman', 'oldsaves', 'party', 'carry', 'followers', 'battle', 'encounter', 'death', 'ending', 'endpartner', 'mahabre', 'sleep', 'rules', 'traps', 'hunger', 'trade', 'cast', 'talk', 'chat', 'scroll', 'softlocks', 'doors', 'gaps', 'lifecycle', 'resume', 'reconnect', 'quietline', 'bot', 'ai', 'plain', 'minds', 'codex', 'ai-resume', 'partner', 'pit', 'setup', 'plays', 'soak'];
// The suites where how the players are connected can change the outcome: joining, moving
// between maps, fights and their picture, dropped lines, what is carried over the line.
// The gate runs every suite as shipped, and only these in its other ways of connecting
// (FH_TEST_LINE=1). The rest (the partner's own play, menus, the launcher, start-up) do the
// same thing on any line: four full passes of them were an hour of the gate's 80 minutes.
const LINE = new Set(['join', 'hostrun', 'four', 'title', 'two', 'events', 'kept', 'loadfade', 'frontdoor', 'lobby', 'lobbysave', 'lobbysoak', 'ghost', 'crow', 'holds', 'refight', 'scenes', 'lift',
    'meterline', 'transfer', 'follow', 'paste', 'differs', 'midfight', 'dropfight', 'slowlink', 'deafwatch', 'import', 'buckman', 'party', 'carry', 'followers', 'battle',
    'encounter', 'death', 'ending', 'trade', 'cast', 'talk', 'chat', 'doors', 'lifecycle', 'resume', 'reconnect', 'quietline', 'soak']);
for (const n of LINE) if (ALL.indexOf(n) < 0) throw new Error('LINE names a suite that is not in ALL: ' + n);
// The public copy has no oldsaves (it loads real players' saves, kept private).
const names = process.argv.slice(2).length ? process.argv.slice(2) : ALL.filter((n) => n === 'lint' || fs.existsSync(path.join(__dirname, n + '.js'))).filter((n) => !process.env.FH_TEST_LINE || LINE.has(n));
const jobs = Math.max(1, Number(process.env.FH_TEST_JOBS) || Math.min(6, Math.floor(os.cpus().length / 2)));

// The longest suites start first, by how long each took last time.
const TIMES = path.join(__dirname, 'out', 'times.json');
let times = {};
try { times = JSON.parse(fs.readFileSync(TIMES, 'utf8')); } catch (e) { /* first run */ }
const queue = names.slice().sort((a, b) => (times[b] || 0) - (times[a] || 0));
const LOGS = process.env.FH_TEST_LOGS_DIR || path.join(__dirname, 'out', 'logs');

// One run at a time (test/lock.js).
if (!require('./lock')()) { console.error('Another test run is using the ports (test/out/run.lock). Wait for it, or end it.'); process.exit(2); }

// Exit 0 is not a pass: the last line has to say what passed. A suite that checked
// nothing, or stopped before its summary, fails.
const PROVED = /^(all [1-9]\d* passed|lint: [1-9]\d* files clean|[A-Z]+ OK)$/;
function proved(code, stdout) {
    const lines = stdout.trim().split('\n');
    return code === 0 && PROVED.test(lines[lines.length - 1].trim());
}
// The scorer is tried on known answers before it scores anything.
for (const [code, out, want] of [[0, 'PASS x\nall 3 passed\n', true], [0, 'SOAK OK', true], [0, '', false], [0, 'all 0 passed', false],
    [0, 'PASS x', false], [1, 'all 3 passed', false], [0, 'all 3 passed\n1 FAILED', false], [0, 'all 3 passed\nkilled after 10 minutes', false]]) {
    if (proved(code, out) !== want) throw new Error('the scorer is wrong about: exit ' + code + ', ' + JSON.stringify(out));
}

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
            const ok = proved(code, stdout);
            // Every suite's whole output is kept, passed or not, to read afterwards.
            fs.mkdirSync(LOGS, { recursive: true });
            fs.writeFileSync(path.join(LOGS, name + (again ? '.again' : '') + '.txt'), stdout + (stderr ? '\n--- stderr\n' + stderr : ''));
            times[name] = secs;
            const lines = stdout.trim().split('\n');
            let report = `${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(10)} ${secs}s  ${lines[lines.length - 1] || ''}`;
            if (!ok && code === 0) report += '\n       exited 0 without a last line saying what passed';
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
    // Alone, three times: passing all three means the suite is flaky under load, not that
    // the game is broken. It is named, to be fixed, and does not fail the run (11/11: one
    // flake used to cost the whole gate again, 80 minutes a time; 0.1.9 took four runs).
    const flaky = [];
    for (const name of failed) {
        let passes = 0;
        for (let i = 0; i < 3; i++) {
            console.log(`again, alone (${i + 1} of 3): ${name}`);
            if (!(await runOne(name, true))) break;
            passes++;
        }
        if (passes === 3) flaky.push(name);
    }
    const broken = failed.filter((n) => flaky.indexOf(n) < 0);
    const wall = `${Math.round((Date.now() - started) / 1000)}s, ${jobs} at a time`;
    console.log(failed.length ? `${failed.length} suite(s) failed (${wall}): broken ${broken.join(' ') || '-'}; flaky (passed alone 3 of 3: fix the test) ${flaky.join(' ') || '-'}` : `all ${names.length} suites passed (${wall})`);
    if (process.env.FH_TEST_RESULT) fs.writeFileSync(process.env.FH_TEST_RESULT, JSON.stringify({ suites: names.length, broken, flaky, secs: Math.round((Date.now() - started) / 1000) }));
    process.exit(broken.length ? 1 : 0);
})();
