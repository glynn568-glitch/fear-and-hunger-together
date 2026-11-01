// A solo save whose fight-just-ended latch is still on must not replay that
// scene when Continue joins someone else's run. Coming back to your own run keeps it.
const fs = require('fs');
const path = require('path');
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const { checker } = require('./common');
const install = require('./helpers');

const titleReady = () => window.SceneManager && SceneManager._scene instanceof Scene_Title && !SceneManager.isSceneChanging() && window.Coop && Coop.connected;
const DUE = 2970;
const SHARED = [2971, 2972, 2965, 2966];
const MARKER = 11;

(async () => {
    const check = checker();
    const port = 8554;
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

        // Bo never begins: a save made before joining, the way a solo Continue is.
        await b.evaluate(() => T.quickStart(4, 27, 66));
        await waitFor(b, () => T.onMap(), 60000, 'Bo on the map');
        await b.evaluate(() => T.settle());
        await b.evaluate(() => { $gamePlayer.reserveTransfer(3, 53, 45, 2, 0); });
        await waitFor(b, () => T.onMap() && $gameMap.mapId() === 3, 30000, 'Bo on map 3');
        const spot = await b.evaluate(() => {
            const near = (x, y) => $gameMap.isValid(x, y) && $gameMap.eventsXy(x, y).length === 0 && [2, 4, 6, 8].some((d) => $gamePlayer.canPass(x, y, d));
            if (near($gamePlayer.x, $gamePlayer.y)) return { x: $gamePlayer.x, y: $gamePlayer.y };
            for (let r = 1; r <= 12; r++) {
                for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
                    if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                    const x = 53 + dx, y = 45 + dy;
                    if (near(x, y)) return { x, y };
                }
            }
            return null;
        });
        check('map 3 has an open tile by the Buckman scene', !!spot, JSON.stringify(spot));
        if (spot) await b.evaluate((s) => { if ($gamePlayer.x !== s.x || $gamePlayer.y !== s.y) $gamePlayer.locate(s.x, s.y); }, spot);
        // Settle erases every autorun, including EV247. The save below turns that one back on.
        // Other autoruns stay erased, or EV133 (no page condition, acts when switch 79 is on) holds the interpreter.
        await b.evaluate(() => T.settle());
        const made = await b.evaluate((due, shared, marker) => {
            const page = ($dataMap.events[247] && $dataMap.events[247].pages || []).find((p) => p.conditions && p.conditions.switch1Valid && p.conditions.switch1Id === due);
            if (!page || page.trigger !== 3) return { error: 'map 3 EV247 has no autorun on ' + due };
            if ($dataItems[marker]) $gameParty.gainItem($dataItems[marker], 1);
            // makeSaveContents without this leaves _bgmOnSave null, and loading plays it.
            $gameSystem.onBeforeSave();
            const contents = JsonEx.parse(JsonEx.stringify(DataManager.makeSaveContents()));
            const events = contents.map._events || [];
            for (const ev of events) {
                if (!ev) continue;
                const data = $dataMap.events[ev._eventId];
                const autorun = data && data.pages.some((p) => p.trigger === 3);
                if (ev._eventId === 247) ev._erased = false;
                else if (autorun) ev._erased = true;
                ev._starting = false;
                if (ev._interpreter) ev._interpreter._list = null;
            }
            if (contents.map._interpreter) contents.map._interpreter._list = null;
            contents.map._needsRefresh = true;
            contents.switches._data[due] = true;
            contents.switches._data[79] = true;
            // She came out of her cage in that solo run.
            contents.switches._data[81] = true;
            if (contents.party._actors.indexOf(2) < 0) contents.party._actors.push(2);
            for (const id of shared) contents.switches._data[id] = false;
            if (contents.selfSwitches && contents.selfSwitches._data) delete contents.selfSwitches._data['3,247,A'];
            contents.coop.runId = '';
            contents.coop.mine = (contents.coop.mine || []).filter((k) => k !== 'sw' + due && shared.every((id) => k !== 'sw' + id));
            contents.coop.mine.push('sw' + due);
            const count = (id) => contents.party.numItems($dataItems[id]);
            const bag = { marker: count(marker), key: count(51), vials: count(67) };
            StorageManager.save(1, JsonEx.stringify(contents));
            const info = DataManager.makeSavefileInfo();
            info.coopRun = '';
            const all = DataManager.loadGlobalInfo() || [];
            all[1] = info;
            DataManager.saveGlobalInfo(all);
            return { bag, liveDue: !!$gameSwitches.value(due) };
        }, DUE, SHARED, MARKER);
        check('the solo save is written with the latch on and the live map still off it', made && !made.error && made.liveDue === false, JSON.stringify(made));
        await b.evaluate(() => SceneManager.goto(Scene_Title));
        await waitFor(b, titleReady, 20000, 'Bo at the title');
        await b.evaluate(() => { DataManager.loadGame(1); SceneManager.goto(Scene_Map); $gameSystem.onAfterLoad(); });
        await waitFor(b, () => SceneManager._scene instanceof Scene_Map && Coop.world.live, 30000, 'Bo joins Ann\'s run');
        // Long enough for page 1 to set the shared switches, if the latch was allowed to run.
        await sleep(6000);
        const after = await b.evaluate((due, shared, marker) => {
            const map = $gameMap._interpreter;
            const ev = $gameMap.event(247);
            const own = ev && ev._interpreter;
            const running = !!((map && map.isRunning() && map.eventId && map.eventId() === 247) || (own && own.isRunning()) || (ev && ev._starting));
            return {
                due: !!$gameSwitches.value(due),
                shared: shared.map((id) => !!$gameSwitches.value(id)),
                mine: Coop.world.mine.has('sw' + due),
                list: (Coop.world.census.dueScenes || []).indexOf(due) >= 0,
                running,
                bag: { marker: $gameParty.numItems($dataItems[marker]), key: $gameParty.numItems($dataItems[51]), vials: $gameParty.numItems($dataItems[67]) },
                run: Coop.world.runId,
            };
        }, DUE, SHARED, MARKER);
        const onA = await a.evaluate((shared) => shared.map((id) => !!$gameSwitches.value(id)), SHARED);
        let disk = null;
        try { disk = JSON.parse(fs.readFileSync(path.join(server.saves, 'runs', after.run, 'world.json'), 'utf8')); } catch (e) { disk = null; }
        const diskOn = disk && SHARED.some((id) => disk.sw && (disk.sw[id] || disk.sw[String(id)]));
        check('joining clears the carried latch and the Buckman scene does not start', after.list && !after.due && !after.mine && !after.running && after.shared.every((v) => !v), JSON.stringify(after));
        const girl = await Promise.all([a.evaluate(() => $gameSwitches.value(81)), b.evaluate(() => $gameSwitches.value(81))]);
        check('a body holding the Girl brings the flag that says she left her cage', girl[0] && girl[1], JSON.stringify(girl));
        check('the scene\'s shared switches stay off for Ann and on the server', onA.every((v) => !v) && !!disk && !diskOn, JSON.stringify({ onA, disk: disk && disk.sw }));
        check('Bo\'s bag is unchanged', made.bag && after.bag.marker === made.bag.marker && after.bag.key === made.bag.key && after.bag.vials === made.bag.vials, JSON.stringify({ made: made.bag, after: after.bag }));

        // The same latch, reconnecting into the run he is already in, is still due.
        await b.evaluate(() => { $gamePlayer.reserveTransfer(1, 27, 66, 8, 0); });
        await waitFor(b, () => T.onMap() && $gameMap.mapId() === 1, 30000, 'Bo back on map 1');
        await b.evaluate(() => T.settle());
        await b.evaluate((due) => $gameSwitches.setValue(due, true), DUE);
        await b.evaluate(() => Coop._ws.close());
        await waitFor(b, () => Coop.connected && Coop.world.live, 15000, 'Bo reconnects');
        await sleep(800);
        const again = await b.evaluate((due) => ({ on: !!$gameSwitches.value(due), mine: Coop.world.mine.has('sw' + due) }), DUE);
        check('reconnecting keeps the latch', again.on && again.mine, JSON.stringify(again));

        // A save too old to say whose flags were whose: what the run already has is the run's.
        const guessed = await b.evaluate(() => {
            const w = Coop.world;
            w.mineGuessed = true;
            w.mine.add('sw22');
            Coop.emit('world', { runId: w.runId, world: { sw: { 22: 1 }, va: {}, ss: {}, el: {} }, mode: 'again', balance: true });
            return { mine: w.mine.has('sw22'), left: w.mineGuessed };
        });
        check('an old save does not claim flags the run already has', !guessed.mine && !guessed.left, JSON.stringify(guessed));
        // Told to wait for the host, or for someone alive: still no word on which run this is.
        const held = await b.evaluate(() => {
            const w = Coop.world;
            const out = {};
            w._holdDue = true;
            Coop.emit('worldhost', { by: 'Ann' });
            out.host = w._holdDue;
            Coop.emit('worldwait', {});
            out.wait = w._holdDue;
            clearTimeout(w._hostTimer); clearTimeout(w._waitTimer);
            w.hostWait = ''; w.waiting = false; w._holdDue = false;
            return out;
        });
        check('a due scene stays held while waiting for the host or a living player', held.host && held.wait, JSON.stringify(held));
    } catch (e) {
        console.error(e);
        check('test ran to the end', false);
    }
    const code = check.finish(pages);
    if (browser) await browser.close();
    if (server) server.kill();
    process.exit(code);
})();
