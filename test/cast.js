// Using things on a partner outside a fight, through the real keys: facing
// them, Enter offers to cast a skill on them or use an item on them.
const { twoPlayers, checker, sleep, waitFor } = require('./common');

async function press(page, code) {
    await page.keyboard.down(code); await sleep(130); await page.keyboard.up(code); await sleep(350);
}

(async () => {
    const check = checker();
    let s;
    try {
        s = await twoPlayers(8447, { ax: 27, ay: 66, bx: 28, by: 66 });
        const { a, b } = s;
        // A knows a healing prayer; B is hurt.
        await a.evaluate(() => { const me = $gameParty.leader(); me.learnSkill(151); me.setMp(me.mmp); $gameParty._items = {}; $gamePlayer.setDirection(6); });
        await b.evaluate(() => { $gameParty.leader().setHp(30); });
        await sleep(900);

        //--- casting ---------------------------------------------------------
        await press(a, 'Enter');
        await waitFor(a, () => $gameMessage.isChoice() && $gameMessage.choices().indexOf('Cast on them') >= 0, 5000, 'the partner menu');
        const first = await a.evaluate(() => $gameMessage.choices());
        check('facing a partner, Enter offers to cast on them', first[0] === 'Cast on them' && first[first.length - 1] === 'Never mind', JSON.stringify(first));
        await press(a, 'Enter');
        await waitFor(a, () => $gameMessage.isChoice() && /Healing whispers/.test($gameMessage.choices()[0] || ''), 5000, 'the spell list');
        const mp0 = await a.evaluate(() => $gameParty.leader().mp);
        await sleep(700); // the list has to finish opening before it takes a key
        await press(a, 'Enter');
        await waitFor(b, () => $gameParty.leader().hp > 30, 6000, 'B is healed');
        const healed = await b.evaluate(() => ({ hp: $gameParty.leader().hp, toast: document.getElementById('coop-toast').textContent }));
        const mp1 = await a.evaluate(() => $gameParty.leader().mp);
        check('the healing lands on the partner, and the caster pays the mind', healed.hp > 30 && mp1 < mp0 && /uses Healing whispers on you/.test(healed.toast), JSON.stringify(healed) + ' mind ' + mp0 + ' -> ' + mp1);
        check('A is free to move again', await a.evaluate(() => !$gameMap.isEventRunning() && !$gameMessage.isBusy()));

        //--- feeding: food used on the partner --------------------------------
        await a.evaluate(() => { $gameParty.leader().forgetSkill(151); $gameParty.gainItem($dataItems[16], 1); }); // Dried meat
        await b.evaluate(() => { $gameParty.leader().changeExp(95, false); });
        await sleep(500);
        await press(a, 'Enter');
        await waitFor(a, () => $gameMessage.isChoice() && $gameMessage.choices().indexOf('Use an item on them') >= 0, 5000, 'the partner menu again');
        const second = await a.evaluate(() => $gameMessage.choices());
        await sleep(700);
        await press(a, 'ArrowDown');
        await press(a, 'Enter'); // "Use an item on them" sits after "Hand them something"
        await waitFor(a, () => SceneManager._scene._messageWindow && SceneManager._scene._messageWindow._itemWindow && SceneManager._scene._messageWindow._itemWindow.active, 5000, 'the item list');
        await sleep(700);
        await press(a, 'Enter');
        await waitFor(b, () => $gameParty.leader().currentExp() > 95, 8000, 'B has eaten');
        const fed = await b.evaluate(() => $gameParty.leader().currentExp());
        check('food used on a partner feeds them', fed > 95 && (await a.evaluate(() => $gameParty.numItems($dataItems[16]))) === 0, JSON.stringify(second) + ' hunger ' + fed);

        //--- their fight begins as the food is on its way: it comes back -----
        const bId = await b.evaluate(() => Coop.id);
        await b.evaluate(() => { window.__realBattle = Coop.battle; Coop.battle = { role: 'host' }; });
        await a.evaluate((id) => {
            const item = $dataItems[16];
            $gameParty.gainItem(item, 1);
            $gameParty.consumeItem(item);
            Coop.castItem(id, item, $gameParty.leader());
        }, bId);
        await waitFor(a, () => $gameParty.numItems($dataItems[16]) === 1, 5000, 'the food back in A\'s bag').catch(() => {});
        const back = await a.evaluate(() => $gameParty.numItems($dataItems[16]));
        const ate = await b.evaluate(() => $gameParty.leader().currentExp());
        await b.evaluate(() => { Coop.battle = window.__realBattle; });
        check('food that lands mid-fight goes back to the giver, uneaten', back === 1 && ate === fed, 'bag ' + back + ' hunger ' + fed + ' -> ' + ate);
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
