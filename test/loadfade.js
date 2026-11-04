// Continue from a fresh page into a run already under way, with a solo save
// whose map has a shelf slid off its home. The world reply lands during the
// load fade, while $dataMap is still the title's: the 11/03 field crash
// (Enki, twice: placeEl read another map's event, the join never finished,
// he stood "at the title" for everyone and the partner answered every line).
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const { checker } = require('./common');
const install = require('./helpers');

const titleReady = () => window.SceneManager && SceneManager._scene instanceof Scene_Title && !SceneManager.isSceneChanging() && window.Coop && Coop.connected;
const SHELF = 119; // Map003 bookshel1, home 16,31, <Save Event Location>

(async () => {
    const check = checker();
    const port = 8503;
    let server, browser, pages = [];
    try {
        server = await startServer(port);
        browser = await launch();
        const a = await openPlayer(browser, `http://localhost:${port}/?name=Ann`, 'Ann');
        const b = await openPlayer(browser, `http://localhost:${port}/?name=Bo`, 'Bo');
        pages = [a, b];
        for (const p of [a, b]) {
            await waitFor(p, titleReady, 90000, 'title');
            await p.evaluate(install);
        }
        await a.evaluate(() => T.quickStart(1, 27, 67));
        await waitFor(a, () => T.onMap(), 60000, 'Ann on the map');
        await a.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(a, () => Coop.world.live, 10000, 'Ann live');

        // Bo's solo game, never joined: a save on map 3 with the shelf one tile right.
        await b.evaluate(() => T.quickStart(4, 27, 66));
        await waitFor(b, () => T.onMap(), 60000, 'Bo on the map');
        await b.evaluate(() => T.settle());
        await b.evaluate(() => { $gamePlayer.reserveTransfer(3, 53, 45, 2, 0); });
        await waitFor(b, () => T.onMap() && $gameMap.mapId() === 3, 30000, 'Bo on map 3');
        await b.evaluate(() => T.settle());
        const made = await b.evaluate((shelf) => {
            const home = $dataMap.events[shelf];
            if (!home) return { error: 'no shelf' };
            $gameSystem.onBeforeSave();
            const contents = JsonEx.parse(JsonEx.stringify(DataManager.makeSaveContents()));
            for (const ev of contents.map._events || []) {
                if (!ev) continue;
                // Switch 79 below wakes map 3's autoruns (EV133 has no condition): settled, as in buckman.js.
                const data = $dataMap.events[ev._eventId];
                if (data && data.pages.some((p) => p.trigger === 3)) ev._erased = true;
                ev._starting = false;
                if (ev._interpreter) ev._interpreter._list = null;
                if (ev._eventId === shelf) { ev._x = home.x + 1; ev._realX = home.x + 1; }
            }
            if (contents.map._interpreter) contents.map._interpreter._list = null;
            const slid = [home.x + 1, home.y, 2];
            contents.system._savedEventLocations = contents.system._savedEventLocations || {};
            contents.system._savedEventLocations[[3, shelf]] = slid;
            contents.map._needsRefresh = true;
            contents.switches._data[79] = true; // in the dungeon: loading it asks to join
            contents.coop.runId = '';
            contents.coop.el ={ ['3,' + shelf]: slid };
            StorageManager.save(1, JsonEx.stringify(contents));
            const info = DataManager.makeSavefileInfo();
            info.coopRun = '';
            const all = DataManager.loadGlobalInfo() || [];
            all[1] = info;
            DataManager.saveGlobalInfo(all);
            return { home: [home.x, home.y] };
        }, SHELF);
        check('the solo save is written with the shelf slid', made && !made.error, JSON.stringify(made));

        // A fresh page, as on the Deck: the title's map data, not map 3's.
        await b.reload({ waitUntil: 'domcontentloaded' });
        await waitFor(b, titleReady, 90000, 'Bo back at the title');
        await b.evaluate(install);
        await b.evaluate(() => {
            window.__notes = [];
            const note = Coop.note;
            Coop.note = function (text) { window.__notes.push(String(text)); return note.apply(this, arguments); };
        });
        // Scene_Load: the save is in at once, the map file only after the fade.
        await b.evaluate(() => {
            DataManager.loadGame(1);
            setTimeout(() => { SceneManager.goto(Scene_Map); $gameSystem.onAfterLoad(); }, 800);
        });
        const live = await waitFor(b, () => SceneManager._scene instanceof Scene_Map && T.onMap() && Coop.world.live, 20000, 'Bo joins Ann\'s run').then(() => true, () => false);
        await sleep(800);
        const after = await b.evaluate((shelf) => {
            const ev = $gameMap.event(shelf);
            const saved = $gameSystem._savedEventLocations || {};
            return {
                live: Coop.world.live,
                map: $gameMap.mapId(),
                at: ev ? [ev.x, ev.y] : null,
                saved: saved[[3, shelf]] || null,
                el: Coop.world.el['3,' + shelf] || null,
                errors: (window.__notes || []).filter((n) => /script error/.test(n)),
            };
        }, SHELF);
        check('Bo joins the run from a fresh page, no script error', live && after.live && after.errors.length === 0, JSON.stringify(after));
        check('the shelf stands at home on Bo\'s map, as in the run', made.home && after.map === 3 && after.at && after.at[0] === made.home[0] && after.at[1] === made.home[1] && !after.el && !after.saved, JSON.stringify({ home: made.home, after }));
        const onA = await a.evaluate((shelf) => Coop.world.el['3,' + shelf] || null, SHELF);
        check('Bo\'s solo slide never reaches Ann\'s world', !onA, JSON.stringify(onA));
        const seen = await a.evaluate(() => [...Coop.peers.values()].filter((p) => p.name === 'Bo').map((p) => p.st));
        check('Ann sees Bo in the dungeon, not at the title', seen.length === 1 && seen[0] && seen[0] !== 'title', JSON.stringify(seen));
    } catch (e) {
        console.error(e);
        check('test ran to the end', false);
    }
    const code = check.finish(pages);
    if (browser) await browser.close();
    if (server) server.kill();
    process.exit(code);
})();
