// The lobby carrying a save on, a start called off, and "away": the real title, real keys,
// the load screen and its fade (test/lobby.js has a new run and the late Join).
//   1  carrying a save on: the host chooses it on the load screen, the friend is ready, Start loads both
//   2  the host's page reloads with a start under way: the friend is brought back to the title
//   3  someone idle at the title is away and does not hold Start up
//   4  a friend who has only a save of another run brings that character into a new run (his ruling 11/21)
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const { checker } = require('./common');
const install = require('./helpers');
const { titleReady, menu, hud, hudIs, key, choose, menuIs, watch, playIn, toTitle, who, errorsOf } = require('./lobbylib');

const PORT = 8542;
// The menu, each line matched in turn (a string exactly, a RegExp as a pattern).
const menuLike = (p, want, ms) => waitFor(p, (src) => {
    const w = SceneManager._scene && SceneManager._scene._commandWindow;
    if (!w) return false;
    const lines = w._list.map((c) => c.name + (c.enabled ? '' : '~'));
    const pats = src.map((x) => (x.re ? new RegExp(x.re) : x.s));
    return lines.length === pats.length && lines.every((l, i) => (typeof pats[i] === 'string' ? l === pats[i] : pats[i].test(l)));
}, ms || 15000, 'the menu to read ' + want.join(' / '), want.map((x) => (x instanceof RegExp ? { re: x.source } : { s: x }))).then(() => true, () => false);

