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

        // 10/20: a line said during a drop never arrived. Lines on A's screen, and B's own row.
        const onA = (text) => a.evaluate((t) => [...document.querySelectorAll('#coop-chat .line')].filter((l) => l.textContent === t).length, text);
        const rowB = (text) => b.evaluate((t) => { const l = [...document.querySelectorAll('#coop-chat .line')].find((r) => r.textContent === t); return l ? l.className : 'none'; }, text);
        const say = async (text) => {
            await b.evaluate(() => document.activeElement && document.activeElement.blur());
            await b.keyboard.press('KeyY');
            await sleep(300);
            await b.keyboard.type(text, { delay: 25 });
            await b.keyboard.press('Enter');
        };
        const arrives = (text) => waitFor(a, (t) => [...document.querySelectorAll('#coop-chat .line')].some((l) => l.textContent === t), 15000, 'A gets ' + text, text).then(() => true, () => false);
        // B's line is down (held down, as a long drop is) when B says something.
        await b.evaluate(() => {
            window._holdLine = true;
            const connect = Coop.connect;
            Coop.connect = function () { if (window._holdLine) setTimeout(Coop.connect, 200); else connect(); };
            Coop._ws.close();
        });
        await waitFor(b, () => !Coop.connected, 5000, 'B offline');
        await say('are you there');
        await sleep(1000);
        check('a line said while the line is down is kept, marked not sent yet', /unsent/.test(await rowB('Bo: are you there')) && await onA('Bo: are you there') === 0, await rowB('Bo: are you there'));
        await b.evaluate(() => { window._holdLine = false; });
        check('...and arrives once B is back', await arrives('Bo: are you there'));
        await waitFor(b, () => Coop.connected, 10000, 'B back');
        await sleep(800);
        check('...and is no longer marked on B\'s screen', !/unsent/.test(await rowB('Bo: are you there')), await rowB('Bo: are you there'));
        // A line that died without a word (the page still thinks it is connected): whatever is
        // sent into it is lost, until the dead line is noticed and B reconnects.
        await b.evaluate(() => { Coop._ws.send = function () { /* into the void */ }; });
        await say('lost in the wire');
        await sleep(3500);
        check('a line said into a dead line is marked not sent yet', /unsent/.test(await rowB('Bo: lost in the wire')) && await onA('Bo: lost in the wire') === 0, await rowB('Bo: lost in the wire'));
        await b.evaluate(() => Coop._ws.close()); // the dead line noticed (server.js), and B reconnects
        check('...and arrives once B is back', await arrives('Bo: lost in the wire'));
        // A line that arrived, but the word back was lost in a drop: said again after the
        // reconnect, and still shown once.
        await waitFor(b, () => Coop.connected, 10000, 'B back again');
        await b.evaluate(() => { window._receive = Coop._receive; Coop._receive = function (msg) { if (msg.t !== 'chatok') window._receive(msg); else window._lostAck = true; }; });
        await say('only once');
        const lost = await arrives('Bo: only once') && await waitFor(b, () => window._lostAck, 5000, 'the word back lost').then(() => true, () => false);
        await sleep(3000);
        check('a line that arrived but whose word back was lost...', lost && /unsent/.test(await rowB('Bo: only once')), await rowB('Bo: only once'));
        await b.evaluate(() => { Coop._receive = window._receive; });
        await b.evaluate(() => Coop._ws.close());
        await waitFor(b, () => Coop.connected, 10000, 'B back a third time');
        await sleep(2000);
        check('...is said again after a reconnect but shown once', await onA('Bo: only once') === 1, (await onA('Bo: only once')) + ' times');
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
