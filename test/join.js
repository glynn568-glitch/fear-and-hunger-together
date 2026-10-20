// Joining with your own copy: the joiner's server serves the game from its
// own install and passes only the socket and the save files to the host.
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const install = require('./helpers');
const { checker } = require('./common');

const HOST = 8460, JOINER = 8461, BADKEY = 8462, NOHOST = 8463;
const KEY = 'jointest';

(async () => {
    const check = checker();
    const host = await startServer(HOST, { FH_KEY: KEY });
    const joiner = await startServer(JOINER, { FH_JOIN: `http://localhost:${HOST}/?k=${KEY}` });
    const badKey = await startServer(BADKEY, { FH_JOIN: `http://localhost:${HOST}/?k=wrong` });
    const noHost = await startServer(NOHOST, { FH_JOIN: 'http://localhost:8469/?k=x' });
    const browser = await launch();
    let a, b;
    try {
        a = await openPlayer(browser, `http://localhost:${HOST}/?name=Ann`, 'host');
        b = await openPlayer(browser, `http://localhost:${JOINER}/?name=Bo`, 'joiner');
        for (const p of [a, b]) {
            await waitFor(p, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 90000, 'title + connection');
            await p.evaluate(install);
        }
        check('the joiner reaches the host through its own server', await a.evaluate(() => Coop.peers.size) === 1 && await b.evaluate(() => Coop.peers.size) === 1);
        check('the joiner\'s game came from its own server', !b.logs.some((l) => /http 40\d/.test(l) && !/favicon/.test(l)), b.logs.filter((l) => /http 4/.test(l)).slice(0, 3).join(' '));
        check('the joiner\'s page says it joined', await b.evaluate(() => window.COOP_BUILD.joined === true) && await a.evaluate(() => window.COOP_BUILD.joined === false));

        await a.evaluate(() => T.quickStart(1, 27, 67));
        await waitFor(a, () => T.onMap(), 60000, 'host on map');
        await a.evaluate(() => { $gameSwitches.setValue(25, true); T.begin(); });
        await waitFor(a, () => Coop.world.live, 10000, 'host live');
        await b.evaluate(() => T.quickStart(3, 28, 67));
        await waitFor(b, () => T.onMap(), 60000, 'joiner on map');
        await b.evaluate(() => T.begin());
        await waitFor(b, () => Coop.world.live, 10000, 'joiner live');
        check('the joiner adopted the host\'s world', await b.evaluate(() => $gameSwitches.value(25)));

        await b.evaluate(() => T.step(8));
        await sleep(800);
        const idB = await b.evaluate(() => Coop.id);
        const seen = await a.evaluate((id) => T.avatar(id), idB);
        check('the host sees the joiner walk', seen && seen.drawn && seen.x === 28 && seen.y === 66, JSON.stringify(seen));

        await b.evaluate(() => $gameSwitches.setValue(22, true));
        await sleep(500);
        check('a world switch from the joiner reaches the host', await a.evaluate(() => $gameSwitches.value(22)));

        // Fights stream pictures and keys both ways over the same socket.
        await b.evaluate(() => { $gameSystem.onBeforeSave(); DataManager.saveGame(3); });
        await sleep(1500);
        const onHost = path.join(host.saves, 'players', 'bo', 'file3.rpgsave');
        const onJoiner = path.join(joiner.saves, 'players', 'bo', 'file3.rpgsave');
        check('the joiner\'s save is kept on the joiner\'s own PC, not the host', fs.existsSync(onJoiner) && !fs.existsSync(onHost));
        check('...and reads back through its own server', await b.evaluate(() => StorageManager.exists(3) && !!StorageManager.load(3)));

        // The joiner's server is for its own PC: another machine gets neither the game nor a seat.
        const http = require('http');
        const lanGet = (p) => new Promise((resolve) => http.get({ host: 'localhost', port: JOINER, path: p, headers: { 'x-forwarded-for': '192.168.1.50' } }, (r) => { r.resume(); resolve(r.statusCode); }).on('error', () => resolve(0)));
        const lanWs = await new Promise((resolve) => {
            const ws = new WebSocket(`ws://localhost:${JOINER}/coop/ws` + require('../tools/version').socketQuery(), { headers: { 'x-forwarded-for': '192.168.1.50' } });
            ws.on('close', (code) => resolve(code)); ws.on('error', () => resolve(-1));
        });
        check('a joining server serves nobody else on the network', await lanGet('/') === 403 && await lanGet('/js/rpg_core.js') === 403 && await lanGet('/coop/store/Bo/index') === 403 && lanWs === 4004, 'ws ' + lanWs);

        // A link with the wrong key: told why, and no endless retrying.
        const c = await openPlayer(browser, `http://localhost:${BADKEY}/?name=Cy`, 'badkey');
        await waitFor(c, () => window.Coop && Coop.refused, 30000, 'refused');
        check('a wrong key is refused with a reason', /key/.test(await c.evaluate(() => Coop.refused)));

        // No host at the link: said on screen, and it keeps trying.
        const d = await openPlayer(browser, `http://localhost:${NOHOST}/?name=Di`, 'nohost');
        await waitFor(d, () => window.Coop && document.body.innerText.includes('Cannot reach the host'), 30000, 'host down note');
        check('a dead link says it cannot reach the host', !(await d.evaluate(() => Coop.refused)));

        // Another build, through the joiner's server.
        const other = await new Promise((resolve) => {
            const ws = new WebSocket(`ws://localhost:${JOINER}/coop/ws?fp=0000&build=1&mod=x&v=0.0.1`);
            const inbox = [];
            ws.on('message', (raw) => inbox.push(JSON.parse(raw)));
            ws.on('close', (code) => resolve({ code, inbox }));
            ws.on('error', () => resolve({ code: 0, inbox }));
        });
        check('another build is turned away at the joiner too', other.code === 4001 && other.inbox[0] && other.inbox[0].t === 'version');

    } catch (e) {
        check('ran to the end', false, e.message);
    } finally {
        await browser.close();
        for (const s of [host, joiner, badKey, noHost]) s.kill();
    }
    process.exit(check.finish([a, b].filter(Boolean)));
})();