(async () => {
    const check = checker();
    let server, joiner, browser, pages = [];
    try {
        server = await startServer(PORT, { FH_MIND: 'none' });
        // The joiner's PC keeps no room of its own: a spec trace (FH_LOBBY_TRACE) is the host's alone.
        joiner = await startServer(PORT + 100, { FH_JOIN: `http://localhost:${PORT}/`, FH_LOBBY_TRACE: null });
        browser = await launch();
        const a = await openPlayer(browser, `http://localhost:${PORT}/?name=Ann`, 'Ann');
        const b = await openPlayer(browser, `http://localhost:${PORT + 100}/?name=Bo`, 'Bo');
        pages = [a, b];
        for (const p of pages) { await waitFor(p, titleReady, 90000, p.label + ' at the title'); await p.evaluate(install); await p.evaluate(watch); }
        const errors = async (label) => { const errs = await errorsOf(pages); check(label + ': no script errors', errs.length === 0, errs.join(' || ').slice(0, 600)); };

        // A night played and saved, without its opening: Ann as Enki founds it, Bo as D'arce is in it,
        // Ann saves and Bo's game saves alongside.
        await a.evaluate(() => T.quickStart(4, 27, 67));
        await waitFor(a, () => T.onMap(), 60000, 'Ann on the map');
        await a.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(a, () => Coop.world.live, 15000, 'Ann in');
        await b.evaluate(() => T.quickStart(3, 27, 66));
        await waitFor(b, () => T.onMap(), 60000, 'Bo on the map');
        await b.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(b, () => Coop.world.live, 15000, 'Bo in');
        await sleep(500);
        await a.evaluate(() => { $gameSystem.onBeforeSave(); DataManager.saveGame(1); });
        const saved = await waitFor(b, () => { const info = DataManager.loadGlobalInfo() || []; return info.some((i) => i && i.coopRun === Coop.world.runId); }, 20000, 'Bo saved alongside').then(() => true, () => false);
        const runId = await a.evaluate(() => Coop.world.runId);
        check('a night played and saved by both', saved && !!runId, JSON.stringify({ saved, runId }));
        await toTitle(b);
        await toTitle(a);

        //--- 1. carrying a save on -------------------------------------------------
        check('the run ended: the host chooses again', await menuIs(a, ['Run: choose...', 'As: -~', 'Start~', 'Together']), JSON.stringify(await menu(a)));
        // A save with no character in it yet, the newest, so the load screen opens on it (11/24 review: only a buzz).
        await a.evaluate(() => {
            const chars = [661, 662, 663, 664], was = chars.map((s) => $gameSwitches._data[s]);
            for (const s of chars) $gameSwitches._data[s] = false;
            $gameSystem.onBeforeSave();
            DataManager.saveGame(5);
            chars.forEach((s, i) => { $gameSwitches._data[s] = was[i]; });
        });
        await choose(a, 'Run: choose...');
        await choose(a, 'Continue');
        await waitFor(a, () => SceneManager._scene instanceof Scene_Load && SceneManager.isCurrentSceneStarted() && !SceneManager.isSceneChanging(), 20000, 'the load screen');
        await sleep(300);
        await key(a, 'Enter');
        const noChar = await a.evaluate(() => ({ load: SceneManager._scene instanceof Scene_Load, slot: SceneManager._scene.savefileId && SceneManager._scene.savefileId(), toast: (document.getElementById('coop-toast') || {}).textContent || '' }));
        check('a save with no character in it says so, and the list stays', noChar.load && noChar.slot === 5 && /no character in it/.test(noChar.toast), JSON.stringify(noChar));
        await a.evaluate(() => { StorageManager.remove(5); SceneManager._scene._listWindow.select(0); });
        await sleep(300);
        await key(a, 'Enter');
        await waitFor(a, titleReady, 20000, 'Ann back at the title').catch(() => {});
        check('choosing a save loads nothing: back at the title, the lines say the save', await menuLike(a, [/^Run: Continue/, 'As: Enki (the save)~', 'Start (waiting on Bo)~', 'Together']) && !(await a.evaluate(() => Coop.world.live)), JSON.stringify(await menu(a)));
        check('the friend is asked who they come in as', await menuIs(b, ['As: choose...', 'Together']), JSON.stringify(await menu(b)));
        await sleep(400);
        check('the corner list says which run, on the host\'s row', /^Ann continuing.*, Enki \| Bo choosing/.test(await hud(b)), await hud(b));
        await choose(b, 'As: choose...');
        await waitFor(b, () => Coop.lobby.mode === 'pick', 5000, 'Bo\'s list').catch(() => {});
        const list = await menu(b);
        check('As: opens the list, the cursor on their own save of this run', /^D'arce, my save, Lv \d+$/.test(list.lines[list.at] || '') && list.lines[2] === 'Enki (Ann)~', JSON.stringify(list));
        await key(b, 'Enter');
        check('chosen', await menuIs(a, ['Run: ' + (await menu(a)).lines[0].slice(5), 'As: Enki (the save)~', 'Start', 'Together']) && await hudIs(a, /Bo D'arce/) && await menuLike(b, [/^As: D'arce, my save, Lv \d+$/, 'Together']), await hud(a));
        await choose(a, 'Start');
        const live = () => SceneManager._scene instanceof Scene_Map && Coop.world.live && !$gamePlayer.isTransferring() && SceneManager._scene.isActive();
        const loadedA = await waitFor(a, live, 40000, 'Ann in').then(() => true, () => false);
        const loadedB = await waitFor(b, live, 40000, 'Bo in').then(() => true, () => false);
        const runs = [await a.evaluate(() => Coop.world.runId), await b.evaluate(() => Coop.world.runId)];
        check('Start loads both saves into the run they were saved in', loadedA && loadedB && runs[0] === runId && runs[1] === runId, JSON.stringify({ loadedA, loadedB, runs, runId }));
        const wa3 = await who(a), wb3 = await who(b);
        check('each is who their save is', wa3.is.join() === '663' && wb3.is.join() === '662', JSON.stringify({ wa3, wb3 }));
        await sleep(1500);
        check('each sees the other in the dungeon again', (await a.evaluate(() => Coop.others().some((p) => p.name === 'Bo' && p.st !== 'title'))) && (await b.evaluate(() => Coop.others().some((p) => p.name === 'Ann' && p.st !== 'title'))));
        await errors('carrying a save on');
        // 11/21: the joiner's PC kept nothing past "joined". Its page's notes (the lobby as it saw it) go in its own log.
        let joinerLog = '';
        try { joinerLog = require('fs').readFileSync(require('path').join(require('path').dirname(joiner.saves), 'server-' + (PORT + 100) + '.log'), 'utf8'); } catch (e) { /* none */ }
        check('the joiner\'s own PC keeps its lobby in its log', /note Bo: lobby: on/.test(joinerLog) && /note Bo: lobby menu: /.test(joinerLog),
            joinerLog.split('\n').filter((l) => / note /.test(l)).slice(0, 8).join(' || '));

        //--- 2. the host's page reloads with a start under way -------------------------
        await toTitle(b);
        await toTitle(a);
        await menuIs(a, ['Run: choose...', 'As: -~', 'Start~', 'Together']);
        await choose(a, 'Run: choose...');
        await choose(a, 'New run');
        await choose(a, 'Cahara');
        await menuIs(b, ['As: choose...', 'Together']);
        await choose(b, 'As: choose...');
        check('a new run: the friend\'s save is of another run, and the line says so', await menuLike(b, ['Cahara (Ann)~', "D'arce", 'Enki', 'Ragnvaldr', /^D'arce, other run, Lv \d+$/, 'Back']), JSON.stringify(await menu(b)));
        await choose(b, 'Ragnvaldr');
        await menuIs(a, ['Run: New', 'As: Cahara', 'Start', 'Together']);
        await choose(a, 'Start');
        await waitFor(b, () => SceneManager._scene instanceof Scene_Map, 20000, 'Bo\'s game to start').catch(() => {});
        await a.reload({ waitUntil: 'domcontentloaded' });
        const back = await waitFor(b, titleReady, 30000, 'Bo back at the title').then(() => true, () => false);
        check('the host\'s page reloads during the start: the friend is brought back to the title', back && !(await b.evaluate(() => Coop.world.live || Coop.lobby.going)));
        await waitFor(a, titleReady, 90000, 'Ann at the title again');
        await a.evaluate(install);
        await a.evaluate(watch);
        check('and the lobby starts over: the host chooses', await menuIs(a, ['Run: choose...', 'As: -~', 'Start~', 'Together']) && await menuIs(b, ['As: (Ann is choosing the run)~', 'Together']), JSON.stringify([await menu(a), await menu(b)]));
        await errors('a start called off');

        //--- 3. away --------------------------------------------------------------------
        await choose(a, 'Run: choose...');
        await choose(a, 'New run');
        await choose(a, 'Cahara');
        await menuIs(b, ['As: choose...', 'Together']);
        check('someone here who has not chosen holds Start up', await menuIs(a, ['Run: New', 'As: Cahara', 'Start (waiting on Bo)~', 'Together']), JSON.stringify(await menu(a)));
        // What Bo's page said and what it took for a key, for the day this check fails (it did once, 11/11).
        await b.evaluate(() => {
            window.__said = [];
            const t0 = Date.now();
            const send = Coop.send;
            Coop.send = function (m) { if (m && m.t === 'lobby') window.__said.push((Date.now() - t0) + ' ' + m.do + ' ' + m.on); return send.apply(this, arguments); };
            for (const type of ['keydown', 'mousedown', 'touchstart']) document.addEventListener(type, (e) => window.__said.push((Date.now() - t0) + ' ' + type + ' ' + (e.code || '')), true);
            Coop.lobby.awayAfter = 1500;
        });
        const awayOk = await menuIs(a, ['Run: New', 'As: Cahara', 'Start', 'Together'], 10000) && await hudIs(a, /Bo away/);
        check('idle at the title: away, and Start no longer waits for them', awayOk, (await hud(a)) + ' || Bo: ' + JSON.stringify(await b.evaluate(() => ({
            said: window.__said, latest: Input._latestButton, held: Object.keys(Input._currentState).filter((k) => Input._currentState[k]), pads: Array.from(navigator.getGamepads ? navigator.getGamepads() : []).filter(Boolean).length,
            row: Coop.lobby.rows[Coop.id], on: Coop.lobby.on, host: Coop.lobby.host, id: Coop.id,
        }))) + ' || Ann: ' + JSON.stringify(await a.evaluate(() => ({ rows: Coop.lobby.rows, others: Coop.others().map((p) => [p.id, p.name, p.st, p.up]) }))));
        await b.evaluate(() => { Coop.lobby.awayAfter = 300000; });
        await key(b, 'ArrowDown');
        check('a key: here again, and waited for', await menuIs(a, ['Run: New', 'As: Cahara', 'Start (waiting on Bo)~', 'Together'], 10000) && await hudIs(a, /Bo choosing/), await hud(a));
        await errors('away');

        //--- 4. a save of another run, brought into this one --------------------------
        // 11/21 live: pho's friend had only saves of other runs, and nothing on screen offered them. His ruling: the
        // host's run takes priority and nobody's save is blocked; the character comes in as saved, the world is the host's.
        const saved4 = await b.evaluate(() => {
            const info = DataManager.loadGlobalInfo() || [];
            const slot = info.findIndex((i, n) => n > 0 && i && i.coopRun);
            const c = JsonEx.parse(StorageManager.load(slot));
            const lead = c.actors._data[c.party._actors[0]];
            return { slot, runId: c.coop.runId, level: lead._level, items: Object.keys(c.party._items).length };
        });
        // A save made while dead (the alongside save keeps you as you are) is no character to bring: here as Ragnvaldr.
        await b.evaluate((slot) => {
            const c = JsonEx.parse(StorageManager.load(slot));
            c.switches._data[662] = false;
            c.switches._data[664] = true;
            c.coop.dead = true;
            StorageManager.save(5, JsonEx.stringify(c));
            const info = DataManager.loadGlobalInfo() || [];
            info[5] = Object.assign({}, info[slot], { timestamp: Date.now() });
            DataManager.saveGlobalInfo(info);
        }, saved4.slot);
        await choose(b, 'As: choose...');
        await sleep(300);
        const list4 = (await menu(b)).lines;
        check('a save made dead is not offered', list4.some((l) => /^D'arce, other run/.test(l)) && !list4.some((l) => /^Ragnvaldr, /.test(l)), JSON.stringify(list4));
        await choose(b, list4.find((l) => /^D'arce, other run/.test(l)));
        check('a save of another run asks first, and says what it means', await menuLike(b, [/^Bring D'arce \(Lv \d+\) into this run$/, 'Back'])
            && await b.evaluate(() => /progress stays behind/.test(document.body.innerText)), JSON.stringify(await menu(b)));
        await choose(b, (await menu(b)).lines[0]);
        check('brought: the line says so, and the host can start', await menuLike(b, [/^As: D'arce, other run, Lv \d+$/, 'Together']) && await menuIs(a, ['Run: New', 'As: Cahara', 'Start', 'Together']) && await hudIs(a, /Bo D'arce/), JSON.stringify(await menu(b)));
        await choose(a, 'Start');
        const ann4 = (await playIn([a], 300000))[0];
        const bo4 = await waitFor(b, () => SceneManager._scene instanceof Scene_Map && Coop.world.live && !$gamePlayer.isTransferring(), 60000, 'Bo in').then(() => true, () => false);
        const runA = await a.evaluate(() => Coop.world.runId);
        const wb4 = await who(b);
        check('the host starts a new run, and the friend comes in as the save of the other run', ann4 && bo4 && runA && runA !== saved4.runId
            && (await b.evaluate(() => Coop.world.runId)) === runA && wb4.is.join() === '662', JSON.stringify({ ann4, bo4, runA, saved4, wb4 }));
        const kept4 = await b.evaluate(() => ({ level: $gameParty.leader().level, items: Object.keys($gameParty._items).length }));
        check('as saved: the same level and the same things', kept4.level === saved4.level && kept4.items === saved4.items, JSON.stringify({ kept4, saved4 }));
        const beside = await waitFor(b, () => { const ann = Coop.others().find((p) => p.name === 'Ann'); return !!ann && ann.m === $gameMap.mapId() && !$gamePlayer.isTransferring(); }, 20000, 'Bo beside Ann').then(() => true, () => false);
        check('set down beside the host, not where the other run left them', beside, JSON.stringify(await b.evaluate(() => ({ m: $gameMap.mapId(), others: Coop.others().map((p) => [p.name, p.m]) }))));
        check('the other run\'s save is still there, untouched', await b.evaluate((slot, runId) => { const i = (DataManager.loadGlobalInfo() || [])[slot]; return !!i && i.coopRun === runId; }, saved4.slot, saved4.runId), JSON.stringify(saved4));
        await errors('a save of another run');
    } catch (e) {
        console.error(e);
        check('test ran to the end', false);
    }
    const code = check.finish(pages);
    if (browser) await browser.close();
    for (const s of [server, joiner]) if (s) s.kill();
    process.exit(code);
})();
