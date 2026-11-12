// The lobby carrying a save on, a start called off, and "away": the real title, real keys,
// the load screen and its fade (test/lobby.js has a new run and the late Join).
//   1  carrying a save on: the host chooses it on the load screen, the friend is ready, Start loads both
//   2  the host's page reloads with a start under way: the friend is brought back to the title
//   3  someone idle at the title is away and does not hold Start up
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const { checker } = require('./common');
const install = require('./helpers');
const { titleReady, menu, hud, hudIs, key, choose, menuIs, watch, toTitle, who, errorsOf } = require('./lobbylib');

const PORT = 8542;

(async () => {
    const check = checker();
    let server, joiner, browser, pages = [];
    try {
        server = await startServer(PORT, { FH_MIND: 'none' });
        joiner = await startServer(PORT + 100, { FH_JOIN: `http://localhost:${PORT}/` });
        browser = await launch();
        const a = await openPlayer(browser, `http://localhost:${PORT}/?name=Ann`, 'Ann');
        const b = await openPlayer(browser, `http://localhost:${PORT + 100}/?name=Bo`, 'Bo');
        pages = [a, b];
        for (const p of pages) { await waitFor(p, titleReady, 90000, p.label + ' at the title'); await p.evaluate(install); await p.evaluate(watch); }
        const errors = async (label) => { const errs = await errorsOf(pages); check(label + ': no script errors', errs.length === 0, errs.join(' || ').slice(0, 600)); };

        // A night played and saved, without its opening: Ann as Enki founds it, Bo as D'arce is in it,
        // Ann saves and Bo's game saves alongside.
        await a.evaluate(() => T.quickStart(4, 27, 67));
        await waitFor(a, () => T.onMap(), 60000, 'Ann on the map');
        await a.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(a, () => Coop.world.live, 15000, 'Ann in');
        await b.evaluate(() => T.quickStart(3, 27, 66));
        await waitFor(b, () => T.onMap(), 60000, 'Bo on the map');
        await b.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(b, () => Coop.world.live, 15000, 'Bo in');
        await sleep(500);
        await a.evaluate(() => { $gameSystem.onBeforeSave(); DataManager.saveGame(1); });
        const saved = await waitFor(b, () => { const info = DataManager.loadGlobalInfo() || []; return info.some((i) => i && i.coopRun === Coop.world.runId); }, 20000, 'Bo saved alongside').then(() => true, () => false);
        const runId = await a.evaluate(() => Coop.world.runId);
        check('a night played and saved by both', saved && !!runId, JSON.stringify({ saved, runId }));
        await toTitle(b);
        await toTitle(a);

        //--- 1. carrying a save on -------------------------------------------------
        check('the run ended: the host chooses again', await menuIs(a, ['New run', 'Continue', 'Together']), JSON.stringify(await menu(a)));
        await choose(a, 'Continue');
        await waitFor(a, () => SceneManager._scene instanceof Scene_Load && SceneManager.isCurrentSceneStarted() && !SceneManager.isSceneChanging(), 20000, 'the load screen');
        await sleep(300);
        await key(a, 'Enter');
        await waitFor(a, titleReady, 20000, 'Ann back at the title').catch(() => {});
        check('choosing a save loads nothing: back at the title, with Start', await menuIs(a, ['Start~', 'Change run', 'Together']) && !(await a.evaluate(() => Coop.world.live)), JSON.stringify(await menu(a)));
        check('the friend has their own save of that run: Ready', await menuIs(b, ['Ready', 'Come in as...', 'Together']), JSON.stringify(await menu(b)));
        await sleep(400);
        check('the corner list says which run', /^Continue.* \| Ann ready \| Bo not ready/.test(await hud(b)), await hud(b));
        await choose(b, 'Ready');
        check('ready', await menuIs(a, ['Start', 'Change run', 'Together']) && await hudIs(a, /Bo ready/), await hud(a));
        await choose(a, 'Start');
        const live = () => SceneManager._scene instanceof Scene_Map && Coop.world.live && !$gamePlayer.isTransferring() && SceneManager._scene.isActive();
        const loadedA = await waitFor(a, live, 40000, 'Ann in').then(() => true, () => false);
        const loadedB = await waitFor(b, live, 40000, 'Bo in').then(() => true, () => false);
        const runs = [await a.evaluate(() => Coop.world.runId), await b.evaluate(() => Coop.world.runId)];
        check('Start loads both saves into the run they were saved in', loadedA && loadedB && runs[0] === runId && runs[1] === runId, JSON.stringify({ loadedA, loadedB, runs, runId }));
        const wa3 = await who(a), wb3 = await who(b);
        check('each is who their save is', wa3.is.join() === '663' && wb3.is.join() === '662', JSON.stringify({ wa3, wb3 }));
        await sleep(1500);
        check('each sees the other in the dungeon again', (await a.evaluate(() => Coop.others().some((p) => p.name === 'Bo' && p.st !== 'title'))) && (await b.evaluate(() => Coop.others().some((p) => p.name === 'Ann' && p.st !== 'title'))));
        await errors('carrying a save on');

        //--- 2. the host's page reloads with a start under way -------------------------
        await toTitle(b);
        await toTitle(a);
        await menuIs(a, ['New run', 'Continue', 'Together']);
        await choose(a, 'New run');
        await choose(a, 'Cahara');
        check('a new run: the friend\'s save does not count, a character has to be picked', await menuIs(b, ['Ready~', 'Come in as...', 'Together']), JSON.stringify(await menu(b)));
        await choose(b, 'Come in as...');
        await choose(b, 'Ragnvaldr');
        await choose(b, 'Ready');
        await menuIs(a, ['Start', 'Change run', 'Together']);
        await choose(a, 'Start');
        await waitFor(b, () => SceneManager._scene instanceof Scene_Map, 20000, 'Bo\'s game to start').catch(() => {});
        await a.reload({ waitUntil: 'domcontentloaded' });
        const back = await waitFor(b, titleReady, 30000, 'Bo back at the title').then(() => true, () => false);
        check('the host\'s page reloads during the start: the friend is brought back to the title', back && !(await b.evaluate(() => Coop.world.live || Coop.lobby.going)));
        await waitFor(a, titleReady, 90000, 'Ann at the title again');
        await a.evaluate(install);
        await a.evaluate(watch);
        check('and the lobby starts over: the host chooses', await menuIs(a, ['New run', 'Continue', 'Together']) && await menuIs(b, ['Together']), JSON.stringify([await menu(a), await menu(b)]));
        await errors('a start called off');

        //--- 3. away --------------------------------------------------------------------
        await choose(a, 'New run');
        await choose(a, 'Cahara');
        await menuIs(b, ['Ready~', 'Come in as...', 'Together']);
        check('someone here and not ready holds Start up', await menuIs(a, ['Start~', 'Change run', 'Together']), JSON.stringify(await menu(a)));
        // What Bo's page said and what it took for a key, for the day this check fails (it did once, 11/11).
        await b.evaluate(() => {
            window.__said = [];
            const t0 = Date.now();
            const send = Coop.send;
            Coop.send = function (m) { if (m && m.t === 'lobby') window.__said.push((Date.now() - t0) + ' ' + m.do + ' ' + m.on); return send.apply(this, arguments); };
            for (const type of ['keydown', 'mousedown', 'touchstart']) document.addEventListener(type, (e) => window.__said.push((Date.now() - t0) + ' ' + type + ' ' + (e.code || '')), true);
            Coop.lobby.awayAfter = 1500;
        });
        const awayOk = await menuIs(a, ['Start', 'Change run', 'Together'], 10000) && await hudIs(a, /Bo away/);
        check('idle at the title: away, and Start no longer waits for them', awayOk, (await hud(a)) + ' || Bo: ' + JSON.stringify(await b.evaluate(() => ({
            said: window.__said, latest: Input._latestButton, held: Object.keys(Input._currentState).filter((k) => Input._currentState[k]), pads: Array.from(navigator.getGamepads ? navigator.getGamepads() : []).filter(Boolean).length,
            row: Coop.lobby.rows[Coop.id], on: Coop.lobby.on, host: Coop.lobby.host, id: Coop.id,
        }))) + ' || Ann: ' + JSON.stringify(await a.evaluate(() => ({ rows: Coop.lobby.rows, others: Coop.others().map((p) => [p.id, p.name, p.st, p.up]) }))));
        await b.evaluate(() => { Coop.lobby.awayAfter = 300000; });
        await key(b, 'ArrowDown');
        check('a key: here again, and waited for', await menuIs(a, ['Start~', 'Change run', 'Together'], 10000) && await hudIs(a, /Bo not ready/), await hud(a));
        await errors('away');
    } catch (e) {
        console.error(e);
        check('test ran to the end', false);
    }
    const code = check.finish(pages);
    if (browser) await browser.close();
    for (const s of [server, joiner]) if (s) s.kill();
    process.exit(code);
})();
