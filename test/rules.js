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
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
