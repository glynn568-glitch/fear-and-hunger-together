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
    'bot-dressing': {
        why: '10/21 marathons froze the host: the bot\'s change of clothes handed pieces back, each asking for another change',
        suite: 'ai', file: 'tools/bot-page.js',
        find: ' && Coop.world.live && !BOT.dressing) {', put: ' && Coop.world.live) {',
    },
    'log-late': {
        why: 'review 10/21: a second start (Play pressed twice) moved the running session\'s log away before finding the port taken',
        suite: 'meterline', file: 'server.js',
        find: 'let LOG = null;\n', put: 'let LOG = null;\nprocess.nextTick(() => openLog());\n',
    },
    'notes-cap': {
        why: 'review 10/21: a page throwing in a loop could fill the host\'s disk with notes',
        suite: 'meterline', file: 'room.js',
        find: '                if (peer.notesN > NOTES_PER_MIN) continue;\n', put: '',
    },
    'flatpak-partner': {
        why: 'his 10/21: a Steam Deck player could not call an AI partner in (its Chrome is a Flatpak)',
        suite: 'deck', file: 'tools/bot.js',
        find: "    ...(process.platform === 'linux' ? linuxBrowsers() : [])].find(", put: '    ].find(',
    },
    'whose-scene': {
        why: 'world switches started other players\' scenes on everyone (the hound, the elevator, Trortur)',
        suite: 'scenes', file: 'client/state.js',
        find: 'return actsOnPlayer(page.list);', put: 'return false;',
    },
    'settle-start': {
        why: 'his 10/20: the Cave Mother, just won in Enki\'s fight, fought him again at full health and left him stuck',
        suite: 'refight', file: 'client/events.js',
        find: "        if (hold && hold.k === 'talk' && hold.won) return;\n", put: '',
    },
    'hold-flush': {
        why: 'the word that a beaten boss\'s scene was over could reach a partner before her "dead" switch',
        suite: 'refight', file: 'client/events.js',
        find: '        Coop.world.flush();\n        Coop.send(msg);', put: '        Coop.send(msg);',
    },
    'gnome-dead': {
        why: 'a cave gnome one player killed was alive for the other (its dead switch was kept on one machine)',
        suite: 'refight', file: 'client/census.json',
        find: ',302,303,304,305,306,307,', put: ',302,303,307,',
    },
    'beaten-scene': {
        why: 'a scene under way when its enemy was beaten in another fight started that fight again',
        suite: 'refight', file: 'client/battle.js',
        find: 'if (beaten && this._coopSince && this._coopSince <= beaten) {', put: 'if (false) {',
    },
    'meter-line': {
        why: 'his 10/21 "high ping": nothing measured the line to the host or kept either player\'s numbers',
        suite: 'meterline', file: 'room.js',
        find: "this.send(peer, { t: 'rtt', at: msg.at });", put: '',
    },
    'meter-relay': {
        why: 'the room kept players\' meters to its log and stopped passing them on: tools/stats.js heard nobody',
        suite: 'meterline', file: 'room.js',
        find: "            this.broadcast(msg, peer.id); // and passed on as before: tools/stats.js listens for it\n", put: '',
    },
    'host-notes': {
        why: 'players\' notes stayed in their own games: a session could not be read back from the host\'s PC (10/21)',
        suite: 'meterline', file: 'room.js',
        find: "                console.log(who + line.slice(0, 300).replace(/[\\r\\n]+/g, ' '));\n", put: '',
    },
    'log-rotate': {
        why: 'each start wrote over the last session\'s log, so his 10/20 session before the last one was gone',
        suite: 'meterline', file: 'server.js',
        find: "        try { fs.renameSync(n ? older(n) : LOG_FILE, older(n + 1)); } catch (e) { /* not there yet */ }\n", put: '',
    },
    'layout-once': {
        why: 'his 10/21: the Blood pit lizardman missing; any layout dice but three could be thrown again mid-run, changing a floor under everyone',
        suite: 'slips', file: 'room.js',
        find: "try { ONCE = JSON.parse(fs.readFileSync(path.join(__dirname, 'client', 'census.json'), 'utf8')).once || []; }", put: 'try { ONCE = [24, 25, 29]; }',
    },
    'player-route': {
        why: 'his friend 10/20: the lift\'s arrival walked the partner and left the cage hanging a tile up, unusable',
        suite: 'lift', file: 'client/state.js',
        find: 'if (c.code === 205 && c.parameters[0] === -1) { yes = true; break; }', put: '',
    },
    'walk-buffer': {
        why: 'his 10/21: a partner walking over a shaky line stopped between tiles whenever a step came late',
        suite: 'walk', file: 'client/presence.js',
        find: 'const WALK_DELAY = 200; // ms', put: 'const WALK_DELAY = 0; // ms',
    },
    'snake-slip': {
        why: 'his 10/20: the Salmonsnake on map 184 moved him to map 11, away from his partner, into a fight they could not join',
        suite: 'slips', file: 'client/fixes.js',
        find: "const SNAKE_SLIP = { '39:263': 11, '184:263': 11 };", put: 'const SNAKE_SLIP = {};',
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
        find: 'zoneServers().then(viaZone).catch(() => viaHttps());', put: 'done();',
    },
    'dns-authoritative': {
        why: 'links were held up to 90 s: asked too early, the public resolver remembered "no such name" for a minute',
        suite: 'publish', file: 'tools/tunnel.js',
        find: 'zoneServers().then(viaZone).catch(() => viaHttps());', put: 'viaHttps();',
    },
    'quiet-line': {
        why: 'a joiner\'s line that died without closing went unnoticed: his game played on alone for minutes',
        suite: 'quietline', file: 'server.js',
        find: 'if (Date.now() - heard > DEAD_AFTER) {', put: 'if (false) {',
    },
    'quiet-handshake': {
        why: 'a try to reach the host whose handshake a dead line swallowed waited forever, so the joiner never got back',
        suite: 'quietline', file: 'server.js',
        find: ', handshakeTimeout: 10000 });', put: ' });',
    },
    'own-ghost': {
        why: 'a joiner back before the host noticed its old line was dead took its own old self for another player and stayed out of the world',
        suite: 'quietline', file: 'client/state.js',
        find: 'if (Coop.name && String(peer.name).toLowerCase() === Coop.name.toLowerCase()) continue;', put: '',
    },
    'chat-resend': {
        why: 'a chat line said while the line was down, or into a line that had died, was lost',
        suite: 'chat', file: 'client/chat.js',
        find: "for (const l of unsent) Coop.send({ t: 'chat', text: l.text, id: l.id });", put: '',
    },
    'chat-once': {
        why: 'a chat line said again after a reconnect showed twice when it had arrived the first time',
        suite: 'chat', file: 'room.js',
        find: 'if (!id || !this.chatSeen.has(id)) this.broadcast(msg, peer.id);', put: 'this.broadcast(msg, peer.id);',
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
    'hunger-rate': {
        why: 'hunger drained at the solo rate in co-op, where nobody can pause',
        suite: 'hunger', file: 'client/rules.js',
        find: 'if (this._waitCount > 0 && isHungerDrain(this._list) && Coop.playingTogether()) {', put: 'if (false) {',
    },
    'restart-host': {
        why: 'Stop hosting then Host online at once: the old cloudflared\'s exit took the new tunnel\'s place, and no link came',
        suite: 'humans', file: 'tools/tunnel.js', env: { FH_TEST_TUNNEL: '1', FH_TEST_RELAY: '1' },
        find: "if (this.proc !== proc) { reject(new Error('stopped')); return; }", put: '',
    },
    'name-trim': {
        why: 'the box added the letter under its cursor on Enter, "O LORD " was not the prayer, and a Steam Deck player got no Black orb',
        suite: 'scroll', file: 'client/fixes.js',
        find: 'return this._name.trim();', put: 'return this._name;',
    },
    'typed-key': {
        why: 'the space bar typed a space and also pressed the name box\'s OK: it finished the box when its cursor was on OK',
        suite: 'scroll', file: 'client/fixes.js',
        find: "for (const b of ['ok', 'cancel']) if (Input.isTriggered(b)) held[b] = true;", put: '',
    },
    'typing-enter': {
        why: 'Enter after a typed word put the letter under the name box\'s grid cursor in: "o lord" became "o lordA"',
        suite: 'scroll', file: 'client/fixes.js',
        find: 'if (this._coopTyping && this.character()) SoundManager.playBuzzer();', put: 'if (false) SoundManager.playBuzzer();',
    },
    'verse-case': {
        why: 'the scroll\'s verses were compared capitals and all: "o lord teach black orb" taught nothing',
        suite: 'scroll', file: 'client/fixes.js',
        find: 'actor.name().toUpperCase() === String(p[3]).toUpperCase();', put: 'actor.name() === String(p[3]);',
    },
    'slow-host': {
        why: 'a host who took over 25 s on their own move left the AI partner never asked for its turn',
        suite: 'plain', file: 'client/battle.js',
        find: '            if (newTurn) b.ctlAt = Date.now();\n            const who = controller(b);\n',
        put: '            const who = controller(b);\n            if (newTurn) b.ctlAt = Date.now();\n',
    },
    'chat-trim': {
        why: 'a chat line from a sender that is not Coop.say kept the spaces at its ends',
        suite: 'scroll', file: 'client/chat.js',
        find: "const text = String(msg.text || '').trim().slice(0, 200);", put: "const text = String(msg.text || '').slice(0, 200);",
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
