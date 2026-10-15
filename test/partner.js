// Calling an AI partner in from the game and sending it home: F8 on the
// host's own browser starts one (the server runs it), F8 again sends it home.
// Nobody coming in through the tunnel may do either.
process.env.FH_BOT_ARGS = '--brain none'; // no model calls in the tests
const WebSocket = require('ws');
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const { checker } = require('./common');
const install = require('./helpers');

async function press(page, code) {
    await page.keyboard.down(code); await sleep(130); await page.keyboard.up(code); await sleep(250);
}

(async () => {
    const check = checker();
    const port = 8446;
    const server = await startServer(port);
    const logs = [];
    server.stdout.on('data', (d) => logs.push(String(d)));
    const browser = await launch();
    let a;
    try {
        a = await openPlayer(browser, `http://localhost:${port}/?name=Ann`, 'Ann');
        await waitFor(a, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 90000, 'title');
        await a.evaluate(install);
        await a.evaluate(() => T.quickStart(1, 27, 67));
        await waitFor(a, () => T.onMap(), 60000, 'Ann on the map');
        await a.evaluate(() => { T.settle(); T.begin(); for (const ev of $gameMap.events()) if (/guard|enemy|chaser/i.test(ev.event().name)) ev.erase(); });
        await waitFor(a, () => Coop.world.live, 10000, 'Ann live');

        //--- someone through the tunnel may not call one ---------------------
        const visitor = new WebSocket(`ws://localhost:${port}/coop/ws` + require('../tools/version').socketQuery(), { headers: { 'cf-connecting-ip': '203.0.113.9' } });
        const notes = [];
        visitor.on('message', (raw) => { try { const m = JSON.parse(raw); if (m.t === 'partnernote') notes.push(m.text); } catch (e) { /* binary */ } });
        await new Promise((r) => visitor.on('open', r));
        visitor.send(JSON.stringify({ t: 'partner', on: true }));
        await sleep(1500);
        check('a friend coming in through the tunnel cannot call a partner', notes.some((t) => /Only the player hosting/.test(t)) && !/\[Claude\]/.test(logs.join('')), notes.join(' | '));
        visitor.close();

        //--- F8: one is called in --------------------------------------------
        await a.evaluate(() => { window.toasts = []; const t = Coop.toast; Coop.toast = function (text) { window.toasts.push(text); return t.apply(this, arguments); }; });
        await press(a, 'F8');
        await waitFor(a, () => window.toasts.some((t) => /on the way/.test(t)), 5000, 'the call is confirmed');
        await waitFor(a, () => Coop.others().some((p) => p.bot === 1 && p.st === 'map'), 90000, 'the partner arrives in the dungeon');
        const who = await a.evaluate(() => { const p = Coop.others().find((q) => q.bot); return { name: p.name, an: p.an }; });
        check('F8 calls an AI partner into the dungeon, no console needed', who.name === 'Claude', JSON.stringify(who));
        await waitFor(a, () => [...document.querySelectorAll('#coop-chat .line')].some((l) => /No AI model is connected/.test(l.textContent)), 15000, 'the no-model notice');
        check('without a model it says so plainly in the chat', true);
        await sleep(2000);
        check('its arrival is not announced as "Player N connected"', !(await a.evaluate(() => window.toasts.some((t) => /^Player d+ connected/.test(t)))), JSON.stringify(await a.evaluate(() => window.toasts)));

        //--- F8 again: it goes home ------------------------------------------
        await sleep(1000);
        await press(a, 'F8');
        await waitFor(a, () => !Coop.others().some((p) => p.bot), 20000, 'the partner leaves');
        check('F8 again sends it home', true);
        await sleep(2000);
        check('the partner left on purpose, so nothing was kept as a dropped player', !fsExists(server.saves));

        //--- two called at once: they cannot both be the knight --------------
        await press(a, 'F8');
        await a.keyboard.down('Shift'); await press(a, 'F8'); await a.keyboard.up('Shift');
        await waitFor(a, () => Coop.others().filter((p) => p.bot === 1 && p.st === 'map').length === 2, 120000, 'both partners in the dungeon');
        await sleep(6000);
        const pair = await a.evaluate(() => Coop.others().filter((p) => p.bot).map((p) => ({ name: p.name, ini: (p.ini || []).join(), st: p.st })));
        check('two partners called together come in as two different characters', pair.length === 2 && pair[0].ini && pair[1].ini && pair[0].ini !== pair[1].ini, JSON.stringify(pair));
        await press(a, 'F8'); await sleep(1500); await press(a, 'F8');
        await waitFor(a, () => !Coop.others().some((p) => p.bot), 30000, 'both partners leave');
    } catch (e) {
        console.error(e);
        check('test ran to the end', false);
        if (a) console.log('toast: ' + await a.evaluate(() => document.getElementById('coop-toast').textContent).catch(() => '?'));
        console.log('server said:\n' + logs.join('').split('\n').filter((l) => /\[Claude|partner|could not/i.test(l)).slice(-12).join('\n'));
    }
    const code = check.finish([a].filter(Boolean));
    await browser.close();
    server.kill();
    process.exit(code);
})();

function fsExists(saves) {
    return require('fs').existsSync(require('path').join(saves, 'parked', 'claude.json'));
}
