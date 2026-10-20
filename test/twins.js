// Broken twins: each one takes a single fix back out of the mod, in the test's own copy of the
// code as it is served or loaded (never the files on disk), and runs the suite that proves the
// fix. That suite has to FAIL. A suite that still passes with its fix gone was proving nothing.
//   node test/twins.js            every twin (its suite once clean, then broken; one at a time)
//   node test/twins.js paste-box  some of them
//   node test/twins.js --check    only that every twin still finds its code (lint runs this)
// FH_TWIN=<name> is read by test/lib.js (pages: the served /coop/ file) and test/twin-hook.js
// (the server: any of its own modules as Node loads it).
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'out', 'twins');

// file: relative to the repo. find must occur exactly once in it.
const TWINS = {
    'whose-scene': {
        why: 'world switches started other players\' scenes on everyone (the hound, the elevator, Trortur)',
        suite: 'scenes', file: 'client/state.js',
        find: 'return actsOnPlayer(page.list);', put: 'return false;',
    },
    'paste-box': {
        why: 'the Together link box took no clicks (0.1.0 to 0.1.3)',
        suite: 'paste', file: 'client/fixes.js',
        find: "strip.textContent = '#ErrorPrinter { pointer-events: none; } #ErrorPrinter * { pointer-events: auto; }';", put: "strip.textContent = '';",
    },
    'just-guard': {
        why: 'a guest\'s Just Guard never counted, and the charge killed him',
        suite: 'ai', file: 'client/battle.js',
        find: '!$gameSwitches.value(JUST_GUARD) && playersGuarding()) {', put: '!$gameSwitches.value(JUST_GUARD) && false) {',
    },
    'hidden-loop': {
        why: 'a minimised or covered window froze fights for everyone',
        suite: 'humans', file: 'client/fixes.js',
        find: 'if (document.hidden && othersHere()) nextBeat(go); else requestAnimationFrame(go);', put: 'requestAnimationFrame(go);',
    },
    'menu-trade': {
        why: 'nothing could be handed to a player standing in their own menu',
        suite: 'trade', file: 'client/trade.js',
        find: "const REACHABLE = ['map', 'event', 'menu'];", put: "const REACHABLE = ['map', 'event'];",
    },
    'version-gate': {
        why: 'another release of the game or the mod would share a world it cannot',
        suite: 'server', file: 'server.js',
        find: 'if (theirs.build !== BUILD.build || theirs.mod !== BUILD.mod) {', put: 'if (false) {',
    },
    'dns-wait': {
        why: 'links were handed out before Cloudflare published them',
        suite: 'publish', file: 'tools/tunnel.js',
        find: '        ask();\n    }\n\n    // Resolves once the address answers', put: '        done();\n    }\n\n    // Resolves once the address answers',
    },
    'service-address': {
        why: 'Cloudflare\'s own service, named in cloudflared\'s errors, became the link and the panel waited for nothing',
        suite: 'publish', file: 'tools/tunnel.js',
        find: '(?!api\\.)', put: '',
    },
    'drop-notice': {
        why: 'a host whose tunnel dropped was not told, and friends were left with a dead link',
        suite: 'publish', file: 'client/together.js',
        find: 'if (dropSeen !== null && s.droppedAt && s.mode === \'local\') {', put: 'if (false) {',
    },
    'restart-host': {
        why: 'Stop hosting then Host online at once: the old cloudflared\'s exit took the new tunnel\'s place, and no link came',
        suite: 'humans', file: 'tools/tunnel.js', env: { FH_TEST_TUNNEL: '1', FH_TEST_RELAY: '1' },
        find: "if (this.proc !== proc) { reject(new Error('stopped')); return; }", put: '',
    },
};

// The twin's source for `file` (repo-relative, forward slashes), or null when the twin is not for it.
function twinSource(name, file, text) {
    const t = TWINS[name];
    if (!t || t.file !== file) return null;
    const nl = text.includes('\r\n') ? '\r\n' : '\n';
    const find = t.find.split('\n').join(nl), put = t.put.split('\n').join(nl);
    const at = text.indexOf(find);
    if (at < 0 || text.indexOf(find, at + 1) >= 0) throw new Error(`twin ${name}: its code in ${file} is gone or not unique; update test/twins.js`);
    // Each page and server that got the twin says so: a run where nothing did is no run.
    try { fs.mkdirSync(OUT, { recursive: true }); fs.appendFileSync(path.join(OUT, name + '.applied'), file + '\n'); } catch (e) { /* counted elsewhere */ }
    return text.slice(0, at) + put + text.slice(at + find.length);
}

function check() {
    let bad = 0;
    for (const [name, t] of Object.entries(TWINS)) {
        const text = fs.readFileSync(path.join(ROOT, t.file), 'utf8').split('\r\n').join('\n');
        const n = text.split(t.find).length - 1;
        if (n !== 1) { bad++; console.log(`FAIL twin ${name}: found ${n} times in ${t.file} (needs exactly 1)`); }
        if (!fs.existsSync(path.join(__dirname, t.suite + '.js'))) { bad++; console.log(`FAIL twin ${name}: no suite test/${t.suite}.js`); }
    }
    return bad;
}

