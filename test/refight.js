// An enemy beaten in someone else's fight is not fought again at full health.
// His 10/20 session: the Cave Mother (map 8, event 75) was won in Enki's fight;
// his own game, back on the map while Enki's victory scene was still setting
// her body down, started her scene again and a second fight at full health,
// whose ending (her sprite flying off through rock it no longer passes) left
// him unable to move. Also: a scene already under way when the enemy was
// beaten elsewhere does not start its fight, and a later scene still does.
const { twoPlayers, checker, sleep, waitFor } = require('./common');

const MOTHER = 75, ALIVE = 177, DEAD = 178, GNOME = 105, GNOME_DEAD = 305;

async function press(page, code) {
    await page.keyboard.down(code); await sleep(130); await page.keyboard.up(code); await sleep(250);
}
async function backOnMap(p, what) {
    for (let i = 0; i < 60; i++) {
        if (await p.evaluate(() => SceneManager._scene instanceof Scene_Map && !$gameMap.isEventRunning() && !SceneManager.isSceneChanging())) return true;
        if (await p.evaluate(() => $gameMessage.isBusy())) await press(p, 'Enter'); else await sleep(300);
    }
    return false;
}
const winNow = (p) => p.evaluate(() => { for (const e of $gameTroop.members()) e.addState(e.deathStateId()); const w = SceneManager._scene._actorCommandWindow; if (w) { w.deactivate(); w.close(); } BattleManager.processVictory(); });
const inInput = (p, what) => waitFor(p, () => Coop.battle && Coop.battle.role === 'owner' && BattleManager._phase === 'input', 30000, what);
const ownFight = (p) => p.evaluate(() => !!(Coop.battle && Coop.battle.role === 'owner'));
const scene = (list) => list.map((c) => ({ code: c[0], indent: 0, parameters: c[1] || [] })).concat([{ code: 0, indent: 0, parameters: [] }]);

