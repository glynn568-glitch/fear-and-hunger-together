// A scene that starts by itself and acts on the player (moves them, fights,
// the party, a game over) plays for the player whose doing it was, never for
// a partner who only hears of the flag. Found 10/20: the elevator on map 8
// took a partner anywhere on the map along; Trortur's table (map 3) killed
// whoever else was there, and anyone who walked in later.
const { twoPlayers, checker, sleep, waitFor } = require('./common');

const ELEVATOR = 118, TORTURE = 136;

(async () => {
    const check = checker();
    let s;
    try {
        s = await twoPlayers(8527);
        const { a, b } = s;
        const go = (p, m, x, y) => p.evaluate((m, x, y) => $gamePlayer.reserveTransfer(m, x, y, 2, 0), m, x, y);
        const at = (p) => p.evaluate(() => ({ map: $gameMap.mapId(), running: $gameMap.isEventRunning() ? $gameMap._interpreter.eventId() : 0 }));
        const settled = (p, m) => waitFor(p, (m) => $gameMap.mapId() === m && SceneManager._scene instanceof Scene_Map && SceneManager._scene.isActive() && !$gamePlayer.isTransferring(), 30000, p.label + ' on map ' + m, m);

        // The elevator: A rides it; B, elsewhere on the same map, stays put.
        await go(a, 8, 10, 10); await go(b, 8, 12, 10);
        await settled(a, 8); await settled(b, 8);
        await sleep(1500);
        await a.evaluate((id) => $gameSwitches.setValue(id, true), ELEVATOR);
        await waitFor(a, () => $gameMap.mapId() === 5, 15000, 'A down to map 5').catch(() => {});
        await sleep(2000);
        const ride = { a: await at(a), b: await at(b) };
        check('the elevator takes the one who rode it', ride.a.map === 5, JSON.stringify(ride));
        check('and leaves a partner elsewhere on the map where they are', ride.b.map === 8 && !ride.b.running, JSON.stringify(ride));

        // B rides it too: their own ride is theirs.
        await b.evaluate((id) => $gameSwitches.setValue(id, true), ELEVATOR);
        await waitFor(b, () => $gameMap.mapId() === 5, 15000, 'B down to map 5').catch(() => {});
        check('a partner\'s own ride still works', (await at(b)).map === 5);

        // Trortur's table: A's torture plays for A only.
        await go(a, 3, 10, 10); await go(b, 3, 12, 10);
        await settled(a, 3); await settled(b, 3);
        await sleep(1500);
        await a.evaluate((id) => $gameSwitches.setValue(id, true), TORTURE);
        await sleep(3000);
        const table = { a: await at(a), b: await at(b) };
        check('the torture plays for the one on the table', table.a.running === TORTURE, JSON.stringify(table));
        check('not for a partner on the same map', table.b.running !== TORTURE, JSON.stringify(table));
        await a.evaluate(() => $gameMap._interpreter.clear());

        // B walks out and back in: still not B's.
        await go(b, 1, 27, 67); await settled(b, 1);
        await go(b, 3, 12, 10); await settled(b, 3);
        await sleep(2500);
        check('nor for a partner who walks in later', (await at(b)).running !== TORTURE);

        // ...nor from B's save: it keeps which flags were B's own, and a game
        // loaded from it goes by that (a carried-on run, another night).
        await b.evaluate(() => { $gameSystem.onBeforeSave(); DataManager.saveGame(5); });
        await sleep(500);
        const kept = await b.evaluate((id) => {
            const c = JsonEx.parse(StorageManager.load(5));
            const was = Coop.world.mine;
            Coop.world.mine = new Set(c.coop.mine);
            const theirs = Coop.world.othersScene($gameMap.event(id));
            Coop.world.mine = was;
            return { saved: Array.isArray(c.coop.mine), torture: c.coop.mine.includes('sw' + id), theirs };
        }, TORTURE);
        check('a save keeps whose flags were whose, so a loaded game stays out of it', kept.saved && !kept.torture && kept.theirs, JSON.stringify(kept));
    } catch (e) { console.error(e); check('test ran to the end', false); if (s) console.log('STATE B', JSON.stringify(await s.b.evaluate(() => ({ scene: SceneManager._scene.constructor.name, map: $gameMap.mapId(), live: Coop.world.live, run: $gameMap.isEventRunning() && $gameMap._interpreter.eventId(), log: Coop.log.slice(-8) })).catch((x) => String(x)))); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
