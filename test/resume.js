// Carrying a run on another day: whoever loads first decides the moment, and
// everyone after them ends up on their own save from that same moment,
// whichever one they picked. Someone who was dead at that save comes back dead.
const { twoPlayers, checker, sleep, waitFor, sees } = require('./common');

const titleReady = () => window.SceneManager && SceneManager._scene instanceof Scene_Title && !SceneManager.isSceneChanging() && window.Coop && Coop.connected;
const onMapLive = () => SceneManager._scene instanceof Scene_Map && SceneManager._scene.isActive() && Coop.world.live;
const toast = (page) => page.evaluate(() => document.getElementById('coop-toast').textContent);
const banner = (page) => page.evaluate(() => document.getElementById('coop-dead').textContent);
const load = (page, slot) => page.evaluate((n) => { DataManager.loadGame(n); SceneManager.goto(Scene_Map); $gameSystem.onAfterLoad(); }, slot);
const save = (page, slot) => page.evaluate((n) => { $gameSystem.onBeforeSave(); DataManager.saveGame(n); }, slot);
// Only these slots are known to the player; the rest are as if never saved.
const keepOnly = (page, slots) => page.evaluate((keep) => {
    window._info = window._info || JSON.stringify(DataManager.loadGlobalInfo());
    const info = JSON.parse(window._info);
    for (let i = 1; i < info.length; i++) if (keep.indexOf(i) < 0) info[i] = null;
    DataManager.saveGlobalInfo(info);
}, slots);
async function bothToTitle(a, b) {
    for (const p of [a, b]) await p.evaluate(() => { if (!(SceneManager._scene instanceof Scene_Title)) SceneManager.goto(Scene_Title); });
    for (const p of [a, b]) await waitFor(p, titleReady, 20000, p.label + ' at the title');
    for (const p of [a, b]) await waitFor(p, () => !Coop.world.on && !Coop.world.live, 8000, p.label + ' knows the run has stopped');
    await sleep(300);
}

