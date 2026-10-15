// A companion walking behind one player is drawn on the other player's
// screen too, follows them step by step, and goes when it leaves the party.
const { twoPlayers, checker, sleep, waitFor } = require('./common');

(async () => {
    const check = checker();
    const t = await twoPlayers(8465);
    const { a, b, idA } = t;
    try {
        await a.evaluate(() => { $gameParty.addActor(2); $gamePlayer.followers().show(); $gamePlayer.refresh(); });
        await waitFor(b, (id) => { const s = SceneManager._scene._spriteset; return s && s._coopTrail && [...s._coopTrail.keys()].some((c) => /girl/.test(c.characterName())); }, 10000, 'the girl on Bo\'s screen', idA);
        check('a companion behind Ann is drawn on Bo\'s screen', true);

        const before = await b.evaluate((id) => { const tr = Coop.avatarFor(id).trail()[0]; return [tr.x, tr.y]; }, idA);
        await a.evaluate(() => { $gamePlayer.moveStraight(8); });
        await sleep(800);
        await a.evaluate(() => { $gamePlayer.moveStraight(8); });
        await sleep(1200);
        const after = await b.evaluate((id) => { const tr = Coop.avatarFor(id).trail()[0]; return [tr.x, tr.y]; }, idA);
        const real = await a.evaluate(() => { const f = $gamePlayer.followers().follower(0); return [f.x, f.y]; });
        check('it walks where she walks on Ann\'s own screen', after.join() === real.join() && after.join() !== before.join(), 'Bo sees ' + after + ', Ann has ' + real + ', was ' + before);

        await a.evaluate(() => { $gameParty.removeActor(2); $gamePlayer.refresh(); });
        await waitFor(b, () => { const s = SceneManager._scene._spriteset; return s && s._coopTrail && s._coopTrail.size === 0; }, 10000, 'the girl gone from Bo\'s screen');
        check('when she leaves the party she is gone from Bo\'s screen too', true);
    } catch (e) {
        console.error(e);
        check('test ran to the end', false);
    }
    const code = check.finish([a, b]);
    await t.close();
    process.exit(code);
})();
