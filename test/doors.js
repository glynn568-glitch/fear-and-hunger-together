// Doors that swing open with the action key (map 29's kitchen door here):
// one player opening it opens it for everyone, and the AI partner opens a
// shut door in its way itself instead of giving up and teleporting.
const { spawn } = require('child_process');
const path = require('path');
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const { checker } = require('./common');
const install = require('./helpers');

const MAP = 29, DOOR = 5, DOOR_SWITCH = 21; // EV005 "door1" at (15,49); its swing turns switch 21 on

(async () => {
    const check = checker();
    const port = 8472;
    const server = await startServer(port);
    const browser = await launch();
    let bot, a, b;
    const said = [];
    try {
        //--- two people: one opens, both see it open ----------------------------
        a = await openPlayer(browser, `http://localhost:${port}/?name=Ann`, 'A');
        b = await openPlayer(browser, `http://localhost:${port}/?name=Bo`, 'B');
        for (const p of [a, b]) {
            await waitFor(p, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 90000, 'title');
            await p.evaluate(install);
        }
        for (const [p, actor] of [[a, 1], [b, 3]]) {
            await p.evaluate((act) => T.quickStart(act, 27, 67), actor);
            await waitFor(p, () => T.onMap(), 60000, 'on the map');
            await p.evaluate(() => { T.settle(); T.begin(); });
            await waitFor(p, () => Coop.world.live, 15000, 'live');
        }
        for (const [p, y] of [[a, 50], [b, 51]]) {
            await p.evaluate((m, y) => $gamePlayer.reserveTransfer(m, 15, y, 8, 0), MAP, y);
            await waitFor(p, (m) => T.onMap() && $gameMap.mapId() === m, 30000, 'on map 29', MAP);
            await p.evaluate(() => T.settle());
        }
        await sleep(800);
        const shut = await b.evaluate((id, sw) => ({ page: $gameMap.event(id).findProperPageIndex(), sw: $gameSwitches.value(sw), solid: $gameMap.event(id).isNormalPriority() }), DOOR, DOOR_SWITCH);
        // A opens it the way a player does: facing it, the action key.
        await a.evaluate(() => $gamePlayer.setDirection(8));
        await a.keyboard.down('KeyZ'); await sleep(120); await a.keyboard.up('KeyZ');
        await waitFor(a, (sw) => $gameSwitches.value(sw), 8000, 'the door swings open for A', DOOR_SWITCH);
        await waitFor(b, (sw) => $gameSwitches.value(sw), 5000, 'and for B', DOOR_SWITCH);
        // The door takes its new page on B's next map refresh.
        await waitFor(b, (id) => $gameMap.event(id).isThrough(), 3000, 'the door open on B', DOOR).catch(() => {});
        const open = await b.evaluate((id) => ({ page: $gameMap.event(id).findProperPageIndex(), through: $gameMap.event(id).isThrough() }), DOOR);
        check('a door one player opens is open for everyone', shut.solid && !shut.sw && open.through, JSON.stringify({ shut, open }));
        await b.close(); b = null;

        //--- the AI partner opens a shut door in its way -----------------------
        // The door shut again (a fresh run of this map would have it shut).
        await a.evaluate((sw) => $gameSwitches.setValue(sw, false), DOOR_SWITCH);
        await sleep(500);
        bot = spawn(process.execPath, [path.join(__dirname, '..', 'tools', 'bot.js'), `http://localhost:${port}/`, '--name', 'Claude', '--brain', 'none'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
        bot.stdout.on('data', (d) => said.push(...String(d).trim().split('\n')));
        bot.stderr.on('data', (d) => said.push('ERR ' + String(d).trim()));
        // A stands below the door; the partner joins beside A.
        await a.evaluate(() => { $gamePlayer.locate(15, 51); });
        await waitFor(a, (m) => Coop.peersHere().some((p) => p.name === 'Claude' && p.m === m), 120000, 'the partner arrives on map 29', MAP);
        await waitFor(a, () => { const p = Coop.peersHere().find((q) => q.name === 'Claude'); return p && Math.abs(p.x - $gamePlayer.x) + Math.abs(p.y - $gamePlayer.y) <= 3; }, 60000, 'the partner beside A');
        // A slips through the shut door to the room above (as if they had opened and closed it).
        const room = await a.evaluate(() => { $gamePlayer.setThrough(true); $gamePlayer.locate(15, 46); $gamePlayer.setThrough(false); return [$gamePlayer.x, $gamePlayer.y]; });
        const t0 = Date.now();
        const said0 = said.length;
        let reached = false;
        try {
            await waitFor(a, () => { const p = Coop.peersHere().find((q) => q.name === 'Claude'); return p && p.y <= 48 && Math.abs(p.x - $gamePlayer.x) + Math.abs(p.y - $gamePlayer.y) <= 3; }, 45000, 'the partner through the door');
            reached = true;
        } catch (e) { /* reported below */ }
        const log = said.slice(said0).join(' | ');
        const where = await a.evaluate(() => { const p = Coop.peersHere().find((q) => q.name === 'Claude'); return p ? [p.x, p.y] : null; });
        check('the partner opens a shut door in its way and walks through, no teleport', reached && !/no way on foot/.test(log), 'A at ' + room + ', partner at ' + JSON.stringify(where) + ' after ' + Math.round((Date.now() - t0) / 1000) + ' s; ' + log.slice(0, 300));
        check('the door it opened is open for A too', await a.evaluate((sw) => $gameSwitches.value(sw), DOOR_SWITCH));
    } catch (e) {
        console.error(e);
        check('ran to the end', false, e.message);
    } finally {
        if (bot) bot.kill();
        await browser.close();
        server.kill();
    }
    process.exit(check.finish([a].filter(Boolean)));
})();
