// The lift between the Prisons and the Caverns (map 8, event 2). His friend
// 10/20: "the elevator is floating above the ground, i can see it but not
// enter it". It hangs in its shaft for anyone who walks onto the floor (the
// game alone does that too) and is ridden from its shadow; when someone rides
// it down, it is down for everyone, and either player can ride it up.
const { twoPlayers, checker, sleep, waitFor } = require('./common');

const CAGE = 2, BASE = 7, ARRIVED = 116, UP = 118;

async function press(page, code) {
    await page.keyboard.down(code); await sleep(130); await page.keyboard.up(code); await sleep(250);
}

(async () => {
    const check = checker();
    let s;
    try {
        s = await twoPlayers(8732);
        const { a, b } = s;
        const go = (p, m, x, y, d) => p.evaluate((m, x, y, d) => $gamePlayer.reserveTransfer(m, x, y, d || 2, 0), m, x, y, d);
        const settled = (p, m) => waitFor(p, (m) => $gameMap.mapId() === m && SceneManager._scene instanceof Scene_Map && SceneManager._scene.isActive() && !$gamePlayer.isTransferring(), 30000, p.label + ' on map ' + m, m);
        const cage = (p) => p.evaluate((id) => { const e = $gameMap.event(id); return e ? e.x + ',' + e.y : 'none'; }, CAGE);
        const idle = (p) => waitFor(p, () => !$gameMap.isEventRunning() && !$gamePlayer.isMoving(), 30000, p.label + ' idle');

        // Both walk onto the Caverns: the lift hangs in its shaft for both.
        await go(a, 8, 24, 58); await go(b, 8, 26, 58);
        await settled(a, 8); await settled(b, 8);
        await sleep(1500);
        const hung = { a: await cage(a), b: await cage(b) };
        check('walked in, the cage hangs where the game leaves it, the same for both', hung.a === '20,53' && hung.b === '20,53', JSON.stringify(hung));

        // B rides it down from the Prisons, the game's way: the lift's switch goes on
        // up there, then B arrives in the cage. It comes down with B, and A sees it
        // come down too. 10/21: A's game played the arrival as well (a route on the
        // player did not count as acting on them), walked A, and its own copy of
        // the ride mixed with B's reports and left the cage hanging a tile up.
        await go(b, 1, 27, 67); await settled(b, 1);
        await a.evaluate(() => { window.RAN = 0; const setup = Game_Interpreter.prototype.setup; Game_Interpreter.prototype.setup = function (list, id) { if (id === 2 && $gameMap.mapId() === 8) RAN++; return setup.apply(this, arguments); }; });
        await b.evaluate((id) => { $gameSwitches.setValue(id, true); $gamePlayer.reserveTransfer(8, 20, 57, 6, 0); }, ARRIVED);
        await settled(b, 8);
        await idle(b);
        await sleep(2500);
        const down = { a: await cage(a), b: await cage(b), aMap: await a.evaluate(() => $gameMap.mapId() + ' ' + $gamePlayer.x + ',' + $gamePlayer.y), aRan: await a.evaluate(() => RAN) };
        check('ridden down, the cage is down for the rider', down.b === '20,58', JSON.stringify(down));
        check('and for the partner on the same floor, who stays where they were', down.a === '20,58' && down.aMap === '8 24,58' && !down.aRan, JSON.stringify(down));

        // A steps onto its shadow and uses the mechanism: A rides it up, B stays.
        await a.evaluate(() => { $gamePlayer.locate(20, 57); });
        await sleep(500);
        await a.evaluate((id) => $gameMap.event(id).start(), BASE);
        await waitFor(a, () => $gameMessage.isChoice() || $gameMessage.isBusy(), 10000, 'the mechanism asks');
        for (let i = 0; i < 6 && await a.evaluate(() => $gameMap.mapId() === 8); i++) {
            if (await a.evaluate(() => $gameMessage.isBusy())) await press(a, 'Enter'); else await sleep(400);
        }
        await waitFor(a, () => $gameMap.mapId() === 5, 20000, 'A up to the Prisons').catch(() => {});
        check('from its shadow the lift takes the one who used it', await a.evaluate(() => $gameMap.mapId() === 5));
        await sleep(2500);
        const after = { b: await b.evaluate(() => $gameMap.mapId() + ' ' + $gamePlayer.x + ',' + $gamePlayer.y), cage: await cage(b) };
        check('and leaves the partner where they are', after.b.startsWith('8 '), JSON.stringify(after));
        check('who sees it go back up', after.cage !== '20,58', JSON.stringify(after));
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
