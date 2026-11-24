// The lobby as two people meet it: the real title screen, its menu worked with real keys,
// the corner list read off the page, and the games it starts played from their first frame
// (the opening with its character picker). room.js's rules are test/lobbyroom.js; this is
// the page (client/lobby.js) and the whole way in. test/lobbysave.js carries a save on.
//   1  a new run: characters picked in the lobby, Start, both through the opening as picked
//   2  back at the title with the run under way: Join
// Always as friends really meet: Bo through a server of his own. Two pages on the host's PC
// are both "the host" to the room.
const { startServer, launch, openPlayer, goOnline, waitFor, sleep } = require('./lib');
const { checker } = require('./common');
const install = require('./helpers');
const { titleReady, menu, hud, hudIs, dimRows, key, choose, menuIs, watch, playIn, toTitle, who, errorsOf } = require('./lobbylib');

const PORT = 8541;

// FH_TEST_TUNNEL=1 (the internet gate): one new run and one Join, the friend coming in
// through a real tunnel the way test/humans.js does. The long localhost suite below stays
// the default, so a flaky tunnel does not take the everyday lobby run with it.
async function tunnelRun(check) {
    let server, joiner, browser, pages = [];
    try {
        server = await startServer(PORT, { FH_MIND: 'none' });
        const app = await goOnline(PORT);
        check('the host is online through a tunnel', /^https:\/\/.+trycloudflare\.com\/\?k=/.test(app.link || ''), JSON.stringify(app).slice(0, 200));
        check('and its link works once it is handed out', !!app.ready, JSON.stringify(app).slice(0, 200));
        const link = app.link;
        joiner = await startServer(PORT + 100, { FH_LOBBY_TRACE: null, FH_MIND: 'none' });
        browser = await launch();
        const a = await openPlayer(browser, `http://localhost:${PORT}/?name=Ann`, 'Ann');
        const b = await openPlayer(browser, `http://localhost:${PORT + 100}/?name=Bo`, 'Bo');
        pages = [a, b];
        for (const p of pages) {
            await waitFor(p, titleReady, 120000, p.label + ' at the title');
            await p.evaluate(install);
            await p.evaluate(watch);
        }
        check('both came in under their names', await a.evaluate(() => Coop.name) === 'Ann' && await b.evaluate(() => Coop.name) === 'Bo');
        await choose(a, 'Together');
        await waitFor(a, () => /trycloudflare\.com\/\?k=/.test((document.querySelector('[data-field=link]') || {}).value || ''), 15000, 'the link in Together');
        const shown = await a.evaluate(() => document.querySelector('[data-field=link]').value);
        check('Together shows the tunnel link', shown === link, shown);
        await a.evaluate(() => Coop.together.close());
        await choose(b, 'Together');
        await b.evaluate((l) => { document.querySelector('[data-field=join]').value = l; }, link);
        await b.click('#coop-together [data-do=join]');
        await waitFor(b, () => /Joined/.test(document.querySelector('#coop-together .why').textContent), 20000, 'Bo joined');
        await waitFor(b, () => Coop.connected && Array.from(Coop.peers.values()).some((p) => p.name === 'Ann'), 20000, 'Bo sees Ann');
        await b.evaluate(() => Coop.together.close());
        await sleep(500);
        await waitFor(b, () => Coop.lobby.on, 15000, 'Bo in the lobby').catch(() => {});
        check('two at the title over the tunnel: the host chooses the run', await menuIs(a, ['Run: choose...', 'As: -~', 'Start~', 'Together']), JSON.stringify(await menu(a)));
        await choose(a, 'Run: choose...');
        await choose(a, 'New run');
        await choose(a, 'Enki');
        await choose(b, 'As: choose...');
        await choose(b, 'Ragnvaldr');
        check('everyone has chosen: Start', await menuIs(a, ['Run: New', 'As: Enki', 'Start', 'Together']), JSON.stringify(await menu(a)));
        await choose(a, 'Start');
        for (const p of pages) await waitFor(p, () => SceneManager._scene instanceof Scene_Map, 30000, p.label + '\'s game to start').catch(() => {});
        const inAB = await playIn(pages, 300000);
        check('both come through the opening into one run', inAB[0] && inAB[1] && (await a.evaluate(() => Coop.world.runId)) === (await b.evaluate(() => Coop.world.runId)), JSON.stringify(inAB));
        const wa = await who(a), wb = await who(b);
        check('each is the character picked in the lobby', wa.is.join() === '663' && wb.is.join() === '664', JSON.stringify({ wa, wb }));
        // In a game the corner list names the others, not yourself.
        const cornerA = await hud(a), cornerB = await hud(b);
        check('each corner list names the other', /^Bo /.test(cornerA) && /^Ann /.test(cornerB), cornerA + ' || ' + cornerB);
        for (const p of pages) await p.evaluate(() => T.settle());
        await toTitle(b);
        check('at the title with the run under way: Join', await menuIs(b, ['Join', 'Together']), JSON.stringify(await menu(b)));
        await choose(b, 'Join');
        await waitFor(b, () => Coop.lobby.mode === 'pick', 5000, 'Bo\'s list').catch(() => {});
        await key(b, 'Enter');
        await waitFor(b, () => SceneManager._scene instanceof Scene_Map, 30000, 'Bo in the opening');
        const inB = await playIn([b], 300000, true);
        const wb2 = await who(b);
        check('Join brings them in over the tunnel, on a controller', inB[0] && wb2.is.join() === '664' && (await a.evaluate(() => Coop.world.runId)) === (await b.evaluate(() => Coop.world.runId)), JSON.stringify(wb2));
        const errs = await errorsOf(pages);
        check('no script errors', errs.length === 0, errs.join(' || ').slice(0, 600));
    } catch (e) {
        console.error(e);
        check('test ran to the end', false);
    }
    const code = check.finish(pages);
    if (browser) await browser.close();
    for (const s of [server, joiner]) if (s) s.kill();
    return code;
}

