// The hounds hunt everyone on the floor. Their every page waits on HOUNDS_ARE_COMING (1781), which each
// machine's own bark timer turns on; kept per player, the hounds came out on one screen only, and the
// partner saw "invisible wolves" start a fight (report 11/13). The level 5 knight is the same: his
// zone switch (360) and the start-of-run die that decides whether he stands there at all (61). So is the
// black witch: her tile wakes her for the player who steps on it, and a room change sends her away (3451,
// 3453, 3454, 3457). Here A runs her tile's parallel page too (3453 is shared), so "out on A's screen" holds
// even with 3451 kept per player; "gone from both" is the check that needs 3451 and 3454 shared (twins).
const { twoPlayers, checker, sleep, waitFor } = require('./common');

const HOUNDS = [102, 113, 114]; // Map074 Fortress: hound1, hound2, hound3
const COMING = 1781, TIMER = 211;
const WITCH = 209, WITCH_MAP = 114, ARMS = [3451, 3453, 3454, 3457]; // black_witch1 in Ancient_inside2

(async () => {
    const check = checker();
    let s;
    try {
        s = await twoPlayers(8516);
        const { a, b } = s;
        const go = (p, map, x, y) => p.evaluate((map, x, y) => $gamePlayer.reserveTransfer(map, x, y, 2, 0), map, x, y);

        //--- The black witch. A tile (EV210) wakes her: its touch turns 3453 on, whose parallel page brings her
        // to 99,44 and turns her on to fight (3451). Every room change (common event 271) turns all four off.
        // She walks toward the player, so both stand far from where she sleeps and where she wakes.
        await go(a, WITCH_MAP, 1, 1);
        await waitFor(a, (m) => T.onMap() && $gameMap.mapId() === m, 30000, 'A in the witch\'s halls', WITCH_MAP);
        const far = await a.evaluate((id) => {
            const w = $gameMap.event(id);
            const open = (x, y) => $gameMap.isValid(x, y) && !$gameMap.eventsXy(x, y).length && [2, 4, 6, 8].every((d) => $gameMap.isPassable(x, y, d));
            let best = null;
            for (let y = 0; y < $gameMap.height(); y++) for (let x = 0; x < $gameMap.width(); x++) {
                const d = Math.min(Math.abs(x - w.x) + Math.abs(y - w.y), Math.abs(x - 99) + Math.abs(y - 44));
                if (d >= 30 && (!best || d < best[2]) && open(x, y) && open(x + 1, y)) best = [x, y, d];
            }
            return best;
        }, WITCH);
        check('found open floor far from the witch', !!far, JSON.stringify(far));
        await a.evaluate((x, y) => { $gamePlayer.locate(x, y); }, far[0], far[1]);
        await go(b, WITCH_MAP, far[0] + 1, far[1]);
        await waitFor(b, (m) => T.onMap() && $gameMap.mapId() === m, 30000, 'B in the witch\'s halls', WITCH_MAP);
        await sleep(1500);
        const witch = (p) => p.evaluate((id) => { const ev = $gameMap.event(id); return { x: ev.x, y: ev.y, image: ev.characterName(), trigger: ev.page() ? ev._trigger : null }; }, WITCH);
        const asleep = await Promise.all([witch(a), witch(b)]);
        check('no witch before anyone wakes her', asleep.every((w) => !w.image), JSON.stringify(asleep));
        await b.evaluate(() => { $gameSwitches.setValue(3453, true); }); // B steps on her tile
        await waitFor(b, () => $gameSwitches.value(3451), 20000, 'the witch awake on B');
        await waitFor(a, () => $gameSwitches.value(3451), 5000, 'and on A').catch(() => {});
        await sleep(500);
        const awake = await Promise.all([witch(a), witch(b)]);
        check('B wakes the witch: she is out on A\'s screen too, ready to fight, where B sees her',
            awake.every((w) => /black_angel2/.test(w.image) && w.trigger === 2) && Math.abs(awake[0].x - awake[1].x) + Math.abs(awake[0].y - awake[1].y) <= 2,
            JSON.stringify(awake));
        // B changes rooms: the game's room-change event, run to its end.
        const ran = await b.evaluate(() => {
            const i = new Game_Interpreter();
            i.setup($dataCommonEvents[271].list, 0);
            for (let k = 0; k < 3000 && i.isRunning(); k++) i.update();
            return !i.isRunning();
        });
        await waitFor(a, (ids) => ids.every((id) => !$gameSwitches.value(id)), 5000, 'A hears her sent away', ARMS).catch(() => {});
        await sleep(300);
        const gone = await Promise.all([witch(a), witch(b)]);
        check('B changes rooms: she is gone from both screens', ran && gone.every((w) => !w.image), JSON.stringify(gone));

        // Open floor in the Fortress, well away from the hounds' kennel (14..27, 18..25) and the exits.
        await go(a, 74, 20, 12);
        await waitFor(a, () => T.onMap() && $gameMap.mapId() === 74, 30000, 'A in the Fortress');
        const spot = await a.evaluate(() => {
            const open = (x, y) => $gameMap.isValid(x, y) && !$gameMap.eventsXy(x, y).length && [2, 4, 6, 8].every((d) => $gameMap.isPassable(x, y, d));
            for (let r = 0; r < 12; r++) for (let dx = -r; dx <= r; dx++) for (const dy of [r - Math.abs(dx), Math.abs(dx) - r]) {
                const x = 20 + dx, y = 12 + dy;
                if (open(x, y) && open(x + 1, y)) return [x, y];
            }
            return null;
        });
        check('found open floor in the Fortress', !!spot, JSON.stringify(spot));
        await a.evaluate((x, y) => { $gamePlayer.locate(x, y); }, spot[0], spot[1]);
        await go(b, 74, spot[0] + 1, spot[1]);
        await waitFor(b, () => T.onMap() && $gameMap.mapId() === 74, 30000, 'B in the Fortress');
        await sleep(1500);
        check('A runs the map, B is the one whose timer runs out', await a.evaluate(() => Coop.events.amOwner()));

        const look = (p) => p.evaluate((ids) => ids.map((id) => {
            const ev = $gameMap.event(id), page = ev.page();
            return { id, x: ev.x, y: ev.y, image: ev.characterName(), trigger: page ? ev._trigger : null };
        }), HOUNDS);
        const before = await look(a);
        check('no hounds before anyone hears them', before.every((h) => !h.image && h.trigger === null), JSON.stringify(before));

        // B has been here longest: one tick short of "The hounds are coming!".
        await b.evaluate((t) => { $gameVariables.setValue(t, 249); }, TIMER);
        await waitFor(b, (c) => $gameSwitches.value(c), 15000, 'B hears the hounds', COMING);
        await waitFor(a, (c) => $gameSwitches.value(c), 5000, 'A hears them too', COMING).catch(() => {});
        const out = await look(a);
        check('the hounds are out on A\'s screen too, ready to fight', out.every((h) => /moonless/.test(h.image) && h.trigger === 2), JSON.stringify(out));

        // A runs the map: the hounds have to come for the players on both screens.
        let moved = false;
        for (let i = 0; i < 20 && !moved; i++) {
            await sleep(250);
            const now = await look(a);
            moved = now.some((h, k) => h.x !== out[k].x || h.y !== out[k].y);
        }
        check('they run, with the map run by the one who never heard them', moved);
        await sleep(600);
        const here = await Promise.all([look(a), look(b)]);
        const gaps = here[0].map((h, k) => Math.abs(h.x - here[1][k].x) + Math.abs(h.y - here[1][k].y));
        check('both screens have them in the same places', gaps.every((g) => g <= 2), JSON.stringify(here));

        // Level 5's knight: one roll per run, and his zone is everyone's.
        await a.evaluate(() => { $gameVariables.setValue(61, 2); });
        await waitFor(b, () => $gameVariables.value(61) === 2, 5000, 'B hears A\'s knight roll');
        await b.evaluate(() => { $gameVariables.setValue(61, 1); });
        await sleep(1500);
        const roll = await Promise.all([a, b].map((p) => p.evaluate(() => $gameVariables.value(61))));
        check('the knight roll is thrown once: a second throw is sent back', roll[0] === 2 && roll[1] === 2, JSON.stringify(roll));
        await b.evaluate(() => { $gameSwitches.setValue(360, true); });
        await waitFor(a, () => $gameSwitches.value(360), 5000, 'A hears the knight\'s zone armed').catch(() => {});
        check('the knight\'s zone is armed for both', await a.evaluate(() => $gameSwitches.value(360)));
    } catch (e) { console.error(e); check('test ran to the end', false, e && e.message); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
