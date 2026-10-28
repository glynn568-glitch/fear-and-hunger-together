// Step 1 check: does the unmodified game reach its title screen in Chrome?
const { startServer, launch, openPlayer, waitFor, shot, sleep } = require('./lib');

(async () => {
    const port = 8431;
    const server = await startServer(port);
    const browser = await launch();
    let failed = false;
    try {
        const page = await openPlayer(browser, `http://localhost:${port}/`, 'p1');
        // The title, not a fixed wait: six suites at once can take longer than 8 s to get there.
        await waitFor(page, () => window.SceneManager && SceneManager._scene instanceof Scene_Title, 90000, 'title');
        await sleep(3000);
        const state = await page.evaluate(() => ({
            scene: SceneManager._scene && SceneManager._scene.constructor.name,
            stopped: SceneManager._stopped,
            webgl: Graphics.isWebGL(),
            nwjs: Utils.isNwjs(),
            version: Utils.RPGMAKER_VERSION,
            plugins: PluginManager._scripts.length,
            pluginErrors: PluginManager._errorUrls,
            mapId: window.$gameMap ? $gameMap.mapId() : null,
            dataLoaded: DataManager.isDatabaseLoaded(),
        }));
        console.log(JSON.stringify(state, null, 1));
        console.log('screenshot', await shot(page, 'boot'));
        console.log('errors:', page.errors.length);
        for (const e of page.errors.slice(0, 20)) console.log('  ', e.slice(0, 400));
        const bad = page.logs.filter((l) => /^\[(http|requestfailed|warning)/.test(l));
        console.log('failed requests / warnings:', bad.length);
        for (const l of bad.slice(0, 20)) console.log('  ', l.slice(0, 300));
        // The game ships one plugin that fails to parse; it fails the same way on desktop.
        const ours = page.errors.filter((e) => !/physical_attack_animation/.test(e));
        failed = ours.length > 0 || state.stopped || state.scene !== 'Scene_Title';
    } catch (e) {
        console.error(e);
        failed = true;
    } finally {
        await browser.close();
        server.kill();
    }
    console.log(failed ? 'BOOT FAILED' : 'BOOT OK');
    process.exitCode = failed ? 1 : 0; // not exit(): the last line must reach the runner's pipe
})();
