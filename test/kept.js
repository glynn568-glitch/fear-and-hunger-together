// A shelf slid by one player is slid for someone who was not in the room.
// Map003 EV119 (the Mockup book, item 49) walks EV119-124 and the door EV127,
// then turns on shared switches 132 and 209. The tiles have to travel too.
const fs = require('fs');
const path = require('path');
const { twoPlayers, checker, sleep, waitFor } = require('./common');

const IDS = [119, 120, 121, 122, 123, 124, 127];

const titleReady = () => window.SceneManager && SceneManager._scene instanceof Scene_Title && !SceneManager.isSceneChanging() && window.Coop && Coop.connected;
const onMapLive = () => SceneManager._scene instanceof Scene_Map && SceneManager._scene.isActive() && Coop.world.live && !$gamePlayer.isTransferring();

function readSpots(page) {
    return page.evaluate((ids) => {
        const at = {};
        const moved = {};
        for (const id of ids) {
            const ev = $gameMap.event(id);
            const home = ev.event();
            at[id] = [ev.x, ev.y, ev.direction()];
            moved[id] = ev.x !== home.x || ev.y !== home.y;
        }
        const door = $gameMap.event(127).event();
        const blockers = $gameMap.eventsXyNt(door.x, door.y).filter((ev) => ev.isNormalPriority()).map((ev) => ev.eventId());
        const shelf = $gameMap.event(119).event();
        const shelfBlock = $gameMap.eventsXyNt(shelf.x, shelf.y).filter((ev) => ev.isNormalPriority()).map((ev) => ev.eventId());
        const el = ids.map((id) => { const p = Coop.world.el['3,' + id]; return p ? p.join() : ''; });
        return { at, moved, el, door: { x: door.x, y: door.y, pass: $gameMap.isPassable(door.x, door.y, 2), blockers }, shelfBlock };
    }, IDS);
}

function sameAt(p, q) {
    return IDS.every((id) => p.at[id] && q.at[id] && p.at[id].join() === q.at[id].join());
}

async function go(page, mapId, x, y) {
    await page.evaluate((m, x, y) => {
        $gameVariables.setValue(123, 1); // layout die: 1 keeps this hall on map 3
        $gamePlayer.setThrough(true);
        $gamePlayer.reserveTransfer(m, x, y, 8, 0);
    }, mapId, x, y);
    await waitFor(page, (m) => T.onMap() && $gameMap.mapId() === m, 30000, 'on map ' + mapId, mapId);
    await page.evaluate(() => { T.settle(); $gamePlayer.setDirection(8); $gamePlayer.setThrough(false); });
}

// The page shows the choice with the first text, then a second text, then the slide.
async function slide(page) {
    await page.evaluate(() => {
        $gameParty.gainItem($dataItems[49], 1);
        $gamePlayer.setDirection(8);
        $gameMap.event(119).start();
    });
    const deadline = Date.now() + 40000;
    let last = null;
    while (Date.now() < deadline) {
        last = await page.evaluate(() => {
            const choice = $gameMessage.isChoice() ? $gameMessage.choices() : null;
            const ids = [119, 120, 121, 122, 123, 124, 127];
            const moving = ids.some((id) => { const ev = $gameMap.event(id); return ev && (ev.isMoving() || ev.isMoveRouteForcing()); });
            return { choice, busy: $gameMessage.isBusy(), text: $gameMessage.allText().slice(0, 90), sw: $gameSwitches.value(209), moving, page: $gameMap.event(119).findProperPageIndex() };
        });
        if (last.sw && !last.moving) return last;
        if (last.choice) {
            const pick = last.choice.findIndex((c) => /mockup/i.test(c));
            await page.evaluate((n) => {
                $gameMessage.onChoice(n);
                const w = SceneManager._scene && SceneManager._scene._messageWindow;
                if (w && w.terminateMessage) w.terminateMessage(); else $gameMessage.clear();
            }, pick < 0 ? 0 : pick);
        } else if (last.busy) {
            await page.evaluate(() => {
                const w = SceneManager._scene && SceneManager._scene._messageWindow;
                if (w && w.terminateMessage) w.terminateMessage(); else $gameMessage.clear();
            });
        }
        await sleep(80);
    }
    throw new Error('the shelves did not finish: ' + JSON.stringify(last));
}

