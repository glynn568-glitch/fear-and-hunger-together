// The companion bot, run as a separate process the way a person would run
// it, against a "human" player driven by this test.
const { spawn } = require('child_process');
const path = require('path');
const { startServer, launch, openPlayer, waitFor, shot, sleep } = require('./lib');
const { checker } = require('./common');
const install = require('./helpers');

(async () => {
    const check = checker();
    const port = 8451;
    const server = await startServer(port);
    const browser = await launch();
    let bot;
    let a;
    const said = [];
    try {
        a = await openPlayer(browser, `http://localhost:${port}/?name=Ann`, 'A');
        await waitFor(a, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 90000, 'title');
        await a.evaluate(install);
        bot = spawn(process.execPath, [path.join(__dirname, '..', 'tools', 'bot.js'), `http://localhost:${port}/`, '--name', 'Claude'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
        bot.stdout.on('data', (d) => said.push(...String(d).trim().split('\n')));
        bot.stderr.on('data', (d) => said.push('ERR ' + String(d).trim()));

        await waitFor(a, () => Coop.others().some((p) => p.name === 'Claude'), 60000, 'the bot connects');
        await waitFor(a, () => Coop.others()[0].st === 'title', 10000, 'the bot reports in from the title');
        check('the bot connects and waits at the title', true);
        await a.evaluate(() => T.quickStart(1, 27, 67));
        await waitFor(a, () => T.onMap(), 60000, 'human on the map');
        await a.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(a, () => { const p = Coop.peersHere()[0]; return p && Math.abs(p.x - $gamePlayer.x) + Math.abs(p.y - $gamePlayer.y) <= 3; }, 60000, 'the bot appears beside the human');
        const first = await a.evaluate(() => { const p = Coop.peersHere()[0]; return { cn: p.cn, an: p.an, ini: p.ini }; });
        check('it joined as a different protagonist', first.an !== 'Mercenary' && first.ini.length === 1, JSON.stringify(first));
        const seen = await a.evaluate(() => { const p = Coop.peersHere()[0]; const e = SceneManager._scene._spriteset._coopSprites.get(p.id); return { transparent: !!p.tr, drawn: !!e, visible: !!e && e.sprite.visible && e.sprite.opacity > 0, label: e && e.label ? e.label.visible : false }; });
        await sleep(1500);
        check('it steps off the tile the human is standing on', await a.evaluate(() => { const p = Coop.peersHere()[0]; return Coop.distanceTo(p) >= 1; }));
        check('the human can actually see it, name and all', !seen.transparent && seen.drawn && seen.visible && seen.label, JSON.stringify(seen));

        // Walk off; it should come along.
        for (let i = 0; i < 9; i++) { await a.evaluate(() => T.step(8)); await sleep(280); }
        await waitFor(a, () => { const p = Coop.peersHere()[0]; return p && Math.abs(p.x - $gamePlayer.x) + Math.abs(p.y - $gamePlayer.y) <= 3; }, 20000, 'the bot catches up after a walk');
        check('it follows on foot', true);
        console.log('screenshot', await shot(a, 'bot-follow'));

        // Leave for another map.
        await a.evaluate(() => { $gamePlayer.reserveTransfer(74, 15, 22, 8, 0); });
        await waitFor(a, () => $gameMap.mapId() === 74 && SceneManager._scene instanceof Scene_Map && SceneManager._scene.isActive(), 30000, 'human on the fortress map');
        await a.evaluate(() => T.settle());
        await waitFor(a, () => Coop.peersHere().length === 1, 40000, 'the bot follows to the other map');
        check('it follows to another map', true);

        // A fight: it is pulled in and takes its turn.
        await waitFor(a, () => { const p = Coop.peersHere()[0]; return p && (p.st === 'map' || p.st === 'event') && Coop.distanceTo(p) <= 4; }, 30000, 'the bot settles next to the human');
        await a.evaluate(() => { BattleManager.setup(1, true, true); SceneManager.push(Scene_Battle); });
        await waitFor(a, () => BattleManager._phase === 'input' && Coop.battle && Coop.battle.guests.size === 1, 25000, 'the bot joins the fight');
        check('it is pulled into the fight', await a.evaluate(() => $gameParty._actors.length) === 2);
        // The human attacks; then the bot must finish its own turn unaided.
        for (let i = 0; i < 3; i++) { await a.keyboard.down('Enter'); await sleep(130); await a.keyboard.up('Enter'); await sleep(260); }
        await waitFor(a, () => BattleManager._phase !== 'input', 20000, 'the bot commands its own character');
        check('it takes its own turn', true);
        await a.evaluate(() => BattleManager.abort());
        await waitFor(a, () => SceneManager._scene instanceof Scene_Map, 15000, 'fight over');
        await waitFor(a, () => { const p = Coop.peersHere()[0]; return p && p.st !== 'battle'; }, 15000, 'the bot is back on the map');
        check('it returns to the map afterwards', true);
        console.log('bot said:', said.filter((l) => l.startsWith('[bot]')).join(' | ').slice(0, 900));
        const errs = said.filter((l) => /script error|ERR /.test(l));
        check('the bot reported no script errors', errs.length === 0, errs.slice(0, 3).join(' | ').slice(0, 500));
    } catch (e) {
        console.error(e);
        check('test ran to the end', false);
        if (a) console.log('bot as the human sees it:', await a.evaluate(() => JSON.stringify(Coop.others().map((p) => ({ st: p.st, m: p.m, x: p.x, y: p.y })))).catch(() => ''), 'human at', await a.evaluate(() => $gamePlayer.x + ',' + $gamePlayer.y + ' battle ' + JSON.stringify(Coop.battle && { g: Coop.battle.guests.size, inv: Coop.battle.invited.size, pend: Coop.battle.pending.length })).catch(() => ''));
    }
    const code = check.finish(a ? [a] : []);
    if (code) console.log('bot said:', said.join(' | ').slice(0, 1200));
    if (bot) bot.kill();
    await browser.close();
    server.kill();
    process.exit(code);
})();
