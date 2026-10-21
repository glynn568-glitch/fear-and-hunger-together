// A joiner's line to the host that goes quiet without closing. 10/20: the host
// gave up on his friend at 20:39:02 (no answer to a ping), and the friend's game
// played on alone for minutes, five fights, before it said it had lost the
// connection. The joiner's own server has to notice within seconds, tell the
// page, and get back in by itself once the line works again.
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const install = require('./helpers');
const { checker } = require('./common');
const { quietLine } = require('./chaos');

const HOST = 8725, LINE = 8726, JOINER = 8727;
const KEY = 'quietline';

(async () => {
    const check = checker();
    const host = await startServer(HOST, { FH_KEY: KEY });
    const line = await quietLine(LINE, HOST);
    const joiner = await startServer(JOINER, { FH_JOIN: `${line.url}/?k=${KEY}` });
    const browser = await launch();
    let a, b;
    try {
        a = await openPlayer(browser, `http://localhost:${HOST}/?name=Ann`, 'host');
        b = await openPlayer(browser, `http://localhost:${JOINER}/?name=Bo`, 'joiner');
        for (const p of [a, b]) {
            await waitFor(p, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 90000, 'title + connection');
            await p.evaluate(install);
        }
        await a.evaluate(() => T.quickStart(1, 27, 67));
        await waitFor(a, () => T.onMap(), 60000, 'host on map');
        await a.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(a, () => Coop.world.live, 10000, 'host live');
        await b.evaluate(() => T.quickStart(3, 28, 67));
        await waitFor(b, () => T.onMap(), 60000, 'joiner on map');
        await b.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(b, () => Coop.world.live, 10000, 'joiner live');
        await sleep(800);
        check('the joiner plays in the host\'s world through the line', await a.evaluate(() => Coop.peersHere().length) === 1 && await b.evaluate(() => Coop.peersHere().length) === 1);

        // The line goes quiet. Nothing is closed; the host lets go after its own pings (15-30 s).
        await b.evaluate(() => { const toast = Coop.toast; window._toasts = []; Coop.toast = function (text) { window._toasts.push(text); return toast.apply(this, arguments); }; });
        line.quiet(true);
        const t0 = Date.now();
        const noticed = await waitFor(b, () => !Coop.connected, 45000, 'the joiner notices').then(() => true, () => false);
        const secs = (Date.now() - t0) / 1000;
        check('the joiner\'s game notices a line that went quiet within 15 s, not minutes later', noticed && secs <= 15, noticed ? secs.toFixed(1) + ' s' : 'not within 45 s');
        const told = await b.evaluate(() => ({ log: Coop.log.slice(-3), toasts: window._toasts }));
        check('...and the player is told', told.log.includes('lost the connection, retrying') && told.toasts.some((t) => /Cannot reach the host/.test(t)), JSON.stringify(told));

        // The line works again at once, before the host has noticed the old one is dead: the
        // joiner comes back to find its own old self still there, and still rejoins the world.
        line.quiet(false, 5000);
        const quick = await waitFor(b, () => Coop.connected && Coop.world.live, 20000, 'the joiner back in the world').then(() => true, () => false);
        const ghost = await b.evaluate(() => Coop.log.filter((l) => /^connected as player/.test(l)).pop() || '');
        check('back within seconds, while the host still held its old line, the joiner rejoins the shared world', quick && /, 2 other\(s\) here$/.test(ghost), ghost + ' / ' + (await b.evaluate(() => Coop.log.slice(-2).join(' | '))));
        await sleep(1500);
        check('...and they see each other', await a.evaluate(() => Coop.peersHere().length) === 1 && await b.evaluate(() => Coop.peersHere().length) === 1);

        // Quiet again, this time for long.
        line.quiet(true);
        await waitFor(b, () => !Coop.connected, 45000, 'the joiner notices again');

        // Still quiet, and the joiner keeps trying. It comes back on a try whose handshake the
        // line swallowed: that one has to be given up on too.
        await waitFor(a, () => Coop.peers.size === 0, 40000, 'the host lets go of the joiner');
        for (const t = Date.now(); !line.hung() && Date.now() - t < 20000;) await sleep(100);
        line.quiet(false);
        const t1 = Date.now();
        const back = await waitFor(b, () => Coop.connected && Coop.world.live, 40000, 'the joiner back').then(() => true, () => false);
        check('once the line works again the joiner is back in by itself', back, back ? ((Date.now() - t1) / 1000).toFixed(1) + ' s' : 'not within 40 s');
        await sleep(1500);
        check('and they see each other again', await a.evaluate(() => Coop.peersHere().length) === 1 && await b.evaluate(() => Coop.peersHere().length) === 1);
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish([a, b].filter(Boolean));
    await browser.close();
    host.kill(); joiner.kill(); line.close();
    process.exit(code);
})();
