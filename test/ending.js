// An ending plays for everyone (his ruling, 10/18). Every ending runs on map
// 86 and closes with a Game Over; the marathon showed that only the finisher's
// machine went there, and its Game Over then left them a "dead" player a
// circle could call back. Here A reaches ending D while B lies dead: both
// must play it, B with the same ending switch, and both get the real Game Over.
const { twoPlayers, checker, waitFor, sleep } = require('./common');

(async () => {
    const check = checker();
    let s, code = 1;
    try {
        s = await twoPlayers(8478);
        const { a, b } = s;
        // The credits are long: ten times the game's speed.
        for (const p of [a, b]) await p.evaluate(() => { SceneManager._dt = 1 / 600; });

        await b.evaluate(() => SceneManager.goto(Scene_Gameover));
        await waitFor(b, () => SceneManager._scene instanceof Scene_CoopDead, 8000, 'B dead');

        // Ending D as the game does it (Map140 E4): its switch, then map 86 at 8,7.
        await a.evaluate(() => { $gameSwitches.setValue(1889, true); $gamePlayer.reserveTransfer(86, 8, 7, 2, 0); });
        await waitFor(b, () => window.$gameMap && $gameMap.mapId() === 86 && SceneManager._scene instanceof Scene_Map, 15000, 'B taken to the ending');
        const bAt = await b.evaluate(() => ({ dead: Coop.dead, ending: $gameSwitches.value(1889), map: $gameMap.mapId() }));
        check('the dead partner is taken into the same ending', !bAt.dead && bAt.ending && bAt.map === 86, JSON.stringify(bAt));

        // From here on nobody should land among the dead.
        for (const p of [a, b]) await p.evaluate(() => { const start = Scene_CoopDead.prototype.start; Scene_CoopDead.prototype.start = function () { window.__coopDeadSeen = true; start.call(this); }; });
        // Read through it, as a player would: OK whenever text waits.
        const atEnd = () => SceneManager._scene instanceof Scene_Gameover || SceneManager._scene instanceof Scene_Title;
        const t0 = Date.now();
        while (Date.now() - t0 < 240000) {
            const done = await Promise.all([a, b].map((p) => p.evaluate(atEnd)));
            if (done.every(Boolean)) break;
            for (const [i, p] of [a, b].entries()) if (!done[i]) { await p.keyboard.down('Enter'); await sleep(60); await p.keyboard.up('Enter'); }
            await sleep(300);
        }
        const ends = await Promise.all([a, b].map((p) => p.evaluate(() => SceneManager._scene.constructor.name + ' map ' + $gameMap.mapId() + ' "' + $gameMessage.allText().slice(0, 60) + '"')));
        check('both play the ending through to its close', ends.every((e) => /^Scene_(Gameover|Title)/.test(e)), ends.join(' | '));
        const never = await Promise.all([a, b].map((p) => p.evaluate(() => window.__coopDeadSeen || false)));
        check('both get the real Game Over, nobody left waiting for a circle', !never.some(Boolean));
        code = check.finish([a, b]);
    } catch (e) { console.error(e); check('test ran to the end', false); code = check.finish([]); }
    if (s) await s.close();
    process.exit(code);
})();
