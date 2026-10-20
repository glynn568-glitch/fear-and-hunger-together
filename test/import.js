// Bringing single-player saves into co-op: a save made playing alone sits in
// the game's own save folder; Together's "Bring mine in" copies it into a free
// slot here (once), and loading it starts a co-op run from that moment.
const fs = require('fs');
const path = require('path');
const { startServer, launch, openPlayer, waitFor, sleep, OUT } = require('./lib');
const { checker } = require('./common');
const install = require('./helpers');
const { findGame } = require('../tools/find-game');

const titleReady = () => window.SceneManager && SceneManager._scene instanceof Scene_Title && !SceneManager.isSceneChanging() && window.Coop && Coop.connected;

// A copy of the game linked to the real one, with a save folder of its own.
function gameWithSaves(dir) {
    const real = findGame();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, 'www', 'save'), { recursive: true });
    for (const name of fs.readdirSync(real)) {
        if (name === 'save') continue;
        const from = path.join(real, name), to = path.join(dir, 'www', name);
        if (fs.statSync(from).isDirectory()) fs.symlinkSync(from, to, 'junction'); else fs.copyFileSync(from, to);
    }
    return path.join(dir, 'www');
}

(async () => {
    const check = checker();
    let server, browser, pages = [];
    try {
        const game = gameWithSaves(path.join(OUT, 'game-with-saves'));
        server = await startServer(8493, { FH_GAME: game });
        browser = await launch();
        const a = await openPlayer(browser, 'http://localhost:8493/?name=Cy', 'player');
        pages = [a];
        await waitFor(a, titleReady, 90000, 'title');
        await a.evaluate(install);

        // Playing alone: the mercenary at the gate with 4 of item 2, saved the game's own way.
        await a.evaluate(() => T.quickStart(1, 27, 66));
        await waitFor(a, () => T.onMap(), 60000, 'on the map');
        await a.evaluate(() => T.settle());
        const made = await a.evaluate(() => {
            $gameParty.gainItem($dataItems[2], 4);
            $gameSwitches._data[79] = true; // past the intro, as any real save is
            $gameSystem.onBeforeSave();
            const contents = DataManager.makeSaveContents();
            delete contents.coop; // a save from the game alone carries nothing of the mod
            const info = DataManager.makeSavefileInfo();
            delete info.coopStamp; delete info.coopRun;
            return { file: LZString.compressToBase64(JsonEx.stringify(contents)), global: LZString.compressToBase64(JSON.stringify([null, null, info])) };
        });
        fs.writeFileSync(path.join(game, 'save', 'file2.rpgsave'), made.file);
        fs.writeFileSync(path.join(game, 'save', 'global.rpgsave'), made.global);
        await a.evaluate(() => SceneManager.goto(Scene_Title));
        await waitFor(a, titleReady, 20000, 'back at the title');
        check('the co-op slots start empty', await a.evaluate(() => !(DataManager.loadGlobalInfo() || []).some(Boolean)));

        // Together, then the button, with real clicks.
        await a.evaluate(() => SceneManager._scene._commandWindow.callHandler('together'));
        await sleep(600);
        await a.click('#coop-together [data-do=import]');
        await waitFor(a, () => /Brought in|No |already/.test(document.querySelector('#coop-together .why').textContent), 15000, 'an answer');
        const said = await a.evaluate(() => document.querySelector('#coop-together .why').textContent);
        check('"Bring mine in" copies the single-player save into a free slot', /^Brought in 1 save\./.test(said), said);
        const slots = await a.evaluate(() => (DataManager.loadGlobalInfo() || []).map((i, n) => (i ? n : 0)).filter(Boolean));
        check('it is listed in a slot of its own', slots.length === 1, JSON.stringify(slots));
        await a.click('#coop-together [data-do=import]');
        await waitFor(a, () => /already/.test(document.querySelector('#coop-together .why').textContent), 15000, 'a second answer');
        check('pressing it again brings nothing twice', await a.evaluate(() => (DataManager.loadGlobalInfo() || []).filter(Boolean).length === 1));
        await a.click('#coop-together [data-do=close]');
        await sleep(300);

        // Loading it starts a co-op run from that moment.
        await a.evaluate((n) => { DataManager.loadGame(n); SceneManager.goto(Scene_Map); $gameSystem.onAfterLoad(); }, slots[0]);
        await waitFor(a, () => SceneManager._scene instanceof Scene_Map && Coop.world.live, 30000, 'in a co-op run');
        const st = await a.evaluate(() => ({ actor: $gameParty.leader().actorId(), items: $gameParty.numItems($dataItems[2]), pos: [$gamePlayer.x, $gamePlayer.y].join(), run: Coop.world.runId }));
        check('loading it carries on in co-op from where that save was', st.actor === 1 && st.items === 4 && st.pos === '27,66' && !!st.run, JSON.stringify(st));
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(pages);
    if (browser) await browser.close();
    if (server) server.kill();
    process.exit(code);
})();
