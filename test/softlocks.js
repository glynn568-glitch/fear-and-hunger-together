// The softlocks players reported against another co-op mod for this game
// (mattieFM/FearAndHungerModManager issues #27, #32, #37, #38, #48, #49),
// played through here with two players: whoever is involved must be able to
// move again afterwards, and the other player must not be caught up in it.
const { twoPlayers, checker, sleep, waitFor, sees } = require('./common');

async function press(page, code, ms) {
    await page.keyboard.down(code); await sleep(ms || 110); await page.keyboard.up(code); await sleep(160);
}
async function hold(page, code, ms) {
    await page.keyboard.down(code); await sleep(ms); await page.keyboard.up(code);
}
// Free to walk: on the map, nothing running, nothing said, not frozen.
const free = (p) => p.evaluate(() => SceneManager._scene instanceof Scene_Map && SceneManager._scene.isActive() && !$gameMap.isEventRunning()
    && !$gameMessage.isBusy() && !$gamePlayer.isTransferring() && $gamePlayer.canMove());

// Plays through whatever an event says, the way a player would: Z through
// its text, the given answers to its questions (the first one after that).
// True once the player has been free for a second.
async function drive(page, answers, ms) {
    const queue = answers.slice();
    const until = Date.now() + (ms || 60000);
    let calm = 0;
    while (Date.now() < until) {
        const st = await page.evaluate(() => {
            const w = SceneManager._scene._messageWindow;
            return { choice: !!(w && w._choiceWindow && w._choiceWindow.active), busy: $gameMessage.isBusy() };
        });
        if (st.choice) {
            await page.evaluate((i) => SceneManager._scene._messageWindow._choiceWindow.select(i), queue.length ? queue.shift() : 0);
            await press(page, 'KeyZ');
            calm = 0;
        } else if (st.busy) {
            await press(page, 'KeyZ');
            calm = 0;
        } else if (await free(page)) {
            if (++calm >= 4) return true;
            await sleep(250);
        } else {
            calm = 0;
            await sleep(250);
        }
    }
    // Still held: say by what, so a failure reads without a rerun.
    const stop0 = await page.evaluate(() => $gamePlayer._stopCount);
    await sleep(300);
    console.log(page.label + ' engine: ' + JSON.stringify(await page.evaluate((stop0) => {
        const p = $gamePlayer, d = 6, x2 = $gameMap.roundXWithDirection(p.x, d), y2 = $gameMap.roundYWithDirection(p.y, d);
        return { stopAdvanced: p._stopCount - stop0, pWait: p._waitCount, canPass: p.canPass(p.x, p.y, d), mapPass: p.isMapPassable(p.x, p.y, d),
            collided: p.isCollidedWithCharacters(x2, y2), evs: $gameMap.eventsXyNt(x2, y2).map((e) => e.eventId() + ':' + e._priorityType + (e._erased ? 'erased' : '')),
            through: p.isThrough(), ok: p.isMovementSucceeded(), idx: p._moveRouteIndex, followers: p._followers.visibleFollowers().map((f) => f.x + ',' + f.y),
            avatars: [...Coop.avatars.values()].map((a) => a.x + ',' + a.y) };
    }, stop0)));
    console.log(page.label + ' still held: ' + JSON.stringify(await page.evaluate(() => {
        const i = $gameMap._interpreter, ev = i && $gameMap.event(i.eventId());
        const c = i && i._list && i._list[i._index];
        return { scene: SceneManager._scene.constructor.name, running: $gameMap.isEventRunning(), event: i && i.eventId(), name: ev && ev.event().name,
            index: i && i._index, code: c && c.code, params: c && JSON.stringify(c.parameters).slice(0, 120), wait: i && i._waitMode, count: i && i._waitCount,
            child: !!(i && i._childInterpreter), msg: $gameMessage.isBusy(), moving: $gamePlayer.isMoving(), transferring: $gamePlayer.isTransferring(),
            route: $gamePlayer._moveRouteForcing, xy: [$gamePlayer.x, $gamePlayer.y],
            step: $gamePlayer._moveRoute && $gamePlayer._moveRoute.list[$gamePlayer._moveRouteIndex],
            near: $gameMap.events().filter((e) => Math.abs(e.x - $gamePlayer.x) + Math.abs(e.y - $gamePlayer.y) <= 1 && e.page())
                .map((e) => e.eventId() + '@' + e.x + ',' + e.y + (e.isNormalPriority() ? ' solid' : '') + (e.isThrough() ? ' through' : '') + ' ' + e.characterName()) };
    })));
    return false;
}

async function goTo(page, mapId, x, y, d) {
    await page.evaluate((m, x, y, d) => $gamePlayer.reserveTransfer(m, x, y, d, 0), mapId, x, y, d);
    await waitFor(page, (m) => T.onMap() && $gameMap.mapId() === m, 30000, 'on map ' + mapId, mapId);
    await page.evaluate(() => T.settle());
    await sleep(300);
}

