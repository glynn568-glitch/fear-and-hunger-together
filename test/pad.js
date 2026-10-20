// Playing on a controller (a Steam Deck): every key-only action has a button,
// the mod's panels are worked with the D-pad, A and B, and prompts name the
// button once a controller is in use. The pad is simulated in the page.
const { twoPlayers, checker, sleep, waitFor } = require('./common');
const { openPlayer } = require('./lib');
const install = require('./helpers');

const BTN = { A: 0, B: 1, LT: 6, RT: 7, VIEW: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13 };

// A standard-layout pad the page reads instead of a real one.
function plugIn() {
    const pad = { index: 0, id: 'test pad', connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: [] };
    for (let i = 0; i < 17; i++) pad.buttons.push({ pressed: false, touched: false, value: 0 });
    window.PAD = pad;
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
}
const hold = (page, i, on) => page.evaluate((i, on) => { PAD.buttons[i].pressed = on; PAD.buttons[i].value = on ? 1 : 0; }, i, on);
async function tap(page, i, ms) { await hold(page, i, true); await sleep(ms || 150); await hold(page, i, false); await sleep(250); }

(async () => {
    const check = checker();
    let s, t;
    try {
        s = await twoPlayers(8538);
        const { a } = s;
        await a.evaluate(plugIn);
        await a.evaluate(() => {
            window.CE = [];
            const r = Game_Temp.prototype.reserveCommonEvent;
            Game_Temp.prototype.reserveCommonEvent = function (id) { CE.push(id); return r.apply(this, arguments); };
            window.KEYS = [];
            document.addEventListener('keydown', (e) => KEYS.push(e.code + (e.ctrlKey && e.shiftKey ? '+cs' : '')), true);
        });

        // The game's own key-only actions.
        await tap(a, BTN.RT);
        check('RT lights the torch (the game\'s T)', await a.evaluate(() => CE.includes(289)), JSON.stringify(await a.evaluate(() => CE)));
        await a.evaluate(() => { $gameTemp.clearCommonEvent(); $gameMap._interpreter.clear(); });
        await sleep(300);
        await tap(a, BTN.L3);
        check('L3 phases (the game\'s C)', await a.evaluate(() => CE.includes(257)), JSON.stringify(await a.evaluate(() => CE)));
        await a.evaluate(() => { $gameTemp.clearCommonEvent(); $gameMap._interpreter.clear(); });

        // The mod's keys.
        await hold(a, BTN.LT, true);
        await sleep(400);
        const sheetOn = await a.evaluate(() => document.getElementById('coop-sheets').classList.contains('on'));
        await hold(a, BTN.LT, false);
        await sleep(400);
        const sheetOff = await a.evaluate(() => !document.getElementById('coop-sheets').classList.contains('on'));
        check('LT held shows everyone\'s gear, let go hides it', sheetOn && sheetOff);
        await tap(a, BTN.R3);
        check('R3 is follow (F)', await a.evaluate(() => KEYS.includes('KeyF')));
        await tap(a, BTN.VIEW);
        const help = await a.evaluate(() => { const h = document.getElementById('coop-help'); return { shown: h.style.display !== 'none', pad: h.querySelector('footer.pad').style.display !== 'none', text: h.innerText }; });
        check('View opens how playing together works, with the controller\'s buttons', help.shown && help.pad && /RT/.test(help.text), JSON.stringify({ shown: help.shown, pad: help.pad }));
        await tap(a, BTN.VIEW);
        check('View again closes it', await a.evaluate(() => document.getElementById('coop-help').style.display === 'none'));

        // Talking: Start opens the line, B closes it, and the game does not move meanwhile.
        await tap(a, BTN.START);
        check('Start opens the chat line', await a.evaluate(() => document.activeElement && document.activeElement.closest('#coop-chat') !== null));
        const before = await a.evaluate(() => [$gamePlayer.x, $gamePlayer.y]);
        await hold(a, BTN.DOWN, true); await sleep(700); await hold(a, BTN.DOWN, false);
        check('while typing, the D-pad does not walk', JSON.stringify(before) === JSON.stringify(await a.evaluate(() => [$gamePlayer.x, $gamePlayer.y])));
        await hold(a, BTN.B, true); await sleep(400);
        check('B closes the chat line', await a.evaluate(() => !(document.activeElement && document.activeElement.closest('#coop-chat'))));
        check('and the B that closed it opens no menu, held or let go', await a.evaluate(() => !Input.isPressed('cancel') && !(SceneManager._scene instanceof Scene_Menu)));
        await hold(a, BTN.B, false); await sleep(500);
        check('still no menu once it is let go', await a.evaluate(() => !(SceneManager._scene instanceof Scene_Menu)));
        // A sends a line: the A still held does not then press OK in the game.
        await tap(a, BTN.START);
        await a.evaluate(() => { document.activeElement.value = 'hi'; });
        await hold(a, BTN.A, true); await sleep(400);
        const sent = await a.evaluate(() => ({ closed: !(document.activeElement && document.activeElement.closest('#coop-chat')), ok: Input.isPressed('ok') }));
        await hold(a, BTN.A, false); await sleep(300);
        check('A sends a line, and the held A is not OK in the game', sent.closed && !sent.ok, JSON.stringify(sent));

        // A second pad (a Deck's own and one plugged in): one holding RT presses T once, not over and over.
        await a.evaluate(() => {
            const two = JSON.parse(JSON.stringify(PAD)); two.index = 1; window.PAD2 = two;
            Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [PAD, PAD2] });
            KEYS.length = 0;
            PAD2.buttons[7].pressed = true;
        });
        await sleep(800);
        await a.evaluate(() => { PAD2.buttons[7].pressed = false; });
        await sleep(300);
        const ts = await a.evaluate(() => KEYS.filter((k) => k === 'KeyT').length);
        check('two pads: RT held on the second presses T once', ts === 1, ts + ' presses');
        await a.evaluate(() => { $gameTemp.clearCommonEvent(); $gameMap._interpreter.clear(); Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [PAD] }); });

        // Unstuck: View and Start held together.
        await hold(a, BTN.VIEW, true); await hold(a, BTN.START, true);
        await sleep(2400);
        await hold(a, BTN.VIEW, false); await hold(a, BTN.START, false);
        await sleep(300);
        const keys = await a.evaluate(() => KEYS);
        check('View+Start held is unstuck, and neither opens anything on its own', keys.includes('KeyU+cs') && await a.evaluate(() => document.getElementById('coop-help').style.display === 'none' && !(document.activeElement && document.activeElement.closest('#coop-chat'))), keys.join(' '));

        // Prompts name the button while a controller is in use, the key once the keyboard is.
        check('prompts name the button on a controller', await a.evaluate(() => [Coop.keyName('F'), Coop.keyName('Esc'), Coop.keyName('R')].join()) === 'R3,B,RT');
        await a.keyboard.press('KeyQ');
        check('and the key again after a key is pressed', await a.evaluate(() => Coop.keyName('F')) === 'F');

        // The Together panel at the title: D-pad, A and B, and the title menu stays put behind it.
        t = await openPlayer(s.browser, 'http://localhost:8538/?name=Cy', 'C');
        await waitFor(t, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && SceneManager._scene._commandWindow && window.Coop && Coop.connected, 90000, 'C at the title');
        await t.evaluate(install);
        await t.evaluate(plugIn);
        await waitFor(t, () => { const w = SceneManager._scene._commandWindow; return w.active && w.isOpen() && !SceneManager.isSceneChanging(); }, 15000, 'the title menu of C ready');
        await sleep(1500); // the name is taken and the menu redrawn
        await t.evaluate(() => { const w = SceneManager._scene._commandWindow; w.select(w._list.findIndex((c) => c.symbol === 'together')); });
        await sleep(300);
        await tap(t, BTN.A);
        await waitFor(t, () => Coop.together.isOpen(), 5000, 'panel open').catch(() => {});
        check('A on Together opens the panel', await t.evaluate(() => Coop.together.isOpen()));
        await sleep(300);
        const focused = () => t.evaluate(() => { const el = document.activeElement; return el ? el.tagName + ':' + (el.type || '') + ':' + (el.textContent || el.placeholder || '') : ''; });
        const first = await focused();
        await tap(t, BTN.DOWN);
        const second = await focused();
        check('the D-pad moves between the panel\'s buttons', first && second && first !== second, first + ' -> ' + second);
        if (/checkbox/.test(second)) {
            const was = await t.evaluate(() => document.activeElement.checked);
            await tap(t, BTN.A);
            check('A ticks a checkbox', await t.evaluate((was) => document.activeElement.checked === !was, was));
        }
        await tap(t, BTN.B);
        const after = await t.evaluate(() => ({ open: Coop.together.isOpen(), scene: SceneManager._scene.constructor.name, index: SceneManager._scene._commandWindow.index(), symbol: SceneManager._scene._commandWindow.currentSymbol() }));
        check('B closes it, back on the title menu where it was', !after.open && after.scene === 'Scene_Title' && after.symbol === 'together', JSON.stringify(after));
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(s ? [s.a, s.b].concat(t ? [t] : []) : []);
    if (s) await s.close();
    process.exit(code);
})();
