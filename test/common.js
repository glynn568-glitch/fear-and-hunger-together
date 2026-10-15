// Brings two players to the dungeon gate on map 1, in one world.
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const install = require('./helpers');

async function twoPlayers(port, opts) {
    const o = Object.assign({ ax: 27, ay: 67, bx: 28, by: 67, actorA: 1, actorB: 3 }, opts);
    const server = await startServer(port);
    // FH_TEST_JOIN=1: B plays through a server of its own that joins A's, as a
    // friend on another PC would (`FH_TEST_JOIN=1 node test/run.js battle death`).
    const joiner = process.env.FH_TEST_JOIN ? await startServer(port + 100, { FH_JOIN: `http://localhost:${port}/` }) : null;
    const browser = await launch();
    const a = await openPlayer(browser, `http://localhost:${port}/?name=Ann`, 'A');
    const b = await openPlayer(browser, `http://localhost:${joiner ? port + 100 : port}/?name=Bo`, 'B');
    for (const p of [a, b]) {
        await waitFor(p, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 90000, 'title + connection');
        await p.evaluate(install);
    }
    await a.evaluate((act, x, y) => T.quickStart(act, x, y), o.actorA, o.ax, o.ay);
    await waitFor(a, () => T.onMap(), 60000, 'A on map');
    await a.evaluate(() => T.settle());
    await a.evaluate(() => T.begin());
    await waitFor(a, () => Coop.world.live, 10000, 'A live');
    await b.evaluate((act, x, y) => T.quickStart(act, x, y), o.actorB, o.bx, o.by);
    await waitFor(b, () => T.onMap(), 60000, 'B on map');
    await b.evaluate(() => T.settle());
    await b.evaluate(() => T.begin());
    await waitFor(b, () => Coop.world.live, 10000, 'B live');
    await sleep(500);
    const idA = await a.evaluate(() => Coop.id), idB = await b.evaluate(() => Coop.id);
    return { server, browser, a, b, idA, idB, close: async () => { await browser.close(); server.kill(); if (joiner) joiner.kill(); } };
}

function checker() {
    const results = [];
    const check = (name, ok, detail) => {
        results.push(!!ok);
        console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
    };
    check.finish = (pages) => {
        for (const p of pages || []) {
            const errs = p.errors.filter((e) => !/physical_attack_animation/.test(e));
            check(p.label + ' has no script errors', errs.length === 0, errs.slice(0, 3).join(' || ').slice(0, 700));
        }
        const failed = results.filter((r) => !r).length;
        console.log(failed ? `${failed} FAILED` : `all ${results.length} passed`);
        return failed ? 1 : 0;
    };
    return check;
}

// Runs the game's head count (common event 49) and then asks its usual
// recruiting question, "party size is not 4", the way its events do.
const canRecruit = (page) => page.evaluate(() => {
    const flag = 3600;
    $gameSwitches._data[flag] = false;
    const interp = new Game_Interpreter();
    interp.setup([
        { code: 117, indent: 0, parameters: [49] },
        { code: 111, indent: 0, parameters: [1, 34, 0, 4, 5] },
        { code: 121, indent: 1, parameters: [flag, flag, 0] },
        { code: 0, indent: 1, parameters: [] },
        { code: 412, indent: 0, parameters: [] },
        { code: 0, indent: 0, parameters: [] },
    ], 0);
    for (let i = 0; i < 600 && interp.isRunning(); i++) interp.update();
    return { can: !!$gameSwitches._data[flag], counted: $gameVariables.value(34), stuck: interp.isRunning() };
});

module.exports = { twoPlayers, checker, sleep, waitFor, canRecruit };
