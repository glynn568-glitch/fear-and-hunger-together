// Carrying a run on without its host: night one Ann hosts and Bo joins from
// his own PC; they sleep in a bed. Night two Bo hosts and Ann joins him; both
// Continue onto that bed, each with their own save, in the same world.
const fs = require('fs');
const path = require('path');
const { startServer, launch, openPlayer, waitFor, sleep, OUT } = require('./lib');
const { checker } = require('./common');
const install = require('./helpers');

const titleReady = () => window.SceneManager && SceneManager._scene instanceof Scene_Title && !SceneManager.isSceneChanging() && window.Coop && Coop.connected;
const onMapLive = () => SceneManager._scene instanceof Scene_Map && SceneManager._scene.isActive() && Coop.world.live;
const load = (page, slot) => page.evaluate((n) => { DataManager.loadGame(n); SceneManager.goto(Scene_Map); $gameSystem.onAfterLoad(); }, slot);
const save = (page, slot) => page.evaluate((n) => { $gameSystem.onBeforeSave(); DataManager.saveGame(n); }, slot);
const BO = 'bo rae'; // the save folder of a name with a space in it
const SWITCH = 25; // bookshelf1: shared, and never set by the gate map itself

async function night(hostPort, hostSaves, joinSaves) {
    const host = await startServer(hostPort, { FH_SAVES: hostSaves });
    const joiner = await startServer(hostPort + 100, { FH_SAVES: joinSaves, FH_JOIN: `http://localhost:${hostPort}/` });
    const browser = await launch();
    return { host, joiner, browser, close: async () => { await browser.close(); host.kill(); joiner.kill(); await sleep(500); } };
}

