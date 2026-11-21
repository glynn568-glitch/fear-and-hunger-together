// The party limit of four is counted across all players, using the game's
// own "is the party full?" question.
const { twoPlayers, checker, waitFor, canRecruit } = require('./common');

// A must have heard B's head count before it asks.
const seesOthers = (a, n) => waitFor(a, (n) => Coop.othersPartySize() === n, 10000, 'a party of ' + n + ' from B', n);

(async () => {
    const check = checker();
    let s;
    try {
        s = await twoPlayers(8450);
        const { a, b } = s;
        let r = await canRecruit(a);
        check('two players alone: A may recruit', r.can && r.counted === 1 && !r.stuck, JSON.stringify(r));
        await b.evaluate(() => { $gameParty.addActor(2); });
        await seesOthers(a, 2);
        r = await canRecruit(a);
        check('B has one companion (3 in the world): A may still recruit', r.can, JSON.stringify(r));
        await b.evaluate(() => { $gameParty.addActor(7); });
        await seesOthers(a, 3);
        r = await canRecruit(a);
        check('B has two companions (4 in the world): A is told the party is full', !r.can && r.counted === 1, JSON.stringify(r));
        r = await canRecruit(b);
        check('and so is B', !r.can && r.counted === 3, JSON.stringify(r));
        check('A\'s own count is left as the game computed it', await a.evaluate(() => $gameVariables.value(34)) === 1);
        await b.evaluate(() => { $gameParty.removeActor(7); });
        await seesOthers(a, 2);
        r = await canRecruit(a);
        check('a companion lost frees the place again', r.can, JSON.stringify(r));

        // Both used Necromancy on the lone skeleton (Map001 EV187) a moment apart: A's page reaches its Add
        // Actor first and closes the body (865). B's, still on its way there, must not raise a second one.
        await b.evaluate(() => { $gameParty.removeActor(2); });
        const raise = (p) => p.evaluate(() => {
            const list = $dataMap.events[187].pages[0].list;
            const i = new Game_Interpreter();
            i.setup(list, 187);
            i._index = list.findIndex((c) => c.code === 129);
            for (let k = 0; k < 600 && i.isRunning() && !$gameMessage.isBusy(); k++) i.update();
            $gameMessage.clear();
            return { skeleton: $gameParty._actors.includes(19), closed: $gameSwitches.value(865) };
        });
        const first = await raise(a);
        await waitFor(b, () => $gameSwitches.value(865), 5000, 'B hears the body is taken');
        const second = await raise(b);
        check('A raises the skeleton and the body is closed', first.skeleton && first.closed, JSON.stringify(first));
        check('B, a moment behind on the same body, raises none', !second.skeleton && second.closed, JSON.stringify(second));

        // The Girl's cage (Map001 EV88) is opened (81) half a second before she joins: both picked the lock.
        const free = (p) => p.evaluate(() => {
            const list = $dataMap.events[88].pages[0].list;
            const i = new Game_Interpreter();
            i.setup(list, 88);
            i._index = list.findIndex((c) => c.code === 121 && c.parameters[0] === 81);
            for (let k = 0; k < 600 && i.isRunning() && !$gameMessage.isBusy(); k++) i.update();
            $gameMessage.clear();
            $gameScreen.startTint([0, 0, 0, 0], 1);
            return { girl: $gameParty._actors.includes(2), open: $gameSwitches.value(81) };
        });
        const opener = await free(a);
        await waitFor(b, () => $gameSwitches.value(81), 5000, 'B hears the cage is open');
        const late = await free(b);
        check('A frees the Girl', opener.girl && opener.open, JSON.stringify(opener));
        check('B, a moment behind at the same cage, gets no second Girl', !late.girl && late.open, JSON.stringify(late));

        // The Void (Map160 EV288, its event put in this map's place): its third page takes in 2 and 7 at once,
        // closing on 2611 then 2612; page 1 takes 2 alone (2611), page 2 takes 7 alone (2612). Alone on page 3,
        // A gets both. B taking 2 on page 1 a moment before A's page 3 reaches its adds: A still gets 7.
        const voidPage3 = (p) => p.evaluate(() => {
            const x = new XMLHttpRequest();
            x.open('GET', 'data/Map160.json', false);
            x.send();
            const kept = $dataMap.events[288];
            $dataMap.events[288] = Object.assign(JSON.parse(x.responseText).events[288], { id: 288 });
            const list = $dataMap.events[288].pages[3].list;
            const i = new Game_Interpreter();
            i.setup(list, 288);
            i._index = list.findIndex((c) => c.code === 129);
            for (let k = 0; k < 600 && i.isRunning() && !$gameMessage.isBusy(); k++) i.update();
            $gameMessage.clear();
            $gameScreen.startTint([0, 0, 0, 0], 1);
            $dataMap.events[288] = kept;
            return { two: $gameParty._actors.includes(2), seven: $gameParty._actors.includes(7) };
        });
        const reset = () => a.evaluate(() => { $gameParty.removeActor(2); $gameParty.removeActor(7); $gameSwitches.setValue(2611, false); $gameSwitches.setValue(2612, false); });
        await reset();
        await waitFor(b, () => !$gameSwitches.value(2611) && !$gameSwitches.value(2612), 5000, 'B hears the Void\'s flags are off');
        const alone = await voidPage3(a);
        check('alone at the Void, its two-at-once page takes in both', alone.two && alone.seven, JSON.stringify(alone));
        await reset();
        await waitFor(b, () => !$gameSwitches.value(2611) && !$gameSwitches.value(2612), 5000, 'B hears the Void\'s flags are off again');
        await b.evaluate(() => $gameSwitches.setValue(2611, true));
        await waitFor(a, () => $gameSwitches.value(2611), 5000, 'A hears B took 2');
        const after = await voidPage3(a);
        check('B took 2 a moment before: A\'s two-at-once page skips 2 and still takes 7', !after.two && after.seven, JSON.stringify(after));
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
