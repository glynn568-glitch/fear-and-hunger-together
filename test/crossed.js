// Both players write one shared key at the same moment. The room keeps the one it handles last
// and passes each only to the other, so each writer got the partner's write after its own: before
// the room answered each batch ('wk'), each game ended on the other's value for good (Moonless's
// body set down at each player's own feet lay at the other one's feet on each screen,
// test/samefuzz.js 11/13). Now a game skips a partner's write while one of its own to that key
// is on the way, and a broken line forgets what was on the way. Model: spec/writes/Writes.tla.
// The room holds what it sends by FH_LAG, so both writes reach it before either hears the other.
// The room writes what it did with the key to TRACE (room.js traceWrite) and the test adds what
// each game held whenever nothing was on the way: test/out/crossed-trace.ndjson, a real run for
// spec/writes/TraceWrites.tla (copied into spec/writes/traces/ by hand).
const fs = require('fs');
const path = require('path');
const { twoPlayers, checker, sleep, waitFor } = require('./common');

const KEY = 88; // moonless_affection: shared, not a die thrown once, nothing runs on it
const TRACE = path.join(__dirname, 'out', 'crossed-trace.live.ndjson');

(async () => {
    const check = checker();
    let s;
    try {
        fs.mkdirSync(path.dirname(TRACE), { recursive: true });
        fs.writeFileSync(TRACE, '');
        s = await twoPlayers(8517, { env: { FH_LAG: '300', FH_WRITES_TRACE: TRACE + '|va' + KEY } });
        const { a, b } = s;
        const set = (p, v) => p.evaluate((k, v) => { $gameVariables.setValue(k, v); }, KEY, v);
        const get = (p) => p.evaluate((k) => $gameVariables.value(k), KEY);
        // A partner's write to the key that this game did not take (it runs after state.js's own
        // handler): proof that the writes really crossed, not that one landed before the other.
        for (const p of [a, b]) {
            await p.evaluate((k) => {
                window.SKIPPED = 0;
                Coop.on('w', (msg) => { for (const [kind, key, value] of msg.w) if (kind === 'va' && key === k && $gameVariables.value(k) !== value) SKIPPED++; });
            }, KEY);
        }
        const skipped = async () => (await a.evaluate(() => SKIPPED)) + (await b.evaluate(() => SKIPPED));
        // Both are in the world and nothing has written the key: the spec's start.
        fs.writeFileSync(TRACE, JSON.stringify({ event: 'Init', once: false }) + '\n');
        const settled = async () => {
            await sleep(800);
            fs.appendFileSync(TRACE, JSON.stringify({ event: 'Settled', vals: { Ann: await get(a), Bo: await get(b) } }) + '\n');
        };

        for (let round = 1; round <= 4; round++) {
            const was = await skipped();
            await Promise.all([set(a, 10 + round), set(b, 20 + round)]);
            await sleep(1500);
            const got = [await get(a), await get(b)];
            check(`round ${round}: the writes crossed (a game held its own over the partner's)`, await skipped() > was);
            check(`round ${round}: both games hold the same one`, got[0] === got[1] && [10 + round, 20 + round].includes(got[0]), JSON.stringify(got));
            await settled();
        }

        // Nothing is left counted on the way: a lone write still lands, both ways.
        await set(a, 31);
        await waitFor(b, (k) => $gameVariables.value(k) === 31, 5000, 'B gets A\'s next write', KEY).catch(() => {});
        check('after the crossings B still takes A\'s writes', await get(b) === 31, String(await get(b)));
        await set(b, 32);
        await waitFor(a, (k) => $gameVariables.value(k) === 32, 5000, 'A gets B\'s next write', KEY).catch(() => {});
        check('and A takes B\'s', await get(a) === 32, String(await get(a)));
        await settled();

        // B's line breaks with its write sent and the room's answer still held back.
        await set(b, 41);
        await sleep(100);
        await b.evaluate(() => Coop._ws.close());
        await waitFor(b, () => Coop.connected && Coop.world.live, 30000, 'B back in the world');
        await sleep(1000);
        const back = [await get(a), await get(b)];
        check('after the broken line both hold one value', back[0] === back[1], JSON.stringify(back));
        await settled();
        await set(a, 42);
        await waitFor(b, (k) => $gameVariables.value(k) === 42, 5000, 'B gets A\'s write after the break', KEY).catch(() => {});
        check('B takes A\'s writes after the break: the lost answer is not still waited for', await get(b) === 42, String(await get(b)));
        await settled();
        // Kept before the end of the test drops both lines.
        fs.writeFileSync(path.join(__dirname, 'out', 'crossed-trace.ndjson'), fs.readFileSync(TRACE, 'utf8'));
    } catch (e) { console.error(e); check('test ran to the end', false, e && e.message); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
