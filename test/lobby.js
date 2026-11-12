// The lobby as two people meet it: the real title screen, its menu worked with real keys,
// the corner list read off the page, and the games it starts played from their first frame
// (the opening with its character picker). room.js's rules are test/lobbyroom.js; this is
// the page (client/lobby.js) and the whole way in. test/lobbysave.js carries a save on.
//   1  a new run: characters picked in the lobby, Start, both through the opening as picked
//   2  back at the title with the run under way: Join
// Always as friends really meet: Bo through a server of his own. Two pages on the host's PC
// are both "the host" to the room.
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const { checker } = require('./common');
const install = require('./helpers');
const { titleReady, menu, hud, dimRows, key, choose, menuIs, watch, playIn, toTitle, who, errorsOf } = require('./lobbylib');

const PORT = 8541;

(async () => {
    const check = checker();
    let server, joiner, browser, pages = [];
    try {
        server = await startServer(PORT, { FH_MIND: 'none' });
        joiner = await startServer(PORT + 100, { FH_JOIN: `http://localhost:${PORT}/` });
        browser = await launch();
        const a = await openPlayer(browser, `http://localhost:${PORT}/?name=Ann`, 'Ann');
        await waitFor(a, titleReady, 90000, 'Ann at the title');
        await a.evaluate(install);
        await a.evaluate(watch);
        await sleep(600);
        check('alone at the title: the game\'s own menu', (await menu(a)).lines.join('|') === 'New Game|Continue~|Together', JSON.stringify(await menu(a)));
        const b = await openPlayer(browser, `http://localhost:${PORT + 100}/?name=Bo`, 'Bo');
        pages = [a, b];
        await waitFor(b, titleReady, 90000, 'Bo at the title');
        await b.evaluate(install);
        await b.evaluate(watch);
        const errors = async (label) => { const errs = await errorsOf(pages); check(label + ': no script errors', errs.length === 0, errs.join(' || ').slice(0, 600)); };

        //--- 1. a new run ------------------------------------------------------
        check('two at the title: the host chooses the run', await menuIs(a, ['New run', 'Continue~', 'Together']), JSON.stringify(await menu(a)));
        check('and the friend has nothing to choose yet', await menuIs(b, ['Together']), JSON.stringify(await menu(b)));
        await choose(a, 'New run');
        check('New run asks who the host plays', await menuIs(a, ['Cahara', "D'arce", 'Enki', 'Ragnvaldr', 'Back']), JSON.stringify(await menu(a)));
        await choose(a, 'Enki');
        check('the host\'s menu is now Start, and not yet', await menuIs(a, ['Start~', 'Change run', 'Together']), JSON.stringify(await menu(a)));
        check('the friend may pick, and is not ready without a character', await menuIs(b, ['Ready~', 'Come in as...', 'Together']), JSON.stringify(await menu(b)));
        await sleep(400);
        check('the corner list says the run and who is who', /New run \| Ann Enki \| Bo not ready/.test(await hud(b)), await hud(b));
        await key(b, 'Enter'); // Ready, greyed: nothing
        await key(a, 'Enter'); // Start, greyed: nothing
        await sleep(300);
        check('greyed lines do nothing', (await a.evaluate(() => !Coop.lobby.going && !Coop.lobby.line.length)) && (await b.evaluate(() => !(Coop.lobby.rows[Coop.id] || {}).ready)));
        await choose(b, 'Come in as...');
        check('the host\'s character is greyed for the friend', await menuIs(b, ['Cahara', "D'arce", 'Enki~', 'Ragnvaldr', 'Back']), JSON.stringify(await menu(b)));
        await choose(b, "D'arce");
        check('picked: Ready is offered, with the cursor on it', await menuIs(b, ['Ready', 'Come in as...', 'Together']) && (await menu(b)).at === 0, JSON.stringify(await menu(b)));
        await sleep(300);
        check('picked, not ready: their row is dim', (await dimRows(a)).some((r) => /Bo D'arce/.test(r)), JSON.stringify(await dimRows(a)));
        await choose(b, 'Ready');
        check('ready: the line turns to Not ready, and picking is closed', await menuIs(b, ['Not ready', 'Come in as...~', 'Together']), JSON.stringify(await menu(b)));
        check('everyone ready: Start', await menuIs(a, ['Start', 'Change run', 'Together']), JSON.stringify(await menu(a)));
        check('ready: their row is lit', !(await dimRows(a)).some((r) => /Bo/.test(r)) && /Bo D'arce/.test(await hud(a)), await hud(a));
        await choose(a, 'Start');
        for (const p of [a, b]) await waitFor(p, () => SceneManager._scene instanceof Scene_Map, 20000, p.label + '\'s game to start').catch(() => {});
        check('Start starts both games at once', await a.evaluate(() => SceneManager._scene instanceof Scene_Map) && await b.evaluate(() => SceneManager._scene instanceof Scene_Map));
        const inAB = await playIn([a, b], 300000);
        check('both come through the opening into one run', inAB[0] && inAB[1] && (await a.evaluate(() => Coop.world.runId)) === (await b.evaluate(() => Coop.world.runId)), JSON.stringify(inAB));
        const wa = await who(a), wb = await who(b);
        check('each is the character picked in the lobby, and the picker showed that one', wa.is.join() === '663' && wa.shown === 3 && wb.is.join() === '662' && wb.shown === 2, JSON.stringify({ wa, wb }));
        check('the host\'s game founded the run', wa.founded && !wb.founded, JSON.stringify({ wa, wb }));
        await sleep(1500);
        check('each sees the other in the dungeon', (await a.evaluate(() => Coop.others().some((p) => p.name === 'Bo' && p.st !== 'title'))) && (await b.evaluate(() => Coop.others().some((p) => p.name === 'Ann' && p.st !== 'title'))));
        await errors('a new run');

        //--- 2. the run under way: Join ------------------------------------------
        for (const p of [a, b]) await p.evaluate(() => T.settle());
        await toTitle(b);
        check('at the title with the run under way: Join', await menuIs(b, ['Join', 'Come in as...', 'Together']), JSON.stringify(await menu(b)));
        await sleep(600);
        check('the corner list says it is under way, who is in and who is not', /^Under way.* \| Ann in \| Bo not in/.test(await hud(b)), await hud(b));
        await b.evaluate(() => { window.__shown = 0; });
        await choose(b, 'Join');
        // The line drops while the opening plays (Grok g14): the page comes back to its call.
        await waitFor(b, () => SceneManager._scene instanceof Scene_Map && Coop.lobby.going, 30000, 'Bo in the opening');
        const idWas = await b.evaluate(() => { const id = Coop.id; Coop._ws.close(); return id; });
        await waitFor(b, (was) => Coop.connected && Coop.id !== was && Coop.lobby.line.indexOf(Coop.id) >= 0, 15000, 'Bo back on the line, still called', idWas).catch(() => {});
        const idNow = await b.evaluate(() => Coop.id);
        check('a line that drops in the opening comes back to its call', idNow !== idWas && await a.evaluate((id) => Coop.lobby.line.indexOf(id) >= 0, idNow) && await b.evaluate(() => Coop.lobby.going && !Coop.world.live), JSON.stringify({ idWas, idNow, line: await a.evaluate(() => Coop.lobby.line) }));
        const inB = await playIn([b], 300000);
        const wb2 = await who(b);
        check('Join brings them in, as the character they picked', inB[0] && wb2.is.join() === '662' && wb2.shown === 2 && (await a.evaluate(() => Coop.world.runId)) === (await b.evaluate(() => Coop.world.runId)), JSON.stringify(wb2));
        await errors('a late join');
    } catch (e) {
        console.error(e);
        check('test ran to the end', false);
    }
    const code = check.finish(pages);
    if (browser) await browser.close();
    for (const s of [server, joiner]) if (s) s.kill();
    process.exit(code);
})();
