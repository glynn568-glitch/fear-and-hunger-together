// 11/21 live, item 3: pho played his own run as Cahara on his own PC, went back to the title, joined Enki's game with a
// link, and Enki continued a save of another run. pho could come in only as D'arce: Cahara was greyed, and Enki's Start
// waited until he took D'arce. Here: the same moves, real title, real keys, the link switched from the title as the
// Together panel does it.
//   Cahara stays his to come in as, new or as his save from his own run (his ruling 11/21: no save is blocked).
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const { checker } = require('./common');
const install = require('./helpers');
const { titleReady, menu, hud, hudIs, key, choose, menuIs, watch, toTitle, who, errorsOf } = require('./lobbylib');

const ENKI = 8560, PHO = 8660;

(async () => {
    const check = checker();
    let host, own, browser, pages = [];
    try {
        host = await startServer(ENKI, { FH_MIND: 'none' });
        own = await startServer(PHO, { FH_MIND: 'none' });
        browser = await launch();
        const e = await openPlayer(browser, `http://localhost:${ENKI}/?name=Enki`, 'Enki');
        const p = await openPlayer(browser, `http://localhost:${PHO}/?name=pho`, 'pho');
        pages = [e, p];
        for (const x of pages) { await waitFor(x, titleReady, 90000, x.label + ' at the title'); await x.evaluate(install); await x.evaluate(watch); }
        const errors = async (label) => { const errs = await errorsOf(pages); check(label + ': no script errors', errs.length === 0, errs.join(' || ').slice(0, 600)); };

        // Each plays a run of their own, alone on their own server, and saves it.
        const alone = async (x, actor) => {
            await x.evaluate((id) => T.quickStart(id, 27, 67), actor);
            await waitFor(x, () => T.onMap(), 60000, x.label + ' on the map');
            await x.evaluate(() => { T.settle(); T.begin(); });
            await waitFor(x, () => Coop.world.live, 15000, x.label + ' in');
            await x.evaluate(() => { $gameSystem.onBeforeSave(); DataManager.saveGame(1); });
            const run = await x.evaluate(() => Coop.world.runId);
            await toTitle(x);
            return run;
        };
        const runE = await alone(e, 4); // Enki
        const runP = await alone(p, 1); // Cahara
        check('two runs of their own, saved', !!runE && !!runP && runE !== runP, JSON.stringify({ runE, runP }));

        // pho joins Enki's game from the title, as the Together panel's Join does.
        const joined = await p.evaluate((link) => fetch('coop/app/join', { method: 'POST', headers: { 'x-fh-app': '1' }, body: JSON.stringify({ link, fromTitle: true }) })
            .then((r) => r.json()).then((j) => j.error || 'ok'), `http://localhost:${ENKI}/`);
        check('pho switches to Enki\'s link at the title', joined === 'ok', joined);
        await waitFor(p, () => Coop.connected && Coop.lobby.on && Coop.others().some((o) => o.name === 'Enki'), 30000, 'pho in Enki\'s lobby').catch(() => {});
        await waitFor(p, titleReady, 30000, 'pho at the title').catch(() => {});

        // Enki continues his save; pho chooses.
        await menuIs(e, ['Run: choose...', 'As: -~', 'Start~', 'Together']);
        await choose(e, 'Run: choose...');
        await choose(e, 'Continue');
        await waitFor(e, () => SceneManager._scene instanceof Scene_Load && SceneManager.isCurrentSceneStarted() && !SceneManager.isSceneChanging(), 20000, 'the load screen');
        await sleep(300);
        await key(e, 'Enter');
        await waitFor(e, titleReady, 20000, 'Enki back at the title').catch(() => {});
        await menuIs(p, ['As: choose...', 'Together']);
        await choose(p, 'As: choose...');
        await waitFor(p, () => Coop.lobby.mode === 'pick', 5000, 'pho\'s list').catch(() => {});
        await sleep(300);
        const list = await menu(p);
        const lines = list.lines.join('|');
        check('Cahara is his: free new, and his own run\'s save offered', /^Cahara\|D'arce\|Enki \(Enki\)~\|Ragnvaldr\|Cahara, other run, Lv \d+\|Back$/.test(lines),
            lines + ' || ' + JSON.stringify(await p.evaluate(() => ({ rows: Coop.lobby.rows, held: Coop.lobby.held, others: Coop.others().map((o) => [o.id, o.name, o.st, o.ini]) }))));
        await choose(p, list.lines.find((l) => /^Cahara, other run/.test(l)) || 'Back');
        await choose(p, ((await menu(p)).lines[0]) || 'Back');
        check('brought: Enki can start', await menuIs(e, [(await menu(e)).lines[0], 'As: Enki (the save)~', 'Start', 'Together']) && await hudIs(e, /pho Cahara/), JSON.stringify(await menu(e)) + ' ' + await hud(e));
        await choose(e, 'Start');
        const live = () => SceneManager._scene instanceof Scene_Map && Coop.world.live && !$gamePlayer.isTransferring() && SceneManager._scene.isActive();
        const inE = await waitFor(e, live, 40000, 'Enki in').then(() => true, () => false);
        const inP = await waitFor(p, live, 40000, 'pho in').then(() => true, () => false);
        const wp = await who(p), we = await who(e);
        check('both in Enki\'s run: Enki as his save, pho as his Cahara', inE && inP && we.is.join() === '663' && wp.is.join() === '661'
            && (await p.evaluate(() => Coop.world.runId)) === runE && (await e.evaluate(() => Coop.world.runId)) === runE, JSON.stringify({ inE, inP, we, wp, runE }));
        // Both logs have the lobby as each PC saw it (item 1): pho's server is a joiner now.
        await sleep(2500);
        let log = '';
        try { log = require('fs').readFileSync(require('path').join(require('path').dirname(own.saves), 'server-' + PHO + '.log'), 'utf8'); } catch (err) { /* none */ }
        check('pho\'s own PC kept the lobby after the switch', /joined http/.test(log) && /note pho: lobby menu: .*Cahara, other run/.test(log), log.split('\n').filter((l) => / note pho/.test(l)).slice(-6).join(' || '));
        await errors('a switched link');
    } catch (err) {
        console.error(err);
        check('test ran to the end', false);
    }
    const code = check.finish(pages);
    if (browser) await browser.close();
    for (const s of [host, own]) if (s) s.kill();
    process.exit(code);
})();
