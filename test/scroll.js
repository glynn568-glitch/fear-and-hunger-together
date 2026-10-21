// The empty scroll's prayer, typed the way players type it. The game compares
// the three verses letter for letter, and its name box fought its own grid:
// every Enter or A put in the letter under the grid's cursor (a Steam Deck
// player's "O LORD " got no Black orb, 10/20), the space bar typed a space and
// the grid's letter, or finished the box on OK, and "o lord" in small letters
// was not "O LORD". A pad user picking letters on the grid still gets them.
// Chat lines lose their end spaces too, whoever sent them.
const { checker, sleep, waitFor } = require('./common');
const { startServer, launch, openPlayer } = require('./lib');
const install = require('./helpers');

const PAD = { A: 0, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

// A standard-layout pad the page reads instead of a real one.
function plugIn() {
    const pad = { index: 0, id: 'test pad', connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: [] };
    for (let i = 0; i < 17; i++) pad.buttons.push({ pressed: false, touched: false, value: 0 });
    window.PAD = pad;
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
}

(async () => {
    const check = checker();
    let server, browser, a, b;
    try {
        server = await startServer(8700);
        browser = await launch();
        a = await openPlayer(browser, 'http://localhost:8700/?name=Ann', 'A');
        b = await openPlayer(browser, 'http://localhost:8700/?name=Bo', 'B');
        for (const p of [a, b]) {
            await waitFor(p, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 90000, 'title + connection');
            await p.evaluate(install);
        }
        // Keys held as a person holds them (a press shorter than a frame is never seen by the game).
        const key = async (k) => { await a.keyboard.down(k); await sleep(90); await a.keyboard.up(k); await sleep(90); };
        const type = async (text) => { for (const ch of text) await key(ch); };
        const tap = async (i) => {
            await a.evaluate((i) => { PAD.buttons[i].pressed = true; PAD.buttons[i].value = 1; }, i);
            await sleep(120);
            await a.evaluate((i) => { PAD.buttons[i].pressed = false; PAD.buttons[i].value = 0; }, i);
            await sleep(150);
        };
        const box = () => a.evaluate(() => SceneManager._scene instanceof Scene_Name ? { text: SceneManager._scene._editWindow._name, at: SceneManager._scene._inputWindow.index() } : null);

        await a.evaluate(() => T.quickStart(1, 27, 67));
        await waitFor(a, () => T.onMap(), 60000, 'A on map');
        await a.evaluate(() => T.settle());
        await a.evaluate(() => T.begin());
        await waitFor(a, () => Coop.world.live, 10000, 'A live');
        await a.evaluate(plugIn);
        await a.evaluate(() => {
            // What was said, and the verses as the game held them when it read them back (it resets them after).
            window.SHOWN = [];
            const add = Game_Message.prototype.add;
            Game_Message.prototype.add = function (text) {
                if (/\\N\[25\]/.test(text)) window.VERSES = [25, 26, 27].map((id) => $gameActors.actor(id).name());
                SHOWN.push(text);
                return add.apply(this, arguments);
            };
        });
        check('Cahara does not know Black orb yet', !(await a.evaluate(() => $gameActors.actor(1).hasSkill(150))));

        // The scroll is read with the Quill in the bag: three boxes, one verse each.
        await a.evaluate(() => { $gameParty.gainItem($dataItems[87], 1); $gameTemp.reserveCommonEvent(84); });
        const verse = async (actorId) => {
            await waitFor(a, (id) => SceneManager._scene instanceof Scene_Name && SceneManager._scene._actorId === id && SceneManager._scene._inputWindow
                && SceneManager._scene._inputWindow.active && !SceneManager.isSceneChanging(), 15000, 'box for verse ' + actorId, actorId);
            await sleep(300);
            // The box holds "First verse" and so on: rubbed out with Backspace.
            const n = (await box()).text.length;
            for (let i = 0; i < n; i++) await key('Backspace');
        };

        // First verse typed on the keyboard, space bar and all, in small letters. Enter after the
        // word puts in no grid letter; then Up and Left to the grid's OK, and Enter.
        await verse(25);
        await type('o lord');
        const spaced = await box();
        check('the space bar types a space and nothing else (was "o alord")', spaced && spaced.text === 'o lord', JSON.stringify(spaced));
        await key('Enter');
        const entered = await box();
        check('Enter after a typed word puts in no grid letter', entered && entered.text === 'o lord', JSON.stringify(entered));
        // X is the grid's Cancel too: typed, it stays (it used to go in and rub itself out).
        await type('x');
        const ex = await box();
        check('a typed x stays in the box', ex && ex.text === 'o lordx', JSON.stringify(ex));
        await key('Backspace');
        await key('ArrowUp'); await key('ArrowLeft');
        await key('Enter');

        // Second verse picked on the grid with the pad, as a player who never types does: the D-pad
        // to each letter and A, then by mistake to the grid's space and A, then to OK and A.
        await verse(26);
        const picks = [[PAD.DOWN, 3], [PAD.RIGHT, 4], [PAD.A, 1], [PAD.UP, 3], [PAD.A, 1], [PAD.LEFT, 4], [PAD.A, 1],
            [PAD.RIGHT, 2], [PAD.A, 1], [PAD.DOWN, 1], [PAD.A, 1], [PAD.UP, 2], [PAD.RIGHT, 5], [PAD.A, 1]];
        for (const [button, times] of picks) for (let i = 0; i < times; i++) await tap(button);
        const second = await box();
        check('a pad user on the grid gets the letters picked, and the space too', second && second.text === 'TEACH ', JSON.stringify(second));
        await tap(PAD.RIGHT); await tap(PAD.RIGHT);
        await tap(PAD.A);

        // Third verse: the cursor put on OK first, then typed with a space bar press before the
        // words (on OK, that press used to finish the box), and Enter on OK finishes it.
        await verse(27);
        await key('ArrowUp'); await key('ArrowLeft');
        await type(' black orb');
        const third = await box();
        check('the space bar on the grid\'s OK types a space and does not finish the box', third && third.text === ' black orb', JSON.stringify(third));
        await key('Enter');

        // The game reads the three verses back and compares them, and Alll-Mer teaches.
        const taught = await (async () => {
            const until = Date.now() + 20000;
            while (Date.now() < until) {
                if (await a.evaluate(() => $gameActors.actor(1).hasSkill(150))) return true;
                if (await a.evaluate(() => $gameMessage.isBusy() && SceneManager._scene instanceof Scene_Map && SceneManager._scene._messageWindow.isOpen())) await key('Enter');
                else if (!(await a.evaluate(() => $gameMap.isEventRunning()))) return false;
                await sleep(300);
            }
            return false;
        })();
        const names = await a.evaluate(() => window.VERSES);
        check('the verses are kept as typed, without the end spaces', JSON.stringify(names) === JSON.stringify(['o lord', 'TEACH', 'black orb']), JSON.stringify(names));
        const shown = await a.evaluate(() => SHOWN);
        check('"o lord TEACH black orb" teaches Black orb (case does not count in the verses)', taught && shown.some((t) => /teaches you .*Black orb/.test(t)), JSON.stringify(shown).slice(0, 300));
        // Only the verses: any other name is compared as the game always did, capitals and all.
        const exact = await a.evaluate(() => {
            const asks = (name) => {
                const flag = 3600;
                $gameSwitches._data[flag] = false;
                const interp = new Game_Interpreter();
                interp.setup([
                    { code: 111, indent: 0, parameters: [4, 1, 1, name] },
                    { code: 121, indent: 1, parameters: [flag, flag, 0] },
                    { code: 0, indent: 1, parameters: [] },
                    { code: 412, indent: 0, parameters: [] },
                    { code: 0, indent: 0, parameters: [] },
                ], 0);
                for (let i = 0; i < 20 && interp.isRunning(); i++) interp.update();
                return !!$gameSwitches._data[flag];
            };
            const name = $gameActors.actor(1).name();
            return { name, same: asks(name), capitals: asks(name.toUpperCase()) };
        });
        check('other names are still compared exactly', exact.same && !exact.capitals, JSON.stringify(exact));

        // Chat: a line sent with spaces at its ends shows without them, typed here or sent by anyone.
        await sleep(500);
        await key('KeyY');
        await sleep(300);
        await type('  hello there  ');
        await key('Enter');
        const heard = await waitFor(b, () => [...document.querySelectorAll('#coop-chat .line')].some((l) => l.textContent === 'Ann: hello there'), 5000, 'B sees the line').then(() => true, () => false);
        check('a typed chat line goes out without its end spaces', heard, JSON.stringify(await b.evaluate(() => [...document.querySelectorAll('#coop-chat .line')].map((l) => l.textContent))));
        await b.evaluate(() => Coop.send({ t: 'chat', text: '   hi there   ' }));
        const shownLine = await waitFor(a, () => [...document.querySelectorAll('#coop-chat .line')].some((l) => l.textContent === 'Bo: hi there'), 5000, 'A sees the line').then(() => true, () => false);
        check('a chat line that arrives with end spaces shows without them', shownLine, JSON.stringify(await a.evaluate(() => [...document.querySelectorAll('#coop-chat .line')].map((l) => l.textContent))));
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish([a, b].filter(Boolean));
    if (browser) await browser.close();
    if (server) server.kill();
    process.exit(code);
})();
