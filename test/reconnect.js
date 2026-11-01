// A dropped connection: the player keeps playing, reconnects, and catches up
// on what changed while they were away. A one-second drop also keeps the party
// line, says they are back, and the host's log says why the line died.
const { twoPlayers, checker, sleep, waitFor, sees } = require('./common');
const { openPlayer } = require('./lib');
const installBot = require('../tools/bot-page');

const port = 8466;
async function until(page, fn, ms, what, ...args) {
    try { await waitFor(page, fn, ms, what, ...args); return true; }
    catch (e) { console.error(String(e && e.message || e)); return false; }
}
const gone = (page) => page.evaluate(() => window._toasts.some((t) => /party leader is gone/.test(t)));
const arm = (page) => page.evaluate(() => {
    const toast = Coop.toast;
    window._toasts = [];
    Coop.toast = function (text) { window._toasts.push(text); return toast.apply(this, arguments); };
});

(async () => {
    const check = checker();
    let s, bot;
    let out = '';
    try {
        s = await twoPlayers(port);
        const { a, b } = s;
        s.server.stdout.on('data', (d) => { out += d; });
        await b.evaluate(() => Coop._ws.close());
        await waitFor(a, () => Coop.peers.size === 0, 5000, 'A notices B is gone');
        check('A stops drawing the player who dropped', await a.evaluate(() => Coop.peersHere().length) === 0);
        // Both keep changing the world while apart.
        await a.evaluate(() => $gameSwitches.setValue(25, true));
        await b.evaluate(() => { $gameSwitches.setValue(27, true); T.step(8); });
        await waitFor(b, () => Coop.connected && Coop.world.live, 15000, 'B reconnects and resyncs');
        await sleep(1200);
        check('B caught up on what A did meanwhile', await b.evaluate(() => $gameSwitches.value(25)));
        check('what B did offline reached A', await a.evaluate(() => $gameSwitches.value(27)));
        check('they see each other again', (await sees(a, 1)) && (await sees(b, 1)));
        const pos = await a.evaluate(() => { const p = Coop.others()[0]; return p.x + ',' + p.y; });
        check('A has the position B walked to while offline', pos === '28,66', pos);
        check('one owner', (await a.evaluate(() => Coop.events.amOwner())) !== (await b.evaluate(() => Coop.events.amOwner())));
        const fa = await a.evaluate(() => Coop.world.fingerprint()), fb = await b.evaluate(() => Coop.world.fingerprint());
        check('shared state identical', fa === fb);

        // The first close above already gave B a new id. The line is by name from here.
        await arm(a);
        await arm(b);
        const idA = await a.evaluate(() => Coop.id);
        await b.evaluate((id) => Coop.joinParty(id), idA);
        check('B walks in A\'s line', await until(a, () => { const p = Coop.others().find((q) => q.name === 'Bo'); return !!(p && p.pl === Coop.id); }, 5000, 'A sees Bo in line'));

        // B's own socket dies and is back within seconds. Old code clears the line on the way down.
        await a.evaluate(() => { document.getElementById('coop-toast').textContent = ''; });
        await b.evaluate(() => Coop._ws.close());
        const boBack = until(a, () => /Bo is back\./.test(document.getElementById('coop-toast').textContent), 8000, 'A sees Bo is back');
        check('B is back in A\'s line under the new id', await until(b, (id) => Coop.connected && Coop.world.live && Coop.partyLeader === id, 15000, 'B back in line', idA));
        check('B was not told the leader is gone', !(await gone(b)));
        check('A agrees Bo is still in the line', await until(a, (id) => { const p = Coop.others().find((q) => q.name === 'Bo'); return !!(p && p.pl === id && p.st && p.st !== 'title' && p.st !== 'dead'); }, 8000, 'A agrees', idA));
        check('A sees "Bo is back."', await boBack);

        const tNote = Date.now();
        while (!/note Bo: .*lost the connection, retrying \(closed \d+, down \d+\.\d+s, hostdown (?:yes|no)\)/.test(out) && Date.now() - tNote < 8000) await sleep(200);
        const boNotes = (out.match(/note Bo: .*/g) || []).filter((l) => /lost the connection/.test(l));
        check('the host log says the close code, how long the line was down, and hostdown', boNotes.length >= 1 && boNotes.every((l) => /closed \d+, down \d+\.\d+s, hostdown (yes|no)/.test(l)), boNotes.join(' || ') || out.slice(-400));

        // The leader's socket dies. Old code tells the follower the leader is gone at once.
        await b.evaluate(() => { document.getElementById('coop-toast').textContent = ''; });
        const prevA = await a.evaluate(() => Coop.id);
        await a.evaluate(() => Coop._ws.close());
        const annBack = until(b, () => /Ann is back\./.test(document.getElementById('coop-toast').textContent), 8000, 'B sees Ann is back');
        check('A is back under a new id', await until(a, (was) => Coop.connected && Coop.world.live && Coop.id !== was, 15000, 'A back', prevA));
        const idA2 = await a.evaluate(() => Coop.id);
        check('B is still in A\'s line', await until(b, (id) => Coop.partyLeader === id, 8000, 'B still in line', idA2));
        check('B was not told the leader is gone after A\'s drop', !(await gone(b)));
        check('A agrees, from B\'s presence', await until(a, (id) => { const p = Coop.others().find((q) => q.name === 'Bo'); return !!(p && p.pl === id); }, 8000, 'A sees Bo\'s line', idA2));
        check('B sees "Ann is back."', await annBack);

        // An AI partner in the line, following A by name. Old code never points BOT.with at the new id,
        // and it says the leader is gone as soon as the old id vanishes.
        bot = await openPlayer(s.browser, `http://localhost:${port}/?name=Claude`, 'bot');
        await waitFor(bot, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 90000, 'the partner at the title');
        await bot.exposeFunction('fhBrainCharacter', () => {});
        await bot.exposeFunction('fhBrain', async () => null);
        await arm(bot);
        await bot.evaluate(installBot, { character: 'priest', follow: 'Ann', party: true, brainless: true });
        check('the partner joins as the priest', await until(bot, () => BOT.status().character === 'priest' && SceneManager._scene instanceof Scene_Map && Coop.world.live, 60000, 'partner on the map'));
        for (const p of [a, b, bot]) await p.evaluate(() => { if (!window.$gameMap) return; for (const ev of $gameMap.events()) if (/guard|enemy|chaser/i.test(ev.event().name)) ev.erase(); });
        check('the partner walks in Ann\'s line', await until(bot, (id) => Coop.partyLeader === id, 20000, 'partner in line', idA2));
        const prevBot = await bot.evaluate(() => window._toasts.length);
        const prevA2 = await a.evaluate(() => Coop.id);
        await a.evaluate(() => Coop._ws.close());
        check('Ann is back again', await until(a, (was) => Coop.connected && Coop.world.live && Coop.id !== was, 15000, 'Ann back again', prevA2));
        const idA3 = await a.evaluate(() => Coop.id);
        check('the partner keeps the line and keeps following through the blip', await until(bot, (id) => Coop.partyLeader === id && BOT.with === id, 8000, 'partner still following', idA3));
        check('the partner was not told the leader is gone', await bot.evaluate((n) => !window._toasts.slice(n).some((t) => /party leader is gone/.test(t)), prevBot));
        check('A agrees the partner is still in the line', await until(a, (id) => { const p = Coop.others().find((q) => q.bot && q.name === 'Claude'); return !!(p && p.pl === id); }, 8000, 'A sees the partner', idA3));

        // Held down past the grace. At two seconds the line is still there (old code has already ended it).
        const mark = await b.evaluate(() => window._toasts.length);
        await a.evaluate(() => { Coop._realConnect = Coop._realConnect || Coop.connect; Coop.connect = function () {}; Coop._ws.close(); });
        await sleep(2000);
        const mid = await b.evaluate((n) => ({ lead: Coop.partyLeader, gone: window._toasts.slice(n).some((t) => /party leader is gone/.test(t)) }), mark);
        check('two seconds after the leader drops, the line is still there', mid.lead !== 0 && !mid.gone, JSON.stringify(mid));
        check('once the grace has passed, the leader is gone and the line ends', await until(b, (n) => Coop.partyLeader === 0 && window._toasts.slice(n).some((t) => /party leader is gone/.test(t)), 23000, 'gone after the grace', mark));

        // Dropped, and back under a new id at the title: not the dungeon, so the wait still runs out.
        await a.evaluate(() => { Coop.connect = Coop._realConnect; Coop.connect(); });
        check('A is back before the title test', await until(a, () => Coop.connected && Coop.world.live && SceneManager._scene instanceof Scene_Map, 20000, 'A back'));
        const idA9 = await a.evaluate(() => Coop.id);
        await until(b, (id) => { const p = Coop.peers.get(id); return !!(p && p.st && p.st !== 'title' && p.st !== 'dead'); }, 8000, 'A seen', idA9);
        await b.evaluate((id) => Coop.joinParty(id), idA9);
        await until(b, (id) => Coop.partyLeader === id, 5000, 'B in line', idA9);
        const toldT = await b.evaluate(() => window._toasts.length);
        await a.evaluate(() => { Coop.connect = function () {}; Coop._ws.close(); });
        await sleep(300);
        await a.evaluate(() => { SceneManager.goto(Scene_Title); });
        await until(a, () => SceneManager._scene instanceof Scene_Title, 10000, 'A at the title');
        await a.evaluate(() => { Coop.connect = Coop._realConnect; Coop.connect(); });
        check('a leader back at the title under a new id lets the line go when the wait runs out', await until(b, (n) => Coop.partyLeader === 0 && window._toasts.slice(n).some((t) => /walk on your own|party leader is gone/.test(t)), 25000, 'line let go', toldT));
        await a.evaluate(() => T.quickStart(1, 27, 67));
        await until(a, () => T.onMap(), 60000, 'A on the map again');
        await a.evaluate(() => T.settle());
        await a.evaluate(() => T.begin());
        check('A is back on the map', await until(a, () => Coop.connected && Coop.world.live && SceneManager._scene instanceof Scene_Map, 20000, 'A back on the map'));
        const idA4 = await a.evaluate(() => Coop.id);
        check('B can see A in the dungeon', await until(b, (id) => { const p = Coop.peers.get(id); return !!(p && p.st && p.st !== 'title' && p.st !== 'dead'); }, 8000, 'A in the dungeon', idA4));
        await b.evaluate((id) => Coop.joinParty(id), idA4);
        check('B is in the line again', await until(b, (id) => Coop.partyLeader === id, 5000, 'B rejoins', idA4));
        const told = await b.evaluate(() => window._toasts.length);
        await a.evaluate(() => SceneManager.goto(Scene_Title));
        // 5s, not the 20s grace: a line that waits out the title fails here.
        check('the title ends the line at once', await until(b, (n) => Coop.partyLeader === 0 && window._toasts.slice(n).some((t) => /walk on your own/.test(t)), 5000, 'line ends at the title', told));
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish([s && s.a, s && s.b, bot].filter(Boolean));
    if (s) await s.close();
    process.exit(code);
})();