async function fresh(page, actor, x, y) {
    await page.evaluate(() => { if (!(SceneManager._scene instanceof Scene_Title)) SceneManager.goto(Scene_Title); });
    await waitFor(page, titleReady, 20000, page.label + ' at the title');
    await page.evaluate((act, x, y) => T.quickStart(act, x, y), actor, x, y);
    await waitFor(page, () => T.onMap(), 60000, page.label + ' on the map');
    await page.evaluate(() => { T.settle(); T.begin(); });
    await waitFor(page, () => Coop.world.live, 15000, page.label + ' live');
}

const save = (page, slot) => page.evaluate((n) => { $gameSystem.onBeforeSave(); DataManager.saveGame(n); }, slot);
const load = (page, slot) => page.evaluate((n) => { DataManager.loadGame(n); SceneManager.goto(Scene_Map); $gameSystem.onAfterLoad(); }, slot);

async function bothToTitle(a, b) {
    for (const p of [a, b]) await p.evaluate(() => { if (!(SceneManager._scene instanceof Scene_Title)) SceneManager.goto(Scene_Title); });
    for (const p of [a, b]) await waitFor(p, titleReady, 20000, p.label + ' at the title');
    for (const p of [a, b]) await waitFor(p, () => !Coop.world.live, 8000, p.label + ' has left the run');
    await sleep(800);
}

