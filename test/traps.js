// A bear trap laid in the prisons (map 6) catches the elite guard that walks onto it.
// The game's crossbow wrote its own tile into the elite guard's pair every frame, so the
// trap never saw the guard (his report, 10/25). Laid by the player whose machine does not
// move the map's events; the guard is walked there by the one that does.
const { twoPlayers, checker, sleep, waitFor } = require('./common');

const MAP = 6, ELITE = 223, ELITE_ON = 2930, CROSSBOW = 77;

(async () => {
    const check = checker();
    let s;
    try {
        s = await twoPlayers(8735);
        const { a, b } = s;
        for (const p of [a, b]) await p.evaluate((m) => { $gamePlayer.reserveTransfer(m, 1, 1, 2, 0); }, MAP);
        for (const p of [a, b]) await waitFor(p, (m) => $gameMap.mapId() === m && SceneManager._scene instanceof Scene_Map && !$gamePlayer.isTransferring(), 15000, 'map ' + MAP, MAP);
        // Nothing wanders on its own (a guard that catches the layer starts a fight).
        for (const p of [a, b]) await p.evaluate(() => { Game_Event.prototype.updateSelfMovement = function () {}; });
        await a.evaluate((sw) => { $gameSwitches.setValue(sw, true); }, ELITE_ON);
        await sleep(1500);
        const runner = (await a.evaluate(() => Coop.events.amOwner())) ? a : b;
        const layer = runner === a ? b : a;
        // The guard is put at the start of an open stretch of four tiles.
        const line = await runner.evaluate((g) => {
            const e = $gameMap.event(g);
            const ox = e.x, oy = e.y;
            for (let r = 0; r < 25; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                const sx = ox + dx, sy = oy + dy;
                if (!$gameMap.isValid(sx, sy) || $gameMap.eventsXyNt(sx, sy).length) continue;
                e._x = sx; e._y = sy;
                for (const d of [2, 4, 6, 8]) {
                    let x = sx, y = sy, ok = true; const tiles = [];
                    for (let i = 0; i < 4 && ok; i++) {
                        if (!e.canPass(x, y, d)) ok = false;
                        x = $gameMap.roundXWithDirection(x, d); y = $gameMap.roundYWithDirection(y, d);
                        tiles.push({ x, y });
                        if ($gameMap.eventsXy(x, y).length) ok = false;
                    }
                    if (ok) { e._x = ox; e._y = oy; e.locate(sx, sy); return { d, from: { x: sx, y: sy }, tiles }; }
                }
            }
            e._x = ox; e._y = oy;
            return null;
        }, ELITE);
        check('an open stretch for the elite guard', !!line, JSON.stringify(line));
        const spot = line.tiles[2];
        await layer.evaluate((p) => { $gamePlayer.locate(p.x, p.y); $gameParty.gainItem($dataItems[76], 1); }, spot);
        await sleep(600);
        await layer.evaluate(() => {
            const item = $dataItems[76], user = $gameParty.leader(), action = new Game_Action(user);
            action.setItemObject(item); user.useItem(item); action.applyGlobal();
        });
        const trapAt = (p, spot) => p.evaluate((s) => $gameMap.events().some((e) => /^bearTrap/.test(e.event().name) && e.x === s.x && e.y === s.y && e._pageIndex === 0), spot);
        await waitFor(runner, (s) => $gameMap.events().some((e) => /^bearTrap/.test(e.event().name) && e.x === s.x && e.y === s.y), 5000, 'the trap on the runner', spot);
        check('the laid trap is armed on both machines', await trapAt(layer, spot) && await trapAt(runner, spot));
        const wall = (p) => p.evaluate((s) => Coop.trapAt(s.x, s.y), spot);
        check('an armed trap is a wall for a party line on both machines', await wall(a) && await wall(b));
        for (const p of [a, b]) await p.evaluate((l) => { $gamePlayer.locate(l.from.x, l.from.y + 6); }, line);
        await sleep(600);
        await runner.evaluate((l) => {
            const code = { 2: 1, 4: 2, 6: 3, 8: 4 }[l.d];
            $gameMap.event(223).forceMoveRoute({ list: [{ code }, { code }, { code }, { code }, { code: 0 }], repeat: false, skippable: true, wait: false });
        }, line);
        await sleep(3500);
        for (const [n, p] of [['A', a], ['B', b]]) {
            const r = await p.evaluate((g, s) => {
                const e = $gameMap.event(g);
                return { x: e.x, y: e.y, page: e._pageIndex, legs: $gameSwitches.value(2864) && $gameSwitches.value(2865) };
            }, ELITE, spot);
            check(n + ': the elite guard is caught on the trap (both legs, its trapped page)', r.legs && r.page === 2 && r.x === spot.x && r.y === spot.y, JSON.stringify(r));
        }
        await sleep(400);
        check('a sprung trap is not', !(await wall(a)) && !(await wall(b)));
        const bow = await runner.evaluate((c) => {
            const e = $gameMap.event(c);
            return { x: e.x, y: e.y, vx: $gameVariables.value(451), vy: $gameVariables.value(452) };
        }, CROSSBOW);
        check('the crossbow still tracks its own tile (in its own pair now)', bow.vx === bow.x && bow.vy === bow.y - 1, JSON.stringify(bow));
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
