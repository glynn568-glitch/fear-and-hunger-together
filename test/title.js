// The title screen with no name yet: one press of Enter must buzz once and
// hand the keyboard to the name box, and typing a name then starts normally.
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const { checker } = require('./common');

(async () => {
    const check = checker();
    const server = await startServer(8452);
    const browser = await launch();
    let a;
    try {
        a = await openPlayer(browser, 'http://localhost:8452/', 'A'); // no ?name=, nothing stored
        await waitFor(a, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && SceneManager._scene._commandWindow && SceneManager._scene._commandWindow.active && window.Coop && Coop.connected, 90000, 'title');
        await sleep(800);
        await a.evaluate(() => {
            window.BUZZ = 0; window.OKS = 0;
            const buzz = SoundManager.playBuzzer; SoundManager.playBuzzer = function () { BUZZ++; return buzz.apply(this, arguments); };
            const ok = SoundManager.playOk; SoundManager.playOk = function () { OKS++; return ok.apply(this, arguments); };
        });
        check('no name is set to begin with', await a.evaluate(() => Coop.name) === '');

        // A real press: held for a moment, as a finger does.
        await a.keyboard.down('Enter'); await sleep(150); await a.keyboard.up('Enter');
        await sleep(2500);
        const after = await a.evaluate(() => ({ buzz: BUZZ, oks: OKS, focused: document.activeElement && document.activeElement.tagName, scene: SceneManager._scene.constructor.name, held: Input.isPressed('ok') }));
        check('one press makes one sound, not a stream of them', after.buzz === 1 && after.oks <= 1, JSON.stringify(after));
        check('the name box has the keyboard and the game sees no key held', after.focused === 'INPUT' && !after.held && after.scene === 'Scene_Title');

        // Holding the key down for a long time is still one refusal.
        await a.evaluate(() => { document.activeElement.blur(); BUZZ = 0; OKS = 0; });
        await sleep(300);
        await a.keyboard.down('Enter'); await sleep(1500); await a.keyboard.up('Enter');
        await sleep(800);
        check('holding Enter does not repeat it either', await a.evaluate(() => BUZZ) === 1, 'buzzes ' + await a.evaluate(() => BUZZ));

        // Type a name, Enter to confirm; that Enter must not also start the game.
        await a.keyboard.type('Zed', { delay: 60 });
        await a.keyboard.down('Enter'); await sleep(700); await a.keyboard.up('Enter');
        await sleep(600);
        const named = await a.evaluate(() => ({ name: Coop.name, scene: SceneManager._scene.constructor.name, focused: document.activeElement.tagName, typedIntoGame: Input.isPressed('ok') }));
        check('the typed name is taken and the confirming Enter does not start the game', named.name === 'Zed' && named.scene === 'Scene_Title' && named.focused !== 'INPUT', JSON.stringify(named));

        // Now Enter starts a new game.
        await a.keyboard.down('Enter'); await sleep(150); await a.keyboard.up('Enter');
        await waitFor(a, () => SceneManager._scene instanceof Scene_Map, 30000, 'New Game starts once named');
        check('with a name, Enter starts the game', true);
        // Every co-op panel has to sit in front of the game's canvas, or it is there but unseen.
        const behind = await a.evaluate(() => Array.prototype.filter.call(document.querySelectorAll('[id^="coop-"]'), (el) => !(Number(getComputedStyle(el).zIndex) >= 50)).map((el) => el.id + '=' + getComputedStyle(el).zIndex));
        const panels = await a.evaluate(() => document.querySelectorAll('[id^="coop-"]').length);
        check('every co-op panel is drawn in front of the game picture', panels >= 10 && behind.length === 0, panels + ' panels; behind: ' + behind.join(', '));
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(a ? [a] : []);
    await browser.close();
    server.kill();
    process.exit(code);
})();