(async () => {
    const check = checker();
    let s;
    try {
        s = await twoPlayers(8558);
        const { a, b } = s;
        let picture = null;

        // (g) a wanderer, before anyone runs a scene.
        const wander = await a.evaluate(() => {
            const ev = $gameMap.events().find((e) => e._moveType !== 0 && !e._erased);
            if (!ev) return null;
            const before = [ev.x, ev.y];
            ev.setThrough(true);
            ev.forceMoveRoute({ list: [{ code: 1 }, { code: 1 }, { code: 1 }, { code: 0 }], repeat: false, skippable: true, wait: false });
            return { id: ev._eventId, before };
        });
        await sleep(2500);
        const wandered = await a.evaluate((id) => {
            const ev = $gameMap.event(id);
            return { at: [ev.x, ev.y], el: Coop.world.el['1,' + id] || null };
        }, wander.id);
        const wanderedB = await b.evaluate((id) => Coop.world.el['1,' + id] || null, wander.id);
        check('a wanderer moving does not publish a kept location', wander && wandered.at[1] !== wander.before[1] && !wandered.el && !wanderedB, JSON.stringify({ wander, wandered, wanderedB }));
        const fpA = await a.evaluate(() => Coop.world.fingerprint());
        const fpB = await b.evaluate(() => Coop.world.fingerprint());
        check('a wanderer is not in the shared fingerprint', fpA === fpB && !fpA.split(';').some((part) => part.charAt(0) === 'e'), fpA === fpB ? '' : fpA + ' / ' + fpB);

        // (b) B is in the room the whole time.
        await go(a, 3, 30, 40);
        await go(b, 3, 32, 40);
        await slide(a);
        await sleep(400);
        const seenA = await readSpots(a);
        await waitFor(b, (ids) => ids.every((id) => { const ev = $gameMap.event(id); const home = ev.event(); return ev.x !== home.x || ev.y !== home.y; }), 8000, 'B sees the shelves move', IDS).catch(() => {});
        const seenB = await readSpots(b);
        check('the slide actually leaves every tile', IDS.every((id) => seenA.moved[id]), JSON.stringify(seenA.at));
        check('B, already in the room, has the shelves and the door where A does', sameAt(seenA, seenB), 'A ' + JSON.stringify(seenA.at) + ' B ' + JSON.stringify(seenB.at));
        check('B, already in the room, is told the kept locations', IDS.every((id, i) => seenB.el[i] === seenA.at[id].join()), JSON.stringify(seenB.el));
        check('the door tile EV127 started on matches A for B in the room', seenA.door.pass === seenB.door.pass && seenA.door.blockers.join() === seenB.door.blockers.join() && seenA.shelfBlock.join() === seenB.shelfBlock.join(), JSON.stringify({ a: seenA.door, b: seenB.door, shelfA: seenA.shelfBlock, shelfB: seenB.shelfBlock }));

        // (f) Trortur's table walks EV134 and sets no shared flag. Stop it before the game over.
        const home134 = await a.evaluate(() => { const ev = $gameMap.event(134); return [ev.x, ev.y]; });
        await a.evaluate(() => {
            const ev = $gameMap.event(136);
            ev._erased = false;
            ev.refresh();
            $gameSwitches.setValue(136, true);
        });
        let moved134 = false;
        const until = Date.now() + 25000;
        while (Date.now() < until) {
            const st = await a.evaluate((home) => {
                const ev = $gameMap.event(134);
                const over = SceneManager._scene instanceof Scene_Gameover;
                return { x: ev.x, y: ev.y, moved: ev.x !== home[0] || ev.y !== home[1], over, busy: $gameMessage.isBusy(), text: $gameMessage.allText().slice(0, 60) };
            }, home134);
            if (st.over) break;
            if (st.moved) { moved134 = true; break; }
            if (st.busy) await a.evaluate(() => { const w = SceneManager._scene && SceneManager._scene._messageWindow; if (w && w.terminateMessage) w.terminateMessage(); else $gameMessage.clear(); });
            await sleep(80);
        }
        await a.evaluate(() => {
            $gameMap._interpreter.clear();
            $gameMessage.clear();
            const walker = $gameMap.event(134);
            if (walker) walker._moveRouteForcing = false;
            const ev = $gameMap.event(136);
            ev._starting = false;
            ev._locked = false;
            ev._erased = true;
            $gameSwitches.setValue(136, false);
        });
        await sleep(800);
        const leaked = await a.evaluate(() => Coop.world.el['3,134'] || null);
        const leakedB = await b.evaluate(() => Coop.world.el['3,134'] || null);
        check('a scene with no shared flag does not publish the actor it walks', moved134 && !leaked && !leakedB && !(await a.evaluate(() => SceneManager._scene instanceof Scene_Gameover)), JSON.stringify({ home134, leaked, leakedB }));

        // A new run, so the shelf page is back. (a) B is not in the room.
        await bothToTitle(a, b);
        await fresh(a, 1, 27, 67);
        await fresh(b, 3, 28, 67);
        await go(a, 3, 30, 40);
        await slide(a);
        await sleep(400);
        picture = await readSpots(a);
        check('A slid the shelves again', IDS.every((id) => picture.moved[id]), JSON.stringify(picture.at));
        await go(a, 1, 27, 67);
        await waitFor(b, () => $gameMap.mapId() === 1 && T.onMap(), 8000, 'B never entered the hall');
        await waitFor(b, (want) => { const p = Coop.world.el['3,119']; return p && p.join() === want; }, 8000, 'B heard the shelf', picture.at[119].join()).catch(() => {});
        const heard = await b.evaluate((ids) => ids.map((id) => { const p = Coop.world.el['3,' + id]; return p ? p.join() : ''; }), IDS);
        check('B, still outside, is told where the shelves stopped', IDS.every((id, i) => heard[i] === picture.at[id].join()), JSON.stringify({ heard, at: picture.at }));
        await go(b, 3, 32, 40);
        const arrived = await readSpots(b);
        check('B, coming in after, has the shelves and the door where A left them', sameAt(picture, arrived), 'A ' + JSON.stringify(picture.at) + ' B ' + JSON.stringify(arrived.at));
        check('the door tile EV127 was on is as passable for B as it was for A', picture.door.pass === arrived.door.pass && picture.door.blockers.join() === arrived.door.blockers.join(), JSON.stringify({ a: picture.door, b: arrived.door }));
        check('the shelf tile EV119 left is as clear for B as it was for A', picture.shelfBlock.join() === arrived.shelfBlock.join(), JSON.stringify({ a: picture.shelfBlock, b: arrived.shelfBlock }));

        // (d) B's save remembers the tiles. Captured here; reloaded once the run is quiet.
        const blobEl = await b.evaluate((ids) => {
            const contents = JsonEx.parse(JsonEx.stringify(DataManager.makeSaveContents()));
            const el = contents.coop && contents.coop.el || {};
            return ids.map((id) => { const p = el['3,' + id]; return p ? p.join() : ''; });
        }, IDS);
        check('B\'s save keeps the kept locations', IDS.every((id, i) => blobEl[i] === picture.at[id].join()), JSON.stringify(blobEl));
        await save(b, 1);
        await waitFor(a, () => StorageManager.exists(1), 8000, 'A saved alongside');

        // (c) B starts a new game while A is still in the run, then walks in.
        await fresh(b, 3, 28, 67);
        await waitFor(b, () => Coop.world.live && Coop.world.el['3,119'], 8000, 'the new game joined the shelves').catch(() => {});
        const joinedEl = await b.evaluate((ids) => ids.map((id) => { const p = Coop.world.el['3,' + id]; return p ? p.join() : ''; }), IDS);
        check('a new game that joins the run is told the kept locations', IDS.every((id, i) => joinedEl[i] === picture.at[id].join()), JSON.stringify(joinedEl));
        await go(b, 3, 32, 40);
        const late = await readSpots(b);
        check('a new game, walking in later, has the shelves and the door where A left them', sameAt(picture, late), JSON.stringify(late.at));

        // (d) reload. A (the host) carries the run on, then B loads the bed.
        await bothToTitle(a, b);
        await load(a, 1);
        await waitFor(a, onMapLive, 30000, 'A continues from the bed');
        await load(b, 1);
        await waitFor(b, onMapLive, 30000, 'B reloads the bed');
        await waitFor(b, () => $gameMap.mapId() === 3 && T.onMap(), 15000, 'B is back in the hall').catch(() => {});
        if (await b.evaluate(() => $gameMap.mapId() !== 3)) await go(b, 3, 32, 40);
        const reloaded = await readSpots(b);
        check('B\'s reloaded save still has the shelves and the door', sameAt(picture, reloaded), JSON.stringify(reloaded.at));

        // (e) the server's copy of the world is gone. A's save has to bring the tiles.
        await save(a, 2);
        await waitFor(b, () => StorageManager.exists(2), 8000, 'B saved alongside (2)');
        const runId = await a.evaluate(() => Coop.world.runId);
        const stamp = await a.evaluate(() => { const info = DataManager.loadGlobalInfo()[2]; return info && info.coopStamp || 0; });
        await bothToTitle(a, b);
        const dir = path.join(s.server.saves, 'runs', String(runId).replace(/[^\w-]/g, ''));
        const wipe = () => {
            if (!fs.existsSync(dir)) return [];
            const gone = [];
            for (const name of fs.readdirSync(dir)) {
                if (name === 'world.json' || /^world@\d+\.json$/.test(name)) {
                    fs.unlinkSync(path.join(dir, name));
                    gone.push(name);
                }
            }
            return gone;
        };
        wipe();
        await sleep(1500);
        wipe();
        const wanted = stamp ? 'world@' + stamp + '.json' : 'world.json';
        const left = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name === 'world.json' || /^world@\d+\.json$/.test(name)) : [];
        check('the server has no world file for this save', !left.includes(wanted), 'stamp ' + stamp + ' left ' + left.join(','));
        await load(a, 2);
        await waitFor(a, onMapLive, 30000, 'A reloads with no world file');
        const contributed = await a.evaluate(() => Coop.log.filter((line) => /facts contributed/.test(line)).slice(-2));
        const brought = await a.evaluate((ids) => ids.map((id) => { const p = Coop.world.el['3,' + id]; return p ? p.join() : ''; }), IDS);
        check('A\'s save contributes the kept locations', IDS.every((id, i) => brought[i] === picture.at[id].join()) && contributed.some((line) => !/\(0 facts contributed\)/.test(line)), JSON.stringify({ brought, contributed }));
        await fresh(b, 3, 28, 67);
        await waitFor(b, () => Coop.world.el['3,119'], 8000, 'B is told the shelves').catch(() => {});
        await go(b, 3, 32, 40);
        const fromSave = await readSpots(b);
        check('B, joining after the reload, has the shelves and the door', sameAt(picture, fromSave), JSON.stringify(fromSave.at));
        check('that door tile matches too', picture.door.pass === fromSave.door.pass && picture.door.blockers.join() === fromSave.door.blockers.join(), JSON.stringify({ a: picture.door, b: fromSave.door }));

        // A save from before positions were kept (0.1.14, or solo): the plugin's table is all it has.
        await save(a, 2);
        await waitFor(b, () => StorageManager.exists(2), 8000, 'B saved alongside again');
        const runOld = await a.evaluate(() => Coop.world.runId);
        await bothToTitle(a, b);
        const dirOld = path.join(s.server.saves, 'runs', String(runOld).replace(/[^\w-]/g, ''));
        const wipeOld = () => { if (fs.existsSync(dirOld)) for (const name of fs.readdirSync(dirOld)) if (/^world(@\d+)?\.json$/.test(name)) fs.unlinkSync(path.join(dirOld, name)); };
        wipeOld();
        await sleep(1500);
        wipeOld();
        await a.evaluate(() => { const c = JsonEx.parse(StorageManager.load(2)); delete c.coop.el; StorageManager.save(2, JsonEx.stringify(c)); });
        await load(a, 2);
        await waitFor(a, onMapLive, 30000, 'A reloads the older save');
        const seeded = await a.evaluate((ids) => ids.map((id) => { const p = Coop.world.el['3,' + id]; return p ? p.join() : ''; }), IDS);
        check('a save from before positions were kept still tells where the shelves stand', IDS.every((id, i) => seeded[i] === picture.at[id].join()), JSON.stringify(seeded));
        await fresh(b, 3, 28, 67);
        await waitFor(b, () => Coop.world.el['3,119'], 8000, 'B is told the shelves from the older save').catch(() => {});
        await go(b, 3, 32, 40);
        const fromOld = await readSpots(b);
        check('B has them too', sameAt(picture, fromOld), JSON.stringify(fromOld.at));

        // An owner's arrival picture with the shelf on its old square: the square is ignored, the erase is not.
        const erased = await b.evaluate(() => {
            const ev = $gameMap.event(119);
            const home = ev.event();
            const at = [ev.x, ev.y];
            Coop.emit('to:evall', { from: 0, m: 3, e: [[119, home.x, home.y, 2, 3, 1]] });
            const out = { erased: !!ev._erased, stayed: ev.x === at[0] && ev.y === at[1] };
            ev._erased = false;
            ev.refresh();
            return out;
        });
        check('an arrival picture still erases what it says is erased, and does not move a kept shelf home', erased.erased && erased.stayed, JSON.stringify(erased));

        // A world with no positions in it (its founder loaded a save from before they were kept):
        // the same run's stay and are told to it; another run's go, with its flags.
        const noEl = (id) => b.evaluate((run) => {
            const w = { sw: {}, va: {}, ss: {}, el: {} };
            $gameSwitches._data.forEach((on, i) => { if (on && Coop.world.isShared('sw', i)) w.sw[i] = 1; });
            $gameVariables._data.forEach((v, i) => { if (v && Coop.world.isShared('va', i)) w.va[i] = v; });
            for (const k in $gameSelfSwitches._data) if (Coop.world.isShared('ss', k)) w.ss[k] = 1;
            Coop.emit('world', { runId: run || Coop.world.runId, world: w, mode: 'join', balance: true });
            return { el: Object.keys(Coop.world.el).length, x: $gameMap.event(119).x };
        }, id);
        const same = await noEl('');
        check('joining the same run keeps its kept locations', same.el === 7 && same.x === 17, JSON.stringify(same));
        const other = await noEl('another-run');
        check('joining another run drops them', other.el === 0 && other.x === 16, JSON.stringify(other));
    } catch (e) {
        console.error(e);
        check('test ran to the end', false, e && e.message);
    }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
