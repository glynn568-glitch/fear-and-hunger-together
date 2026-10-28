// Step 7: dying, being called back at a ritual circle, saving together,
// the run ending when nobody is left, and reloading to the saved moment.
const fs = require('fs');
const path = require('path');
const { twoPlayers, checker, sleep, waitFor, sees } = require('./common');
const { shot } = require('./lib');

async function press(page, code) {
    await page.keyboard.down(code); await sleep(130); await page.keyboard.up(code); await sleep(250);
}

(async () => {
    const check = checker();
    let s;
    try {
        s = await twoPlayers(8437);
        const { a, b, idA, idB, server, joiner } = s;

        // Save first, so there is a moment to come back to.
        await a.evaluate(() => { $gameSystem.onBeforeSave(); DataManager.saveGame(1); });
        await waitFor(b, () => StorageManager.exists(1), 8000, 'B saved alongside A');
        // A friend joining from their own PC keeps their saves there.
        const files = [[server, 'players/ann/file1.rpgsave'], [server, 'players/ann/global.rpgsave'], [joiner || server, 'players/bo/file1.rpgsave']].map(([srv, f]) => fs.existsSync(path.join(srv.saves, f)));
        const runs = fs.readdirSync(path.join(server.saves, 'runs'));
        const frozen = fs.readdirSync(path.join(server.saves, 'runs', runs[0])).filter((f) => f.startsWith('world@'));
        check('one save by A saves both players, and the world on the host', files.every(Boolean) && frozen.length === 1, JSON.stringify(files) + ' ' + frozen);

        // B dies while A lives, of hunger: the game keeps hunger as experience points. B has
        // lost both legs and both arms too, which the game marks as "disabled" (switch 41; the marathon found it).
        await b.evaluate(() => { $gameParty.leader().changeExp(40, false); for (const id of [248, 249, 250, 251, 41]) $gameSwitches._data[id] = true; SceneManager.goto(Scene_Gameover); });
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
        // With no limbs B would only quit breathing again: the circle asks A for one of theirs.
        await waitFor(a, () => $gameMessage.isBusy() && /no limbs left/.test($gameMessage.allText()), 8000, 'the circle asks for a limb');
        await waitFor(a, () => SceneManager._scene._messageWindow._choiceWindow.active, 8000, 'the limb choice open');
        await sleep(300);
        console.log('screenshot', await shot(a, 'circle-limb'));
        const waiting = await b.evaluate(() => ({ dead: Coop.dead, scene: SceneManager._scene.constructor.name })), whole = await a.evaluate(() => !$gameSwitches.value(409));
        check('a body with no limbs is not called back for free', waiting.dead && waiting.scene === 'Scene_CoopDead' && whole, JSON.stringify(waiting));
        // Stepping away costs nothing; using the circle again asks again.
        await press(a, 'KeyZ');
        await sleep(1500);
        const kept = await a.evaluate(() => ({ circle: !$gameSwitches.value(409), arms: [36, 37].map((id) => $gameSwitches.value(id)), msg: $gameMessage.isBusy() }));
        check('stepping away leaves the circle whole and A in one piece', kept.circle && !kept.arms.some(Boolean) && !kept.msg && await b.evaluate(() => Coop.dead), JSON.stringify(kept));
        await a.evaluate((c) => { $gameMap.event(c.id).start(); }, circle);
        await waitFor(a, () => SceneManager._scene._messageWindow._choiceWindow.active, 8000, 'the circle offers the choice again');
        await sleep(600); // the window opens before it takes keys
        await press(a, 'ArrowUp');
        await press(a, 'ArrowUp');
        await press(a, 'KeyZ');
        await waitFor(a, () => SceneManager._scene._messageWindow._choiceWindow.active && /no limbs left/.test($gameMessage.allText()), 8000, 'the circle asks for a limb again');
        await sleep(300);
        await press(a, 'ArrowUp');
        await press(a, 'ArrowUp');
        await press(a, 'KeyZ'); // Give an arm
        await waitFor(b, () => SceneManager._scene instanceof Scene_Map && !SceneManager.isSceneChanging(), 15000, 'B back on the map');
        check('someone who starved comes back hungry, not starving', await b.evaluate(() => $gameParty.leader().currentExp()) === 100);
        const back = await b.evaluate(() => ({ dead: Coop.dead, hp: $gameParty.leader().hp, x: $gamePlayer.x, y: $gamePlayer.y, view: Coop.viewer.active, sw: $gameSwitches.value(409) }));
        check('B is called back at the circle with 1 HP', !back.dead && back.hp === 1 && back.x === circle.x && back.y === circle.y && !back.view, JSON.stringify(back));
        check('the circle is spent for both players', back.sw && await a.evaluate(() => $gameSwitches.value(409)));
        await sleep(600);
        await sleep(1500); // common events 40 and 240 run meanwhile
        const body = await b.evaluate(() => ({ lost: [248, 249, 250, 251].map((id) => $gameSwitches.value(id)), disabled: $gameSwitches.value(41), msg: $gameMessage.allText() }));
        check('B comes back with one arm, legs still gone, not "unable to move"', JSON.stringify(body.lost) === '[true,false,true,true]' && !body.disabled && !/unable to move/.test(body.msg), JSON.stringify(body));
        const giver = await a.evaluate(() => ({ arm1: $gameSwitches.value(36), arm2: $gameSwitches.value(37), cut: $gameParty.leader().isStateAffected(3), bleeding: $gameParty.leader().isStateAffected(5) }));
        check('the arm was taken from A by the game, and A bleeds', giver.arm1 && !giver.arm2 && !giver.cut && giver.bleeding, JSON.stringify(giver));
        check('A stopped streaming once B was back', await a.evaluate(() => Coop.stream.watchers.size) === 0);
        check('A sees B again', await sees(a, 1));

        // A spent circle makes no second offer.
        await b.evaluate(() => SceneManager.goto(Scene_Gameover));
        await waitFor(b, () => SceneManager._scene instanceof Scene_CoopDead, 8000, 'B dead again');
        await sleep(500);
        // Two soul stones call them back in the circle's place, even at a spent circle; one is not
        // enough, and on Hard there is no such undo.
        await waitFor(a, (id) => Coop.peers.get(id).st === 'dead', 5000, 'A knows B is dead again', idB);
        await a.evaluate((c) => { $gameMap._interpreter.clear(); $gameMessage.clear(); $gameParty.gainItem($dataItems[115], 2); $gameMap.event(c.id).start(); }, circle);
        await waitFor(a, () => SceneManager._scene._messageWindow._choiceWindow.active, 8000, 'the spent circle offers a call with the soul stone');
        const stoneOffer = await a.evaluate(() => $gameMessage.allText());
        await sleep(1500);
        await press(a, 'ArrowUp');
        await press(a, 'ArrowUp');
        await press(a, 'KeyZ');
        await waitFor(b, () => !Coop.dead && SceneManager._scene instanceof Scene_Map, 15000, 'B back by the soul stone');
        await sleep(600);
        const stone = await a.evaluate(() => ({ stones: $gameParty.numItems($dataItems[115]), spent: $gameSwitches.value(409) }));
        check('two soul stones call B back at a spent circle and are used up in its place', /soul stones/.test(stoneOffer) && stone.stones === 0 && stone.spent, stoneOffer + ' ' + JSON.stringify(stone));

        // The stones leave the bag when the call goes out: none to hand over while B's machine
        // answers (that was a free call at a spent circle), and a call nobody answers gives them back.
        const callWithStones = async () => {
            await waitFor(a, () => SceneManager._scene._messageWindow.isClosed() && !$gameMessage.isBusy() && !$gameMap.isEventRunning(), 8000, 'the last message shut');
            await a.evaluate((c) => { $gameMap.event(c.id).start(); }, circle);
            await waitFor(a, () => SceneManager._scene._messageWindow._choiceWindow.active && /soul stones/.test($gameMessage.allText()), 8000, 'the spent circle offers the stones again');
            await sleep(1500);
            await press(a, 'ArrowUp');
            await press(a, 'ArrowUp');
            await press(a, 'KeyZ');
        };
        await b.evaluate(() => SceneManager.goto(Scene_Gameover));
        await waitFor(b, () => SceneManager._scene instanceof Scene_CoopDead, 8000, 'B dead before the stone calls');
        await sleep(500);
        await waitFor(a, (id) => Coop.peers.get(id).st === 'dead', 5000, 'A knows B is dead before the stone calls', idB);
        // The unanswered call idles A for 7 s: long enough for a wanderer to walk into a fight.
        await a.evaluate(() => { $gameParty.gainItem($dataItems[115], 2); $gameMap.events().forEach((e) => { if (e.page() && (e._trigger === 1 || e._trigger === 2)) e.erase(); }); });
        await a.evaluate(() => { const send = Coop.sendTo; window._sendTo = send; Coop.sendTo = (id, type, msg) => type === 'revive' ? null : send(id, type, msg); });
        await callWithStones();
        const unanswered = { during: await a.evaluate(() => $gameParty.numItems($dataItems[115])) };
        await sleep(7000);
        unanswered.after = await a.evaluate(() => { Coop.sendTo = window._sendTo; return $gameParty.numItems($dataItems[115]); });
        check('a stone call nobody answers holds the stones meanwhile and gives them back', unanswered.during === 0 && unanswered.after === 2 && await b.evaluate(() => Coop.dead), JSON.stringify(unanswered));
        // What is still in the bag the moment the call goes out could be handed over before the answer.
        await a.evaluate(() => { const send = Coop.sendTo; Coop.sendTo = (id, type, msg) => { if (type === 'revive') { window._handed = $gameParty.numItems($dataItems[115]); Coop.sendTo = send; } return send(id, type, msg); }; });
        // A's map has a tileset a door gave it (as in the Ancient city): B is called back into the same walls.
        const ts0 = await a.evaluate(() => { const t = $gameMap.tilesetId(); $gameMap.changeTileset(t === 30 ? 28 : 30); return t; });
        await callWithStones();
        await waitFor(b, () => !Coop.dead && SceneManager._scene instanceof Scene_Map, 15000, 'B back by the stones a second time');
        const tsBack = { a: await a.evaluate(() => $gameMap.tilesetId()), b: await b.evaluate(() => $gameMap.tilesetId()) };
        await a.evaluate((t) => $gameMap.changeTileset(t), ts0);
        await b.evaluate((t) => $gameMap.changeTileset(t), ts0);
        check("called back where the caller stands, B has the caller's tileset there", tsBack.a !== ts0 && tsBack.a === tsBack.b, JSON.stringify(tsBack));
        const handed = await a.evaluate(() => ({ handed: window._handed, left: $gameParty.numItems($dataItems[115]) }));
        check('no stones are left to hand over while a stone call is answered', handed.handed === 0 && handed.left === 0, JSON.stringify(handed));

        await b.evaluate(() => SceneManager.goto(Scene_Gameover));
        await waitFor(b, () => SceneManager._scene instanceof Scene_CoopDead, 8000, 'B dead a third time');
        await sleep(500);
        await waitFor(a, (id) => Coop.peers.get(id).st === 'dead', 5000, 'A knows B is dead a third time', idB);
        const noOffer = await a.evaluate(async (c) => {
            const tryIt = async () => { $gameMap._interpreter.clear(); $gameMessage.clear(); $gameMap.event(c.id).start(); await new Promise((r) => setTimeout(r, 800)); const t = $gameMessage.allText(); const ev = $gameMap.event(c.id); $gameMap._interpreter.clear(); $gameMessage.clear(); ev._starting = false; ev.unlock(); $gameTemp.clearCommonEvent(); return /call .* back/.test(t); };
            $gameParty.gainItem($dataItems[115], 1);
            const one = await tryIt();
            $gameParty.gainItem($dataItems[115], 1); $gameSwitches.setValue(2190, true);
            const hard = await tryIt();
            $gameSwitches.setValue(2190, false);
            return { one, hard };
        }, circle);
        check('one soul stone is not enough, and on Hard stones call nobody back', !noOffer.one && !noOffer.hard, JSON.stringify(noOffer));

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
        check('they see each other again', (await sees(a, 1)) && (await sees(b, 1)));
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
