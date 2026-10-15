// Step 7: dying, being called back at a ritual circle, saving together,
// the run ending when nobody is left, and reloading to the saved moment.
const fs = require('fs');
const path = require('path');
const { twoPlayers, checker, sleep, waitFor } = require('./common');
const { shot } = require('./lib');

async function press(page, code) {
    await page.keyboard.down(code); await sleep(130); await page.keyboard.up(code); await sleep(250);
}

(async () => {
    const check = checker();
    let s;
    try {
        s = await twoPlayers(8437);
        const { a, b, idA, idB, server } = s;

        // Save first, so there is a moment to come back to.
        await a.evaluate(() => { $gameSystem.onBeforeSave(); DataManager.saveGame(1); });
        await waitFor(b, () => StorageManager.exists(1), 8000, 'B saved alongside A');
        const files = ['players/ann/file1.rpgsave', 'players/ann/global.rpgsave', 'players/bo/file1.rpgsave'].map((f) => fs.existsSync(path.join(server.saves, f)));
        const runs = fs.readdirSync(path.join(server.saves, 'runs'));
        const frozen = fs.readdirSync(path.join(server.saves, 'runs', runs[0])).filter((f) => f.startsWith('world@'));
        check('one save by A puts both players and the world on the host', files.every(Boolean) && frozen.length === 1, JSON.stringify(files) + ' ' + frozen);

        // B dies while A lives, of hunger: the game keeps hunger as experience points.
        await b.evaluate(() => { $gameParty.leader().changeExp(40, false); SceneManager.goto(Scene_Gameover); });
        await waitFor(b, () => SceneManager._scene instanceof Scene_CoopDead, 8000, 'B in the dead scene');
        await waitFor(b, () => Coop.viewer.active && Coop.viewer.frames > 3, 10000, 'B watching A');
        check('B is dead and watching A instead of a game over', await b.evaluate(() => Coop.dead));
        await waitFor(a, (id) => Coop.peers.get(id).st === 'dead', 5000, 'A knows B is dead', idB);
        check('A no longer sees the dead player walking around', await a.evaluate(() => Coop.peersHere().length) === 0);
        console.log('screenshot', await shot(b, 'dead-b'));

        // A walks to the first ritual circle and uses it.
        const circle = await a.evaluate(() => { const e = $gameMap.events().find((ev) => /^circle\d/.test(ev.event().name) && ev.event().pages.length >= 20); return { id: e._eventId, x: e.x, y: e.y }; });
        await a.evaluate((c) => { $gamePlayer.locate(c.x, c.y); }, circle);
        await sleep(400);
        await a.evaluate((c) => { $gameMap.event(c.id).start(); }, circle);
        await waitFor(a, () => $gameMessage.isBusy(), 5000, 'the circle offers the choice');
        await sleep(1500);
        console.log('screenshot', await shot(a, 'circle-choice'));
        await press(a, 'ArrowUp');
        await press(a, 'ArrowUp');
        await press(a, 'KeyZ');
        await waitFor(b, () => SceneManager._scene instanceof Scene_Map && !SceneManager.isSceneChanging(), 15000, 'B back on the map');
        check('someone who starved comes back hungry, not starving', await b.evaluate(() => $gameParty.leader().currentExp()) === 100);
        const back = await b.evaluate(() => ({ dead: Coop.dead, hp: $gameParty.leader().hp, x: $gamePlayer.x, y: $gamePlayer.y, view: Coop.viewer.active, sw: $gameSwitches.value(409) }));
        check('B is called back at the circle with 1 HP', !back.dead && back.hp === 1 && back.x === circle.x && back.y === circle.y && !back.view, JSON.stringify(back));
        check('the circle is spent for both players', back.sw && await a.evaluate(() => $gameSwitches.value(409)));
        await sleep(600);
        check('A stopped streaming once B was back', await a.evaluate(() => Coop.stream.watchers.size) === 0);
        check('A sees B again', await a.evaluate(() => Coop.peersHere().length) === 1);

        // A spent circle makes no second offer.
        await b.evaluate(() => SceneManager.goto(Scene_Gameover));
        await waitFor(b, () => SceneManager._scene instanceof Scene_CoopDead, 8000, 'B dead again');
        await sleep(500);

        // Now A dies too: nobody is left, so the run ends for both.
        await a.evaluate(() => { $gameMap._interpreter.clear(); $gameMessage.clear(); SceneManager.goto(Scene_Gameover); });
        await waitFor(a, () => SceneManager._scene instanceof Scene_Gameover, 8000, 'A gets the real game over');
        await waitFor(b, () => SceneManager._scene instanceof Scene_Gameover, 10000, 'B gets the real game over');
        check('with nobody alive, both get the real game over', true);

        // Back to the title, then both reload the save.
        for (const p of [a, b]) {
            await p.evaluate(() => SceneManager.goto(Scene_Title));
            await waitFor(p, () => SceneManager._scene instanceof Scene_Title && !SceneManager.isSceneChanging(), 15000, 'title');
        }
        await sleep(500);
        check('Continue is offered from the saves on the host', await a.evaluate(() => DataManager.isAnySavefileExists()) && await b.evaluate(() => DataManager.isAnySavefileExists()));
        for (const p of [a, b]) {
            await p.evaluate(() => { DataManager.loadGame(1); $gamePlayer.reserveTransfer($gameMap.mapId(), $gamePlayer.x, $gamePlayer.y); $gamePlayer.requestMapReload(); SceneManager.goto(Scene_Map); });
            await waitFor(p, () => SceneManager._scene instanceof Scene_Map && Coop.world.live, 20000, 'reloaded and live');
        }
        await sleep(800);
        const ra = await a.evaluate(() => ({ sw: $gameSwitches.value(409), x: $gamePlayer.x, y: $gamePlayer.y, party: $gameParty._actors.join(), dead: Coop.dead }));
        const rb = await b.evaluate(() => ({ sw: $gameSwitches.value(409), x: $gamePlayer.x, y: $gamePlayer.y, party: $gameParty._actors.join(), hp: $gameParty.leader().hp, dead: Coop.dead }));
        check('the reload rolls the world back: the circle is whole again', !ra.sw && !rb.sw, JSON.stringify(ra) + ' ' + JSON.stringify(rb));
        check('both are back where they saved, as themselves', ra.x === 27 && ra.y === 67 && ra.party === '1' && rb.x === 28 && rb.party === '3' && rb.hp > 1);
        const fa = await a.evaluate(() => Coop.world.fingerprint()), fb = await b.evaluate(() => Coop.world.fingerprint());
        check('shared state identical after the reload', fa === fb);
        check('they see each other again', await a.evaluate(() => Coop.peersHere().length) === 1 && await b.evaluate(() => Coop.peersHere().length) === 1);
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
