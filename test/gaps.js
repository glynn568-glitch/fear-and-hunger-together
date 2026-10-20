// Design-gap fixes: a dropped player can carry on, the dead can give up,
// two players cannot be the same protagonist, saving alongside never eats a
// save from another game, and the keys are explained.
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const { twoPlayers, checker, sees } = require('./common');
const install = require('./helpers');

const titleReady = () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected;
const resumeOffer = (page) => page.evaluate(() => { const b = document.getElementById('coop-resume'); return { shown: b.style.display !== 'none', text: b.textContent }; });

(async () => {
    const check = checker();
    let s;
    try {
        s = await twoPlayers(8457);
        const { a, b, browser } = s;
        const port = 8457;

        //--- carrying on after a dropped connection ---
        await a.evaluate(() => { $gameParty.gainItem($dataItems[1], 4); T.step(8); });
        await sleep(600);
        check('the state is parked while safely on the map', await a.evaluate(() => Coop.parkNow()));
        await sleep(500);
        await a.close({ runBeforeUnload: false }); // the tab simply dies
        await waitFor(b, () => Coop.peers.size === 0, 8000, 'B sees A vanish');
        const a2 = await openPlayer(browser, `http://localhost:${port}/?name=Ann`, 'A2');
        await waitFor(a2, titleReady, 90000, 'A back at the title');
        await a2.evaluate(install);
        await waitFor(a2, () => document.getElementById('coop-resume').style.display !== 'none', 8000, 'A is offered to carry on');
        check('back at the title, A is offered to carry on', /You dropped out a moment ago\. Press R to carry on from there\./.test((await resumeOffer(a2)).text));
        await a2.keyboard.down('KeyR'); await sleep(120); await a2.keyboard.up('KeyR');
        await waitFor(a2, () => SceneManager._scene instanceof Scene_Map && SceneManager._scene.isActive() && Coop.world.live, 30000, 'A is back in the world');
        const back = await a2.evaluate(() => ({ x: $gamePlayer.x, y: $gamePlayer.y, items: $gameParty.numItems($dataItems[1]), party: $gameParty._actors.join(), map: $gameMap.mapId() }));
        check('A is where they were, with what they had', back.x === 27 && back.y === 66 && back.items === 4 && back.party === '1' && back.map === 1, JSON.stringify(back));
        await sleep(800);
        check('B sees A again', await sees(b, 1));

        // Dropping out mid-fight.
        await a2.evaluate(() => Coop.parkNow());
        await a2.evaluate(() => { for (const p of Coop.others()) p.st = 'away'; BattleManager.setup(1, true, true); SceneManager.push(Scene_Battle); });
        await waitFor(a2, () => SceneManager._scene instanceof Scene_Battle && BattleManager._phase === 'input', 20000, 'A in a fight');
        await waitFor(b, () => Coop.others()[0] && Coop.others()[0].st === 'battle', 8000, 'the server knows A is fighting');
        await a2.close({ runBeforeUnload: false });
        await waitFor(b, () => Coop.peers.size === 0, 8000, 'A vanishes mid-fight');
        const a3 = await openPlayer(browser, `http://localhost:${port}/?name=Ann`, 'A3');
        await waitFor(a3, titleReady, 90000, 'A at the title again');
        await a3.evaluate(install);
        await sleep(2500);
        // Still offered, but not as an escape: test/lifecycle.js checks they come back barely alive.
        check('dropping out of a fight of your own still lets you carry on', (await resumeOffer(a3)).shown);

        //--- two players cannot be the same protagonist ---
        await a3.evaluate(() => T.quickStart(3, 27, 67)); // B is already the knight
        await waitFor(a3, () => T.onMap(), 60000, 'A3 on the map as a second knight');
        await a3.evaluate(() => { $gameSwitches._data[662] = true; T.settle(); T.begin(); });
        await sleep(1500);
        const clash = await a3.evaluate(() => ({ live: Coop.world.live, sameAs: Coop.world.sameAs, toast: document.getElementById('coop-toast').textContent, hud: document.getElementById('coop-hud').textContent }));
        check('a second knight is kept out of the shared world and told why', !clash.live && clash.sameAs === 'Bo' && /Bo is already playing this character/.test(clash.toast) && /playing alone: Bo has this character/.test(clash.hud), JSON.stringify(clash));
        check('and does not write into it', await (async () => { await a3.evaluate(() => $gameSwitches.setValue(25, true)); await sleep(400); return !(await b.evaluate(() => $gameSwitches.value(25))); })());

        //--- the dead can let a character go ---
        await a3.evaluate(() => SceneManager.goto(Scene_Title));
        await waitFor(a3, titleReady, 20000, 'title');
        await a3.evaluate(() => T.quickStart(1, 27, 67));
        await waitFor(a3, () => T.onMap(), 60000, 'A3 as the mercenary');
        await a3.evaluate(() => { $gameSwitches._data[661] = true; T.settle(); T.begin(); });
        await waitFor(a3, () => Coop.world.live, 10000, 'A3 live');
        await sleep(600);
        await a3.evaluate(() => SceneManager.goto(Scene_Gameover));
        await waitFor(a3, () => SceneManager._scene instanceof Scene_CoopDead, 8000, 'A3 dead');
        await sleep(1200);
        check('the dead are told they can give the character up', /Hold Esc to give this character up/.test(await a3.evaluate(() => document.getElementById('coop-dead').textContent)));
        await a3.keyboard.down('Escape'); await sleep(2600); await a3.keyboard.up('Escape');
        await waitFor(a3, () => SceneManager._scene instanceof Scene_Title, 10000, 'back at the title');
        check('holding Esc returns a dead player to the title', await a3.evaluate(() => !Coop.dead && !Coop.world.live));
        await sleep(1500);
        check('giving up leaves nothing to carry on from', !(await resumeOffer(a3)).shown);

        //--- saving alongside never eats another game's save ---
        const slots = await b.evaluate(() => {
            // B keeps a save from some other game in slot 1.
            const run = Coop.world.runId;
            Coop.world.runId = 'another-game';
            $gameSystem.onBeforeSave(); DataManager.saveGame(1);
            Coop.world.runId = run;
            return (DataManager.loadGlobalInfo() || []).map((i) => i && i.coopRun);
        });
        await a3.evaluate(() => T.quickStart(1, 27, 67));
        await waitFor(a3, () => T.onMap(), 60000, 'A3 back in');
        await a3.evaluate(() => { $gameSwitches._data[661] = true; T.settle(); T.begin(); });
        await waitFor(a3, () => Coop.world.live, 10000, 'A3 live again');
        await sleep(500);
        await a3.evaluate(() => { $gameSystem.onBeforeSave(); DataManager.saveGame(1); });
        await waitFor(b, () => StorageManager.exists(2), 8000, 'B saved alongside');
        const after = await b.evaluate(() => (DataManager.loadGlobalInfo() || []).map((i) => i && i.coopRun));
        check("B's save from another game is left alone; the shared save goes in the next slot", after[1] === 'another-game' && after[2] && after[2] !== 'another-game', JSON.stringify(slots) + ' -> ' + JSON.stringify(after));

        //--- the keys are explained ---
        await b.keyboard.press('F1');
        await sleep(300);
        const help = await b.evaluate(() => { const h = document.getElementById('coop-help'); const pad = h.querySelector('footer.pad'); return { shown: h.style.display !== 'none', text: pad.style.display === 'none' ? h.textContent.replace(pad.textContent, '') : h.textContent }; });
        check('F1 explains how playing together works', help.shown && /Facing a partner: hand them something/.test(help.text) && /ritual circle/.test(help.text) && help.text.length < 760, help.text.length + ' chars');
        await b.keyboard.press('F1');

        //--- G lays a bear trap, as the menu does ---
        await b.evaluate(() => { $gameParty.gainItem($dataItems[76], 2); window.TRAPS = 0; const r = Game_Temp.prototype.reserveCommonEvent; Game_Temp.prototype.reserveCommonEvent = function (id) { if (id === 55) TRAPS++; return r.apply(this, arguments); }; });
        await b.keyboard.down('KeyG'); await sleep(120); await b.keyboard.up('KeyG');
        await sleep(600);
        const trap = await b.evaluate(() => ({ left: $gameParty.numItems($dataItems[76]), laid: TRAPS }));
        check('G lays a bear trap from the bag', trap.left === 1 && trap.laid === 1, JSON.stringify(trap));
        s.a = a3;
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
