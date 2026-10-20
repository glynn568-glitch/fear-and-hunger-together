// A partner standing close by leaves the map (a hole, a teleport, a door):
// the one left behind is offered a way after them, and is never dragged.
const { twoPlayers, checker, sleep, waitFor, sees } = require('./common');
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
        check('they see each other there', (await sees(a, 1)) && (await sees(b, 1)));
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

        // An offer not taken is for that one exit: A goes over by herself, far
        // from B, and B leaves again within the offer's seconds. No offer.
        await b.evaluate(() => { $gamePlayer.reserveTransfer(1, 28, 67, 8, 0); });
        await waitFor(b, onMap, 30000, 'B beside A again', 1);
        await b.evaluate(() => T.settle());
        await sleep(800);
        await b.evaluate(() => { $gamePlayer.reserveTransfer(74, 15, 22, 8, 0); });
        await waitFor(a, () => document.getElementById('coop-follow').style.display !== 'none', 8000, 'offered once more');
        const t0 = Date.now();
        await a.evaluate(() => { $gamePlayer.reserveTransfer(74, 15, 22, 8, 0); });
        await waitFor(a, onMap, 30000, 'A over on her own', 74);
        await a.evaluate(() => { T.settle(); $gamePlayer.setThrough(true); $gamePlayer.locate($gamePlayer.x, $gamePlayer.y - 14); $gamePlayer.setThrough(false); });
        await sleep(700);
        await b.evaluate(() => { $gamePlayer.reserveTransfer(1, 28, 67, 8, 0); });
        await waitFor(b, onMap, 30000, 'B gone again', 1);
        await sleep(1000);
        const late = await offer(a);
        // Only a test while the first offer would still be standing.
        const gap = Date.now() - t0;
        check('an old offer does not come back when the partner leaves again from far off', !late.shown && gap < 8000, JSON.stringify(late) + ' ' + Math.round(gap / 1000) + ' s after the first');

        // A door into a door: B goes on again from where A was offered to follow.
        // The offer stands, and takes A to where B ended up.
        await a.evaluate(() => { $gamePlayer.reserveTransfer(1, 27, 67, 8, 0); });
        await waitFor(a, onMap, 30000, 'A back beside B', 1);
        await a.evaluate(() => T.settle());
        await sleep(800);
        await b.evaluate(() => { $gamePlayer.reserveTransfer(74, 15, 22, 8, 0); });
        await waitFor(a, () => document.getElementById('coop-follow').style.display !== 'none', 8000, 'offered after B');
        await waitFor(b, onMap, 30000, 'B through the first door', 74);
        await b.evaluate(() => { $gamePlayer.reserveTransfer(4, 8, 26, 8, 0); });
        await waitFor(b, onMap, 30000, 'B through the second', 4);
        await sleep(600);
        const chained = await offer(a);
        check('a partner going straight on through another door can still be followed', chained.shown, JSON.stringify(chained));
        await a.keyboard.down('KeyF'); await sleep(120); await a.keyboard.up('KeyF');
        await waitFor(a, onMap, 30000, 'A after B', 4).catch(() => {});
        check('and F takes A to where B ended up', await a.evaluate(() => $gameMap.mapId()) === 4);
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
