// The F9 meter measures the line to the host (round trip through the relay),
// and every player's meter reaches the host's log once a minute, so a "slow,
// low framerate, high ping" report (his 10/21) comes with numbers from both
// machines. FH_LAG 50: the relay holds what it sends back by about that long.
const { execFile } = require('child_process');
const path = require('path');
const { twoPlayers, checker, sleep, waitFor } = require('./common');

(async () => {
    const check = checker();
    let s;
    let out = '';
    try {
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
        // tools/stats.js still hears every player's meter through the room.
        const url = 'ws://localhost:8734/coop/ws' + require('../tools/version').socketQuery();
        const heard = await new Promise((done) => execFile(process.execPath, [path.join(__dirname, '..', 'tools', 'stats.js'), '7', url], (e, stdout) => done(String(stdout || ''))));
        check('tools/stats.js hears the player\'s meter', /== Bo\n/.test(heard.replace(/\r/g, '')), heard.split('\n')[0]);
        // A bug report shows them in their own section, not in the log's tail.
        const report = await (await fetch('http://localhost:8734/coop/app/report', { headers: { 'x-fh-app': '1' } })).text();
        const meters = report.split('--- meters (latest) ---')[1] || '';
        const tailPart = (report.split('--- server log (end) ---')[1] || '').split('--- meters')[0];
        check('a bug report has the meters in their own section', /meter Bo: /.test(meters) && !/ meter /.test(tailPart), meters.trim().split('\n')[0]);
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
