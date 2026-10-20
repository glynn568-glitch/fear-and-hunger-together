// A partner off the screen on the same map: an arrow at the screen's edge
// points their way, with their name. On screen, or on another map: none.
const { twoPlayers, checker, sleep, waitFor } = require('./common');
const { shot } = require('./lib');

const pointer = (page) => page.evaluate(() => {
    const el = [...document.querySelectorAll('.coop-pointer')].find((e) => e.style.display === 'block');
    if (!el) return null;
    const r = el.getBoundingClientRect(), c = Graphics._canvas.getBoundingClientRect();
    return { name: el.textContent, angle: Number(el.dataset.angle), x: r.left, y: r.top, inside: r.left >= c.left - 1 && r.left <= c.right + 1 && r.top >= c.top - 1 && r.top <= c.bottom + 1 };
});

(async () => {
    const check = checker();
    let s;
    try {
        s = await twoPlayers(8471);
        const { a, b } = s;
        await sleep(800);
        check('a partner standing beside you gets no arrow', (await pointer(a)) === null);
        // B goes far up the same map, out of A's view.
        await b.evaluate(() => { $gamePlayer.setThrough(true); $gamePlayer.locate(27, 40); $gamePlayer.setThrough(false); });
        await sleep(1200);
        const up = await pointer(a);
        check('a partner off the screen above gets an arrow at the edge pointing up, named', up && up.name === 'Bo' && up.angle < -60 && up.angle > -120 && up.inside, JSON.stringify(up));
        console.log('screenshot', await shot(a, 'pointer'));
        // And to the side.
        await b.evaluate(() => { $gamePlayer.setThrough(true); $gamePlayer.locate($gameMap.width() - 3, 67); $gamePlayer.setThrough(false); });
        await sleep(1200);
        const right = await pointer(a);
        check('off to the right, it points right', right && Math.abs(right.angle) < 30 && right.inside, JSON.stringify(right));
        // Partner Arrows in the game's Options, turned off there the way a player would.
        await a.evaluate(() => SceneManager.push(Scene_Options));
        await waitFor(a, () => SceneManager._scene instanceof Scene_Options && SceneManager._scene._categoryWindow && !SceneManager.isSceneChanging(), 10000, 'Options open');
        const off = await a.evaluate(() => {
            const s = SceneManager._scene, cats = s._categoryWindow;
            cats.select(cats._list.findIndex((c) => c.name === 'General'));
            cats.updateHelp();
            const w = s._optionsWindow, i = w._list.findIndex((c) => c.symbol === 'coopPointer');
            if (i < 0) return { listed: w._list.map((c) => c.symbol) };
            const was = ConfigManager.coopPointer;
            w.select(i);
            w.processOk();
            return { listed: true, was, now: ConfigManager.coopPointer };
        });
        check('Options lists Partner Arrows under General, on, and OK turns it off', off.listed === true && off.was === true && off.now === false, JSON.stringify(off));
        console.log('screenshot', await shot(a, 'pointer-options'));
        await a.evaluate(() => SceneManager.pop());
        await waitFor(a, () => SceneManager._scene instanceof Scene_Map && !SceneManager.isSceneChanging(), 10000, 'back on the map');
        await sleep(1200);
        check('with it off, a partner off the screen gets no arrow', (await pointer(a)) === null);
        const kept = await a.evaluate(() => ({ saved: ConfigManager.makeData().coopPointer, fresh: (ConfigManager.applyData({}), ConfigManager.coopPointer) }));
        check('the choice is saved with the options, and a PC that never chose has it on', kept.saved === false && kept.fresh === true, JSON.stringify(kept));
        await sleep(1200);
        check('turned back on, the arrow returns', !!(await pointer(a)));
        // Another map: the corner list says where; no arrow.
        await b.evaluate(() => { $gamePlayer.reserveTransfer(74, 15, 22, 8, 0); });
        await waitFor(b, () => $gameMap.mapId() === 74 && T.onMap(), 30000, 'B on another map');
        await sleep(1200);
        check('a partner on another map gets no arrow', (await pointer(a)) === null);
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
