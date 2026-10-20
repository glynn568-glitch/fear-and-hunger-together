// What players reported, checked where no other suite does (the rest of the
// ledger in TASKS.md names the suite for each report).
//   10/14: "the mouse picks the target": the fight's target follows a resting mouse.
//   10/14: the partner "came in with no legs": a knight's lost legs were the world's.
const { twoPlayers, checker, sleep, waitFor } = require('./common');

const LIMBS = [36, 37, 38, 39, 248, 249, 250, 251, 252, 253, 254, 255, 256, 257, 258, 259]; // the four protagonists' arms and legs

(async () => {
    const check = checker();
    let s;
    try {
        s = await twoPlayers(8524);
        const { a, b } = s;

        // A real mouse moved and wheeled over the game moves nothing the game reads.
        const before = await a.evaluate(() => [TouchInput._mouseOverX, TouchInput._mouseOverY, TouchInput.x, TouchInput.y, TouchInput.wheelY]);
        for (const [x, y] of [[200, 200], [450, 300], [700, 500]]) { await a.mouse.move(x, y); await sleep(60); }
        await a.mouse.wheel({ deltaY: 240 });
        await sleep(300);
        const after = await a.evaluate(() => [TouchInput._mouseOverX, TouchInput._mouseOverY, TouchInput.x, TouchInput.y, TouchInput.wheelY]);
        check('a resting or moving mouse picks nothing (targets stay on the keyboard)', JSON.stringify(before) === JSON.stringify(after), JSON.stringify({ before, after }));

        // B's character loses limbs: nobody else's character does, and nobody
        // taking that character later starts without them. The world still syncs.
        await b.evaluate((ids) => { for (const id of ids) $gameSwitches.setValue(id, true); $gameSwitches.setValue(2901, true); }, LIMBS);
        await waitFor(a, () => $gameSwitches.value(2901), 5000, 'A hears a world switch').catch(() => {});
        const lost = await a.evaluate((ids) => ids.filter((id) => $gameSwitches.value(id)), LIMBS);
        check('a protagonist\'s lost limbs stay with whoever plays them', lost.length === 0 && await a.evaluate(() => $gameSwitches.value(2901)), 'shared: ' + lost);
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
