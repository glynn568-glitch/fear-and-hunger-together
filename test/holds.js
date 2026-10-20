// An enemy someone is using (in its scene, or in a fight with it) stands still
// for everyone else, and only as long as they really are using it: dying lets
// it go. Two players in the same enemy's scene end up in one fight, not two.
const { twoPlayers, checker, sleep, waitFor } = require('./common');
const { openPlayer } = require('./lib');

const GUARD = 9; // guard1 on level 1

(async () => {
    const check = checker();
    let s, again;
    try {
        s = await twoPlayers(8531);
        const { a, b } = s;
        const heldOnB = () => b.evaluate((e) => !!Coop.events.holdOf(e), GUARD);

        // A is in the guard's scene, then dies in it: the guard is free for B again.
        await a.evaluate((e) => $gameMap.event(e).lock(), GUARD);
        await waitFor(b, (e) => !!Coop.events.holdOf(e), 5000, 'B hears the guard is in use', GUARD);
        check('an enemy in someone\'s scene stands still for the other', true);
        await a.evaluate(() => SceneManager.goto(Scene_Gameover));
        await waitFor(a, () => SceneManager._scene instanceof Scene_CoopDead, 8000, 'A dead');
        await sleep(1500);
        check('dying in its scene lets the enemy go', !(await heldOnB()));

        // A dead player on 0.1.8 or before never let go: the dead hold nothing.
        await a.evaluate((e) => { Coop.send({ t: 'evh', m: 1, e, k: 'talk' }); }, GUARD);
        await sleep(1500);
        check('a dead player\'s old hold does not freeze the enemy', !(await heldOnB()));
        await a.evaluate(() => { Coop.dead = false; Coop.reportPresence(true); SceneManager.goto(Scene_Map); });
        await waitFor(a, () => SceneManager._scene instanceof Scene_Map && SceneManager._scene.isActive(), 15000, 'A back on the map');
        await a.evaluate(() => { const l = $gameParty.leader(); l.removeState(l.deathStateId()); l.setHp(l.mhp); $gamePlayer.locate(27, 67); });
        await b.evaluate(() => $gamePlayer.locate(27, 58)); // out of reach of A's fight
        await sleep(1500);

        // Both reach the same enemy's fight, A first: B goes into A's fight.
        const fight = (e) => { $gameMap._interpreter.setup([{ code: 301, indent: 0, parameters: [0, 1, true, false] }, { code: 0, indent: 0, parameters: [] }], e); };
        await a.evaluate(fight, GUARD);
        await waitFor(a, () => Coop.battle && Coop.battle.role === 'owner' && BattleManager._phase === 'input', 30000, 'A in the fight');
        await waitFor(b, (e) => { const h = Coop.events.holdOf(e); return h && h.k === 'battle'; }, 5000, 'B hears the guard is in a fight', GUARD);
        await b.evaluate(fight, GUARD);
        await waitFor(b, () => Coop.battle && Coop.battle.role === 'guest', 15000, 'B in a fight').catch(() => {});
        const bb = await b.evaluate(() => ({ role: Coop.battle && Coop.battle.role, scene: SceneManager._scene.constructor.name }));
        check('the second to reach the fight goes into the first one\'s, not a fight of their own', bb.role === 'guest', JSON.stringify(bb));
        // The fight is under way, so B waits for the next turn to come in.
        const inA = () => !!Coop.battle && (Coop.battle.guests.size + Coop.battle.pending.length) === 1;
        await waitFor(a, inA, 20000, 'B asks in').catch(() => {});
        check('and the first one has them in', await a.evaluate(inA));

        // The jaggedjaw leaps at whoever lost its roll, nobody else: its switch
        // (then the mauling scene on touch) stays on that machine. The hound
        // being called in is the world's.
        await b.evaluate(() => { $gameSwitches.setValue(2888, true); $gameSwitches.setValue(2901, true); });
        await waitFor(a, () => $gameSwitches.value(2901), 5000, 'A hears the hound is called in').catch(() => {});
        check('a hound called in is called in for everyone, its leap at one player is theirs alone', await a.evaluate(() => $gameSwitches.value(2901) && !$gameSwitches.value(2888)));

        // His 10/19 report: the friend's game closed mid-fight; the guard stood frozen where
        // the fight began. A's window dies in the guard's fight, then A starts the game again
        // and is at the title: that fight is over, the guard is free at once (not in 5 minutes).
        await waitFor(a, () => Coop.battle && Coop.battle.role === 'owner', 5000, 'A still in the guard fight');
        await a.browserContext().close();
        await waitFor(b, (e) => { const h = Coop.events.holdOf(e); return h && h.gone; }, 10000, 'B sees A gone mid-fight', GUARD);
        check('a fighter gone mid-fight: the enemy stays held a while (their fight may go on)', true);
        again = await openPlayer(s.browser, 'http://localhost:8531/?name=Ann', 'A again');
        await waitFor(again, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 90000, 'A back at the title');
        await waitFor(b, (e) => !Coop.events.holdOf(e), 8000, 'B: the guard is free', GUARD).catch(() => {});
        check('back at the title, their fight is over: the enemy is free at once', !(await b.evaluate((e) => !!Coop.events.holdOf(e), GUARD)));
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(s ? [s.b].concat(again ? [again] : []) : []);
    if (s) await s.close();
    process.exit(code);
})();
