// Slips in the game's own data that split players up. His 10/20 session: the
// Salmonsnake's second page on the Mines' third layout (map 184) moved him to
// the first layout's map 11 and into a fight his partner, still on map 184,
// could not see or join. It now stays on the map it is on (map 39 too).
const { twoPlayers, checker, sleep, waitFor } = require('./common');

const SNAKE = 263, SNAKE_DEAD = 652;

const winNow = (p) => p.evaluate(() => { for (const e of $gameTroop.members()) e.addState(e.deathStateId()); const w = SceneManager._scene._actorCommandWindow; if (w) { w.deactivate(); w.close(); } BattleManager.processVictory(); });

(async () => {
    const check = checker();
    let s;
    try {
        s = await twoPlayers(8731);
        const { a, b } = s;
        const go = (p, m, x, y) => p.evaluate((m, x, y) => $gamePlayer.reserveTransfer(m, x, y, 2, 0), m, x, y);
        const settled = (p, m) => waitFor(p, (m) => $gameMap.mapId() === m && SceneManager._scene instanceof Scene_Map && SceneManager._scene.isActive() && !$gamePlayer.isTransferring(), 30000, p.label + ' on map ' + m, m);

        // Layout dice: the first throw in a world stands. His 10/21: the Blood pit's
        // lizardman (there only when Level2-random1 is 2) was missing; a start event
        // thrown again by anyone's game could change a floor under everyone.
        for (const [id, first, later] of [[32, 2, 1], [128, 3, 1]]) {
            await a.evaluate((id, v) => $gameVariables.setValue(id, v), id, first);
            await waitFor(b, (id, v) => $gameVariables.value(id) === v, 5000, 'B hears the first throw', id, first);
            await b.evaluate((id, v) => $gameVariables.setValue(id, v), id, later);
            await sleep(1500);
            const both = { a: await a.evaluate((id) => $gameVariables.value(id), id), b: await b.evaluate((id) => $gameVariables.value(id), id) };
            check('layout dice ' + id + ': a later throw does not change it, for either player', both.a === first && both.b === first, JSON.stringify(both));
        }

        // Map 39 has the same slip in its data; the fix covers it by the same rule.
        const slip39 = await a.evaluate(() => new Promise((ok) => {
            const x = new XMLHttpRequest(); x.open('GET', 'data/Map039.json'); x.onload = () => {
                const ev = JSON.parse(x.responseText).events[263];
                ok(ev.pages[2].list.some((c) => c.code === 201 && c.parameters[1] === 11));
            }; x.send();
        }));
        check("map 39's snake has the same slip in the game data (covered by the same rule)", slip39);
        for (const map of [184]) {
            await go(a, map, 50, 53); await go(b, map, 45, 53);
            await settled(a, map); await settled(b, map);
            await a.evaluate((id) => $gameSwitches.setValue(id, true), SNAKE_DEAD);
            await sleep(1000);
            // A goes to the snake again: its second page.
            await a.evaluate((e) => $gameMap.event(e).start(), SNAKE);
            const fought = await waitFor(a, () => !!Coop.battle && BattleManager._phase === 'input', 30000, 'A fighting the snake').then(() => true, () => false);
            const where = await a.evaluate(() => ({ map: $gameMap.mapId(), x: $gamePlayer.x, y: $gamePlayer.y }));
            check('map ' + map + ': the snake\'s second page fights where it is', fought && where.map === map, JSON.stringify(where));
            if (fought) {
                const bIn = await waitFor(b, () => !!Coop.battle, 15000, 'B pulled into the fight').then(() => true, () => false);
                check('map ' + map + ': and the partner on the same floor is in that fight', bIn);
                await winNow(a);
                await waitFor(a, () => SceneManager._scene instanceof Scene_Map && !$gameMap.isEventRunning(), 30000, 'A back on the map').catch(() => {});
                await waitFor(b, () => SceneManager._scene instanceof Scene_Map && !Coop.battle, 30000, 'B back on the map').catch(() => {});
            }
        }
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
