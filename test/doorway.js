// One start the way two players meet it: the title, the lobby, the opening, then a step and a save.
// twoPlayers() skips that door with T.quickStart (11/22).
const fs = require('fs');
const path = require('path');
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const { checker } = require('./common');
const install = require('./helpers');
const { titleReady, menu, menuIs, choose, watch, playIn, who, errorsOf } = require('./lobbylib');

const PORT = 8532;
const DIR = { 2: 'ArrowDown', 4: 'ArrowLeft', 6: 'ArrowRight', 8: 'ArrowUp' };

(async () => {
    const check = checker();
    let server, joiner, browser, pages = [];
    try {
        server = await startServer(PORT, { FH_MIND: 'none' });
        joiner = await startServer(PORT + 100, { FH_JOIN: `http://localhost:${PORT}/`, FH_LOBBY_TRACE: null, FH_MIND: 'none' });
        browser = await launch();
        const a = await openPlayer(browser, `http://localhost:${PORT}/?name=Ann`, 'Ann');
        const b = await openPlayer(browser, `http://localhost:${PORT + 100}/?name=Bo`, 'Bo');
        pages = [a, b];
        for (const p of pages) {
            await waitFor(p, titleReady, 90000, p.label + ' at the title');
            await p.evaluate(install);
            await p.evaluate(watch);
        }
        await waitFor(b, () => Coop.lobby.on, 15000, 'Bo in the lobby').catch(() => {});
        check('the host chooses the run', await menuIs(a, ['Run: choose...', 'As: -~', 'Start~', 'Together']), JSON.stringify(await menu(a)));
        await choose(a, 'Run: choose...');
        await choose(a, 'New run');
        await choose(a, 'Enki');
        await choose(b, 'As: choose...');
        await choose(b, 'Ragnvaldr');
        check('everyone has chosen: Start', await menuIs(a, ['Run: New', 'As: Enki', 'Start', 'Together']), JSON.stringify(await menu(a)));
        await choose(a, 'Start');
        for (const p of pages) await waitFor(p, () => SceneManager._scene instanceof Scene_Map, 30000, p.label + ' started').catch(() => {});
        const inAB = await playIn(pages, 300000);
        const wa = await who(a), wb = await who(b);
        const same = (await a.evaluate(() => Coop.world.runId)) === (await b.evaluate(() => Coop.world.runId));
        check('both come through the opening into one run, as the characters they picked', inAB[0] && inAB[1] && same && wa.is.join() === '663' && wb.is.join() === '664', JSON.stringify({ inAB, wa, wb }));
        for (const p of pages) await p.evaluate(() => T.settle());
        await waitFor(a, () => T.onMap(), 15000, 'Ann settled on the map');
        // A tile the player can walk onto, with no event on it (a door or a hound would take the step).
        const step = await a.evaluate(() => {
            const map = $gameMap.mapId(), x0 = $gamePlayer.x, y0 = $gamePlayer.y;
            for (const d of [2, 4, 6, 8]) {
                if (!$gamePlayer.canPass(x0, y0, d)) continue;
                const x = $gameMap.roundXWithDirection(x0, d), y = $gameMap.roundYWithDirection(y0, d);
                if ($gameMap.eventsXy(x, y).length) continue;
                return { d, x, y, map, x0, y0 };
            }
            return { map, x0, y0 };
        });
        check('there is an open tile beside Ann', !!step.d, JSON.stringify(step));
        if (step.d) {
            await a.keyboard.down(DIR[step.d]);
            await sleep(180);
            await a.keyboard.up(DIR[step.d]);
            const moved = await waitFor(a, (x, y) => $gamePlayer.x !== x || $gamePlayer.y !== y, 4000, 'Ann to take a step', step.x0, step.y0).then(() => true, () => false);
            const here = await a.evaluate(() => ({ x: $gamePlayer.x, y: $gamePlayer.y, map: $gameMap.mapId() }));
            check('a real step changes the tile and not the map', moved && here.map === step.map && (here.x !== step.x0 || here.y !== step.y0), JSON.stringify({ step, here }));
            const seen = await waitFor(b, (x, y) => Coop.others().some((p) => p.name === 'Ann' && p.x === x && p.y === y), 8000, 'Bo to see the step', here.x, here.y).then(() => true, () => false);
            check('Bo sees that step', seen, JSON.stringify(await b.evaluate(() => Coop.others().map((p) => p.name + ' ' + p.x + ',' + p.y))));
        }
        // The keyboard has no menu key, so this is the game's own save, the call a menu save makes, after the step.
        await a.evaluate(() => { $gameSystem.onBeforeSave(); DataManager.saveGame(1); });
        const file = path.join(server.saves, 'players', String(await a.evaluate(() => Coop.name)).toLowerCase(), 'file1.rpgsave');
        check('the step is saved on Ann\'s PC', fs.existsSync(file), file);
        const errs = await errorsOf(pages);
        check('no script errors', errs.length === 0, errs.join(' || ').slice(0, 600));
    } catch (e) {
        console.error(e);
        check('test ran to the end', false);
    }
    const code = check.finish(pages);
    if (browser) await browser.close();
    for (const s of [server, joiner]) if (s) s.kill();
    process.exit(code);
})();
