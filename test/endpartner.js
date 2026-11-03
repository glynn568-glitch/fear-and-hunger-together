// The AI partner and an ending: it is taken into the ending its player reached, and after the
// credits it comes into the next run as a new body, not the finished one.
const { spawn } = require('child_process');
const path = require('path');
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const { checker } = require('./common');
const install = require('./helpers');
const { installDriver, onMap } = require('./late');

(async () => {
    const check = checker();
    const port = 8800;
    const server = await startServer(port);
    const browser = await launch();
    let bot;
    let a;
    const said = [];
    try {
        a = await openPlayer(browser, `http://localhost:${port}/?name=Ann`, 'A');
        await waitFor(a, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 90000, 'title');
        await a.evaluate(install);
        await a.evaluate(installDriver);
        bot = spawn(process.execPath, [path.join(__dirname, '..', 'tools', 'bot.js'), `http://localhost:${port}/`, '--name', 'Claude', '--brain', 'none'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
        bot.stdout.on('data', (d) => said.push(...String(d).trim().split('\n')));
        bot.stderr.on('data', (d) => said.push('ERR ' + String(d).trim()));
        await waitFor(a, () => Coop.others().some((p) => p.name === 'Claude'), 60000, 'the bot connects');
        await a.evaluate(() => T.quickStart(1, 27, 67));
        await waitFor(a, () => T.onMap(), 60000, 'A on the map');
        await a.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(a, () => Coop.peersHere().length === 1, 60000, 'the bot in the world');
        const run0 = await a.evaluate(() => Coop.world.runId);
        await a.evaluate(() => { $gameSwitches.setValue(1000, true); D.go(74, 2, 26); });
        await onMap(a, 74);
        await waitFor(a, () => Coop.peersHere().length === 1, 60000, 'the bot follows to the fortress').catch(() => {});
        await sleep(1500);
        await a.evaluate(() => $gameMap.event(60).start());
        await waitFor(a, () => Coop.others().some((p) => p.m === 86), 60000, 'the bot at the ending').catch(() => {});
        const botAt = await a.evaluate(() => Coop.others().map((p) => p.m + '/' + p.st));
        check('the partner is taken into the ending', botAt.some((x) => /^86\//.test(x)), JSON.stringify(botAt));
        await waitFor(a, () => SceneManager._scene instanceof Scene_Gameover, 240000, 'A at the Game Over');
        await a.evaluate(() => SceneManager.goto(Scene_Title));
        await waitFor(a, () => SceneManager._scene instanceof Scene_Title, 15000, 'A at the title');
        await sleep(1000);
        await a.evaluate(() => T.quickStart(1, 27, 67));
        await waitFor(a, () => T.onMap(), 60000, 'A on the map again');
        await a.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(a, () => Coop.world.live, 15000, 'A live');
        const fresh = await a.evaluate(() => ({ run: Coop.world.runId, out: $gameSwitches.value(1000) }));
        check('a New Game after it is a new run', fresh.run !== run0 && !fresh.out, JSON.stringify(fresh));
        const notEnding = await a.evaluate(() => $gameMap.mapId());
        check('A stays in the new run, not pulled back into the old ending', notEnding === 1, 'map ' + notEnding);
        await waitFor(a, () => Coop.peersHere().length === 1 && Coop.peersHere()[0].m === 1, 400000, 'the bot in the new run').catch(() => {});
        const back = await a.evaluate(() => Coop.peersHere().map((p) => p.m + '/' + p.st));
        check('the partner comes into the new run', back.length === 1 && back[0].startsWith('1/'), JSON.stringify(back) + ' ' + said.slice(-8).join(' | ').slice(0, 600));
        check('the partner never crashed', !said.some((l) => /^ERR|TypeError|ReferenceError/.test(l)), said.filter((l) => /ERR|Error/.test(l)).slice(0, 4).join(' | ').slice(0, 600));
        check.finish([a]);
    } catch (e) { console.error(e); check('test ran to the end', false); }
    if (bot) bot.kill();
    await browser.close();
    server.kill();
    process.exit(check.finish([]) || 0);
})();
