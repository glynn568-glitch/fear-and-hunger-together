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
        // Weapons do what their text says, to what they hit: a morning star bleeds and stuns
        // now and then, a long sword does neither. The enemy bleed wears off.
        const hits = await a.evaluate(() => {
            const actor = $gameActors.actor(1), keep = actor._equips[0].object();
            $gameTroop.setup(1);
            const swing = (wid) => {
                actor._equips[0].setObject($dataWeapons[wid]); actor.refresh();
                const n = {}; let landed = 0;
                for (let i = 0; landed < 400 && i < 4000; i++) { // 400 landed: a rate read off ~90 drifts past the bounds now and then
                    const t = $gameTroop.members()[i % 4]; t.recoverAll(); t.clearStates();
                    const act = new Game_Action(actor); act.setAttack(); act.apply(t);
                    if (t.result().isHit() && t.isAlive()) landed++; else continue;
                    for (const sid of t.result().addedStates) n[sid] = (n[sid] || 0) + 1;
                }
                return { bleed: (n[29] || 0) / landed, stun: (n[28] || 0) / landed };
            };
            const r = { star: swing(38), sword: swing(7), bleedTurns: $dataStates[29].maxTurns, bleedHrg: $dataStates[29].traits.find((x) => x.code === 22).value };
            actor._equips[0].setObject(keep); actor.refresh(); $gameTroop.clear();
            return r;
        });
        check('a morning star bleeds and stuns what it hits at modest rates, a long sword does not', hits.star.bleed > 0.25 && hits.star.bleed < 0.45 && hits.star.stun > 0.05 && hits.star.stun < 0.2 && !hits.sword.bleed && !hits.sword.stun && hits.bleedTurns === 4 && hits.bleedHrg === -0.05, JSON.stringify(hits));
        // Silver coins go past 99 (to 999); every other item still stops at 99.
        const coins = await a.evaluate(() => {
            $gameParty.gainItem($dataItems[59], 150); $gameParty.gainItem($dataItems[1], 150); $gameParty.gainItem($dataItems[59], 2000);
            const r = { coins: $gameParty.numItems($dataItems[59]), other: $gameParty.numItems($dataItems[1]) };
            $gameParty.loseItem($dataItems[59], 999); $gameParty.loseItem($dataItems[1], 99);
            return r;
        });
        check('silver coins count up to 999, other items still stop at 99', coins.coins === 999 && coins.other === 99, JSON.stringify(coins));
        // A window back copied from an earlier one is the same picture as one painted afresh.
        const same = await a.evaluate(() => {
            const px = (w) => Array.from(w._windowBackSprite.bitmap.context.getImageData(0, 0, 200, 100).data).join();
            const w1 = new Window_Base(0, 0, 237, 131); w1.setTone(40, -30, 10);
            const w2 = new Window_Base(0, 0, 237, 131); w2.setTone(40, -30, 10);
            const w3 = new Window_Base(0, 0, 237, 131); w3.setTone(0, 0, 0);
            return { same: px(w1) === px(w2), toned: px(w1) !== px(w3), shared: w1._windowBackSprite.bitmap !== w2._windowBackSprite.bitmap };
        });
        check('a window back copied from an earlier one matches it, its own bitmap, by tone', same.same && same.toned && same.shared, JSON.stringify(same));
        // The mace's punch1 is mastered ~14 dB hotter than the rest; it plays turned down.
        const vols = await a.evaluate(() => {
            const at = (name) => { AudioManager.playSe({ name, volume: 90, pitch: 130, pan: 0 }); const b = AudioManager._seBuffers[AudioManager._seBuffers.length - 1]; return b ? b.volume : null; };
            return { punch: at('punch1'), other: at('hit_single') };
        });
        check('the hottest sound files play turned down, others as the game set them', vols.punch > 0 && vols.other > 0 && Math.abs(vols.punch / vols.other - 0.09) < 0.005, JSON.stringify(vols));
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(a ? [a] : []);
    await browser.close();
    server.kill();
    process.exit(code);
})();
