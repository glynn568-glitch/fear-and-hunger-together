// A partner standing close by leaves the map (a hole, a teleport, a door):
// the one left behind is offered a way after them, and is never dragged.
const { twoPlayers, checker, sleep, waitFor } = require('./common');
const { shot } = require('./lib');

const offer = (page) => page.evaluate(() => { const b = document.getElementById('coop-follow'); return { shown: b.style.display !== 'none', text: b.textContent }; });
const onMap = (id) => $gameMap.mapId() === id && SceneManager._scene instanceof Scene_Map && SceneManager._scene.isActive() && !$gamePlayer.isTransferring();

(async () => {
    const check = checker();
    let s;
    try {
        s = await twoPlayers(8456);
        const { a, b } = s;
        check('joining a world someone else is already in is announced', (await b.evaluate(() => document.getElementById('coop-toast').textContent)).includes('already in progress with Ann'));

        // B drops to another map right beside A.
        await b.evaluate(() => { $gamePlayer.reserveTransfer(74, 15, 22, 8, 0); });
        await waitFor(b, onMap, 30000, 'B on the other map', 74);
        await b.evaluate(() => T.settle());
        await waitFor(a, () => document.getElementById('coop-follow').style.display !== 'none', 6000, 'A is offered the way after B');
        const o = await offer(a);
        check('A is offered a way after B', o.shown && /^Bo has gone on\. Press F to follow \(\d\)$/.test(o.text), JSON.stringify(o));
        check('A was not dragged along', await a.evaluate(() => $gameMap.mapId()) === 1);
        console.log('screenshot', await shot(a, 'follow-offer'));
        await a.keyboard.down('KeyF'); await sleep(120); await a.keyboard.up('KeyF');
        await waitFor(a, onMap, 30000, 'A arrives after B', 74);
        const pos = await a.evaluate(() => $gamePlayer.x + ',' + $gamePlayer.y);
        check('pressing F brings A to where B is', pos === await b.evaluate(() => $gamePlayer.x + ',' + $gamePlayer.y), pos);
        await sleep(800);
        check('they see each other there', await a.evaluate(() => Coop.peersHere().length) === 1 && await b.evaluate(() => Coop.peersHere().length) === 1);
        check('the offer is gone once taken', !(await offer(a)).shown);

        // Far apart: no offer. A walks off, B leaves.
        await a.evaluate(() => T.settle());
        await a.evaluate(() => { $gamePlayer.setThrough(true); $gamePlayer.locate($gamePlayer.x, $gamePlayer.y - 14); $gamePlayer.setThrough(false); });
        await sleep(700);
        await b.evaluate(() => { $gamePlayer.reserveTransfer(1, 28, 67, 8, 0); });
        await waitFor(b, onMap, 30000, 'B back on level 1', 1);
        await sleep(1200);
        check('a partner who was far away gets no offer', !(await offer(a)).shown);

        // The offer runs out.
        await a.evaluate(() => { $gamePlayer.reserveTransfer(1, 27, 67, 8, 0); });
        await waitFor(a, onMap, 30000, 'A back on level 1', 1);
        await a.evaluate(() => T.settle());
        await b.evaluate(() => T.settle());
        await sleep(800);
        await b.evaluate(() => { $gamePlayer.reserveTransfer(74, 15, 22, 8, 0); });
        await waitFor(a, () => document.getElementById('coop-follow').style.display !== 'none', 8000, 'offered again');
        await sleep(9800);
        check('the offer lapses after a few seconds', !(await offer(a)).shown);
        await a.keyboard.down('KeyF'); await sleep(120); await a.keyboard.up('KeyF');
        await sleep(800);
        check('and F does nothing after that', await a.evaluate(() => $gameMap.mapId()) === 1);
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
