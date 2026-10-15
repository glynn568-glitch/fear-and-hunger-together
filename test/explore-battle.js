const { startServer, launch, openPlayer, waitFor, shot, sleep } = require('./lib');
const install = require('./helpers');
(async () => {
    const server = await startServer(8434);
    const browser = await launch();
    try {
        const a = await openPlayer(browser, 'http://localhost:8434/?name=Ann', 'A');
        await waitFor(a, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 90000, 'title');
        await a.evaluate(install);
        await a.evaluate(() => T.quickStart(1, 27, 67));
        await waitFor(a, () => T.onMap(), 60000, 'map');
        await a.evaluate(() => { T.settle(); T.begin(); });
        await sleep(500);
        console.log('troops', await a.evaluate(() => $dataTroops.slice(1, 12).map((t) => t.id + ':' + t.name + '[' + t.members.length + ' members, ' + t.pages.length + ' pages]').join(' | ')));
        await a.evaluate(() => { Game_Party.prototype.maxBattleMembers = function () { return 8; }; for (const id of [3, 4, 5, 2, 7]) $gameParty.addActor(id); BattleManager.setup(1, true, false); SceneManager.push(Scene_Battle); });
        for (let i = 0; i < 6; i++) {
            await sleep(2500);
            const st = await a.evaluate(() => ({
                scene: SceneManager._scene.constructor.name, phase: BattleManager._phase, inputting: BattleManager.isInputting(),
                actor: BattleManager.actor() && BattleManager.actor().name(), msg: $gameMessage.isBusy(), text: $gameMessage._texts.join('/').slice(0, 80),
                party: $gameParty.battleMembers().map((m) => m.name() + ':' + m.hp), troop: $gameTroop.members().map((m) => m.name() + ':' + m.hp).join(','),
                win: SceneManager._scene._windowLayer ? SceneManager._scene._windowLayer.children.filter((w) => w.visible && w.isOpen && w.isOpen()).map((w) => w.constructor.name + (w.active ? '*' : '')).join(',') : '',
            }));
            console.log(i, JSON.stringify(st));
            await shot(a, 'battle-' + i);
            // press OK
            await a.keyboard.down('KeyZ'); await sleep(120); await a.keyboard.up('KeyZ'); await sleep(150);
        }
        console.log('errors', a.errors.filter((e) => !/physical_attack/.test(e)).slice(0, 5));
    } catch (e) { console.error(e); }
    await browser.close(); server.kill(); process.exit(0);
})();
