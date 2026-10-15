// A conversation belongs to the player who started it; a partner nearby
// overhears it as captions and is not stopped.
const { twoPlayers, checker, sleep, waitFor } = require('./common');
const { shot } = require('./lib');

async function press(page, code) {
    await page.keyboard.down(code); await sleep(120); await page.keyboard.up(code); await sleep(300);
}
const caption = (page) => page.evaluate(() => { const b = document.getElementById('coop-caption'); return { text: b.textContent, shown: b.style.opacity === '1' }; });
const talk = (page) => page.evaluate(() => {
    $gameMap._interpreter.setup([
        { code: 101, indent: 0, parameters: ['', 0, 0, 2] },
        { code: 401, indent: 0, parameters: ['\\n<Old man>\\C[2]\\N[1]\\C[0], is it?\\! You have \\V[121] days.'] },
        { code: 401, indent: 0, parameters: ['<WordWrap>Leave this place.'] },
        { code: 102, indent: 0, parameters: [['I will not', 'As you say'], 1, 0, 2, 0] },
        { code: 402, indent: 0, parameters: [0, 'I will not'] },
        { code: 121, indent: 1, parameters: [3599, 3599, 0] },
        { code: 0, indent: 1, parameters: [] },
        { code: 402, indent: 0, parameters: [1, 'As you say'] },
        { code: 0, indent: 1, parameters: [] },
        { code: 404, indent: 0, parameters: [] },
        { code: 0, indent: 0, parameters: [] },
    ], 0);
});

(async () => {
    const check = checker();
    let s;
    try {
        s = await twoPlayers(8455, { ax: 27, ay: 66, bx: 28, by: 66 });
        const { a, b } = s;
        await a.evaluate(() => $gameVariables.setValue(121, 3));
        await sleep(600);
        await talk(a);
        await waitFor(a, () => $gameMessage.isBusy() && SceneManager._scene._messageWindow.isOpen(), 6000, 'A sees the text box');
        await sleep(700);
        let c = await caption(b);
        check('B overhears the line, in plain words', c.shown && /Old man \(to Ann\):/.test(c.text) && /Mercenary, is it\? You have 3 days\./.test(c.text) && /Leave this place\./.test(c.text) && !/[\\<\x1b]/.test(c.text), JSON.stringify(c.text));
        const free = await b.evaluate(() => ({ msg: $gameMessage.isBusy(), text: $gameMessage._texts.join(' ').slice(0, 60), event: $gameMap.isEventRunning(), evId: $gameMap._interpreter.eventId(), canMove: $gamePlayer.canMove(), route: $gamePlayer.isMoveRouteForcing() }));
        check('B is not stopped by it', !free.msg && !free.event, JSON.stringify(free));
        console.log('screenshot', await shot(b, 'talk-b'));
        for (let i = 0; i < 8 && await a.evaluate(() => $gameMap.isEventRunning()); i++) await press(a, 'Enter'); // through the text, then the first answer
        await waitFor(a, () => !$gameMap.isEventRunning(), 6000, 'A finishes the conversation');
        await sleep(400);
        c = await caption(b);
        check('B sees which answer A gave', /Ann answers: I will not/.test(c.text), JSON.stringify(c.text));
        check('only A made the choice', await a.evaluate(() => $gameSwitches.value(3599)) && !(await b.evaluate(() => $gameSwitches.value(3599))));

        // Out of earshot: nothing.
        await b.evaluate(() => { document.getElementById('coop-caption').textContent = ''; $gamePlayer.setThrough(true); $gamePlayer.locate(27, 40); $gamePlayer.setThrough(false); });
        await sleep(800);
        await talk(a);
        await waitFor(a, () => $gameMessage.isBusy(), 6000, 'A talks again');
        await sleep(700);
        check('a partner far away hears nothing', (await caption(b)).text === '');
        for (let i = 0; i < 8 && await a.evaluate(() => $gameMap.isEventRunning()); i++) await press(a, 'Enter');
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