(async () => {
    const check = checker();
    let s;
    try {
        s = await twoPlayers(8730);
        const { a, b } = s;
        const go = (p, m, x, y) => p.evaluate((m, x, y) => $gamePlayer.reserveTransfer(m, x, y, 2, 0), m, x, y);
        const settled = (p, m) => waitFor(p, (m) => $gameMap.mapId() === m && SceneManager._scene instanceof Scene_Map && SceneManager._scene.isActive() && !$gamePlayer.isTransferring(), 30000, p.label + ' on map ' + m, m);

        // Both in the Caverns by the Cave Mother, alive.
        await go(a, 8, 39, 47); await go(b, 8, 41, 47);
        await settled(a, 8); await settled(b, 8);
        await a.evaluate((on, off) => { $gameSwitches.setValue(on, true); $gameSwitches.setValue(off, false); }, ALIVE, DEAD);
        await waitFor(b, (id) => $gameSwitches.value(id), 5000, 'B hears she is here', ALIVE);
        await sleep(1000);

        // A walks into her: A's fight. B touches her meanwhile: B asks into it.
        await a.evaluate((e) => $gameMap.event(e).start(), MOTHER);
        await inInput(a, 'A fighting the Cave Mother');
        await waitFor(b, (e) => { const h = Coop.events.holdOf(e); return h && h.k === 'battle'; }, 5000, 'B hears she is in a fight', MOTHER);
        await b.evaluate((e) => $gameMap.event(e).start(), MOTHER);
        await sleep(1500);
        check('touching her mid-fight does not start a second fight', !(await ownFight(b)));

        // A wins. While A's victory scene settles her body, B keeps walking into her.
        // A's messages are logged: her "dead" switch has to leave before the word
        // that A's scene with her is over.
        await a.evaluate((dead, e) => {
            window.SENT = [];
            const send = Coop.send;
            Coop.send = function (msg) {
                if (msg && msg.t === 'w' && msg.w.some((r) => r[0] === 'sw' && r[1] === dead && r[2])) SENT.push('dead');
                if (msg && msg.t === 'evh' && msg.e === e) SENT.push('hold:' + msg.k);
                return send.apply(this, arguments);
            };
        }, DEAD, MOTHER);
        await winNow(a);
        let refought = false, tries = 0;
        const t0 = Date.now();
        const bTouches = (async () => {
            while (Date.now() - t0 < 14000) {
                const st = await b.evaluate((e, dead) => {
                    const fighting = !!(Coop.battle && Coop.battle.role === 'owner');
                    const free = SceneManager._scene instanceof Scene_Map && SceneManager._scene.isActive() && !$gameMap.isEventRunning() && !Coop.battle;
                    if (free && !$gameSwitches.value(dead)) $gameMap.event(e).start();
                    return { fighting, touched: free && !$gameSwitches.value(dead) };
                }, MOTHER, DEAD);
                if (st.fighting) { refought = true; break; }
                if (st.touched) tries++;
                await sleep(150);
            }
        })();
        const aBack = await backOnMap(a, 'A back on the map');
        await bTouches;
        check('A\'s win plays out', aBack && await a.evaluate((id) => $gameSwitches.value(id), DEAD));
        check('B walked into her while A\'s win was settling', tries > 0, 'touches ' + tries);
        check('and was not put in a second fight with her at full health', !refought);
        const bAfter = await b.evaluate((e, dead) => ({ dead: $gameSwitches.value(dead), page: $gameMap.event(e)._pageIndex, running: $gameMap.isEventRunning(), battle: !!Coop.battle }), MOTHER, DEAD);
        check('B sees her dead', bAfter.dead && bAfter.page === 1, JSON.stringify(bAfter));
        if (refought) { await winNow(b); await backOnMap(b, 'B out of the second fight'); }
        const bFree = await waitFor(b, () => !$gameMap.isEventRunning() && !Coop.battle, 15000, 'B free to move').then(() => true, () => false);
        check('B can move afterwards', bFree);
        await b.evaluate(() => $gameMap._interpreter.clear());
        const sent = await a.evaluate(() => SENT.slice());
        check('her "dead" switch left before the word that the scene was over', sent.indexOf('dead') >= 0 && sent.indexOf('dead') < sent.lastIndexOf('hold:null'), sent.join(' '));

        // A cave gnome (its "dead" switch is also turned off once, on map 165, so
        // it was kept on one machine): A kills it, it is dead for B too.
        await a.evaluate(() => $gamePlayer.locate(37, 47));
        await sleep(500);
        await a.evaluate((e) => $gameMap.event(e).start(), GNOME);
        await inInput(a, 'A fighting the gnome');
        await winNow(a);
        await backOnMap(a, 'A back from the gnome');
        const gnome = await waitFor(b, (e) => $gameMap.event(e)._pageIndex === 1, 8000, 'B sees the gnome dead', GNOME).then(() => true, () => false);
        check('a gnome one player kills stays dead for the other', gnome, JSON.stringify(await b.evaluate((e, id) => ({ page: $gameMap.event(e)._pageIndex, sw: $gameSwitches.value(id) }), GNOME, GNOME_DEAD)));

        // A scene B was already in when A won elsewhere (B stood in it, so stayed
        // out of A's fight): its fight is over, it does not start.
        await b.evaluate((list, e) => $gameMap._interpreter.setup(list, e), scene([[230, [420]], [301, [0, 1, false, true]]]), MOTHER);
        await sleep(300);
        await a.evaluate((list, e) => $gameMap._interpreter.setup(list, e), scene([[301, [0, 1, false, true]]]), MOTHER);
        await inInput(a, 'A in a second fight');
        await winNow(a);
        await backOnMap(a, 'A back again');
        const bSkip = await waitFor(b, () => !$gameMap.isEventRunning(), 15000, 'B scene over').then(() => true, () => false);
        const bNotes = await b.evaluate(() => Coop.log.join('\n'));
        check('a scene under way before the win does not start its fight', bSkip && !(await ownFight(b)), bNotes.split('\n').slice(-3).join(' | '));

        // A scene begun after the win still fights (re-fight pages keep working).
        await b.evaluate((list, e) => $gameMap._interpreter.setup(list, e), scene([[301, [0, 1, false, true]]]), MOTHER);
        const fresh = await inInput(b, 'B in a fresh fight').then(() => true, () => false);
        check('a scene begun after the win still fights', fresh);
        if (fresh) { await winNow(b); await backOnMap(b, 'B back'); }
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
