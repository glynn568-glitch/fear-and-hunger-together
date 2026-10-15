// Visual check: two players near each other but outside each other's light.
const { twoPlayers, sleep } = require('./common');
const { shot } = require('./lib');
(async () => {
    const s = await twoPlayers(8442, { ax: 27, ay: 66, bx: 28, by: 65 });
    try {
        await sleep(1500);
        console.log(await shot(s.a, 'look-a'));
        // Shrink both lights and step apart, so each is only lit by their own.
        for (const p of [s.a, s.b]) await p.evaluate(() => { const i = new Game_Interpreter(); i.pluginCommand('Light', ['radius', '90', '#FFFFFF']); });
        await s.b.evaluate(() => { $gamePlayer.setThrough(true); $gamePlayer.locate(31, 62); $gamePlayer.setThrough(false); });
        await sleep(2000);
        console.log(await shot(s.a, 'look-light-a'));
        console.log('A light', JSON.stringify(await s.a.evaluate(() => Coop.myLight())), 'B as A knows it', JSON.stringify(await s.a.evaluate(() => { const p = Coop.others()[0]; return { lr: p.lr, lc: p.lc, x: p.x, y: p.y }; })));
        const errs = [...s.a.errors, ...s.b.errors].filter((e) => !/physical_attack/.test(e));
        console.log('errors', errs.length, errs.slice(0, 3).join(' | ').slice(0, 400));
    } catch (e) { console.error(e); }
    await s.close(); process.exit(0);
})();
