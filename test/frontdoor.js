// Through the front door, as people come in: each player on their own copy
// (the joiner's own server, as Enki's Deck), a slow line, the real title's
// Continue, the load screen and its fade. No quickStart into the run, no
// goto(Scene_Map) past the fade. Each way in must end with both players in
// the run, each seeing the other in the dungeon, and no script errors.
// 11/03: Continue from a fresh page into a run already under way crashed
// the join (test/loadfade.js has the narrow case); tests until then never
// came in this way.
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const { checker } = require('./common');
const install = require('./helpers');

const HOST = 8590, JOINER = 8591;
const KEY = 'frontdoor';
const SHELF = 119; // Map003 bookshel1, home 16,31, <Save Event Location>
const titleReady = () => window.SceneManager && SceneManager._scene instanceof Scene_Title && SceneManager.isCurrentSceneStarted() && !SceneManager.isSceneChanging() && window.Coop && Coop.connected;

function watchErrors() {
    window.__errs = [];
    const note = Coop.note;
    Coop.note = function (text) { if (/script error/.test(String(text))) window.__errs.push(String(text).slice(0, 300)); return note.apply(this, arguments); };
}

(async () => {
    const check = checker();
    let host, joiner, browser, pages = [];
    try {
        host = await startServer(HOST, { FH_KEY: KEY, FH_LAG: '80' });
        joiner = await startServer(JOINER, { FH_JOIN: `http://localhost:${HOST}/?k=${KEY}` });
        browser = await launch();
        const a = await openPlayer(browser, `http://localhost:${HOST}/?name=Ann`, 'Ann');
        const b = await openPlayer(browser, `http://localhost:${JOINER}/?name=Bo`, 'Bo');
        pages = [a, b];
        const ready = async (p) => { await waitFor(p, titleReady, 90000, p.label + ' at the title'); await p.evaluate(install); await p.evaluate(watchErrors); };
        const fresh = async (p) => { await p.reload({ waitUntil: 'domcontentloaded' }); await ready(p); };
        // The title's Continue, the load screen, the slot, OK: the fade and the map load run as for a person.
        const cont = async (p, slot) => {
            await p.evaluate(() => SceneManager._scene.commandContinue());
            await waitFor(p, () => SceneManager._scene instanceof Scene_Load && SceneManager.isCurrentSceneStarted() && !SceneManager.isSceneChanging(), 20000, p.label + ' load screen');
            await p.evaluate((n) => { const s = SceneManager._scene; s._listWindow.select(n - 1); s.onSavefileOk(); }, slot);
        };
        const together = async (label, shelf) => {
            const inA = await waitFor(a, () => SceneManager._scene instanceof Scene_Map && T.onMap() && Coop.world.live, 30000, 'Ann in').then(() => true, () => false);
            const inB = await waitFor(b, () => SceneManager._scene instanceof Scene_Map && T.onMap() && Coop.world.live, 30000, 'Bo in').then(() => true, () => false);
            await sleep(2500); // presence crosses the slow line
            const seen = async (p, who) => p.evaluate((n) => [...Coop.peers.values()].filter((x) => x.name === n).map((x) => x.st), who);
            const sees = { ann: await seen(a, 'Bo'), bo: await seen(b, 'Ann') };
            const runs = [await a.evaluate(() => Coop.world.runId), await b.evaluate(() => Coop.world.runId)];
            check(label + ': both in one run, each sees the other in the dungeon',
                inA && inB && runs[0] && runs[0] === runs[1] && sees.ann.length === 1 && sees.ann[0] !== 'title' && sees.bo.length === 1 && sees.bo[0] !== 'title',
                JSON.stringify({ inA, inB, runs, sees }));
            const errs = [...await a.evaluate(() => window.__errs), ...await b.evaluate(() => window.__errs)];
            check(label + ': no script errors', errs.length === 0, errs.join(' || ').slice(0, 600));
            if (shelf) {
                const at = await b.evaluate((id) => { const ev = $gameMap.mapId() === 3 && $gameMap.event(id); return ev ? [ev.x, ev.y] : null; }, SHELF);
                check(label + ': the shelf Bo slid alone stands at home, as in the run', at && at[0] === 16 && at[1] === 31, JSON.stringify(at));
            }
        };
        const toTitle = async (p) => { await p.evaluate(() => SceneManager.goto(Scene_Title)); await waitFor(p, titleReady, 20000, p.label + ' at the title'); };

        await ready(a);
        await ready(b);

        // The saves: Ann's run (slot 1), Bo's solo game on map 3 with the shelf slid one tile (slot 2).
        await a.evaluate(() => T.quickStart(1, 27, 67));
        await waitFor(a, () => T.onMap(), 60000, 'Ann on the map');
        await a.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(a, () => Coop.world.live, 15000, 'Ann live');
        await a.evaluate(() => { $gameSystem.onBeforeSave(); DataManager.saveGame(1); });
        await b.evaluate(() => T.quickStart(4, 27, 66));
        await waitFor(b, () => T.onMap(), 60000, 'Bo on the map');
        await b.evaluate(() => T.settle());
        await b.evaluate(() => { $gamePlayer.reserveTransfer(3, 53, 45, 2, 0); });
        await waitFor(b, () => T.onMap() && $gameMap.mapId() === 3, 30000, 'Bo on map 3');
        await b.evaluate(() => T.settle());
        const made = await b.evaluate((shelf) => {
            const home = $dataMap.events[shelf];
            $gameSystem.onBeforeSave();
            const contents = JsonEx.parse(JsonEx.stringify(DataManager.makeSaveContents()));
            for (const ev of contents.map._events || []) {
                if (!ev) continue;
                const data = $dataMap.events[ev._eventId];
                if (data && data.pages.some((p) => p.trigger === 3)) ev._erased = true;
                ev._starting = false;
                if (ev._interpreter) ev._interpreter._list = null;
                if (ev._eventId === shelf) { ev._x = home.x + 1; ev._realX = home.x + 1; }
            }
            if (contents.map._interpreter) contents.map._interpreter._list = null;
            contents.map._needsRefresh = true;
            contents.switches._data[79] = true;
            const slid = [home.x + 1, home.y, 2];
            contents.system._savedEventLocations = contents.system._savedEventLocations || {};
            contents.system._savedEventLocations[[3, shelf]] = slid;
            contents.coop.runId = '';
            contents.coop.el = { ['3,' + shelf]: slid };
            StorageManager.save(2, JsonEx.stringify(contents));
            const info = DataManager.makeSavefileInfo();
            info.coopRun = '';
            const all = DataManager.loadGlobalInfo() || [];
            all[2] = info;
            DataManager.saveGlobalInfo(all);
            return !!home;
        }, SHELF);
        check('the saves are made', made);
        await toTitle(b);
        await toTitle(a);

        // 1. Tonight's way in: Ann continues first, Bo continues from a fresh page.
        await fresh(a);
        await cont(a, 1);
        await waitFor(a, () => Coop.world.live, 30000, 'Ann founds').catch(() => {});
        await fresh(b);
        await cont(b, 2);
        await together('host in first, joiner continues from a fresh page', true);

        // 2. The joiner first: Bo continues and waits; then Ann continues.
        await toTitle(b);
        await toTitle(a);
        await fresh(b);
        await cont(b, 2);
        await waitFor(b, () => SceneManager._scene instanceof Scene_Map && Coop.world.hostWait, 30000, 'Bo waits for the host').catch(() => {});
        await fresh(a);
        await cont(a, 1);
        await together('joiner in first, host continues after', true);

        // 3. Back to the title in the game, from another map, and Continue again.
        await b.evaluate(() => { $gamePlayer.reserveTransfer(1, 27, 66, 8, 0); });
        await waitFor(b, () => T.onMap() && $gameMap.mapId() === 1, 30000, 'Bo on map 1');
        await toTitle(b);
        await b.evaluate(watchErrors);
        await cont(b, 2);
        await together('joiner back to the title from another map, continues again', true);
    } catch (e) {
        console.error(e);
        check('test ran to the end', false);
    }
    const code = check.finish(pages);
    if (browser) await browser.close();
    for (const s of [host, joiner]) if (s) s.kill();
    process.exit(code);
})();
