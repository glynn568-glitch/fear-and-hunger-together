// Splitting up and meeting again: one player leaves for another map and
// comes back to find events where the other player's machine put them.
const { twoPlayers, checker, sleep, waitFor } = require('./common');

(async () => {
    const check = checker();
    let s;
    try {
        s = await twoPlayers(8445);
        const { a, b, idA, idB } = s;
        await b.evaluate(() => { $gamePlayer.reserveTransfer(74, 15, 22, 8, 0); });
        await waitFor(b, () => $gameMap.mapId() === 74 && SceneManager._scene instanceof Scene_Map && SceneManager._scene.isActive() && !$gamePlayer.isTransferring(), 30000, 'B on the fortress map');
        await b.evaluate(() => T.settle());
        await sleep(800);
        check('A no longer sees B on the map', await a.evaluate(() => Coop.peersHere().length) === 0);
        check('A knows where B went', await a.evaluate((id) => Coop.peers.get(id).m, idB) === 74);
        check('each runs their own map', await a.evaluate(() => Coop.events.amOwner()) && await b.evaluate(() => Coop.events.amOwner()));
        check('B has no stale avatar of A drawn', await b.evaluate(() => SceneManager._scene._spriteset._coopSprites.size) === 0);
        // While apart, a world switch still reaches the other map.
        await a.evaluate(() => $gameSwitches.setValue(25, true));
        await sleep(400);
        check('world state crosses maps', await b.evaluate(() => $gameSwitches.value(25)));
        // A moves the guard while B is away.
        const guard = await a.evaluate(() => {
            const e = $gameMap.events().find((ev) => ev.event().name === 'guard1');
            e.setThrough(true); e.setPosition(e.x - 3, e.y); e.setThrough(false);
            return { id: e._eventId, x: e.x, y: e.y };
        });
        await b.evaluate(() => { $gamePlayer.reserveTransfer(1, 28, 67, 8, 0); });
        await waitFor(b, () => $gameMap.mapId() === 1 && SceneManager._scene instanceof Scene_Map && SceneManager._scene.isActive() && !$gamePlayer.isTransferring(), 30000, 'B back on level 1');
        await b.evaluate(() => T.settle());
        await sleep(1500);
        const gb = await b.evaluate((id) => { const e = $gameMap.event(id); return { x: e.x, y: e.y }; }, guard.id);
        const ga = await a.evaluate((id) => { const e = $gameMap.event(id); return { x: e.x, y: e.y }; }, guard.id);
        check('on return B sees the guard where A has it now', gb.x === ga.x && gb.y === ga.y, JSON.stringify(guard) + ' A ' + JSON.stringify(ga) + ' B ' + JSON.stringify(gb));
        check('they see each other again', await a.evaluate(() => Coop.peersHere().length) === 1 && await b.evaluate(() => Coop.peersHere().length) === 1);
        check('one owner', (await a.evaluate(() => Coop.events.amOwner())) !== (await b.evaluate(() => Coop.events.amOwner())));
        const ea = await a.evaluate(() => T.events()), eb = await b.evaluate(() => T.events());
        const la = ea.split(';'), lb = eb.split(';');
        const diff = la.filter((row, i) => row !== lb[i]);
        check('every event agrees after the reunion', diff.length <= 0, diff.slice(0, 6).join(' | '));
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
