// New Game by each input, then the opening on a controller, until that player is in the run.
// One pad the whole way, one mouse on the title then the pad, one touch on the title then the pad.
// The held picker is not pressed here: it confirms by itself, and test/lobby.js checks that by pressing nothing (11/22).
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const { checker } = require('./common');
const install = require('./helpers');
const { titleReady, watch, playIn, who, plugPad, tapPad } = require('./lobbylib');

const PORT = 8534;
const JOIN = PORT + 100; // reserved; this suite is one player

const lineAt = (p, name) => p.evaluate((name) => {
    const w = SceneManager._scene._commandWindow, i = w._list.findIndex((c) => c.name === name);
    const r = w.itemRect(i), box = Graphics._canvas.getBoundingClientRect(), k = box.width / Graphics.width;
    return { x: box.left + (w.x + w.padding + r.x + r.width / 2) * k, y: box.top + (w.y + w.padding + r.y + r.height / 2) * k };
}, name);

async function one(kind, browser, check, seen) {
    const server = await startServer(PORT, { FH_MIND: 'none' });
    let page;
    try {
        page = await openPlayer(browser, `http://localhost:${PORT}/?name=Ann`, kind);
        seen.push(page);
        // Puppeteer reloads the page when hasTouch changes: before the title, not under it.
        if (kind === 'touch') await page.setViewport({ width: 900, height: 700, hasTouch: true });
        await waitFor(page, titleReady, 90000, kind + ' at the title');
        await page.evaluate(install);
        await page.evaluate(watch);
        await page.evaluate(plugPad);
        await waitFor(page, () => { const w = SceneManager._scene && SceneManager._scene._commandWindow; return w && w.isOpen() && w._list[0] && w._list[0].name === 'New Game'; }, 15000, kind + ' New Game');
        await sleep(300);
        if (kind === 'controller') {
            // Up from the first line wraps to Together, so A is pressed only once New Game is the line.
            for (let i = 0; i < 4; i++) {
                const at = await page.evaluate(() => {
                    const w = SceneManager._scene && SceneManager._scene._commandWindow;
                    if (!w || !w.active) return null;
                    return { i: w.index(), name: (w._list[w.index()] || {}).name };
                });
                if (at && at.name === 'New Game') break;
                if (at && at.i > 0) await tapPad(page, 12);
                else await sleep(200);
            }
            await tapPad(page, 0);
        } else if (kind === 'mouse') {
            const at = await lineAt(page, 'New Game');
            await page.mouse.move(at.x, at.y);
            await sleep(200);
            await page.mouse.click(at.x, at.y);
        } else {
            const at = await lineAt(page, 'New Game');
            await page.touchscreen.tap(at.x, at.y);
        }
        const left = await waitFor(page, () => !(SceneManager._scene instanceof Scene_Title), 25000, kind + ' to leave the title').then(() => true, () => false);
        check(kind + ' leaves the title by that input', left);
        if (!left) return;
        const done = await playIn([page], 300000, true);
        const w = await who(page);
        const live = await page.evaluate(() => Coop.world.live);
        check(kind + ' comes into the run', !!done[0] && live && w.is.length > 0, JSON.stringify(w));
    } catch (e) {
        console.error(kind, e);
        check(kind + ' ran to the end', false);
    } finally {
        if (page) await page.browserContext().close().catch(() => {});
        server.kill();
    }
}

(async () => {
    const check = checker();
    let browser;
    const seen = [];
    try {
        browser = await launch();
        console.log('inputs on ' + PORT + ', ' + JOIN + ' kept free');
        for (const kind of ['controller', 'mouse', 'touch']) await one(kind, browser, check, seen);
    } catch (e) {
        console.error(e);
        check('test ran to the end', false);
    }
    const code = check.finish(seen);
    if (browser) await browser.close();
    process.exit(code);
})();
