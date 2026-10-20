// Three in one fight, and one guest's screen never answers for the pictures it
// gets (a page stalled, a line that swallows the replies). The other guest
// still gets the full picture: the video is not cut for everyone on account
// of the one who says nothing.
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const install = require('./helpers');
const { checker } = require('./common');

const PORT = 8530;
const PLAYERS = [
    { name: 'Ann', actor: 1, x: 27, y: 67 },
    { name: 'Bo', actor: 3, x: 28, y: 67 },
    { name: 'Cy', actor: 4, x: 27, y: 66 },
];

(async () => {
    const check = checker();
    // About one quiet watcher, not a narrow line: the gate's slow-line settings are left out.
    const server = await startServer(PORT, { FH_RELAY: null, FH_LAG: null, FH_RATE: null });
    const browser = await launch();
    const pages = [];
    try {
        for (const p of PLAYERS) pages.push(await openPlayer(browser, `http://localhost:${PORT}/?name=${p.name}`, p.name));
        for (const page of pages) {
            await waitFor(page, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 120000, 'title + connection');
            await page.evaluate(install);
        }
        for (let i = 0; i < PLAYERS.length; i++) {
            const p = PLAYERS[i], page = pages[i];
            await page.evaluate((act, x, y) => T.quickStart(act, x, y), p.actor, p.x, p.y);
            await waitFor(page, () => T.onMap(), 60000, p.name + ' on map');
            await page.evaluate(() => { T.settle(); T.begin(); });
            await waitFor(page, () => Coop.world.live, 15000, p.name + ' live');
        }
        await sleep(1200);
        const [a, b, c] = pages;

        await a.evaluate(() => { BattleManager.setup(1, true, true); SceneManager.push(Scene_Battle); });
        for (const pg of [b, c]) await waitFor(pg, () => SceneManager._scene instanceof Scene_CoopSpectate, 15000, pg.label + ' pulled into the fight');
        await waitFor(a, () => BattleManager._phase === 'input' && BattleManager.actor(), 30000, 'command input');
        for (const pg of [b, c]) await waitFor(pg, () => (Coop.relayOnly ? Coop.viewer.clip : Coop.viewer.video), 25000, pg.label + ' gets video');
        await sleep(3000);
        const full = await a.evaluate(() => Coop.stream.clip.rate);

        // Cy goes quiet: pictures still reach Cy, no answer comes back.
        await c.evaluate(() => { const send = Coop.sendTo; Coop.sendTo = function (id, kind) { return kind === 'fseen' ? true : send.apply(this, arguments); }; });
        await a.evaluate(() => { window.LOW = Coop.stream.clip.rate; window.LOWT = setInterval(() => { LOW = Math.min(LOW, Coop.stream.clip.rate); }, 100); });
        const f0 = await b.evaluate(() => Coop.viewer.frames);
        const t0 = Date.now();
        // The owner's screen keeps changing, as in a real turn.
        for (let i = 0; i < 24; i++) { const k = ['ArrowDown', 'ArrowUp'][i % 2]; await a.keyboard.down(k); await sleep(80); await a.keyboard.up(k); await sleep(340); }
        const secs = (Date.now() - t0) / 1000;
        const fps = (await b.evaluate(() => Coop.viewer.frames) - f0) / secs;
        const low = await a.evaluate(() => { clearInterval(LOWT); return LOW; });
        const detail = `bitrate ${full} at first, lowest ${low} over ${secs.toFixed(0)} s; Bo ${fps.toFixed(1)} pictures/s`;
        console.log(detail);
        // The other guest's own pacing may trim it once or twice on a busy machine; the
        // quiet one alone used to take it to a third of that in these ten seconds.
        check('the quiet guest does not cut the video for the other', low >= full * 0.45, detail);
        check('the other guest keeps a full picture rate', fps >= 25, detail);

        // Alone with the quiet one, the owner does slow down for them.
        await b.evaluate(() => { const send = Coop.sendTo; Coop.sendTo = function (id, kind) { return kind === 'fseen' ? true : send.apply(this, arguments); }; });
        await sleep(9000);
        const alone = await a.evaluate(() => Coop.stream.clip.rate);
        check('with nobody answering, the video slows down', alone < full * 0.5, `bitrate ${alone}, was ${full}`);
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(pages);
    await browser.close();
    server.kill();
    process.exit(code);
})();
