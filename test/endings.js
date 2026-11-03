// Every ending, as the game reaches it, with two players: the scene runs from the real
// event, whoever is elsewhere is taken along into the same ending, nobody is left behind.
//   node test/endings.js            all
//   node test/endings.js s-gate a   by name
const { checker, sleep, waitFor } = require('./common');
const { latePair, onMap, put, flags, bothEnd } = require('./late');

const ENDING = { D: 1889, C: 1890, B: 1891, A: 1892, S: 2249, C2: 2647 };

// Each: A does it, B stands where `b` says. `go` runs on A and starts it.
const CASES = {
    // Ending S, the gate: the game's hard-mode flag 2662 plus the way out.
    's-gate': { port: 8700, want: 'S', a: [74, 2, 26], b: [27, 30, 30], set: [1000, 2662], start: (a) => a.evaluate(() => $gameMap.event(60).start()) },
    // Ending S, the faceless person: God of fear and hunger beaten. B close enough to fight along.
    's-god': { port: 8702, want: 'S', a: [142, 53, 23], b: [142, 54, 23], win: true, start: (a) => a.evaluate(() => { const e = $gameMap.event(47); e.start(); }) },
    // Ending S, the god of fear and hunger with B on another map.
    's-god-far': { port: 8704, want: 'S', a: [142, 53, 23], b: [27, 30, 30], win: true, start: (a) => a.evaluate(() => $gameMap.event(47).start()) },
    // Ending E: the way out, no flags. B dead.
    'e-dead': { port: 8706, want: '', a: [74, 2, 26], b: [27, 30, 30], set: [1000], bDead: true, start: (a) => a.evaluate(() => $gameMap.event(60).start()) },
    // Ending B: stepping off into Gro-goroth's pit with no Girl.
    'b-pit': { port: 8708, want: 'B', a: [142, 32, 27], b: [27, 30, 30], win: true, start: (a) => a.evaluate(() => $gameMap.event(25).start()) },
    // Ending A: the pit with the Girl, the fight, Level 10. B on the same map, which also gets the opening.
    'a-girl': { port: 8710, want: 'A', a: [142, 32, 27], b: [142, 31, 27], win: true, girl: true, start: (a) => a.evaluate(() => $gameMap.event(25).start()) },
    // Ending A with B elsewhere.
    'a-girl-far': { port: 8712, want: 'A', a: [142, 32, 27], b: [27, 30, 30], win: true, girl: true, start: (a) => a.evaluate(() => $gameMap.event(25).start()) },
    // Ending C2: Le'garde on the throne, kneel. In the Void.
    'c2-void': { port: 8714, want: 'C2', a: [160, 63, 38], b: [27, 30, 30], set: [1847], picks: [0, 0], start: (a) => a.evaluate(() => $gameMap.event(286).start()) },
    // Ending D: no Le'garde, the god of yourself. In the Void.
    'd-void': { port: 8716, want: 'D', a: [160, 63, 38], b: [27, 30, 30], set: [2748], win: true, start: (a) => a.evaluate(() => $gameMap.event(286).start()) },
    // B is partway along ending A (its switch comes on long before its door) and A walks out: one ending for both, not a mix.
    'mix-a': { port: 8722, want: '', a: [74, 2, 26], b: [27, 30, 30], set: [1000], bSw: [1892], start: (a) => a.evaluate(() => $gameMap.event(60).start()) },
    // A walks out while B wins the fight that would end it their way: the first ending stands for both.
    'first-stands': { port: 8724, want: '', a: [74, 2, 26], b: [160, 63, 38], set: [1000, 2748], bFightEv: 286, start: (a) => a.evaluate(() => $gameMap.event(60).start()) },
    // Hard mode: A (Cahara) found the crown, B (D'arce) walks out. Ending S told as Cahara's, on both machines.
    's-crown': { port: 8726, want: 'S', a: [26, 10, 10], b: [74, 2, 26], set: [1000, 2190, 2662, 2664], page: 9, start: (a, b) => b.evaluate(() => $gameMap.event(60).start()) },
    // Both step up to the god of themselves in the Void: the second waits for the first one's fight, no ending before it is won.
    'two-gods': { port: 8732, want: 'D', a: [140, 48, 48], b: [140, 47, 48], second: true, start: async () => {} },
    // Starting again as the partner's own character while they are still in the credits.
    'credits': { port: 8738, want: '', a: [74, 2, 26], b: [27, 30, 30], set: [1000], credits: true, start: (a) => a.evaluate(() => $gameMap.event(60).start()) },
    // After the credits: a new run, even with the partner still on the Game Over screen.
    'after': { port: 8728, want: '', a: [74, 2, 26], b: [27, 30, 30], set: [1000], after: true, holdB: true, start: (a) => a.evaluate(() => $gameMap.event(60).start()) },
    // The crown found (2662 stays on for good), then B (D'arce) beats the god of fear and hunger: S told as B's, not the crown's.
    's-god-after-crown': { port: 8736, want: 'S', a: [27, 30, 30], b: [142, 53, 23], set: [2190, 2662, 2664], winB: true, page: 8, start: (a, b) => b.evaluate(() => $gameMap.event(47).start()) },
    // B in the middle of their own fight when the ending comes: taken along once it ends.
    's-b-fight': { port: 8718, want: 'S', a: [74, 2, 26], b: [27, 30, 30], set: [1000, 2662], bFight: true, start: (a) => a.evaluate(() => $gameMap.event(60).start()) },
    // B in the menu.
    's-b-menu': { port: 8720, want: 'S', a: [74, 2, 26], b: [27, 30, 30], set: [1000, 2662], bMenu: true, start: (a) => a.evaluate(() => $gameMap.event(60).start()) },
};

