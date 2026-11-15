// The smash pit (map 62): an elite guard who catches a player throws them in at 25,10. The pit's own guard
// (EV34) arms himself 200 frames after anyone arrives (2933), walks up to the nearest player and strikes on
// touch; the blow (EV1, 2934 on) is that player's scene, and the third one kills. Kept per player, he hunted
// one player while the partner saw him stand still (tools/hunt/ghosts.js touch, 11/14; his call: share him).
// B stands where the guards drop you, A far off, so B is the one he goes for.
const { twoPlayers, checker, sleep, waitFor } = require('./common');

const PIT = 62, GUARD = 34;

(async () => {
    const check = checker();
    let s;
    try {
        s = await twoPlayers(8518);
        const { a, b } = s;
        const go = (p, x, y) => p.evaluate((m, x, y) => $gamePlayer.reserveTransfer(m, x, y, 2, 0), PIT, x, y);
        const guard = (p) => p.evaluate((id) => {
            const ev = $gameMap.event(id);
            return { x: ev.x, y: ev.y, image: ev.characterName(), trigger: ev.page() ? ev._trigger : null, page: ev._pageIndex, swing: $gameSwitches.value(2935), armed: $gameSwitches.value(2933), striking: $gameSwitches.value(2934), refresh: $gameMap._needsRefresh, mine: $gameMap._interpreter.isRunning() ? $gameMap._interpreter.eventId() : 0 };
        }, GUARD);
        const blows = (p) => p.evaluate(() => [2934, 2937, 2938].map((id) => $gameSwitches.value(id)));

        await Promise.all([go(a, 25, 11), go(b, 25, 10)]);
        await waitFor(a, (m) => T.onMap() && $gameMap.mapId() === m, 30000, 'A in the pit', PIT);
        // Far from the guard, any open floor: he goes after whoever is nearest.
        const far = await a.evaluate((id) => {
            const g = $gameMap.event(id);
            const open = (x, y) => $gameMap.isValid(x, y) && !$gameMap.eventsXy(x, y).length && [2, 4, 6, 8].every((d) => $gameMap.isPassable(x, y, d));
            for (let r = 12; r < 40; r++) for (let y = 0; y < $gameMap.height(); y++) for (let x = 0; x < $gameMap.width(); x++) {
                if (Math.abs(x - g.x) + Math.abs(y - g.y) === r && open(x, y)) return [x, y];
            }
            return null;
        }, GUARD);
        check('found open floor far from the pit\'s guard', !!far, JSON.stringify(far));
        await a.evaluate((x, y) => { $gamePlayer.locate(x, y); }, far[0], far[1]);
        await waitFor(b, (m) => T.onMap() && $gameMap.mapId() === m, 30000, 'B in the pit', PIT);

        await waitFor(a, () => $gameSwitches.value(2933), 20000, 'the guard armed on A');
        await sleep(300);
        const armed = await Promise.all([guard(a), guard(b)]);
        check('he arms himself on both screens: the same guard walks up',
            armed.every((g) => g.armed && g.trigger === 2 && /eliteguard1/.test(g.image)), JSON.stringify(armed));

        // He goes for B, the nearest, and strikes.
        await waitFor(b, () => $gameSwitches.value(2934), 30000, 'the guard strikes B');
        await waitFor(a, () => $gameSwitches.value(2934), 5000, 'A hears the blow').catch(() => {});
        // His page changes on the map's next refresh, a frame after the switch comes in: read it then.
        const during = await a.evaluate(async (id) => {
            const read = () => ({ trigger: $gameMap.event(id)._trigger, striking: $gameSwitches.value(2934),
                mine: $gameMap._interpreter.isRunning() && $gameMap._interpreter.eventId() === 1, image: $gamePlayer.characterName() });
            const t0 = performance.now();
            let d = read(), frames = 0;
            while (d.striking && d.trigger !== 0 && performance.now() - t0 < 1000) { await new Promise((r) => requestAnimationFrame(r)); frames++; d = read(); }
            d.frames = frames;
            return d;
        }, GUARD);
        check('the blow is B\'s alone: on A\'s screen he stands there striking, and A is not hit',
            during.striking && during.trigger === 0 && !during.mine && !/bloody/.test(during.image), JSON.stringify(during));
        await waitFor(b, () => !$gameSwitches.value(2934), 15000, 'B\'s blow over');
        await sleep(800);
        const after = await Promise.all([guard(a), guard(b)]);
        check('then he stands down on both screens until he arms again', after.every((g) => !g.armed && !g.striking), JSON.stringify(after));
        const counted = await Promise.all([blows(a), blows(b)]);
        check('the blow counts for B only', !counted[0][1] && counted[1][1], JSON.stringify(counted));

        // The third blow is a game over: B dies and watches; the pit goes on for A.
        await waitFor(b, () => Coop.dead, 60000, 'B dead after the third blow');
        // His page follows on the map's next refresh, which comes late under a full gate's load (11/14: read before it, twice).
        await waitFor(a, (id) => !$gameSwitches.value(2934) && $gameMap.event(id)._trigger !== 0, 5000, 'A sees him stand down', GUARD).catch(() => {});
        const left = { a: await guard(a), aDead: await a.evaluate(() => Coop.dead), b: await blows(b) };
        check('B dies of the third blow and A lives on: he is not left frozen for A, and B\'s blows are forgotten',
            !left.aDead && !left.a.striking && left.a.trigger !== 0 && left.b.every((v) => !v), JSON.stringify(left));
    } catch (e) { console.error(e); check('test ran to the end', false, e && e.message); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