(async () => {
    const check = checker();
    const SA = path.join(OUT, 'carry-ann'), SB = path.join(OUT, 'carry-bo');
    for (const d of [SA, SB]) fs.rmSync(d, { recursive: true, force: true });
    let n;
    let pages = [];
    try {
        //--- night one: Ann hosts, Bo joins ------------------------------------
        n = await night(8482, SA, SB);
        let a = await openPlayer(n.browser, 'http://localhost:8482/?name=Ann', 'Ann1');
        let b = await openPlayer(n.browser, 'http://localhost:8582/?name=Bo%20Rae', 'Bo1');
        pages = [a, b];
        for (const p of [a, b]) { await waitFor(p, titleReady, 90000, 'title'); await p.evaluate(install); }
        await a.evaluate(() => T.quickStart(1, 27, 67));
        await waitFor(a, () => T.onMap(), 60000, 'Ann on the map');
        await a.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(a, () => Coop.world.live, 10000, 'Ann live');
        await b.evaluate(() => T.quickStart(3, 28, 67));
        await waitFor(b, () => T.onMap(), 60000, 'Bo on the map');
        await b.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(b, () => Coop.world.live, 10000, 'Bo live');
        await a.evaluate((s) => $gameSwitches.setValue(s, true), SWITCH);
        await waitFor(b, (s) => $gameSwitches.value(s), 8000, 'Bo sees the shelf moved', SWITCH);
        await b.evaluate(() => $gameParty.gainItem($dataItems[2], 3));
        await save(a, 1);
        await waitFor(b, () => StorageManager.exists(1), 8000, 'Bo saved alongside');
        await sleep(800);
        const stamp = await a.evaluate(() => DataManager.loadGlobalInfo()[1].coopStamp);
        const run = await a.evaluate(() => Coop.world.runId);
        const keptWorld = path.join(SB, 'runs', String(run), `world@${stamp}.json`);
        check("Bo's PC keeps the run's world as it was at the bed", fs.existsSync(keptWorld), keptWorld);
        check("Bo's save is on Bo's own PC, not the host's (a name with a space too)", fs.existsSync(path.join(SB, 'players', BO, 'file1.rpgsave')) && fs.existsSync(path.join(SB, 'players', BO, 'global.rpgsave')) && !fs.existsSync(path.join(SA, 'players', BO)));
        check("the host's copy of the world is the same", fs.existsSync(path.join(SA, 'runs', String(run), `world@${stamp}.json`)) && fs.readFileSync(keptWorld, 'utf8') === fs.readFileSync(path.join(SA, 'runs', String(run), `world@${stamp}.json`), 'utf8'));
        check('the copy never reaches the page', !(await b.evaluate(() => Coop.log.some((l) => /worldcopy/.test(l)))));
        // A save made before 0.1.3 sits on the host: Bo still finds it, and it comes home to his PC.
        fs.mkdirSync(path.join(SA, 'players', BO), { recursive: true });
        for (const name of ['file1.rpgsave', 'global.rpgsave']) fs.renameSync(path.join(SB, 'players', BO, name), path.join(SA, 'players', BO, name));
        await b.goto('http://localhost:8582/?name=Bo%20Rae', { waitUntil: 'domcontentloaded' });
        await waitFor(b, titleReady, 90000, 'Bo back at the title');
        const old = await b.evaluate(() => { const info = DataManager.loadGlobalInfo(); const ok = StorageManager.exists(1) && !!StorageManager.load(1); return { ok, stamp: info && info[1] && info[1].coopStamp }; });
        check("a save left on the host by an older version is found, and copied to Bo's PC", old.ok && old.stamp === stamp && fs.existsSync(path.join(SB, 'players', BO, 'file1.rpgsave')) && fs.existsSync(path.join(SB, 'players', BO, 'global.rpgsave')), JSON.stringify(old));
        for (const p of pages) check(p.label + ' has no script errors', !p.errors.some((e) => !/physical_attack_animation|VideoFrame was garbage collected/.test(e)), p.errors.slice(0, 2).join(' || ').slice(0, 400));
        await n.close();

        //--- night two: Bo hosts, Ann joins him --------------------------------
        n = await night(8483, SB, SA);
        b = await openPlayer(n.browser, 'http://localhost:8483/?name=Bo%20Rae', 'Bo2');
        a = await openPlayer(n.browser, 'http://localhost:8583/?name=Ann', 'Ann2');
        pages = [a, b];
        for (const p of [a, b]) { await waitFor(p, titleReady, 90000, 'title'); await p.evaluate(install); }
        check("Ann, joining, still sees her save from Ann's own PC", await a.evaluate(() => StorageManager.exists(1) && DataManager.loadGlobalInfo()[1] && DataManager.loadGlobalInfo()[1].coopStamp), String(stamp));
        await load(b, 1);
        await waitFor(b, onMapLive, 30000, 'Bo carries on from the bed');
        check('Bo, now hosting, carries on in the world as it was at the bed', await b.evaluate((s) => $gameSwitches.value(s) && $gameParty.numItems($dataItems[2]) === 3, SWITCH));
        await load(a, 1);
        await waitFor(a, onMapLive, 30000, 'Ann carries on from the bed');
        await waitFor(a, () => Coop.peersHere().length === 1, 10000, 'Ann sees Bo');
        check('Ann joins him on her own save from that night, in the same world', await a.evaluate((s) => $gameSwitches.value(s) && $gameParty.leader().actorId() === 1, SWITCH));

        // Another bed, Bo hosting: Ann's save stays on her PC.
        await save(b, 2);
        await waitFor(a, () => StorageManager.exists(2), 8000, 'Ann saved alongside');
        await sleep(800);
        check("Ann's new save is on her own PC only", fs.existsSync(path.join(SA, 'players', 'ann', 'file2.rpgsave')) && !fs.existsSync(path.join(SB, 'players', 'ann')));
        const stamp2 = await b.evaluate(() => DataManager.loadGlobalInfo()[2].coopStamp);
        check("and Ann's PC keeps that night's world, ready for her to host", fs.existsSync(path.join(SA, 'runs', String(run), `world@${stamp2}.json`)));
        for (const p of pages) check(p.label + ' has no script errors', !p.errors.some((e) => !/physical_attack_animation|VideoFrame was garbage collected/.test(e)), p.errors.slice(0, 2).join(' || ').slice(0, 400));
        await n.close();

        //--- night three: Ann hosts, but her PC has no copy of that bed's world --
        // (a bed from before 0.1.3, say). Her save still carries the run on, and
        // Bo's save of the same bed still fits it.
        fs.rmSync(path.join(SA, 'runs', String(run), `world@${stamp2}.json`));
        n = await night(8485, SA, SB);
        a = await openPlayer(n.browser, 'http://localhost:8485/?name=Ann', 'Ann3');
        b = await openPlayer(n.browser, 'http://localhost:8585/?name=Bo%20Rae', 'Bo3');
        pages = [a, b];
        for (const p of [a, b]) await waitFor(p, titleReady, 90000, 'title');
        await load(a, 2);
        await waitFor(a, onMapLive, 30000, 'Ann carries on from the second bed');
        check('without the world copy, the run is still the same run, as her save had it', await a.evaluate((r, s) => Coop.world.runId === r && $gameSwitches.value(s), run, SWITCH));
        await load(b, 2);
        await waitFor(b, onMapLive, 30000, 'Bo carries on from the second bed');
        check("and Bo's save of that bed joins it", await b.evaluate((r) => Coop.world.runId === r && Coop.peersHere().length === 1, run));
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(pages);
    if (n) await n.close();
    process.exit(code);
})();