// Ends a fight from the side running it: broken off if it is still going,
// or the victory read through with Z if it was won.
// A fight's messages and coin flips (a guard's grab, a lost arm) are anyone's to answer:
// this answers them from `page` until the returned function is called.
function answering(page) {
    let on = true;
    (async () => {
        while (on) {
            try { if (await page.evaluate(() => $gameMessage.isBusy())) await press(page, 'KeyZ'); else await sleep(300); } catch (e) { return; }
        }
    })();
    return () => { on = false; };
}
async function endFight(page) {
    await page.evaluate(() => { if (SceneManager._scene instanceof Scene_Battle && BattleManager._phase !== 'battleEnd') BattleManager.abort(); });
    for (let i = 0; i < 40 && !(await page.evaluate(() => SceneManager._scene instanceof Scene_Map)); i++) {
        if (await page.evaluate(() => $gameMessage.isBusy())) await press(page, 'KeyZ'); else await sleep(500);
    }
}

// The coin flip's pictures (common event 259: background, coin, two digits).
const coinShown = (p) => p.evaluate(() => [14, 15, 16, 17].filter((n) => { const pic = $gameScreen.picture(n); return pic && pic.name(); }));

(async () => {
    const check = checker();
    let s;
    try {
        s = await twoPlayers(8470);
        const { a, b } = s;

        //--- #32: a coin flip stuck on screen (searching the shelves on the first floor) ---
        await a.evaluate(() => { $gamePlayer.locate(34, 56); $gamePlayer.setDirection(8); });
        await b.evaluate(() => { $gamePlayer.locate(33, 56); $gamePlayer.setDirection(8); });
        await sleep(400);
        // Counts the coins the game shows, so a pass means a flip really happened.
        for (const p of [a, b]) await p.evaluate(() => {
            window.__coins = 0;
            const show = Game_Screen.prototype.showPicture;
            Game_Screen.prototype.showPicture = function (id, name) { if (name === 'icon_small_coin') window.__coins++; return show.apply(this, arguments); };
        });
        // Both at once, each at a shelf of their own.
        await Promise.all([press(a, 'KeyZ'), press(b, 'KeyZ')]);
        const done = await Promise.all([drive(a, [0, 0]), drive(b, [0, 0])]);
        await sleep(600);
        const left = { a: await coinShown(a), b: await coinShown(b), flips: [await a.evaluate(() => __coins), await b.evaluate(() => __coins)] };
        check('#32 coin flips taken together end, and no coin stays on screen', done[0] && done[1] && left.flips[0] > 0 && left.flips[1] > 0 && !left.a.length && !left.b.length, JSON.stringify({ done, left }));
        // The emptied shelf, searched again by the other player.
        await b.evaluate(() => { $gamePlayer.locate(34, 56); $gamePlayer.setDirection(8); });
        await sleep(300);
        await press(b, 'KeyZ');
        check('...and the other player searching the emptied shelf is not caught in it', await drive(b, [0, 0]) && !(await coinShown(b)).length);

        //--- #38: falling down a pit (the shaft on the second floor) ---
        await a.evaluate(() => $gameVariables.setValue(127, 1)); // the floor below is level4_A (map 8)
        await sleep(300);
        await goTo(a, 5, 39, 48, 2);
        await goTo(b, 5, 41, 48, 4);
        await sleep(500);
        await a.evaluate(() => $gameMap.event(16).start());
        const aFell = await drive(a, [1], 60000); // "Jump down"
        const aAt = await a.evaluate(() => [$gameMap.mapId(), $gamePlayer.x, $gamePlayer.y]);
        check('#38 a player who jumps down the pit lands and can move', aFell && aAt[0] === 8, JSON.stringify(aAt));
        const bStill = await b.evaluate(() => ({ map: $gameMap.mapId(), legs: $gameSwitches.value(250) || $gameSwitches.value(251) }));
        check('...and the other player stays where they were, unhurt and free', bStill.map === 5 && !bStill.legs && await free(b), JSON.stringify(bStill));
        await b.evaluate(() => $gameMap.event(17).start());
        const bFell = await drive(b, [1], 60000);
        check('...and when they jump after, they land free too', bFell && await b.evaluate(() => $gameMap.mapId()) === 8 && await free(a));
        await sleep(800);
        check('...in the same place as their partner', (await sees(a, 1)) && (await sees(b, 1)));

        //--- #27: the Nosramus scene in the mines, met by two players at once ---
        await goTo(a, 11, 34, 64, 2); // on the step-on triggers, where walking in leaves them
        await goTo(b, 11, 35, 65, 2);
        await sleep(500);
        await Promise.all([a.evaluate(() => $gameMap.event(350).start()), b.evaluate(() => $gameMap.event(351).start())]);
        const met = await Promise.all([drive(a, [1, 0], 90000), drive(b, [1, 0], 90000)]); // "Show yourself", "Nice to meet you too"
        const after = await Promise.all([a, b].map((p) => p.evaluate(() => ({ seen: $gameSwitches.value(1290), gone: $gameSwitches.value(1293) }))));
        check('#27 two players meeting Nosramus together can both move afterwards', met[0] && met[1] && await free(a) && await free(b), JSON.stringify({ met, after }));
        check('...and the scene played out once, the same for both', after.every((x) => x.seen && x.gone), JSON.stringify(after));
        // Coming back to where he was: he is gone, nothing starts, nobody is held.
        await b.evaluate(() => $gameMap.event(350).start());
        check('...and a player coming back to that spot later is not held', await drive(b, [], 15000));

        //--- #48: an extra turn from Fast attack (the knight's agility doubled) in a shared fight ---
        await goTo(a, 1, 27, 66, 6);
        await goTo(b, 1, 28, 66, 4);
        await b.evaluate(() => { const k = $gameParty.leader(); k.learnSkill(66); k.setHp(k.mhp); });
        await sleep(600);
        await a.evaluate(() => { BattleManager.setup(1, true, true); SceneManager.push(Scene_Battle); });
        await waitFor(b, () => SceneManager._scene instanceof Scene_CoopSpectate, 15000, 'B pulled into the fight');
        await waitFor(a, () => BattleManager.isInputting() && BattleManager.actor(), 20000, 'the first choice');
        const turns = { a: 0, b: 0, ex: 0, fast: false };
        const until = Date.now() + 70000;
        let stalled = 0;
        while (Date.now() < until && turns.b < 4) {
            const st = await a.evaluate(() => ({ input: BattleManager.isInputting() && !!BattleManager.actor(), actor: BattleManager.actor() ? BattleManager.actor().actorId() : 0,
                over: !(SceneManager._scene instanceof Scene_Battle), ex: !!(window.Galv && Galv.EXTURN && Galv.EXTURN.active), msg: $gameMessage.isBusy() }));
            if (st.over) { turns.end = await a.evaluate(() => ($gameTroop.isAllDead() ? 'won' : $gameParty.isAllDead() ? 'lost' : 'over')); break; }
            // The guest answers what the fight says (anyone may): a message waiting is no stall.
            if (!st.input && st.msg) { turns.said = (turns.said || 0) + 1; await press(b, 'KeyZ'); await sleep(250); continue; }
            if (!st.input) { if (++stalled > 120) { turns.end = 'stalled'; break; } await sleep(250); continue; }
            stalled = 0;
            if (st.ex) turns.ex++;
            if (st.actor === 1) { turns.a++; await press(a, 'KeyZ'); await press(a, 'KeyZ'); await press(a, 'KeyZ'); }
            else if (st.actor === 3) {
                turns.b++;
                if (!turns.fast) {
                    // Skills, then Fast attack (it targets the user: no target to pick).
                    turns.fast = true;
                    await press(b, 'ArrowDown'); await press(b, 'KeyZ');
                    await sleep(300);
                    const picked = await a.evaluate(() => { const w = SceneManager._scene._skillWindow; const i = w && w._data ? w._data.findIndex((k) => k && k.id === 66) : -1; if (i >= 0) w.select(i); return i; });
                    if (picked < 0) turns.fast = 'not listed';
                    await press(b, 'KeyZ');
                } else { await press(b, 'KeyZ'); await press(b, 'KeyZ'); await press(b, 'KeyZ'); }
            } else await sleep(250);
            await sleep(400);
        }
        check('#48 a fight goes on through Fast attack and the turns after it, each player choosing for their own', turns.b >= 3 && turns.a >= 2 && stalled <= 120 && turns.fast === true, JSON.stringify(turns));
        await endFight(a);
        await waitFor(a, () => SceneManager._scene instanceof Scene_Map, 20000, 'A back on the map');
        await waitFor(b, () => SceneManager._scene instanceof Scene_Map, 20000, 'B back on the map');
        check('...and both walk away from it', await drive(a, [], 15000) && await drive(b, [], 15000));

        //--- #49: a companion who fights by itself, and a player taking back their choice ---
        await a.evaluate(() => { $gameParty.addActor(7); }); // Moonless fights on her own
        await sleep(600);
        await a.evaluate(() => { BattleManager.setup(1, true, true); SceneManager.push(Scene_Battle); });
        await waitFor(b, () => SceneManager._scene instanceof Scene_CoopSpectate, 15000, 'B pulled into the second fight');
        await waitFor(a, () => BattleManager.isInputting() && BattleManager.actor() && BattleManager.actor().actorId() === 1, 20000, 'A chooses first');
        await press(a, 'KeyZ'); await press(a, 'KeyZ'); await press(a, 'KeyZ');
        await waitFor(a, () => BattleManager.isInputting() && BattleManager.actor() && BattleManager.actor().actorId() === 3, 10000, 'past Moonless to the knight');
        // A presses cancel while B is choosing: B's turn is not A's to undo.
        await press(a, 'KeyX');
        await sleep(400);
        const held = await a.evaluate(() => BattleManager.actor() ? BattleManager.actor().actorId() : 0);
        // B takes back... their own nothing: cancel goes back to A, who chooses again.
        await press(b, 'KeyX');
        await waitFor(a, () => BattleManager.isInputting() && BattleManager.actor() && BattleManager.actor().actorId() === 1, 10000, 'cancel goes back to A');
        await press(a, 'KeyZ'); await press(a, 'KeyZ'); await press(a, 'KeyZ');
        await waitFor(a, () => BattleManager.isInputting() && BattleManager.actor() && BattleManager.actor().actorId() === 3, 10000, 'and on to the knight again');
        await press(b, 'KeyZ'); await press(b, 'KeyZ'); await press(b, 'KeyZ');
        const ran = await waitFor(a, () => !BattleManager.isInputting() || $gameTroop.turnCount() >= 1, 15000, 'the round runs').then(() => true, () => false);
        const stop = answering(a);
        try {
            await waitFor(a, () => (BattleManager.isInputting() && BattleManager.actor()) || BattleManager._phase === 'battleEnd' || !(SceneManager._scene instanceof Scene_Battle), 30000, 'the next round asks again, or the fight ends');
        } catch (e) {
            throw new Error(e.message + ' ' + JSON.stringify(await a.evaluate(() => {
                const sc = SceneManager._scene, w = (n) => sc[n] ? { a: sc[n].active, o: sc[n].isOpen && sc[n].isOpen(), v: sc[n].visible } : null;
                return { scene: sc.constructor.name, phase: BattleManager._phase, actor: BattleManager.actor() && BattleManager.actor().actorId(), actorIndex: BattleManager._actorIndex,
                    subject: BattleManager._subject && (BattleManager._subject.isActor() ? 'actor ' + BattleManager._subject.actorId() : 'enemy'), turn: $gameTroop.turnCount(),
                    party: $gameParty.battleMembers().map((m) => m.actorId() + (m.isAlive() ? '' : 'x') + ':' + (m.canInput() ? 'in' : 'no') + ':' + m.numActions()),
                    enemies: $gameTroop.members().map((m) => m.hp), busy: BattleManager.isBusy(), log: sc._logWindow && sc._logWindow.isBusy(), msg: $gameMessage.isBusy(), ev: $gameTroop.isEventRunning(),
                    ex: !!(window.Galv && Galv.EXTURN && Galv.EXTURN.active), party: w('_partyCommandWindow'), cmd: w('_actorCommandWindow'), skill: w('_skillWindow'), enemy: w('_enemyWindow'),
                    coop: Coop.battle && { role: Coop.battle.role, waiting: Coop.battle.waiting, seq: Coop.battle.turnSeq } };
            })));
        } finally { stop(); }
        check('#49 with a self-fighting companion, cancelling never strands a turn', held === 3 && ran, 'after A\'s cancel ' + held);
        await endFight(a);
        await waitFor(a, () => SceneManager._scene instanceof Scene_Map, 20000, 'A back on the map');
        await waitFor(b, () => SceneManager._scene instanceof Scene_Map, 20000, 'B back on the map');
        await a.evaluate(() => $gameParty.removeActor(7));

        //--- #37: after death, a new life is an ordinary one (no walking through walls) ---
        await b.evaluate(() => SceneManager.goto(Scene_Gameover));
        await waitFor(b, () => SceneManager._scene instanceof Scene_CoopDead, 8000, 'B dead');
        await sleep(800);
        await hold(b, 'Escape', 2600);
        await waitFor(b, () => SceneManager._scene instanceof Scene_Title && !SceneManager.isSceneChanging(), 15000, 'B gave the character up');
        await b.evaluate(() => T.quickStart(4, 26, 66));
        await waitFor(b, () => T.onMap(), 60000, 'B starts again');
        await b.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(b, () => Coop.world.live, 15000, 'B live again');
        const body = await b.evaluate(() => ({ through: $gamePlayer.isThrough(), see: $gamePlayer.isTransparent(), dead: Coop.dead }));
        check('#37 a character started after letting the dead one go walks like anyone, not through walls', !body.through && !body.see && !body.dead && await free(b), JSON.stringify(body));
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