const LOGS = process.env.FH_TEST_LOGS_DIR || OUT;

// One suite, with a twin in place or none. Its whole output goes to LOGS.
function runSuite(suite, twin, log, vars) {
    return new Promise((resolve) => {
        const env = Object.assign({}, process.env, vars || {});
        if (twin) env.FH_TWIN = twin;
        // The suite too: a check that calls the mod's own code directly gets the twin.
        const hook = twin ? ['-r', path.join(__dirname, 'twin-hook.js')] : [];
        const child = spawn(process.execPath, [...hook, path.join(__dirname, suite + '.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '', killed = false;
        child.stdout.on('data', (d) => { out += d; });
        child.stderr.on('data', (d) => { out += d; });
        const timer = setTimeout(() => {
            killed = true;
            out += '\nkilled after 10 minutes';
            if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
            else child.kill();
        }, 600000);
        child.on('close', (code) => {
            clearTimeout(timer);
            fs.mkdirSync(LOGS, { recursive: true });
            fs.writeFileSync(path.join(LOGS, log + '.txt'), out);
            resolve({ code, out, killed });
        });
    });
}

const clean = {};
async function runTwin(name) {
    const t = TWINS[name];
    const started = Date.now();
    // The control: the suite passes as shipped, here and now. Otherwise its failure with the
    // twin says nothing. (The gate has just run every suite clean, and says so.)
    // A twin's env: the way of playing its suite must run in (a real tunnel, say).
    const key = t.suite + (t.env ? ' ' + JSON.stringify(t.env) : '');
    if (!process.env.FH_TWINS_CLEAN_RUN && clean[key] === undefined) {
        const r = await runSuite(t.suite, null, t.suite + '.clean', t.env);
        clean[key] = r.code === 0 && /^all [1-9]\d* passed$/m.test(r.out);
    }
    if (clean[key] === false) {
        console.log(`FAIL ${name.padEnd(16)} ${t.suite.padEnd(9)} the suite fails without the twin too: no verdict (log ${t.suite}.clean.txt)`);
        return false;
    }
    const applied = path.join(OUT, name + '.applied');
    fs.rmSync(applied, { force: true });
    const { code, out, killed } = await runSuite(t.suite, name, name, t.env);
    let times = 0;
    try { times = fs.readFileSync(applied, 'utf8').trim().split('\n').filter(Boolean).length; } catch (e) { /* never applied */ }
    // Caught = the suite's own checks failed with the twin in place: a FAIL line, not a
    // crash or a run killed for taking too long. The line is shown, to read that it failed
    // for the right reason.
    const reason = out.split('\n').find((l) => /^FAIL /.test(l)) || '';
    const caught = code !== 0 && times > 0 && !!reason && !killed;
    const secs = Math.round((Date.now() - started) / 1000);
    const verdict = times === 0 ? 'NOT APPLIED' : killed ? 'TIMED OUT' : caught ? 'caught' : code !== 0 ? 'NO FAIL LINE' : 'MISSED';
    console.log(`${caught ? 'ok  ' : 'FAIL'} ${name.padEnd(16)} ${t.suite.padEnd(9)} ${secs}s  ${verdict}${times ? ' (applied ' + times + 'x)' : ''}  ${reason.trim().slice(0, 160)}`);
    if (!caught) console.log(`       the fix: ${t.why}`);
    return caught;
}

module.exports = { TWINS, twinSource };

if (require.main === module) {
    const args = process.argv.slice(2);
    if (args[0] === '--check') {
        const bad = check();
        console.log(bad ? `${bad} twin problem(s)` : `all ${Object.keys(TWINS).length} passed`);
        process.exit(bad ? 1 : 0);
    }
    if (process.env.FH_TWIN) { console.error('FH_TWIN is set in this shell: unset it first.'); process.exit(2); }
    const names = args.length ? args : Object.keys(TWINS);
    for (const n of names) if (!TWINS[n]) { console.error('no such twin: ' + n + ' (' + Object.keys(TWINS).join(', ') + ')'); process.exit(2); }
    if (check()) process.exit(1);
    if (!require('./lock')()) { console.error('Another test run is using the ports (test/out/run.lock). Wait for it, or end it.'); process.exit(2); }
    (async () => {
        const started = Date.now();
        const missed = [];
        // One at a time: each runs a whole suite with its usual ports.
        for (const n of names) if (!(await runTwin(n))) missed.push(n);
        const secs = Math.round((Date.now() - started) / 1000);
        console.log(missed.length ? `${missed.length} twin(s) not caught (${secs}s): ${missed.join(' ')}` : `all ${names.length} passed (${secs}s): every twin was caught`);
        if (process.env.FH_TEST_RESULT) fs.writeFileSync(process.env.FH_TEST_RESULT, JSON.stringify({ suites: names.length, broken: missed, flaky: [], secs }));
        process.exit(missed.length ? 1 : 0);
    })();
}
