// Ma'habre with two players: what only goes wrong because the second one came along.
const { checker, sleep, waitFor } = require('./common');
const { latePair, onMap, put, flags } = require('./late');

(async () => {
    const check = checker();
    let s, code = 1;
    try {
        s = await latePair(8790, { actorA: 1, actorB: 3, speed: 4 });
        const { a, b } = s;

        // The Passages: A reads them (a way back of their own); B comes along by following.
        await put(a, 3, 12, 10); await put(b, 3, 13, 10);
        await a.evaluate(() => { $gameVariables.setValue(102, 3); $gameVariables.setValue(103, 12); $gameVariables.setValue(104, 10); });
        await put(a, 26, 25, 13);
        await sleep(600);
        await b.evaluate(() => { const p = Coop.others()[0]; Coop.transferTo(p); });
        await onMap(b, 26);
        const kept = await b.evaluate(() => [$gameVariables.value(102), $gameVariables.value(103), $gameVariables.value(104), $gameVariables.value(101)]);
        check('who follows into the Passages keeps a way back', kept[0] === 3 && kept[1] === 13 && kept[2] === 10 && kept[3] < 5, JSON.stringify(kept));
        // Their time runs out.
        await b.evaluate(() => { $gameVariables.setValue(101, 400); });
        await waitFor(b, () => $gameMap.mapId() === 3 && !$gamePlayer.isTransferring() && !$gameSwitches.value(800) && !$gameMessage.isBusy(), 30000, 'B back').catch(() => {});
        const back = await b.evaluate(() => ({ m: $gameMap.mapId(), x: $gamePlayer.x, y: $gamePlayer.y, sw: $gameSwitches.value(800), t: $gameVariables.value(101) }));
        check('and goes back there when their time is up, not to a map that does not exist', back.m === 3 && back.x === 13 && back.y === 10 && !back.sw, JSON.stringify(back));

        // On that map with no way back kept (a save from before): to the partner, never to map 0.
        await put(a, 27, 30, 30);
        await put(b, 26, 25, 13);
        await b.evaluate(() => { for (const id of [102, 103, 104]) $gameVariables.setValue(id, 0); $gameVariables.setValue(101, 400); });
        await waitFor(b, () => $gameMap.mapId() !== 26 && !$gamePlayer.isTransferring() && !$gameSwitches.value(800) && !$gameMessage.isBusy(), 30000, 'B moved').catch(() => {});
        const none = await b.evaluate(() => ({ m: $gameMap.mapId(), scene: SceneManager._scene.constructor.name }));
        check('no way back at all: goes to the partner', none.m === 27 && none.scene === 'Scene_Map', JSON.stringify(none));
        await sleep(500);

        // The Beacon of the Depths on map 113: A uses it, B stands by. Its steps tint the screen and light it,
        // and only its last step, which moves A, undoes that.
        await put(a, 113, 18, 56); await put(b, 113, 20, 56);
        await sleep(800);
        const before = await b.evaluate(() => $gameScreen.tone().join());
        // Whether a step runs here at all depends on how fast the flags cross; any step that does leaves its tint.
        await b.evaluate(() => { window.__beacon = 0; const setup = Game_Interpreter.prototype.setup; Game_Interpreter.prototype.setup = function (list, eventId) { if (eventId === 238 && $gameMap.mapId() === 113 && list && list.length > 1) window.__beacon++; return setup.apply(this, arguments); }; });
        await a.evaluate(() => { $gameSwitches.setValue(2346, true); });
        await waitFor(a, () => $gameMap.mapId() !== 113, 30000, 'A carried off').catch(() => {});
        await sleep(1000);
        const stood = await b.evaluate(() => ({ m: $gameMap.mapId(), tone: $gameScreen.tone().join(), running: $gameMap._interpreter.isRunning(), steps: window.__beacon, mine: Array.from(Coop.world.mine).filter((k) => /^sw23[45]\d$/.test(k)) }));
        check('a bystander runs none of its steps', stood.steps === 0, JSON.stringify(stood));
        check('the Beacon carries off who used it', (await a.evaluate(() => $gameMap.mapId())) !== 113);
        check('a bystander keeps their screen and their place', stood.m === 113 && stood.tone === before && !stood.running, JSON.stringify(stood));
        check('and none of its steps became theirs', stood.mine.length === 0, JSON.stringify(stood.mine));

        // Le'garde took the throne through A, then B sat on the chair first: he waits for B on the next plane.
        await put(a, 3, 12, 10);
        await flags(a, [1847]);
        await sleep(400);
        await b.evaluate(() => { D.win = false; });
        await put(b, 140, 48, 48);
        await waitFor(b, () => SceneManager._scene instanceof Scene_Battle, 30000, 'B in the fight').catch(() => {});
        const plane = await b.evaluate(() => ({ scene: SceneManager._scene.constructor.name, troop: $gameTroop._troopId }));
        check('whoever reaches the next plane alone meets Le\'garde', plane.scene === 'Scene_Battle' && plane.troop === 126, JSON.stringify(plane));

        code = check.finish([a, b]);
    } catch (e) { console.error(e); check('test ran to the end', false); code = check.finish([]); }
    if (s) await s.close();
    process.exit(code);
})();
