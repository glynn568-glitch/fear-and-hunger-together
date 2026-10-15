// A dropped connection: the player keeps playing, reconnects, and catches up
// on what changed while they were away.
const { twoPlayers, checker, sleep, waitFor, sees } = require('./common');

(async () => {
    const check = checker();
    let s;
    try {
        s = await twoPlayers(8466);
        const { a, b } = s;
        await b.evaluate(() => Coop._ws.close());
        await waitFor(a, () => Coop.peers.size === 0, 5000, 'A notices B is gone');
        check('A stops drawing the player who dropped', await a.evaluate(() => Coop.peersHere().length) === 0);
        // Both keep changing the world while apart.
        await a.evaluate(() => $gameSwitches.setValue(25, true));
        await b.evaluate(() => { $gameSwitches.setValue(27, true); T.step(8); });
        await waitFor(b, () => Coop.connected && Coop.world.live, 15000, 'B reconnects and resyncs');
        await sleep(1200);
        check('B caught up on what A did meanwhile', await b.evaluate(() => $gameSwitches.value(25)));
        check('what B did offline reached A', await a.evaluate(() => $gameSwitches.value(27)));
        check('they see each other again', (await sees(a, 1)) && (await sees(b, 1)));
        const pos = await a.evaluate(() => { const p = Coop.others()[0]; return p.x + ',' + p.y; });
        check('A has the position B walked to while offline', pos === '28,66', pos);
        check('one owner', (await a.evaluate(() => Coop.events.amOwner())) !== (await b.evaluate(() => Coop.events.amOwner())));
        const fa = await a.evaluate(() => Coop.world.fingerprint()), fb = await b.evaluate(() => Coop.world.fingerprint());
        check('shared state identical', fa === fb);
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
