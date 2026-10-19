// Two copies of the same game release whose data files differ (a mod, a
// changed install, a Steam Deck copy that hashes differently): they still
// play together. The joiner is told once, and shares by the host's census.
// A different release of the game is still turned away.
const fs = require('fs');
const path = require('path');
const { startServer, launch, openPlayer, waitFor, sleep, OUT, ROOT } = require('./lib');
const { checker } = require('./common');
const install = require('./helpers');
const { findGame } = require('../tools/find-game');
const { fingerprint, ensureCensus } = require('../tools/version');

const titleReady = () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected;

// A copy of the game whose data differs: everything linked to the real one
// except data/, where one map carries a changed note (and, for the second
// part, System.json a different release number).
function fakeGame(dir, release) {
    const real = findGame();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, 'www', 'data'), { recursive: true });
    for (const name of fs.readdirSync(real)) {
        if (name === 'data' || name === 'save') continue;
        const from = path.join(real, name), to = path.join(dir, 'www', name);
        if (fs.statSync(from).isDirectory()) fs.symlinkSync(from, to, 'junction'); else fs.copyFileSync(from, to);
    }
    for (const name of fs.readdirSync(path.join(real, 'data'))) fs.copyFileSync(path.join(real, 'data', name), path.join(dir, 'www', 'data', name));
    const map = path.join(dir, 'www', 'data', 'Map001.json');
    const m = JSON.parse(fs.readFileSync(map, 'utf8'));
    m.note = (m.note || '') + ' changed by a mod';
    fs.writeFileSync(map, JSON.stringify(m));
    if (release) {
        const sys = path.join(dir, 'www', 'data', 'System.json');
        const s = JSON.parse(fs.readFileSync(sys, 'utf8'));
        s.versionId = release;
        fs.writeFileSync(sys, JSON.stringify(s));
    }
    return path.join(dir, 'www');
}

(async () => {
    const check = checker();
    const real = findGame();
    let host, joiner, browser, pages = [];
    try {
        const game = fakeGame(path.join(OUT, 'fake-game'));
        check('the altered copy really hashes differently, same release', fingerprint(game).fp !== fingerprint(real).fp && fingerprint(game).build === fingerprint(real).build);
        host = await startServer(8488);
        joiner = await startServer(8588, { FH_JOIN: 'http://localhost:8488/', FH_GAME: game });
        browser = await launch();
        const a = await openPlayer(browser, 'http://localhost:8488/?name=Ann', 'host');
        const b = await openPlayer(browser, 'http://localhost:8588/?name=Bo', 'joiner');
        pages = [a, b];
        for (const p of pages) { await waitFor(p, titleReady, 90000, 'title + connection'); await p.evaluate(install); }
        await waitFor(b, () => Coop.world.census && /host/.test(Coop.log.join('\n')), 10000, 'the host census adopted');
        check('the joiner is let in, told once, and shares by the host\'s census', await b.evaluate(() => Coop.world._toldDiffers === true && !Coop.refused));
        await a.evaluate(() => T.quickStart(1, 27, 67));
        await waitFor(a, () => T.onMap(), 60000, 'host on the map');
        await a.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(a, () => Coop.world.live, 10000, 'host live');
        await b.evaluate(() => T.quickStart(3, 28, 67));
        await waitFor(b, () => T.onMap(), 60000, 'joiner on the map');
        await b.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(b, () => Coop.world.live, 10000, 'joiner live');
        await a.evaluate(() => $gameSwitches.setValue(25, true));
        await waitFor(b, () => $gameSwitches.value(25), 8000, 'the shared switch crosses');
        check('they play in one world: a shared switch crosses', true);
        await browser.close(); browser = null; joiner.kill(); joiner = null;

        // A different release of the game is still kept apart, and says so.
        const other = fakeGame(path.join(OUT, 'fake-game-2'), 99999999);
        joiner = await startServer(8589, { FH_JOIN: 'http://localhost:8488/', FH_GAME: other });
        browser = await launch();
        const c = await openPlayer(browser, 'http://localhost:8589/?name=Cy', 'other release');
        pages = [c];
        await waitFor(c, () => !!(window.Coop && Coop.refused), 60000, 'turned away');
        check('a different release of the game is turned away, with the reason', await c.evaluate(() => /different version/.test(Coop.refused)), await c.evaluate(() => Coop.refused));
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(pages);
    if (browser) await browser.close();
    for (const s of [host, joiner]) if (s) s.kill();
    // The joiners rebuilt the shared census for their altered copies; put back the real one.
    await sleep(500);
    ensureCensus(real, fingerprint(real).fp);
    process.exit(code);
})();