(async () => {
    const check = checker();
    let s;
    try {
        s = await twoPlayers(8459);
        const { a, b } = s;

        //--- three beds: the second after B picks something up, the third after B dies ---
        await save(a, 1);
        await waitFor(b, () => StorageManager.exists(1), 8000, 'B saved alongside (1)');
        await b.evaluate(() => $gameParty.gainItem($dataItems[2], 5));
        await sleep(300);
        await save(a, 2);
        await waitFor(b, () => StorageManager.exists(2), 8000, 'B saved alongside (2)');
        await b.evaluate(() => SceneManager.goto(Scene_Gameover));
        await waitFor(b, () => SceneManager._scene instanceof Scene_CoopDead, 8000, 'B dead');
        await waitFor(a, () => Coop.others()[0] && Coop.others()[0].st === 'dead', 8000, 'A knows');
        await save(a, 3);
        await waitFor(b, () => StorageManager.exists(3), 8000, 'B saved while dead');
        check('someone dead is saved along with the living, as dead', /saved with them as you are, in your slot 3/.test(await toast(b)), await toast(b));
        const stamps = await a.evaluate(() => DataManager.loadGlobalInfo().map((i) => i && i.coopStamp));
        const same = await b.evaluate(() => DataManager.loadGlobalInfo().map((i) => i && i.coopStamp));
        check('both hold a save from each of the three moments', stamps[1] && stamps[2] > stamps[1] && stamps[3] > stamps[2] && same[1] === stamps[1] && same[2] === stamps[2] && same[3] === stamps[3], JSON.stringify(stamps) + ' ' + JSON.stringify(same));

        //--- A carries on from the last bed; B picks the wrong save ---
        await bothToTitle(a, b);
        await load(a, 3);
        await waitFor(a, onMapLive, 30000, 'A carries on from the third bed');
        check('the first one in is told which moment the world is from', /The world is as it was at the save of/.test(await toast(a)) && !/saved again/.test(await toast(a)), await toast(a));
        await waitFor(b, () => Coop.world.on, 5000, 'B hears which run is on');
        // A's line drops for a moment while alone in the run; the moment it was carried on from is not forgotten.
        await a.evaluate(() => Coop._ws.close());
        await sleep(300);
        await waitFor(a, () => Coop.connected && Coop.world.live, 15000, 'A reconnects');
        await load(b, 1);
        await waitFor(b, () => SceneManager._scene instanceof Scene_CoopDead && Coop.world.live, 30000, "B ends up on the third bed's save");
        check('a different save of the same run is swapped for the right one', /Ann has carried this run on from the save of .*You are on yours from that same moment \(slot 3\)/s.test(await toast(b)), await toast(b));
        check('B was dead at that bed and is dead now', await b.evaluate(() => Coop.dead && $gameParty.numItems($dataItems[2]) === 5));
        await waitFor(a, () => Coop.others()[0] && Coop.others()[0].st === 'dead', 8000, 'A sees B dead');
        await waitFor(b, () => /can call you back at a ritual circle/.test(document.getElementById('coop-dead').textContent), 8000, 'B is watching A');
        await a.evaluate(() => Coop.sendTo(Coop.others()[0].id, 'revive', { m: $gameMap.mapId(), x: $gamePlayer.x, y: $gamePlayer.y + 1, by: Coop.name }));
        await waitFor(b, onMapLive, 20000, 'B is called back');
        check('and can still be called back', await b.evaluate(() => !Coop.dead && $gameParty.leader().hp === 1));

        //--- the dead one loads first and waits ---
        await bothToTitle(a, b);
        await load(b, 3);
        await waitFor(b, () => SceneManager._scene instanceof Scene_CoopDead && Coop.world.waiting, 30000, 'B loads the save they were dead in');
        await sleep(6000);
        check('loading alone as the dead one waits for a partner; it is not the end of the run', await b.evaluate(() => SceneManager._scene instanceof Scene_CoopDead && Coop.dead) && /You were dead when this was saved.*Hold Esc to go back to the title/.test(await banner(b)), await banner(b));
        check('and does not decide which moment the run is carried on from', await b.evaluate(() => !Coop.world.live) && await a.evaluate(() => !Coop.world.on));
        await load(a, 3);
        await waitFor(a, onMapLive, 30000, 'A carries on from the third bed');
        await waitFor(b, () => Coop.world.live && /Ann can call you back at a ritual circle/.test(document.getElementById('coop-dead').textContent), 12000, 'B is let in and watches A');
        check('once someone alive carries the run on, the dead one is in it and watching them', await b.evaluate(() => Coop.dead && SceneManager._scene instanceof Scene_CoopDead));
        // A leaves again: B goes back to waiting; it is still not the end.
        await a.evaluate(() => SceneManager.goto(Scene_Title));
        await sleep(7000);
        check('the partner leaving again is not the end of the run either', await b.evaluate(() => SceneManager._scene instanceof Scene_CoopDead && Coop.dead) && /You were dead when this was saved/.test(await banner(b)), await banner(b));
        await b.keyboard.down('Escape'); await sleep(2600); await b.keyboard.up('Escape');
        await waitFor(b, titleReady, 15000, 'B back at the title');
        check('holding Esc there goes back to the title and leaves the save alone', /Your save is as it was/.test(await toast(b)) && await b.evaluate(() => StorageManager.exists(3)), await toast(b));

        //--- the first one in picks an old save: they are told, and the other follows ---
        await bothToTitle(a, b);
        await load(a, 1);
        await waitFor(a, onMapLive, 30000, 'A carries on from the first bed');
        check('loading an older save says a later one exists, and where', /saved again after that, on .*\(your slot 3\)/s.test(await toast(a)), await toast(a));
        await waitFor(b, () => Coop.world.on, 5000, 'B hears which run is on');
        // Saves from before slots were labelled with their moment: the label is read back from the file.
        await b.evaluate(() => { const info = DataManager.loadGlobalInfo(); for (const i of info) if (i) delete i.coopStamp; DataManager.saveGlobalInfo(info); });
        await waitFor(b, () => /has carried on a run you share/.test(document.getElementById('coop-hud').textContent), 5000, 'the title screen says so').catch(() => {});
        const hint = await b.evaluate(() => ({ first: Scene_Load.prototype.firstSavefileIndex.call({}), hud: document.getElementById('coop-hud').textContent }));
        check('Continue opens on the matching save', hint.first === 0 && /Ann has carried on a run you share/.test(hint.hud), JSON.stringify(hint));
        await load(b, 3);
        await waitFor(b, onMapLive, 30000, "B ends up on the first bed's save");
        const body = await b.evaluate(() => ({ dead: Coop.dead, alive: $gameParty.leader().isAlive(), hp: $gameParty.leader().hp, items: $gameParty.numItems($dataItems[2]), stamp: Coop.world.saveStamp }));
        check('B is as they were at the first bed: alive, without what came later', !body.dead && body.alive && body.items === 0 && /slot 1/.test(await toast(b)), JSON.stringify(body) + ' ' + await toast(b));
        check('both machines agree about the world', await a.evaluate(() => Coop.world.fingerprint()) === await b.evaluate(() => Coop.world.fingerprint()));

        //--- nothing from that moment, only later: kept out ---
        await bothToTitle(a, b);
        await keepOnly(b, [3]);
        await load(a, 1);
        await waitFor(a, onMapLive, 30000, 'A on the first bed');
        await load(b, 3);
        await waitFor(b, () => SceneManager._scene instanceof Scene_Title && !SceneManager.isSceneChanging(), 30000, 'B is sent back to the title');
        check('a save from later than the run was carried on from cannot come in', !(await b.evaluate(() => Coop.world.live)) && /from an earlier save .* than yours, and you have none from then/s.test(await toast(b)), await toast(b));
        check('and A never sees them', await a.evaluate(() => Coop.peersHere().length) === 0);

        //--- nothing from that moment, only earlier: comes in as they were ---
        await bothToTitle(a, b);
        await keepOnly(b, [1]);
        await load(a, 2);
        await waitFor(a, onMapLive, 30000, 'A on the second bed');
        await load(b, 1);
        await waitFor(b, onMapLive, 30000, 'B joins from the first bed');
        check('someone who was not there for the later save joins as they last were, and is told', /later save than any of yours/.test(await toast(b)), await toast(b));
        check('they see each other', (await sees(a, 1)) && (await sees(b, 1)));
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
