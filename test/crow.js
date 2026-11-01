// The Crow Mauler's hunt is one hunt. His alert (786) was shared but the roll that sends him
// (773/774, 779) stayed on the machine that threw it: the partner saw an empty floor, and if the
// partner owned the map he never took a step on either screen.
const { twoPlayers, checker, sleep, waitFor } = require('./common');

(async () => {
    const check = checker();
    let s;
    try {
        s = await twoPlayers(8596);
        const { a, b } = s;
        const owner = await a.evaluate(() => Coop.events.amOwner());
        check('A simulates the map, and B is the one who rolls him', owner);
        // B's dice bring him at the first try; A's never would.
        await a.evaluate(() => { Math.randomInt = () => 9; });
        await b.evaluate(() => { Math.randomInt = () => 0; $gameSwitches.setValue(786, true); });
        await waitFor(a, () => $gameSwitches.value(786), 5000, 'A hears the alert');
        await waitFor(b, () => $gameSwitches.value(779), 40000, 'B rolled him');
        await waitFor(a, () => $gameSwitches.value(773) || $gameSwitches.value(774), 5000, 'A hears the roll').catch(() => {});
        const pages = await Promise.all([a, b].map((p) => p.evaluate(() => {
            const ev = $gameMap.event(197);
            const page = ev.page();
            return { route: $gameSwitches.value(773) ? 1 : $gameSwitches.value(774) ? 2 : 0, set: $gameSwitches.value(779), walks: !!page && page.moveType === 3, image: ev.characterName(), trigger: ev._trigger };
        })));
        check('the partner who did not roll has him too', pages[0].route === pages[1].route && pages[0].walks && pages[0].image && pages[0].trigger === 2, JSON.stringify(pages));
        check('and does not roll a second one', pages[0].set, JSON.stringify(pages[0]));
        const at = (p) => p.evaluate(() => { const ev = $gameMap.event(197); return [ev.x, ev.y]; });
        // Events only move near a player's screen; he lands far off. A goes to meet him.
        const spot = await a.evaluate(() => {
            // Four steps off along open floor, so a wall cannot hold him at his landing tile.
            const ev = $gameMap.event(197);
            let x = ev.x, y = ev.y, was = 0;
            for (let step = 0; step < 4; step++) {
                const d = [2, 4, 6, 8].find((dir) => dir !== 10 - was && ev.canPass(x, y, dir));
                if (!d) break;
                x = $gameMap.roundXWithDirection(x, d);
                y = $gameMap.roundYWithDirection(y, d);
                was = d;
            }
            $gamePlayer.locate(x, y);
            return [x, y];
        });
        check('he has open floor to walk', spot[0] !== 68 || spot[1] !== 37, JSON.stringify(spot));
        const first = await at(a);
        let moved = false;
        for (let i = 0; i < 40 && !moved; i++) {
            await sleep(500);
            const now = await at(a);
            moved = now[0] !== first[0] || now[1] !== first[1];
        }
        check('he walks, with the map owner one who never rolled', moved, JSON.stringify(first));
        await sleep(1500);
        const here = await Promise.all([at(a), at(b)]);
        const gap = Math.abs(here[0][0] - here[1][0]) + Math.abs(here[0][1] - here[1][1]);
        check('both screens have him in the same place', gap <= 2, JSON.stringify(here));
        await b.evaluate(() => { $gameSwitches.setValue(771, true); });
        await waitFor(a, () => $gameSwitches.value(771), 5000, 'A hears he is dead');
        const dead = await a.evaluate(() => { const p = $gameMap.event(197).page(); return !!p && p.moveType === 0; });
        check('killed by one, he is a body for both', dead);
    } catch (e) { console.error(e); check('test ran to the end', false, e && e.message); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
