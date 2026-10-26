// The F9 meter measures the line to the host (round trip through the relay),
// and every player's meter reaches the host's log once a minute, so a "slow,
// low framerate, high ping" report (his 10/21) comes with numbers from both
// machines. FH_LAG 50: the relay holds what it sends back by about that long.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { twoPlayers, checker, sleep, waitFor } = require('./common');
const { startServer, OUT } = require('./lib');

(async () => {
    const check = checker();
    let s;
    let out = '';
    try {
        // Earlier runs' logs out of the way, so only this run's restart can leave one.
        for (const f of fs.readdirSync(OUT)) if (/^server-8734\.\d\.log$/.test(f)) fs.rmSync(path.join(OUT, f));
        s = await twoPlayers(8734, { env: { FH_LAG: '50', FH_METER_LOG_MS: '5000' } });
        const { a, b } = s;
        s.server.stdout.on('data', (d) => { out += d; });
        await waitFor(b, () => Coop.meter.last && Coop.meter.last.lineMs != null, 20000, 'B has measured its line');
        const m = await b.evaluate(() => Coop.meter.last);
        check('the meter measures the line to the host', m.lineMs >= 25 && m.lineMs <= 200 && m.lineWorstMs >= m.lineMs, m.lineMs + ' ms (worst ' + m.lineWorstMs + ')');
        await b.evaluate(() => { Coop.meter.show = true; });
        await sleep(5500);
        const shown = await b.evaluate(() => document.getElementById('coop-meter').textContent);
        check('and shows it under F9', /line to the host: \d+ ms round trip/.test(shown), shown.split('\n').find((l) => /line/.test(l)));
        const t0 = Date.now();
        while (!/meter Bo: .*line \d+ ms/.test(out) && Date.now() - t0 < 15000) await sleep(500);
        const logged = (out.match(/meter Bo: .*/) || [''])[0];
        check('the host\'s log has the player\'s numbers', /steps\/s/.test(logged) && /line \d+ ms/.test(logged), logged);
        check('...with what each step and drawing cost, the map and the memory in use', /step [\d.]+ ms \(worst \d+\)/.test(logged) && /draw worst \d+ ms/.test(logged) && /heap \d+ MB/.test(logged), logged);
        // Watching a second picture restarts the viewer's frame count (10/24: "at -639 fps").
        await b.evaluate(() => { Coop.meter._frames = 5000; Coop.viewer.active = true; Coop.viewer.frames = 10; Coop.meter.last = null; });
        await waitFor(b, () => Coop.meter.last, 8000, 'next meter window');
        const fps = await b.evaluate(() => { Coop.viewer.active = false; return Coop.meter.last.watchFps; });
        check('a picture watched after another is counted from its start, never below 0 fps', fps >= 0, fps + ' fps');
        // tools/stats.js still hears every player's meter through the room.
        const url = 'ws://localhost:8734/coop/ws' + require('../tools/version').socketQuery();
        const heard = await new Promise((done) => execFile(process.execPath, [path.join(__dirname, '..', 'tools', 'stats.js'), '7', url], (e, stdout) => done(String(stdout || ''))));
        check('tools/stats.js hears the player\'s meter', /== Bo\n/.test(heard.replace(/\r/g, '')), heard.split('\n')[0]);
        // A bug report shows them in their own section, not in the log's tail.
        const report = await (await fetch('http://localhost:8734/coop/app/report', { headers: { 'x-fh-app': '1' } })).text();
        const meters = report.split('--- meters (latest) ---')[1] || '';
        const tailPart = (report.split('--- server log (end) ---')[1] || '').split('--- meters')[0];
        check('a bug report has the meters in their own section', /meter Bo: /.test(meters) && !/ meter /.test(tailPart), meters.trim().split('\n')[0]);

        // Every player's notes reach the host's log (a session read back from the host's PC).
        const noted = (re, ms) => { const t0 = Date.now(); return (async () => { while (!re.test(out) && Date.now() - t0 < ms) await sleep(300); return re.test(out); })(); };
        await b.evaluate(() => Coop.note('stayed out of the fight: test note'));
        check("a player's note reaches the host's log", await noted(/note Bo: stayed out of the fight: test note/, 8000));
        await b.evaluate(() => { Coop.on('notetest', () => { throw new Error('broken handler'); }); Coop.emit('notetest', {}); });
        check('a failing message handler is noted there too', await noted(/note Bo: script error in the notetest handler: Error: broken handler/, 8000));
        // A note made while the line is down arrives once it is back, saying when it was made.
        await b.evaluate(() => {
            window._holdLine = true;
            const connect = Coop.connect;
            Coop.connect = function () { if (window._holdLine) setTimeout(Coop.connect, 200); else connect(); };
            Coop._ws.close();
        });
        await waitFor(b, () => !Coop.connected, 5000, 'B offline');
        await b.evaluate(() => Coop.note('made while offline'));
        await sleep(6000);
        await b.evaluate(() => { window._holdLine = false; });
        check('a note made while the line was down arrives after, with its time', await noted(/note Bo: \[\d\d:\d\d:\d\d\] made while offline/, 15000));
        const report2 = await (await fetch('http://localhost:8734/coop/app/report', { headers: { 'x-fh-app': '1' } })).text();
        const notesPart = report2.split('--- players\' notes (end) ---')[1] || '';
        const tail2 = (report2.split('--- server log (end) ---')[1] || '').split('--- meters')[0];
        check('a bug report has the notes in their own section', /note Bo: stayed out/.test(notesPart) && !/ note /.test(tail2));

        // A page throwing in a loop: its notes are capped, the host's disk is not filled (review 10/21).
        // Straight down the line, as a modified client could (the game's own client sends slower).
        await b.evaluate(() => { for (let k = 0; k < 6; k++) Coop.send({ t: 'notes', lines: Array.from({ length: 50 }, (x, i) => 'flood ' + (k * 50 + i)) }); });
        await noted(/more notes this minute left out/, 15000);
        await sleep(3000);
        const flooded = (out.match(/note Bo: flood \d+/g) || []).length;
        check('a flood of notes is capped in the host\'s log', flooded > 0 && flooded <= 120 && /note Bo: \(more notes this minute left out\)/.test(out), flooded + ' flood lines kept');

        // Starting it a second time while it runs says so and leaves the running session's log where it is (review 10/21).
        const prevBefore = fs.existsSync(path.join(OUT, 'server-8734.1.log')) ? fs.readFileSync(path.join(OUT, 'server-8734.1.log'), 'utf8') : '';
        const second = require('child_process').spawn(process.execPath, [...(process.env.FH_TWIN ? ['-r', path.join(__dirname, 'twin-hook.js')] : []), path.join(__dirname, '..', 'server.js')],
            { env: { ...process.env, PORT: '8734', FH_SAVES: s.server.saves }, stdio: 'ignore' });
        await new Promise((r) => second.on('exit', r));
        const live = fs.readFileSync(path.join(OUT, 'server-8734.log'), 'utf8');
        const prevAfter = fs.existsSync(path.join(OUT, 'server-8734.1.log')) ? fs.readFileSync(path.join(OUT, 'server-8734.1.log'), 'utf8') : '';
        check('a second start leaves the running session\'s log in place', /note Bo: flood \d+/.test(live) && prevAfter === prevBefore, live.length + ' bytes live, .1 ' + (prevAfter === prevBefore ? 'unchanged' : 'replaced'));

        // The session before this one is still there after a restart.
        await s.close();
        const again = await startServer(8734);
        const prev = fs.readFileSync(path.join(OUT, 'server-8734.1.log'), 'utf8');
        again.kill();
        s = null;
        check("restarting keeps the last session's log beside the new one", /note Bo: stayed out of the fight: test note/.test(prev));
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
