// The link box in Together takes a real mouse click, a paste and typing.
// The engine's empty error strip across the middle of the screen used to sit
// above it and swallow the click, so nothing could be pasted or typed there.
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const { checker } = require('./common');

(async () => {
    const check = checker();
    const server = await startServer(8487);
    const browser = await launch();
    let page;
    try {
        page = await openPlayer(browser, 'http://localhost:8487/?name=Ann', 'A');
        await page.browserContext().overridePermissions('http://localhost:8487', ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
        await waitFor(page, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 90000, 'title');
        await sleep(1000);
        await page.evaluate(() => SceneManager._scene._commandWindow.callHandler('together'));
        await sleep(600);
        const at = await page.evaluate(() => {
            const r = document.querySelector('[data-field=join]').getBoundingClientRect();
            const x = r.left + r.width / 2, y = r.top + r.height / 2;
            const top = document.elementFromPoint(x, y);
            return { x, y, top: top && (top.getAttribute('data-field') || top.id || top.tagName) };
        });
        check('nothing covers the link box', at.top === 'join', JSON.stringify(at));
        // Every control in the panel, not just the one that broke, at two window sizes:
        // whatever sits under a control's own centre must be that control.
        const covered = async () => page.evaluate(() => [...document.querySelectorAll('#coop-together button, #coop-together input, #coop-together select')]
            .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
            .map((el) => { const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return top === el || el.contains(top) || (top && top.control === el) ? null : (el.getAttribute('data-do') || el.getAttribute('data-field') || el.tagName) + ' under ' + (top ? top.id || top.tagName : 'nothing'); })
            .filter(Boolean));
        const small = await covered();
        await page.setViewport({ width: 1600, height: 1000 });
        await sleep(500);
        const large = await covered();
        await page.setViewport({ width: 900, height: 700 });
        await sleep(500);
        check('every control in the Together panel takes the mouse, at two window sizes', !small.length && !large.length, JSON.stringify({ small, large }));
        await page.evaluate(() => navigator.clipboard.writeText('https://abc.trycloudflare.com/?k=xyz'));
        await page.mouse.click(at.x, at.y);
        await sleep(200);
        await page.keyboard.down('Control'); await page.keyboard.press('KeyV'); await page.keyboard.up('Control');
        await sleep(300);
        await page.keyboard.type('!');
        const value = await page.evaluate(() => document.querySelector('[data-field=join]').value);
        check('a click, Ctrl+V and typing all land in the link box', value === 'https://abc.trycloudflare.com/?k=xyz!', value);
        await page.mouse.click(at.x, at.y, { button: 'right' });
        check('right-click on the box is the browser\'s own menu (Paste), not switched off', await page.evaluate(() => document.querySelector('[data-field=join]').oncontextmenu === null));
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(page ? [page] : []);
    await browser.close();
    server.kill();
    process.exit(code);
})();
