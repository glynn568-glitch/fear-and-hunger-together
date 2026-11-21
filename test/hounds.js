// The hounds hunt everyone on the floor. Their every page waits on HOUNDS_ARE_COMING (1781), which each
// machine's own bark timer turns on; kept per player, the hounds came out on one screen only, and the
// partner saw "invisible wolves" start a fight (report 11/13). The level 5 knight is the same: his
// zone switch (360) and the start-of-run die that decides whether he stands there at all (61). So is the
// black witch, per floor: the Ancient city's inside (114) and the Grand library (116) each have her, woken
// by the same four switches (3451, 3453, 3454, 3457), and a room change (common event 271, on the floor
// the door is on) sends her away. Everyone on her floor sees her; a partner on the other floor sees
// nothing, and gets her as soon as they walk onto her floor (client/state.js World.fs, spec/floors).
// The room writes what it does with 3451 to TRACE (room.js traceWrite), and the test adds where each game
// stands and what it shows at each quiet moment: spec/floors/TraceFloors.tla checks the run.
const fs = require('fs');
const path = require('path');
const { twoPlayers, checker, sleep, waitFor } = require('./common');

const HOUNDS = [102, 113, 114]; // Map074 Fortress: hound1, hound2, hound3
const COMING = 1781, TIMER = 211;
const ARMS = [3451, 3453, 3454, 3457];
// Each floor's copy of her (black_witch1), where she sleeps, and where her tiles bring her.
const HALLS = { map: 114, ev: 209, spots: [[99, 44], [24, 43]] }; // Ancient city - Inside
const LIBRARY = { map: 116, ev: 309, spots: [[42, 21], [28, 83]] }; // Grand library
const TRACE = path.join(__dirname, 'out', 'floors-trace.live.ndjson');

