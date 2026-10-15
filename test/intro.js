// Plays the game's real opening from "New Game" by mashing the confirm key,
// to prove the unmodified intro and character creation run in a browser and
// end with the player live in the shared world.
const { startServer, launch, openPlayer, waitFor, shot, sleep } = require('./lib');

(async () => {
    const server = await startServer(8438);
    const browser = await launch();
    let ok = false;
    try {
        const a = await openPlayer(browser, 'http://localhost:8438/?name=Ann', 'A');
        await waitFor(a, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 90000, 'title');
        await sleep(1500);
        let last = '';
        const started = Date.now();
        for (let i = 0; Date.now() - started < 240000; i++) {
            if (await a.evaluate(() => SceneManager._scene instanceof Scene_Name)) {
                // The name screen: put the cursor on its OK button first.
                await a.evaluate(() => { const w = SceneManager._scene._inputWindow; if (w) w.select(89); });
            }
            await a.keyboard.down('Enter'); await sleep(90); await a.keyboard.up('Enter'); await sleep(160);
            if (i % 4 === 0) {
                const st = await a.evaluate(() => JSON.stringify({
                    scene: SceneManager._scene && SceneManager._scene.constructor.name,
                    map: window.$gameMap ? $gameMap.mapId() : 0,
                    start: window.$gameSwitches ? $gameSwitches.value(79) : false,
                    live: Coop.world.live,
                    who: window.$gameParty && $gameParty.leader() ? $gameParty.leader().name() : '',
                    msg: window.$gameMessage ? $gameMessage._texts.join(' ').slice(0, 50) : '',
                    stopped: SceneManager._stopped,
                }));
                if (st !== last) { console.log(Math.round((Date.now() - started) / 1000) + 's', st); last = st; }
                const o = JSON.parse(st);
                if (o.stopped) break;
                if (o.live && o.scene === 'Scene_Map') { ok = true; break; }
            }
            if (i % 60 === 30) await shot(a, 'intro-' + Math.floor(i / 60));
        }
        console.log('screenshot', await shot(a, 'intro-end'));
        const errs = a.errors.filter((e) => !/physical_attack_animation/.test(e));
        console.log('errors', errs.length, errs.slice(0, 4).join(' || ').slice(0, 800));
        const bad = a.logs.filter((l) => /^\[(http|requestfailed)/.test(l));
        console.log('failed requests', bad.length, bad.slice(0, 6).join(' | ').slice(0, 600));
        console.log('coop log:', await a.evaluate(() => Coop.log.join(' | ')));
        ok = ok && errs.length === 0;
    } catch (e) { console.error(e); }
    await browser.close();
    server.kill();
    console.log(ok ? 'INTRO OK' : 'INTRO FAILED');
    process.exit(ok ? 0 : 1);
})();
