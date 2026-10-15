// Steps 3 and 4: two players in one world see each other and share state.
const { startServer, launch, openPlayer, waitFor, shot, sleep } = require('./lib');
const install = require('./helpers');

const checks = [];
function check(name, ok, detail) {
    checks.push(ok);
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
}

(async () => {
    const port = 8432;
    const server = await startServer(port);
    const browser = await launch();
    try {
        const a = await openPlayer(browser, `http://localhost:${port}/?name=Ann`, 'A');
        const b = await openPlayer(browser, `http://localhost:${port}/?name=Bo`, 'B');
        for (const p of [a, b]) {
            await waitFor(p, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 90000, 'title + connection');
            await p.evaluate(install);
        }
        const idA = await a.evaluate(() => Coop.id), idB = await b.evaluate(() => Coop.id);
        check('both connected and see each other', await a.evaluate(() => Coop.peers.size) === 1 && await b.evaluate(() => Coop.peers.size) === 1);
        check('names travel', await a.evaluate((id) => Coop.peers.get(id).name, idB) === 'Bo');

        await a.evaluate(() => T.quickStart(1, 27, 67));
        await waitFor(a, () => T.onMap(), 60000, 'A on map');
        await a.evaluate(() => { $gameSwitches.setValue(25, true); $gameVariables.setValue(121, 3); T.begin(); });
        await waitFor(a, () => Coop.world.live, 10000, 'A live');
        check('A founded the world', (await a.evaluate(() => Coop.log.join('|'))).includes('founded the world'));

        await b.evaluate(() => T.quickStart(3, 28, 67));
        await waitFor(b, () => T.onMap(), 60000, 'B on map');
        await b.evaluate(() => { $gameVariables.setValue(121, 9); T.begin(); });
        await waitFor(b, () => Coop.world.live, 10000, 'B live');
        check('B adopted the existing world', await b.evaluate(() => $gameSwitches.value(25) && $gameVariables.value(121) === 3));
        check('identity stays private', await a.evaluate(() => $gameSwitches.value(246) && !$gameSwitches.value(242)) && await b.evaluate(() => $gameSwitches.value(242) && !$gameSwitches.value(246)));

        await sleep(600);
        const seenByB = await b.evaluate((id) => T.avatar(id), idA);
        const seenByA = await a.evaluate((id) => T.avatar(id), idB);
        check('B sees A drawn at 27,67', seenByB && seenByB.drawn && seenByB.x === 27 && seenByB.y === 67, JSON.stringify(seenByB));
        check('A sees B drawn at 28,67 as the knight', seenByA && seenByA.drawn && seenByA.x === 28 && seenByA.name === 'knight', JSON.stringify(seenByA));

        await a.evaluate(() => T.step(8));
        await sleep(700);
        const moved = await b.evaluate((id) => T.avatar(id), idA);
        check('A walks, B sees it', moved.x === 27 && moved.y === 66 && moved.d === 8, JSON.stringify(moved));

        await a.evaluate(() => { $gameSwitches.setValue(22, true); $gameSwitches.setValue(52, true); $gameVariables.setValue(122, 2); $gameVariables.setValue(14, 1); $gameSelfSwitches.setValue([1, 5, 'A'], true); });
        await sleep(500);
        const got = await b.evaluate(() => ({ world: $gameSwitches.value(22), priv: $gameSwitches.value(52), va: $gameVariables.value(122), pva: $gameVariables.value(14), ss: $gameSelfSwitches.value([1, 5, 'A']) }));
        check('world switch, variable and self switch reach B', got.world && got.va === 2 && got.ss, JSON.stringify(got));
        check('private switch and variable do not', !got.priv && got.pva !== 1);
        await b.evaluate(() => $gameSwitches.setValue(22, false));
        await sleep(400);
        check('B turns it back off, A follows', await a.evaluate(() => $gameSwitches.value(22)) === false);
        const fa = await a.evaluate(() => Coop.world.fingerprint()), fb = await b.evaluate(() => Coop.world.fingerprint());
        check('shared state identical on both machines', fa === fb, fa.length + ' vs ' + fb.length);

        console.log('screenshots', await shot(a, 'two-a'), await shot(b, 'two-b'));
        for (const p of [a, b]) {
            const errs = p.errors.filter((e) => !/physical_attack_animation/.test(e));
            check(p.label + ' has no script errors', errs.length === 0, errs.slice(0, 3).join(' || ').slice(0, 500));
        }
    } catch (e) {
        console.error(e);
        checks.push(false);
    } finally {
        await browser.close();
        server.kill();
    }
    const failed = checks.filter((c) => !c).length;
    console.log(failed ? `${failed} FAILED` : `all ${checks.length} passed`);
    process.exit(failed ? 1 : 0);
})();
