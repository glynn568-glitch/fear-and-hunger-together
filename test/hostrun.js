// The host's game decides which run is played. A friend who gets into the
// dungeon first waits for the host to start or continue one, and then joins
// it, instead of founding a run of their own that the host cannot join.
// Not for ever: a host who does not start lets them go on alone, and a host
// waiting as the dead (loaded a save they died in) holds nobody up.
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const install = require('./helpers');
const { checker } = require('./common');

const hud = (p) => p.evaluate(() => (document.getElementById('coop-hud') ? document.getElementById('coop-hud').innerText : ''));

// A host on this PC and a friend through their own server.
async function pair(browser, port, env) {
    const host = await startServer(port, env);
    const joiner = await startServer(port + 100, Object.assign({ FH_JOIN: `http://localhost:${port}/` }, env));
    const a = await openPlayer(browser, `http://localhost:${port}/?name=Ann`, 'host');
    const b = await openPlayer(browser, `http://localhost:${port + 100}/?name=Bo`, 'friend');
    for (const p of [a, b]) {
        await waitFor(p, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected && Coop.peers.size === 1, 90000, 'title + connection');
        await p.evaluate(install);
    }
    await sleep(600);
    return { a, b, close: async () => { await a.close(); await b.close(); host.kill(); joiner.kill(); } };
}

const friendEnters = async (b) => {
    await b.evaluate(() => T.quickStart(3, 28, 67));
    await waitFor(b, () => T.onMap(), 60000, 'friend on map');
    await b.evaluate(() => T.begin());
};

(async () => {
    const check = checker();
    const browser = await launch();
    const pages = [];
    try {
        //--- the friend is first; the host starts; the friend joins the host's run
        let s = await pair(browser, 8498, {});
        let { a, b } = s;
        pages.push(a, b);
        check('the friend\'s title screen says whose game sets the run', /Ann's game sets the run/.test(await hud(b)), await hud(b));
        check('the host\'s does not', !/sets the run/.test(await hud(a)), await hud(a));
        await friendEnters(b);
        await waitFor(b, () => Coop.world.hostWait === 'Ann', 10000, 'the friend is told to wait');
        await sleep(3000);
        check('the friend waits instead of founding a run of their own', await b.evaluate(() => !Coop.world.live && Coop.world.hostWait === 'Ann'));
        check('and is told so on screen', /waiting for Ann to start or continue a game/.test(await hud(b)), await hud(b));
        await a.evaluate(() => T.quickStart(1, 27, 67));
        await waitFor(a, () => T.onMap(), 60000, 'host on map');
        await a.evaluate(() => { $gameSwitches.setValue(25, true); T.begin(); });
        await waitFor(a, () => Coop.world.live, 10000, 'host live');
        await waitFor(b, () => Coop.world.live, 10000, 'friend joins the host\'s run');
        const runs = [await a.evaluate(() => Coop.world.runId), await b.evaluate(() => Coop.world.runId)];
        check('once the host is in, the friend joins the host\'s run', runs[0] && runs[0] === runs[1], runs.join(' vs '));
        check('and has the host\'s world', await b.evaluate(() => $gameSwitches.value(25) && !Coop.world.hostWait));
        await sleep(600); // the corner list redraws four times a second
        check('the waiting notice is gone', !/waiting for/.test(await hud(b)), await hud(b));
        await s.close();

        //--- a host who never starts: after the wait, the friend goes on alone
        s = await pair(browser, 8499, { FH_HOST_WAIT: '5000' });
        ({ a, b } = s);
        pages.push(a, b);
        await friendEnters(b);
        await waitFor(b, () => Coop.world.hostWait === 'Ann', 10000, 'the friend waits');
        await waitFor(b, () => Coop.world.live, 15000, 'the friend goes on alone');
        check('a host who does not start within the wait does not keep the friend out for ever', await b.evaluate(() => Coop.world.live && !Coop.world.hostWait));
        await s.close();

        //--- the host loads a save they died in: they wait for a living player, and hold nobody up
        s = await pair(browser, 8497, {});
        ({ a, b } = s);
        pages.push(a, b);
        await a.evaluate(() => Coop.send({ t: 'world?', how: 'load', dead: true, ini: [], runId: '', stamp: 0 }));
        await sleep(800);
        await friendEnters(b);
        await waitFor(b, () => Coop.world.live, 15000, 'the friend founds the run');
        check('a host waiting as the dead does not hold the friend up', await b.evaluate(() => Coop.world.live && !Coop.world.hostWait));
        await s.close();
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(pages);
    await browser.close();
    process.exit(code);
})();
