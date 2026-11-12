// The release gate: every suite, in every way the game is really played.
//   default   as shipped: Hide my IP on, fight pictures through the host
//   direct    Hide my IP off: fight video straight between browsers
//   join      the second player on their own PC, through their own server
//   badlink   as shipped, over a poor line: 80 ms each way and 4 Mbit/s to each player
//   internet  two people (test/humans.js) through a real Cloudflare tunnel, and hosting on Linux
//             (test/deckhost.js): needs the internet
//   twins     each fix taken back out (test/twins.js): its suite has to fail (run first)
// Every suite runs as shipped; direct, join and badlink run the suites where the line can
// change the outcome (run.js LINE); twins run where their code changed since last caught.
// A suite that fails and then passes three times alone is flaky: named, not a failure.
// On a pass, test/out/gate.json names the commit; tools/release.js ships only that commit.
//   node test/gate.js              all six (about half an hour; FH_TEST_JOBS=4 while he plays)
//   node test/gate.js join badlink some of them (no gate.json is written)
const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const MODES = {
    // First: a check that no longer catches its bug shows in minutes, not at the end.
    // twins.js runs each suite as shipped before it trusts that suite's failure.
    twins: { runner: 'twins.js', FH_TWINS_CHANGED: '1' },
    default: { FH_TEST_RELAY: '1' },
    direct: { FH_TEST_LINE: '1' },
    join: { FH_TEST_RELAY: '1', FH_TEST_JOIN: '1', FH_TEST_LINE: '1' },
    badlink: { FH_TEST_RELAY: '1', FH_LAG: '80', FH_RATE: '500000', FH_TEST_LINE: '1' },
    internet: { FH_TEST_RELAY: '1', FH_TEST_TUNNEL: '1', suites: ['humans', 'deckhost'] },
};
const asked = process.argv.slice(2);
const modes = asked.length ? asked : Object.keys(MODES);
for (const m of modes) if (!MODES[m]) throw new Error('no such mode: ' + m + ' (' + Object.keys(MODES).join(', ') + ')');

const git = (argv) => execFileSync('git', argv, { cwd: ROOT, encoding: 'utf8' }).trim();
const commit = git(['rev-parse', 'HEAD']);
const dirty = !!git(['status', '--porcelain']);

// A full run is for a release: say now what tools/release.js would refuse after half an hour.
// FH_GATE_ANYWAY=1 runs it all the same (nothing can ship from that run's commit as it stands).
const full = modes.length === Object.keys(MODES).length;
if (full && !process.env.FH_GATE_ANYWAY) {
    const version = require('../package.json').version;
    let last = '';
    try { last = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', 'public', 'package.json'), 'utf8')).version; } catch (e) { /* never released from here */ }
    const why = dirty ? 'the tree has uncommitted changes: commit first'
        : version === last ? version + ' is already released: raise the version in package.json first'
        : !fs.existsSync(path.join(ROOT, 'docs', 'releases', version + '.md')) ? 'write docs/releases/' + version + '.md first' : '';
    if (why) { console.log('GATE NOT STARTED: ' + why + '. (FH_GATE_ANYWAY=1 to run it all the same.)'); process.exit(2); }
}

const results = {};
for (const mode of modes) {
    const logs = path.join(OUT, 'gate', mode);
    fs.rmSync(logs, { recursive: true, force: true });
    const result = path.join(OUT, 'gate', mode + '.json');
    // Six at a time: a suite the full machine makes flaky is rerun alone, not the gate.
    const env = Object.assign({ FH_TEST_JOBS: '6' }, process.env, { FH_TEST_LOGS_DIR: logs, FH_TEST_RESULT: result });
    for (const k of ['FH_TEST_RELAY', 'FH_TEST_JOIN', 'FH_LAG', 'FH_RATE', 'FH_TEST_TUNNEL', 'FH_TEST_LINE', 'FH_TWINS_CHANGED']) delete env[k];
    const { suites, runner, ...vars } = MODES[mode];
    Object.assign(env, vars);
    // A result left over from an earlier run must never stand in for this one.
    fs.rmSync(result, { force: true });
    console.log(`\n=== ${mode}`);
    const ran = spawnSync(process.execPath, [path.join(__dirname, runner || 'run.js'), ...(suites || [])], { cwd: ROOT, env, stdio: 'inherit' });
    let r = null;
    try { r = JSON.parse(fs.readFileSync(result, 'utf8')); } catch (e) { /* no result: the run did not finish */ }
    if (!r || !(r.suites > 0 || r.stood > 0)) r = { suites: 0, broken: ['(the run itself did not finish: exit ' + ran.status + ')'], flaky: [] };
    results[mode] = r;
    if (mode === 'twins' && r.broken.length) { console.log('A fix is not caught by its test: the rest is not run.'); break; }
}

console.log('\n=== gate');
let pass = true;
for (const mode of modes) {
    const r = results[mode] || { suites: 0, broken: ['(not run)'], flaky: [] };
    const ok = !r.broken.length;
    pass = pass && ok;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${mode.padEnd(8)} ${ok ? 'all ' + r.suites + ' suites' + (r.stood ? ' (' + r.stood + ' stand)' : '') + (r.flaky.length ? '; FLAKY, fix the test: ' + r.flaky.join(' ') : '') : 'broken: ' + (r.broken.join(' ') || '-') + '; flaky: ' + (r.flaky.join(' ') || '-')}  (logs: test/out/gate/${mode}/)`);
}
// The tree must be the same commit, unchanged, from the first suite to the last.
const same = git(['rev-parse', 'HEAD']) === commit && !git(['status', '--porcelain']);
if (pass && full && !dirty && same) {
    fs.writeFileSync(path.join(OUT, 'gate.json'), JSON.stringify({ commit, at: new Date().toISOString(), results }, null, 1));
    console.log('GATE PASSED for ' + commit.slice(0, 7) + ': this commit may be released.');
} else {
    console.log(pass ? (dirty || !same ? 'Passed, but the tree had uncommitted changes or changed during the run: commit and run the gate again to release.' : 'Passed for the modes asked; run them all to release.') : 'GATE FAILED: nothing ships until every mode passes.');
}
process.exit(pass ? 0 : 1);