(async () => {
    const check = checker();
    let s;
    try {
        fs.mkdirSync(path.dirname(TRACE), { recursive: true });
        fs.writeFileSync(TRACE, '');
        s = await twoPlayers(8516, { env: { FH_WRITES_TRACE: TRACE + '|fs3451' } });
        const { a, b } = s;
        const go = (p, map, x, y) => p.evaluate((map, x, y) => $gamePlayer.reserveTransfer(map, x, y, 2, 0), map, x, y);
        const on = (p, map, who) => waitFor(p, (m) => T.onMap() && $gameMap.mapId() === m && !$gamePlayer.isTransferring(), 30000, who + ' on map ' + map, map);
        const roomChange = (p) => p.evaluate(() => {
            const i = new Game_Interpreter();
            i.setup($dataCommonEvents[271].list, 0);
            for (let k = 0; k < 3000 && i.isRunning(); k++) i.update();
            return !i.isRunning();
        });
        const witch = (p, floor) => p.evaluate((id) => { const ev = $gameMap.event(id); return { x: ev.x, y: ev.y, image: ev.characterName(), trigger: ev.page() ? ev._trigger : null, on: $gameSwitches.value(3451) }; }, floor.ev);
        const isOut = (w) => /black_angel2/.test(w.image) && w.trigger === 2;
        const where = (p) => p.evaluate(() => ({ at: String($gameMap.mapId()), sw: $gameSwitches.value(3451) ? 1 : 0 }));
        const settled = async () => {
            await sleep(800);
            const [wa, wb] = [await where(a), await where(b)];
            fs.appendFileSync(TRACE, JSON.stringify({ event: 'Settled', at: { Ann: wa.at, Bo: wb.at }, sw: { Ann: wa.sw, Bo: wb.sw } }) + '\n');
        };
        // Open floor as far as can be from where she sleeps and where she wakes (she walks toward the nearest player).
        const farSpot = (p, floor) => p.evaluate((id, spots) => {
            const w = $gameMap.event(id);
            const open = (x, y) => $gameMap.isValid(x, y) && !$gameMap.eventsXy(x, y).length && [2, 4, 6, 8].every((d) => $gameMap.isPassable(x, y, d));
            let best = null;
            for (let y = 0; y < $gameMap.height(); y++) for (let x = 0; x < $gameMap.width(); x++) {
                const d = Math.min(...[[w.x, w.y]].concat(spots).map(([sx, sy]) => Math.abs(x - sx) + Math.abs(y - sy)));
                if ((!best || d > best[2]) && open(x, y) && open(x + 1, y)) best = [x, y, d];
            }
            return best;
        }, floor.ev, floor.spots);
        fs.writeFileSync(TRACE, JSON.stringify({ event: 'Init', at: { Ann: String(await a.evaluate(() => $gameMap.mapId())), Bo: String(await b.evaluate(() => $gameMap.mapId())) } }) + '\n');

        //--- Split across her two floors: B in the Ancient city, A in the library.
        await go(b, HALLS.map, 1, 1);
        await on(b, HALLS.map, 'B');
        const hallSpot = await farSpot(b, HALLS);
        await b.evaluate((x, y) => { $gamePlayer.locate(x, y); }, hallSpot[0], hallSpot[1]);
        await go(a, LIBRARY.map, 1, 1);
        await on(a, LIBRARY.map, 'A');
        const libSpot = await farSpot(a, LIBRARY);
        check('found open floor far from her on both floors', hallSpot[2] >= 30 && libSpot[2] >= 30, JSON.stringify([hallSpot, libSpot]));
        await a.evaluate((x, y) => { $gamePlayer.locate(x, y); }, libSpot[0], libSpot[1]);
        await settled();
        const asleep = [await witch(a, LIBRARY), await witch(b, HALLS)];
        check('no witch on either floor before anyone wakes her', asleep.every((w) => !w.image && !w.on), JSON.stringify(asleep));

        // B steps on her tile in the Ancient city.
        await b.evaluate(() => { $gameSwitches.setValue(3453, true); });
        await waitFor(b, () => $gameSwitches.value(3451), 20000, 'the witch awake on B');
        await sleep(1500); // the library's own tile page would have run on A by now
        const split = { a: await witch(a, LIBRARY), aArms: await a.evaluate((ids) => ids.filter((id) => $gameSwitches.value(id)), ARMS), b: await witch(b, HALLS) };
        check('B wakes her in the Ancient city: out there on B\'s screen', isOut(split.b), JSON.stringify(split.b));
        check('and the library\'s copy stays asleep on A\'s, nobody having stepped on its tile', !split.a.image && !split.aArms.length, JSON.stringify(split));
        await settled();

        // A goes through a door in the library: she is not sent away from B's floor.
        check('A\'s room change in the library runs', await roomChange(a));
        await sleep(1000);
        const stays = await witch(b, HALLS);
        check('a door on the other floor leaves her out for B', isOut(stays) && stays.on, JSON.stringify(stays));
        await settled();

        // A walks onto her floor while she is out (a transfer with no room change of its own): A sees her too.
        await go(a, HALLS.map, hallSpot[0] + 1, hallSpot[1]);
        await on(a, HALLS.map, 'A');
        await sleep(1200);
        const both = [await witch(a, HALLS), await witch(b, HALLS)];
        check('A, arriving on her floor while she is out, sees her where B does',
            both.every(isOut) && Math.abs(both[0].x - both[1].x) + Math.abs(both[0].y - both[1].y) <= 2, JSON.stringify(both));
        await settled();

        // B goes through a door there: she is sent away for everyone on her floor.
        check('B\'s room change runs', await roomChange(b));
        await waitFor(a, (ids) => ids.every((id) => !$gameSwitches.value(id)), 5000, 'A hears her sent away', ARMS).catch(() => {});
        await sleep(300);
        const gone = [await witch(a, HALLS), await witch(b, HALLS)];
        check('B changes rooms on her floor: she is gone from both screens', gone.every((w) => !w.image), JSON.stringify(gone));
        await settled();

        // Woken again; A's line drops, A takes the stairs to the library while it is down, and comes back.
        await b.evaluate(() => { $gameSwitches.setValue(3453, true); });
        await waitFor(b, () => $gameSwitches.value(3451), 20000, 'the witch awake on B again');
        await waitFor(a, () => $gameSwitches.value(3451), 5000, 'and on A').catch(() => {});
        await settled();
        await a.evaluate(() => { Coop._realConnect = Coop._realConnect || Coop.connect; Coop.connect = function () {}; Coop._ws.close(); });
        await waitFor(a, () => !Coop.connected && !Coop.world.live, 5000, 'A\'s line down');
        await go(a, LIBRARY.map, libSpot[0], libSpot[1]);
        await on(a, LIBRARY.map, 'A');
        await a.evaluate(() => { Coop.connect = Coop._realConnect; Coop.connect(); });
        await waitFor(a, () => Coop.connected && Coop.world.live, 20000, 'A back in the world');
        await sleep(1200);
        const back = { a: await witch(a, LIBRARY), b: await witch(b, HALLS) };
        check('A, back in the world in the library, shows no witch there', !back.a.image && !back.a.on, JSON.stringify(back.a));
        check('and she is still out for B in the Ancient city', isOut(back.b), JSON.stringify(back.b));
        const prints = [await a.evaluate(() => Coop.world.fingerprint()), await b.evaluate(() => Coop.world.fingerprint())];
        check('both keep the same world, her floor included', prints[0] === prints[1] && /f114,3451/.test(prints[0]), prints.map((f) => (f.match(/f\d+,\d+/g) || []).join(' ')).join(' | '));
        await settled();
        check('B\'s last room change runs', await roomChange(b));
        await settled();
        // A twin's run (a fix taken out) is no trace of the mod: the live file is left for a reject trace.
        if (!process.env.FH_TWIN) fs.writeFileSync(path.join(__dirname, 'out', 'floors-trace.ndjson'), fs.readFileSync(TRACE, 'utf8'));

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
