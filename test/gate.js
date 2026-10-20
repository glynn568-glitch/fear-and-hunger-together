// The release gate: every suite, in every way the game is really played.
//   default   as shipped: Hide my IP on, fight pictures through the host
//   direct    Hide my IP off: fight video straight between browsers
//   join      the second player on their own PC, through their own server
//   badlink   as shipped, over a poor line: 80 ms each way and 4 Mbit/s to each player
//   internet  two people (test/humans.js) through a real Cloudflare tunnel: needs the internet
//   twins     each fix taken back out (test/twins.js): its suite has to fail
// A suite that fails, even one that passes when run again alone, fails the gate.
// On a pass, test/out/gate.json names the commit; tools/release.js ships only that commit.
//   node test/gate.js              all six (about an hour)
//   node test/gate.js join badlink some of them (no gate.json is written)
const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const MODES = {
    default: { FH_TEST_RELAY: '1' },
    direct: {},
    join: { FH_TEST_RELAY: '1', FH_TEST_JOIN: '1' },
    badlink: { FH_TEST_RELAY: '1', FH_LAG: '80', FH_RATE: '500000' },
    internet: { FH_TEST_RELAY: '1', FH_TEST_TUNNEL: '1', suites: ['humans'] },
    // Last, so every suite has just passed clean (FH_TWINS_CLEAN_RUN skips that control).
    twins: { runner: 'twins.js', FH_TWINS_CLEAN_RUN: '1' },
};
const asked = process.argv.slice(2);
const modes = asked.length ? asked : Object.keys(MODES);
for (const m of modes) if (!MODES[m]) throw new Error('no such mode: ' + m + ' (' + Object.keys(MODES).join(', ') + ')');

const git = (argv) => execFileSync('git', argv, { cwd: ROOT, encoding: 'utf8' }).trim();
const commit = git(['rev-parse', 'HEAD']);
const dirty = !!git(['status', '--porcelain']);

const results = {};
for (const mode of modes) {
    const logs = path.join(OUT, 'gate', mode);
    fs.rmSync(logs, { recursive: true, force: true });
    const result = path.join(OUT, 'gate', mode + '.json');
    // Four at a time, not six: video encoding in every fight made a full machine flaky,
    // and here a flaky suite fails the gate.
    const env = Object.assign({ FH_TEST_JOBS: '4' }, process.env, { FH_TEST_LOGS_DIR: logs, FH_TEST_RESULT: result });
    for (const k of ['FH_TEST_RELAY', 'FH_TEST_JOIN', 'FH_LAG', 'FH_RATE', 'FH_TEST_TUNNEL']) delete env[k];
    const { suites, runner, ...vars } = MODES[mode];
    Object.assign(env, vars);
    // A result left over from an earlier run must never stand in for this one.
    fs.rmSync(result, { force: true });
    console.log(`\n=== ${mode}`);
    const ran = spawnSync(process.execPath, [path.join(__dirname, runner || 'run.js'), ...(suites || [])], { cwd: ROOT, env, stdio: 'inherit' });
    let r = null;
    try { r = JSON.parse(fs.readFileSync(result, 'utf8')); } catch (e) { /* no result: the run did not finish */ }
    if (!r || !(r.suites > 0)) r = { suites: 0, broken: ['(the run itself did not finish: exit ' + ran.status + ')'], flaky: [] };
    results[mode] = r;
}

console.log('\n=== gate');
let pass = true;
for (const mode of modes) {
    const r = results[mode];
    const ok = !r.broken.length && !r.flaky.length;
    pass = pass && ok;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${mode.padEnd(8)} ${ok ? 'all ' + r.suites + ' suites' : 'broken: ' + (r.broken.join(' ') || '-') + '; flaky: ' + (r.flaky.join(' ') || '-')}  (logs: test/out/gate/${mode}/)`);
}
const full = modes.length === Object.keys(MODES).length;
// The tree must be the same commit, unchanged, from the first suite to the last.
const same = git(['rev-parse', 'HEAD']) === commit && !git(['status', '--porcelain']);
if (pass && full && !dirty && same) {
    fs.writeFileSync(path.join(OUT, 'gate.json'), JSON.stringify({ commit, at: new Date().toISOString(), results }, null, 1));
    console.log('GATE PASSED for ' + commit.slice(0, 7) + ': this commit may be released.');
} else {
    console.log(pass ? (dirty || !same ? 'Passed, but the tree had uncommitted changes or changed during the run: commit and run the gate again to release.' : 'Passed for the modes asked; run them all to release.') : 'GATE FAILED: nothing ships until every mode passes.');
}
process.exit(pass ? 0 : 1);
