// Handing an item to the player next to you, through the real key path.
const { twoPlayers, checker, sleep, waitFor } = require('./common');
const { shot } = require('./lib');

async function press(page, code) {
    await page.keyboard.down(code); await sleep(130); await page.keyboard.up(code); await sleep(300);
}

(async () => {
    const check = checker();
    let s;
    try {
        s = await twoPlayers(8443, { ax: 27, ay: 66, bx: 28, by: 66 });
        const { a, b } = s;
        const item = await a.evaluate(() => {
            const it = $dataItems.find((i) => i && i.name && i.itypeId === 1);
            $gameParty._items = {};
            $gameParty.gainItem(it, 2);
            $gamePlayer.setDirection(6);
            return { id: it.id, name: it.name };
        });
        await b.evaluate(() => { $gameParty._items = {}; });
        await sleep(900);
        await press(a, 'Enter'); // action key at Bo
        await waitFor(a, () => $gameMessage.isBusy(), 5000, 'the hand-over prompt');
        await sleep(900);
        console.log('screenshot', await shot(a, 'trade-pick'));
        await press(a, 'Enter'); // pick the first item in the list
        await waitFor(b, (id) => $gameParty.numItems($dataItems[id]) === 1, 6000, 'B receives the item', item.id);
        check('A handed over one ' + item.name, await a.evaluate((id) => $gameParty.numItems($dataItems[id]), item.id) === 1);
        check('B holds it now', await b.evaluate((id) => $gameParty.numItems($dataItems[id]), item.id) === 1);
        await sleep(500);
        check('A is free to move again', await a.evaluate(() => !$gameMap.isEventRunning() && !$gameMessage.isBusy()));
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
