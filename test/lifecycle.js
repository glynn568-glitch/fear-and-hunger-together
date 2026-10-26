// Coming and going in a live run: what a save, a new character, a crashed tab
// and a dropped fight are and are not allowed to do to the shared world.
const { openPlayer, waitFor, sleep } = require('./lib');
const { twoPlayers, checker } = require('./common');
const install = require('./helpers');

const titleReady = () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected;
const toast = (page) => page.evaluate(() => document.getElementById('coop-toast').textContent);
const resume = (page) => page.evaluate(() => document.getElementById('coop-resume').style.display !== 'none');
async function hold(page, code, ms) { await page.keyboard.down(code); await sleep(ms); await page.keyboard.up(code); await sleep(250); }
async function reopen(browser, port, name, label) {
    const page = await openPlayer(browser, `http://localhost:${port}/?name=${name}`, label);
    await waitFor(page, titleReady, 90000, label + ' at the title');
    await page.evaluate(install);
    return page;
}

(async () => {
    const check = checker();
    const port = 8458;
    let s;
    let a, b;
    try {
        s = await twoPlayers(port);
        ({ a, b } = s);
        const { browser } = s;

        //--- the first throw of a floor's dice stands ---
        await a.evaluate(() => $gameVariables.setValue(24, 2));
        // B throws only once A's throw has reached the world (B has heard it), so A's is the first.
        await waitFor(b, () => $gameVariables.value(24) === 2, 10000, 'A\'s throw reaches B');
        await b.evaluate(() => $gameVariables.setValue(24, 1));
        await sleep(600);
        const rolled = [await a.evaluate(() => $gameVariables.value(24)), await b.evaluate(() => $gameVariables.value(24))];
        check('a floor is rolled once per world: the second roll is undone', rolled[0] === 2 && rolled[1] === 2, 'A ' + rolled[0] + ', B ' + rolled[1]);

        //--- a bed save, then B dies and tries to load it back into the live run ---
        await b.evaluate(() => { $gameParty.gainItem($dataItems[1], 2); $gameParty.gainItem($dataWeapons[1], 1); $gameParty.gainItem($dataItems[59], 300); });
        await a.evaluate(() => { $gameSystem.onBeforeSave(); DataManager.saveGame(1); });
        await waitFor(b, () => StorageManager.exists(1), 8000, 'B saved alongside');
        await b.evaluate(() => SceneManager.goto(Scene_Gameover));
        await waitFor(b, () => SceneManager._scene instanceof Scene_CoopDead, 8000, 'B dead');
        await sleep(1000);
        const before = await a.evaluate(() => ({ items: $gameParty.numItems($dataItems[1]), weapons: $gameParty.numItems($dataWeapons[1]), coins: $gameParty.numItems($dataItems[59]) }));
        await hold(b, 'Escape', 2600);
        await waitFor(b, () => SceneManager._scene instanceof Scene_Title, 10000, 'B gave the character up');
        await waitFor(a, (n) => $gameParty.numItems($dataItems[1]) === n + 2, 8000, 'A inherits', before.items);
        const got = await a.evaluate(() => ({ items: $gameParty.numItems($dataItems[1]), weapons: $gameParty.numItems($dataWeapons[1]), coins: $gameParty.numItems($dataItems[59]) }));
        check('what a given-up character carried and wore passes to the partner, 300 coins and all', got.items === before.items + 2 && got.weapons >= before.weapons + 1 && got.coins === Math.min(999, before.coins + 300) && /What they carried is yours now/.test(await toast(a)), JSON.stringify(before) + ' -> ' + JSON.stringify(got));

        await b.evaluate(() => { DataManager.loadGame(1); $gamePlayer.reserveTransfer($gameMap.mapId(), $gamePlayer.x, $gamePlayer.y); $gamePlayer.requestMapReload(); SceneManager.goto(Scene_Map); });
        await waitFor(b, () => SceneManager._scene instanceof Scene_Title && !SceneManager.isSceneChanging(), 20000, 'B is sent back to the title');
        check('a save cannot be loaded back into a run its owner already took part in', !(await b.evaluate(() => Coop.world.live)) && /cannot be loaded into it/.test(await toast(b)), await toast(b));
        check('and A never sees the old body', await a.evaluate(() => Coop.peersHere().length) === 0);

        //--- B comes back as someone new: the world is A's, nothing is poured in ---
        await b.evaluate(() => T.quickStart(4, 28, 67));
        await waitFor(b, () => T.onMap(), 60000, 'B as the dark priest');
        await b.evaluate(() => { T.settle(); $gameSwitches._data[27] = true; $gameVariables._data[121] = 7; T.begin(); });
        await waitFor(b, () => Coop.world.live, 10000, 'B live as a new character');
        await sleep(600);
        const joined = await b.evaluate(() => ({ sw: $gameSwitches.value(27), va: $gameVariables.value(121) }));
        check('a newcomer takes the world as it is and adds nothing of their own', joined.sw === false && joined.va === await a.evaluate(() => $gameVariables.value(121)) && !(await a.evaluate(() => $gameSwitches.value(27))), JSON.stringify(joined));
        const fa = await a.evaluate(() => Coop.world.fingerprint()), fb = await b.evaluate(() => Coop.world.fingerprint());
        check('both machines agree about the world', fa === fb);

        //--- B drops out of A's fight; the result waits for them ---
        await b.evaluate(() => Coop.parkNow());
        await sleep(400);
        await a.evaluate(() => { BattleManager.setup(1, true, true); SceneManager.push(Scene_Battle); });
        await waitFor(a, () => BattleManager._phase === 'input' && Coop.battle && Coop.battle.guests.size === 1, 25000, 'B in the fight as a guest');
        await sleep(600);
        await b.close({ runBeforeUnload: false });
        await waitFor(a, () => Coop.peers.size === 0, 8000, 'B vanishes mid-fight');
        await a.evaluate(() => { $gameActors.actor(4).setHp(22); BattleManager.abort(); });
        await waitFor(a, () => SceneManager._scene instanceof Scene_Map && !Coop.battle, 15000, 'the fight ends without B');
        check("A's party is their own again", await a.evaluate(() => $gameParty._actors.join()) === '1');
        b = await reopen(browser, port, 'Bo', 'B2');
        await waitFor(b, () => document.getElementById('coop-resume').style.display !== 'none', 8000, 'B is offered to carry on');
        await hold(b, 'KeyR', 120);
        await waitFor(b, () => SceneManager._scene instanceof Scene_Map && SceneManager._scene.isActive() && Coop.world.live, 30000, 'B carries on');
        await waitFor(b, () => $gameActors.actor(4).hp === 22, 8000, 'the fight catches up with B');
        check('a guest who dropped out comes back with what the fight did to them', /ended without you/.test(await toast(b)));

        //--- carrying on works once ---
        await b.evaluate(() => SceneManager.goto(Scene_Title));
        await waitFor(b, titleReady, 15000, 'B at the title on purpose');
        await sleep(1500);
        check('going back to the title on purpose leaves nothing to carry on from', !(await resume(b)));

        //--- dropping out while dead: still dead ---
        await b.evaluate(() => T.quickStart(5, 28, 67));
        await waitFor(b, () => T.onMap(), 60000, 'B as the outlander');
        await b.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(b, () => Coop.world.live, 10000, 'B live');
        await sleep(500);
        await b.evaluate(() => Coop.parkNow());
        await b.evaluate(() => SceneManager.goto(Scene_Gameover));
        await waitFor(b, () => SceneManager._scene instanceof Scene_CoopDead, 8000, 'B dead');
        await waitFor(a, () => Coop.others()[0] && Coop.others()[0].st === 'dead', 8000, 'the server knows');
        await b.close({ runBeforeUnload: false });
        await waitFor(a, () => Coop.peers.size === 0, 8000, 'B vanishes while dead');
        b = await reopen(browser, port, 'Bo', 'B3');
        await waitFor(b, () => document.getElementById('coop-resume').style.display !== 'none', 8000, 'B is offered to carry on');
        await hold(b, 'KeyR', 120);
        await waitFor(b, () => SceneManager._scene instanceof Scene_CoopDead, 30000, 'B carries on, dead');
        check('someone who vanished while dead comes back dead, and can still be called back', await b.evaluate(() => Coop.dead && Coop.world.live));

        //--- dropping out of your own fight is not an escape ---
        await b.evaluate(() => { Coop.dead = false; SceneManager.goto(Scene_Title); });
        await waitFor(b, titleReady, 15000, 'B at the title');
        await b.evaluate(() => T.quickStart(5, 28, 67));
        await waitFor(b, () => T.onMap(), 60000, 'B again');
        await b.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(b, () => Coop.world.live, 10000, 'B live again');
        await a.evaluate(() => { $gamePlayer.setThrough(true); $gamePlayer.locate(27, 40); $gamePlayer.setThrough(false); }); // out of joining range
        await sleep(700);
        await b.evaluate(() => Coop.parkNow());
        await b.evaluate(() => { BattleManager.setup(1, true, true); SceneManager.push(Scene_Battle); });
        await waitFor(b, () => SceneManager._scene instanceof Scene_Battle && BattleManager._phase === 'input', 20000, 'B in a fight of their own');
        await waitFor(a, () => Coop.others()[0] && Coop.others()[0].st === 'battle', 8000, 'the server knows');
        await b.close({ runBeforeUnload: false });
        await waitFor(a, () => Coop.peers.size === 0, 8000, 'B vanishes from their own fight');
        b = await reopen(browser, port, 'Bo', 'B4');
        await waitFor(b, () => document.getElementById('coop-resume').style.display !== 'none', 8000, 'B is offered to carry on');
        await hold(b, 'KeyR', 120);
        await waitFor(b, () => SceneManager._scene instanceof Scene_Map && SceneManager._scene.isActive() && Coop.world.live, 30000, 'B carries on');
        check('vanishing from a fight of your own brings you back barely alive', await b.evaluate(() => $gameParty.leader().hp) === 1 && /barely alive/.test(await toast(b)));
        s.b = b;
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish([a, b].filter(Boolean));
    if (s) await s.close();
    process.exit(code);
})();
