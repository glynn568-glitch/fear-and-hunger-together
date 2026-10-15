// Press screenshot of the AI partner talking, with its real mind (Claude Code
// on this PC). Spends a few model calls. Not part of the test run.
//   node test/shot-ai.js   -> dist/press/3-ai-partner.png
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const install = require('./helpers');

(async () => {
    const port = 8540;
    const out = path.join(__dirname, '..', 'dist', 'press');
    fs.mkdirSync(out, { recursive: true });
    const server = await startServer(port);
    const browser = await launch();
    let bot;
    try {
        const a = await openPlayer(browser, `http://localhost:${port}/?name=Ann`, 'human');
        await a.setViewport({ width: 900, height: 700, deviceScaleFactor: 2 });
        await waitFor(a, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 90000, 'title');
        await a.evaluate(install);
        await a.evaluate(() => T.quickStart(1, 27, 67));
        await waitFor(a, () => T.onMap(), 60000, 'on the map');
        await a.evaluate(() => { T.settle(); T.begin(); window.heard = []; Coop.on('heard', (m) => window.heard.push(m.text)); });
        await waitFor(a, () => Coop.world.live, 10000, 'live');
        bot = spawn(process.execPath, [path.join(__dirname, '..', 'tools', 'bot.js'), `http://localhost:${port}/`, '--name', 'Claude', '--char', 'knight', '--stdin-stop'], { stdio: ['pipe', 'pipe', 'pipe'] });
        bot.stdout.on('data', (d) => process.stdout.write('  ' + String(d)));
        await waitFor(a, () => Coop.others().some((p) => p.bot === 1 && p.st === 'map'), 120000, 'the partner arrives');
        await sleep(12000); // its greeting
        for (const line of ['this place reeks. stay close to me.', 'if I go down, drag me to a ritual circle. promise?']) {
            const n = await a.evaluate(() => window.heard.length);
            await a.evaluate((t) => Coop.say(t), line);
            await waitFor(a, (k) => window.heard.length > k, 60000, 'a reply', n);
            await sleep(2500);
        }
        await a.screenshot({ path: path.join(out, '3-ai-partner.png') });
        console.log('heard:', JSON.stringify(await a.evaluate(() => window.heard)));
    } catch (e) {
        console.error(e);
        process.exitCode = 1;
    } finally {
        if (bot) { try { bot.stdin.write('stop\n'); } catch (e) { /* gone */ } setTimeout(() => bot.kill(), 3000); }
        await sleep(3500);
        await browser.close();
        server.kill();
    }
})();
