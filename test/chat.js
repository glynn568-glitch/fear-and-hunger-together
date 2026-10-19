// Chat between two people, with real keys: Y opens the line, typing goes into
// it (not into the game), Enter sends, and the other player sees it.
const { twoPlayers, checker, sleep, waitFor } = require('./common');

(async () => {
    const check = checker();
    let s;
    try {
        s = await twoPlayers(8489);
        const { a, b } = s;
        const before = await a.evaluate(() => [$gamePlayer.x, $gamePlayer.y].join());
        await a.keyboard.press('KeyY');
        await sleep(300);
        const box = await a.evaluate(() => {
            const el = document.querySelector('#coop-chat input');
            const r = el.getBoundingClientRect();
            const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return { focused: document.activeElement === el, onTop: top === el };
        });
        check('Y opens the chat line, focused and not covered', box.focused && box.onTop, JSON.stringify(box));
        // Letters the game also uses (arrows, Z, X, W, A, S, D) must go into the line, not move anyone.
        await a.keyboard.type('hey bo, wasd zx ok?', { delay: 25 });
        await a.keyboard.press('Enter');
        await waitFor(b, () => [...document.querySelectorAll('#coop-chat .line')].some((l) => l.textContent === 'Ann: hey bo, wasd zx ok?'), 5000, 'B sees the line');
        check('the other player sees the line, with the sender\'s name', true);
        check('typing did not move the player or reach the game', await a.evaluate((p) => [$gamePlayer.x, $gamePlayer.y].join() === p && !$gameMessage.isBusy() && !(SceneManager._scene instanceof Scene_Menu), before));
        // And back the other way.
        await b.keyboard.press('KeyY');
        await sleep(300);
        await b.keyboard.type('loud and clear', { delay: 25 });
        await b.keyboard.press('Enter');
        await waitFor(a, () => [...document.querySelectorAll('#coop-chat .line')].some((l) => l.textContent === 'Bo: loud and clear'), 5000, 'A sees the reply');
        check('and the reply comes back', true);
        await sleep(400);
        check('after sending, the keys belong to the game again', await b.evaluate(() => document.activeElement !== document.querySelector('#coop-chat input')));
        // Back at the title, they can still talk.
        for (const p of [a, b]) await p.evaluate(() => SceneManager.goto(Scene_Title));
        for (const p of [a, b]) await waitFor(p, () => SceneManager._scene instanceof Scene_Title && !SceneManager.isSceneChanging() && Coop.connected, 20000, 'at the title');
        await sleep(800);
        await a.evaluate(() => document.activeElement && document.activeElement.blur());
        await a.keyboard.press('KeyY');
        await sleep(300);
        await a.keyboard.type('still here?', { delay: 25 });
        await a.keyboard.press('Enter');
        await waitFor(b, () => [...document.querySelectorAll('#coop-chat .line')].some((l) => l.textContent === 'Ann: still here?'), 5000, 'B sees the line at the title');
        check('at the title screen too', await b.evaluate(() => SceneManager._scene instanceof Scene_Title) && await a.evaluate(() => SceneManager._scene instanceof Scene_Title));
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
