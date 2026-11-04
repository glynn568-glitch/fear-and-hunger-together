// A join that breaks halfway (11/03: the world reply threw on Enki's game).
// The player is told, and the server stops counting them in the run once
// their game says "title", so the host is not locked out of their own save.
const fs = require('fs');
const path = require('path');
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const { checker } = require('./common');
const install = require('./helpers');

const titleReady = () => window.SceneManager && SceneManager._scene instanceof Scene_Title && !SceneManager.isSceneChanging() && window.Coop && Coop.connected;
const toast = () => document.getElementById('coop-toast').textContent;

(async () => {
    const check = checker();
    const port = 8504;
    let server, browser, pages = [];
    try {
        server = await startServer(port, { FH_TITLE_GHOST: '3000' });
        browser = await launch();
        const a = await openPlayer(browser, `http://localhost:${port}/?name=Ann`, 'Ann');
        const b = await openPlayer(browser, `http://localhost:${port}/?name=Bo`, 'Bo');
        pages = [a, b];
        for (const p of [a, b]) {
            await waitFor(p, titleReady, 90000, 'title');
            await p.evaluate(install);
        }
        await a.evaluate(() => T.quickStart(1, 27, 67));
        await waitFor(a, () => T.onMap(), 60000, 'Ann on the map');
        await a.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(a, () => Coop.world.live, 10000, 'Ann live');
        await a.evaluate(() => { $gameSystem.onBeforeSave(); DataManager.saveGame(1); });

        // Bo's join breaks inside the world reply, as Enki's did.
        await b.evaluate(() => T.quickStart(4, 27, 66));
        await waitFor(b, () => T.onMap(), 60000, 'Bo on the map');
        await b.evaluate(() => {
            T.settle();
            Coop._handlers.world = [function () { throw new Error('a join that breaks'); }];
            T.begin();
        });
        await waitFor(b, () => /Joining failed/.test(document.getElementById('coop-toast').textContent), 10000, 'Bo told').catch(() => {});
        const told = await b.evaluate(toast);
        const bo = await b.evaluate(() => ({ live: Coop.world.live }));
        check('a join that breaks tells the player', /Joining failed/.test(told) && !bo.live, JSON.stringify({ told, bo }));

        // Three seconds of "title" from a player the server let in, and they are out of the run.
        const log = path.join(__dirname, 'out', 'server-' + port + '.log');
        const said = () => { try { return fs.readFileSync(log, 'utf8'); } catch (e) { return ''; } };
        for (let i = 0; i < 40 && !/said title while in the run/.test(said()); i++) await sleep(250);
        check('the server takes them out of the run', /\(Bo\) said title while in the run; out of it/.test(said()), said().split('\n').filter((l) => /title/.test(l)).join(' | '));

        // The host goes to the title and loads their own save of the run: it is theirs again.
        await a.evaluate(() => SceneManager.goto(Scene_Title));
        await waitFor(a, titleReady, 20000, 'Ann at the title');
        await a.evaluate(() => { DataManager.loadGame(1); SceneManager.goto(Scene_Map); $gameSystem.onAfterLoad(); });
        const back = await waitFor(a, () => SceneManager._scene instanceof Scene_Map && T.onMap() && Coop.world.live, 20000, 'Ann back in').then(() => true, () => false);
        const annToast = await a.evaluate(toast);
        check('the host loads their own save again, not refused as stale', back && !/earlier in a run/.test(annToast), JSON.stringify({ back, annToast }));
    } catch (e) {
        console.error(e);
        check('test ran to the end', false);
    }
    // The one error this test throws on purpose is not a fault.
    for (const p of pages) p.errors = p.errors.filter((e) => !/a join that breaks/.test(e));
    const code = check.finish(pages);
    if (browser) await browser.close();
    if (server) server.kill();
    process.exit(code);
})();