(async () => {
    const check = checker();
    if (process.env.FH_TEST_TUNNEL === '1') process.exit(await tunnelRun(check));
    let server, joiner, browser, pages = [];
    try {
        server = await startServer(PORT, { FH_MIND: 'none' });
        // The joiner's PC keeps no room of its own: a spec trace (FH_LOBBY_TRACE) is the host's alone.
        joiner = await startServer(PORT + 100, { FH_JOIN: `http://localhost:${PORT}/`, FH_LOBBY_TRACE: null });
        browser = await launch();
        const a = await openPlayer(browser, `http://localhost:${PORT}/?name=Ann`, 'Ann');
        await waitFor(a, titleReady, 90000, 'Ann at the title');
        await a.evaluate(install);
        await a.evaluate(watch);
        await sleep(600);
        check('alone at the title: the game\'s own menu', (await menu(a)).lines.join('|') === 'New Game|Continue~|Together', JSON.stringify(await menu(a)));
        // Bo's PC is slow: lobby.js comes in 2 s after the line is up, and the room's one word on the lobby before it.
        const b = await openPlayer(browser, `http://localhost:${PORT + 100}/?name=Bo`, 'Bo', { 'lobby.js': 2000 });
        pages = [a, b];
        await waitFor(b, titleReady, 90000, 'Bo at the title');
        await b.evaluate(install);
        await b.evaluate(watch);
        const errors = async (label) => { const errs = await errorsOf(pages); check(label + ': no script errors', errs.length === 0, errs.join(' || ').slice(0, 600)); };

        //--- 1. a new run ------------------------------------------------------
        // The second page in, through its own server. Under load its lobby.js came in after the room had said
        // the lobby was on, and the room says it again only when it changes (gate 11/14): Bo sat out the lobby.
        await waitFor(b, () => Coop.lobby.on, 15000, 'Bo in the lobby').catch(() => {});
        check('two at the title: the host chooses the run', await menuIs(a, ['Run: choose...', 'As: -~', 'Start~', 'Together']), JSON.stringify(await menu(a)));
        check('and the friend\'s As: waits for it, the host shown choosing', await menuIs(b, ['As: (Ann is choosing the run)~', 'Together']) && await hudIs(b, /Ann choosing the run/), JSON.stringify(await menu(b)) + ' / ' + await hud(b));

        //--- run options in Together: the host ticks, the friend sees them and cannot tick
        // Each option: ticked +/-, greyed (faint) !, and ~ where it takes no clicks.
        const rulesBox = (p) => p.evaluate(() => Array.from(document.querySelectorAll('#coop-together [data-rule]'))
            .map((i) => i.getAttribute('data-rule') + (i.checked ? '+' : '-') + (i.disabled ? '!' : '') + (getComputedStyle(i.parentNode).pointerEvents === 'none' ? '~' : '')).join(' ')
            + ' | ' + document.querySelector('#coop-together [data-field=rulesby]').textContent);
        await a.evaluate(() => Coop.together.open());
        await b.evaluate(() => Coop.together.open());
        await sleep(300);
        check('Together shows the host the run options, to tick', /^loot- balance\+ \| $/.test(await rulesBox(a)), await rulesBox(a));
        // The friend's box, once the host's word has come down the line (80 ms each way on the gate's poor line).
        const boxSays = async (re) => { for (let end = Date.now() + 5000; Date.now() < end && !re.test(await rulesBox(b));) await sleep(100); return rulesBox(b); };
        await a.click('#coop-together [data-rule=loot]');
        const ticked = await boxSays(/^loot\+/);
        check('the friend\'s Together ticks it as the host sees it, not greyed, set by the host', /^loot\+~ balance\+~ \| set by the host$/.test(ticked), ticked);
        check('and the corner list does not say it again (his playtest 11/14)', await hudIs(b, /^(?![\s\S]*Instanced loot)/), await hud(b));
        check('and the host\'s choice is kept', await a.evaluate(() => ConfigManager.coopLoot === true && Coop.rules.loot === true && ConfigManager.makeData().coopLoot === true));
        await b.click('#coop-together [data-rule=balance]').catch(() => {});
        await sleep(300);
        check('the friend cannot change them', await b.evaluate(() => Coop.rules.balance === true && ConfigManager.coopBalance === true) && /^loot\+~ balance\+~/.test(await rulesBox(b)), await rulesBox(b));
        await a.click('#coop-together [data-rule=loot]');
        const unticked = await boxSays(/^loot-/);
        check('ticked off: the friend\'s box follows', /^loot-~ balance\+~/.test(unticked), unticked);
        await a.evaluate(() => Coop.together.close());
        await b.evaluate(() => Coop.together.close());
        await sleep(300);
        await choose(a, 'Run: choose...');
        check('Run: offers a new run or a save', await menuIs(a, ['New run', 'Continue~', 'Back']), JSON.stringify(await menu(a)));
        await choose(a, 'New run');
        check('New run asks who the host plays', await menuIs(a, ['Cahara', "D'arce", 'Enki', 'Ragnvaldr', 'Back']), JSON.stringify(await menu(a)));
        await choose(a, 'Enki');
        check('the host\'s lines say the run, who they are, and whom Start waits on', await menuIs(a, ['Run: New', 'As: Enki', 'Start (waiting on Bo)~', 'Together']), JSON.stringify(await menu(a)));
        check('the friend is asked who they come in as', await menuIs(b, ['As: choose...', 'Together']), JSON.stringify(await menu(b)));
        await sleep(400);
        check('the corner list says who is who, the run on the host\'s row', /^Ann new run, Enki \| Bo choosing/.test(await hud(b)), await hud(b));
        await choose(a, 'Start (waiting on Bo)'); // greyed: nothing
        await sleep(300);
        check('a greyed Start does nothing', await a.evaluate(() => !Coop.lobby.going && !Coop.lobby.line.length));
        // His playtest 11/14: a greyed Ready only buzzed until "Come in as..." had been used. Now choosing is the ready (11/22).
        // And the title's menu takes the mouse, as Together does: pointing picks a line, a click chooses it.
        const lineAt = (p, name) => p.evaluate((name) => {
            const w = SceneManager._scene._commandWindow, i = w._list.findIndex((c) => c.name === name);
            const r = w.itemRect(i), box = Graphics._canvas.getBoundingClientRect(), k = box.width / Graphics.width;
            return { x: box.left + (w.x + w.padding + r.x + r.width / 2) * k, y: box.top + (w.y + w.padding + r.y + r.height / 2) * k };
        }, name);
        // A Steam Deck is 1280x800 (11/22). The line a mouse uses has to sit on the picture there too.
        await b.setViewport({ width: 1280, height: 800 });
        await sleep(400);
        const together = await lineAt(b, 'Together');
        check('a lobby menu at 1280x800: the line sits on the picture', together.x >= 0 && together.y >= 0 && together.x < 1280 && together.y < 800, JSON.stringify(together));
        await b.mouse.move(together.x, together.y);
        await sleep(200);
        check('pointing at a line of the title menu puts the cursor there', (await menu(b)).at === 1, JSON.stringify(await menu(b)));
        const asLine = await lineAt(b, 'As: choose...');
        await b.mouse.move(asLine.x, asLine.y);
        await sleep(200);
        await b.mouse.click(asLine.x, asLine.y);
        check('As: opens the character list, the host\'s greyed with their name', await menuIs(b, ['Cahara', "D'arce", 'Enki (Ann)~', 'Ragnvaldr', 'Back']), JSON.stringify(await menu(b)));
        await b.setViewport({ width: 900, height: 700 });
        await sleep(300);
        await choose(b, "D'arce");
        check('and choosing readies them: the line says who', await menuIs(b, ["As: D'arce, new", 'Together']) && await b.evaluate(() => !!(Coop.lobby.rows[Coop.id] || {}).ready), JSON.stringify(await menu(b)));
        await choose(b, "As: D'arce, new");
        check('As: again: the list opens with the cursor on their pick', await menuIs(b, ['Cahara', "D'arce", 'Enki (Ann)~', 'Ragnvaldr', 'Back']) && (await menu(b)).at === 1, JSON.stringify(await menu(b)));
        await choose(b, 'Ragnvaldr');
        check('a change of mind while ready: still ready, as the new one', await menuIs(b, ['As: Ragnvaldr, new', 'Together']) && await b.evaluate(() => { const r = Coop.lobby.rows[Coop.id] || {}; return r.ready && r.pick === 664; }), JSON.stringify(await b.evaluate(() => Coop.lobby.rows[Coop.id])));
        // Their list was up while the host took Enki: the room drops that pick, and the ready sent with it must not stand as
        // Ragnvaldr (Grok 11/14); the refusal says why (11/21).
        await b.evaluate(() => { Coop.send({ t: 'lobby', do: 'ready', on: false }); Coop.send({ t: 'lobby', do: 'pick', pick: 663 }); Coop.send({ t: 'lobby', do: 'ready', on: true, pick: 663 }); });
        await sleep(600);
        check('a pick the room drops does not ready them as their old one, and says why', await b.evaluate(() => { const r = Coop.lobby.rows[Coop.id] || {}; return !r.ready && r.pick === 664 && Coop.log.some((l) => /pick refused: Enki is taken by Ann/.test(l)); }), JSON.stringify(await b.evaluate(() => Coop.lobby.rows[Coop.id])));
        check('not ready: their row is dim, and Start waits on them', (await dimRows(a)).some((r) => /Bo choosing/.test(r)) && await menuIs(a, ['Run: New', 'As: Enki', 'Start (waiting on Bo)~', 'Together']), JSON.stringify(await dimRows(a)));
        await choose(b, 'As: choose...');
        check('the list opens with the cursor on their pick', await menuIs(b, ['Cahara', "D'arce", 'Enki (Ann)~', 'Ragnvaldr', 'Back']) && (await menu(b)).at === 3, JSON.stringify(await menu(b)));
        await key(b, 'Enter');
        check('everyone has chosen: Start', await menuIs(a, ['Run: New', 'As: Enki', 'Start', 'Together']), JSON.stringify(await menu(a)));
        check('chosen: their row is lit and says who', !(await dimRows(a)).some((r) => /Bo/.test(r)) && /Bo Ragnvaldr/.test(await hud(a)), await hud(a));
        await choose(a, 'Start');
        for (const p of [a, b]) await waitFor(p, () => SceneManager._scene instanceof Scene_Map, 20000, p.label + '\'s game to start').catch(() => {});
        check('Start starts both games at once', await a.evaluate(() => SceneManager._scene instanceof Scene_Map) && await b.evaluate(() => SceneManager._scene instanceof Scene_Map));
        const inAB = await playIn([a, b], 300000);
        check('both come through the opening into one run', inAB[0] && inAB[1] && (await a.evaluate(() => Coop.world.runId)) === (await b.evaluate(() => Coop.world.runId)), JSON.stringify(inAB));
        const wa = await who(a), wb = await who(b);
        check('each is the character picked in the lobby, and the picker showed that one', wa.is.join() === '663' && wa.shown === 3 && wb.is.join() === '664' && wb.shown === 4, JSON.stringify({ wa, wb }));
        check('the host\'s game founded the run', wa.founded && !wb.founded, JSON.stringify({ wa, wb }));
        await sleep(1500);
        check('each sees the other in the dungeon', (await a.evaluate(() => Coop.others().some((p) => p.name === 'Bo' && p.st !== 'title'))) && (await b.evaluate(() => Coop.others().some((p) => p.name === 'Ann' && p.st !== 'title'))));
        await errors('a new run');

        //--- 2. the run under way: Join ------------------------------------------
        for (const p of [a, b]) await p.evaluate(() => T.settle());
        await toTitle(b);
        check('at the title with the run under way: Join', await menuIs(b, ['Join', 'Together']), JSON.stringify(await menu(b)));
        await sleep(600);
        check('the corner list says who is in, and where, and who is not', /^Ann in( · [^|]*)? \| Bo not in/.test(await hud(b)), await hud(b));
        // The same for Join: Enki is Ann's in the run, so that pick is dropped and the Join with it too.
        await b.evaluate(() => { Coop.send({ t: 'lobby', do: 'pick', pick: 663 }); Coop.send({ t: 'lobby', do: 'join', pick: 663 }); });
        await sleep(600);
        check('a pick the room drops does not call them in as their old one', await b.evaluate(() => !Coop.lobby.going && Coop.lobby.line.indexOf(Coop.id) < 0 && SceneManager._scene instanceof Scene_Title), JSON.stringify(await b.evaluate(() => ({ going: Coop.lobby.going, line: Coop.lobby.line }))));
        await b.evaluate(() => { window.__shown = 0; });
        await choose(b, 'Join');
        await waitFor(b, () => Coop.lobby.mode === 'pick', 5000, 'Bo\'s list').catch(() => {});
        const list = await menu(b);
        check('Join opens the list, the cursor on their own character', /Ragnvaldr/.test(list.lines[list.at] || ''), JSON.stringify(list));
        await key(b, 'Enter');
        // The line drops while the opening plays (Grok g14): the page comes back to its call.
        await waitFor(b, () => SceneManager._scene instanceof Scene_Map && Coop.lobby.going, 30000, 'Bo in the opening');
        const idWas = await b.evaluate(() => { const id = Coop.id; Coop._ws.close(); return id; });
        await waitFor(b, (was) => Coop.connected && Coop.id !== was && Coop.lobby.line.indexOf(Coop.id) >= 0, 15000, 'Bo back on the line, still called', idWas).catch(() => {});
        const idNow = await b.evaluate(() => Coop.id);
        check('a line that drops in the opening comes back to its call', idNow !== idWas && await a.evaluate((id) => Coop.lobby.line.indexOf(id) >= 0, idNow) && await b.evaluate(() => Coop.lobby.going && !Coop.world.live), JSON.stringify({ idWas, idNow, line: await a.evaluate(() => Coop.lobby.line) }));
        // 11/21 item 4: the opening's picker, held to the pick, on a controller (his friend plays on a Deck).
        // From here on Bo's page presses only that pad. playIn plugs it, D-pad included: the name grid is
        // walked to OK, and pressing nothing on the held picker is still the check (11/22).
        const inB = await playIn([b], 300000, true);
        const wb2 = await who(b);
        check('Join brings them in on a controller, as the character they picked', inB[0] && wb2.is.join() === '664' && wb2.shown === 4 && (await a.evaluate(() => Coop.world.runId)) === (await b.evaluate(() => Coop.world.runId)), JSON.stringify(wb2));
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