async function one(name, c, check) {
    let s;
    try {
        s = await latePair(c.port, { actorA: 1, actorB: 3, speed: 6 });
        const { a, b } = s;
        // Keep what happens to B on record.
        for (const p of [a, b]) await p.evaluate(() => { const st = Scene_CoopDead.prototype.start; Scene_CoopDead.prototype.start = function () { window.__deadSeen = true; st.call(this); }; });
        if (c.girl) await a.evaluate(() => { $gameParty.addActor(2); });
        if (c.set) await flags(a, c.set);
        await sleep(300);
        await put(a, ...c.a);
        await put(b, ...c.b);
        await sleep(500);
        if (c.win) await a.evaluate(() => { D.win = true; });
        if (c.winB) await b.evaluate(() => { D.win = true; });
        if (c.picks) await a.evaluate((p) => { D.picks = p; }, c.picks);
        if (c.bDead) {
            await b.evaluate(() => SceneManager.goto(Scene_Gameover));
            await waitFor(b, () => SceneManager._scene instanceof Scene_CoopDead, 8000, 'B dead');
            await b.evaluate(() => { window.__deadSeen = false; });
        }
        if (c.bFight) await b.evaluate(() => { BattleManager.setup(1, true, true); SceneManager.push(Scene_Battle); });
        if (c.bMenu) await b.evaluate(() => { SceneManager.push(Scene_Menu); });
        if (c.bSw) await b.evaluate((on) => { for (const id of on) $gameSwitches.setValue(id, true); }, c.bSw);
        if (c.bFightEv) {
            await b.evaluate(() => { const st = Game_CharacterBase.prototype.setTransparent; window.__tr = []; Game_CharacterBase.prototype.setTransparent = function (v) { if (this === $gamePlayer) window.__tr.push(v + ' m' + $gameMap.mapId() + ' ' + new Error().stack.split(String.fromCharCode(10)).slice(2, 5).map((l) => l.trim().slice(0, 90)).join(' < ')); return st.call(this, v); }; });
            await b.evaluate((ev) => $gameMap.event(ev).start(), c.bFightEv);
            await waitFor(b, () => SceneManager._scene instanceof Scene_Battle, 60000, 'B in the fight');
        }
        // Arrival scenes can set a player down elsewhere (the Void puts everyone at 23,15): where B must stand, after them.
        if (c.bAt) { await waitFor(b, () => !$gameMap.isEventRunning() && $gamePlayer.x === 23 && $gamePlayer.y === 15 && !$gamePlayer.isTransferring(), 30000, 'B set down by the Void').catch(() => {}); await sleep(800); await b.evaluate((x, y) => $gamePlayer.locate(x, y), c.bAt[0], c.bAt[1]); await waitFor(a, (x, y) => Coop.others().some((p) => p.x === x && p.y === y), 10000, 'A sees B there', c.bAt[0], c.bAt[1]).catch(() => {}); }
        await c.start(a, b);
        if (c.second) {
            // The next plane's autorun waits 550 frames on each machine, then fights the god of yourself: both arrived, A first.
            // B arrived a moment later, so B's own wait is still running when A's fight begins: it ends inside A's fight.
            await waitFor(a, () => SceneManager._scene instanceof Scene_Battle, 60000, 'A in the fight');
            await sleep(6000);
            const held = await b.evaluate(() => D.state());
            check(name + ': the second is not in the ending before the fight is over', held.map !== 86, JSON.stringify(held) + ' ' + JSON.stringify(await b.evaluate(() => Coop.log.slice(-8))) + ' A: ' + JSON.stringify(await a.evaluate(() => [Coop.log.slice(-8), $gamePlayer.x, $gamePlayer.y, Coop.others().map((p) => [p.x, p.y, p.st, Coop.distanceTo(p)])])));
            await a.evaluate(() => { D.win = true; });
        }
        if (c.bFightEv) {
            await waitFor(a, () => $gameMap.mapId() === 86, 60000, 'A at the ending');
            await sleep(1500);
            await b.evaluate(() => { D.win = true; });
        }
        // B out of the fight or menu after a moment, as a player would.
        if (c.bFight || c.bMenu) {
            await waitFor(a, () => $gameMap.mapId() === 86, 120000, 'A at the ending');
            await sleep(3000);
            const held = await b.evaluate(() => $gameMap.mapId());
            check(name + ': B is not pulled out of ' + (c.bFight ? 'a fight' : 'a menu') + ' at once', c.bMenu || held !== 86, 'map ' + held);
            if (c.bFight) await b.evaluate(() => { D.win = true; });
            if (c.bMenu) await b.evaluate(() => { SceneManager.pop(); });
        }
        const wantSw = c.want ? ENDING[c.want] : 0;
        const pagesRead = async (p) => p.evaluate(() => ({ phase: BattleManager._phase, inp: BattleManager.isInputting(), act: !!BattleManager.actor(), alive: $gameTroop.aliveMembers().map((e) => e.name()).join(), turn: $gameTroop.turnCount(), tev: $gameTroop._interpreter.isRunning() ? $gameTroop._interpreter._index : -1, map: $gameMap.mapId(), scene: SceneManager._scene.constructor.name, msg: $gameMessage.allText().slice(0, 50), run: $gameMap._interpreter.isRunning(), state: D.state(), choices: D.choices.slice(-3) }));
        await waitFor(a, () => $gameMap.mapId() === 86, 150000, 'A at the ending').catch(async (e) => { check(name + ': A reaches the ending', false, JSON.stringify(await pagesRead(a))); throw e; });
        await waitFor(b, () => $gameMap.mapId() === 86, 40000, 'B at the ending').catch(async (e) => { check(name + ': B is taken along', false, JSON.stringify(await pagesRead(b))); throw e; });
        const sw = await Promise.all([a, b].map((p) => p.evaluate((all) => all.filter((id) => $gameSwitches.value(id)), Object.values(ENDING))));
        const expect = wantSw ? [wantSw] : [];
        check(name + ': A plays ending ' + (c.want || 'E'), JSON.stringify(sw[0]) === JSON.stringify(expect), JSON.stringify(sw[0]));
        check(name + ': B plays the same one', JSON.stringify(sw[1]) === JSON.stringify(expect), JSON.stringify(sw[1]));
        const pagesOn = await Promise.all([a, b].map((p) => p.evaluate(() => { const e = $gameMap.event(4); return { page: e ? e._pageIndex + 1 : 0, seen: $gamePlayer.isTransparent() }; })));
        check(name + ': both on the same page of it, unseen', pagesOn[0].page === pagesOn[1].page && (!c.page || pagesOn[0].page === c.page) && pagesOn[1].seen, JSON.stringify(pagesOn) + ' ' + JSON.stringify(await b.evaluate(() => window.__tr || [])));
        if (c.credits) {
            // B is still reading the credits when A, done, starts again as B's own character.
            await b.evaluate(() => { D.read = false; });
            await waitFor(a, () => SceneManager._scene instanceof Scene_Gameover, 240000, 'A at the Game Over');
            await a.evaluate(() => SceneManager.goto(Scene_Title));
            await waitFor(a, () => SceneManager._scene instanceof Scene_Title, 15000, 'A at the title');
            await sleep(500);
            await a.evaluate(() => T.quickStart(3, 27, 67));
            await waitFor(a, () => T.onMap(), 60000, 'A on map');
            await a.evaluate(() => { T.settle(); T.begin(); });
            await waitFor(a, () => Coop.world.live, 10000, 'A live').catch(() => {});
            const st = await a.evaluate(() => ({ live: Coop.world.live, sameAs: Coop.world.sameAs || '', living: Coop.livingPeers().length, b: Coop.others().map((p) => p.m + '/' + p.st).join() }));
            check(name + ': someone still in the credits does not hold the character or the run', st.live && !st.sameAs && st.living === 0, JSON.stringify(st));
            await b.evaluate(() => { D.read = true; });
        }
        const ended = await bothEnd(c.credits ? [b] : [a, b], 240000);
        check(name + ': both play it through to the close', ended, JSON.stringify(await Promise.all([a, b].map(pagesRead))));
        const dead = await Promise.all([a, b].map((p) => p.evaluate(() => !!window.__deadSeen)));
        check(name + ': nobody left among the dead', !dead.some(Boolean), JSON.stringify(dead));
        if (c.after) {
            // A goes back to the title and starts again while B still sits on the Game Over.
            const run0 = await a.evaluate(() => Coop.world.runId);
            await a.evaluate(() => SceneManager.goto(Scene_Title));
            await waitFor(a, () => SceneManager._scene instanceof Scene_Title, 15000, 'A at the title');
            await sleep(500);
            await a.evaluate(() => T.quickStart(1, 27, 67));
            await waitFor(a, () => T.onMap(), 60000, 'A on map');
            await a.evaluate(() => { T.settle(); T.begin(); });
            await waitFor(a, () => Coop.world.live, 10000, 'A live');
            const fresh = await a.evaluate(() => ({ run: Coop.world.runId, out: $gameSwitches.value(1000), s: $gameSwitches.value(2249) }));
            check(name + ': a New Game after the ending is a new run', fresh.run !== run0 && !fresh.out && !fresh.s, JSON.stringify(fresh));
        }
        for (const p of [a, b]) {
            const errs = p.errors.filter((e) => !/physical_attack_animation|VideoFrame was garbage collected/.test(e));
            check(name + ': ' + p.label + ' has no script errors', errs.length === 0, errs.slice(0, 3).join(' || ').slice(0, 500));
        }
    } catch (e) {
        check(name + ' ran to the end', false, e.message);
    }
    if (s) await s.close();
}

(async () => {
    const check = checker();
    // FH_ENDINGS=a,b picks cases too (test/twins.js runs one case per twin).
    const names = process.argv.slice(2).length ? process.argv.slice(2) : process.env.FH_ENDINGS ? process.env.FH_ENDINGS.split(',') : Object.keys(CASES);
    for (const n of names) await one(n, CASES[n], check);
    process.exit(check.finish([]));
})();
