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
const { titleReady, menu, hud, hudIs, dimRows, key, choose, menuIs, watch, playIn, toTitle, who, errorsOf } = require('./lobbylib');

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
        check('two at the title: the host chooses the run', await menuIs(a, ['New run', 'Continue~', 'Together']), JSON.stringify(await menu(a)));
        check('and the friend\'s Ready waits for it, the host shown choosing', await menuIs(b, ['Ready~', 'Together']) && await hudIs(b, /Ann choosing/), JSON.stringify(await menu(b)) + ' / ' + await hud(b));

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
        await choose(a, 'New run');
        check('New run asks who the host plays', await menuIs(a, ['Cahara', "D'arce", 'Enki', 'Ragnvaldr', 'Back']), JSON.stringify(await menu(a)));
        await choose(a, 'Enki');
        check('the host\'s menu is now Start, and not yet', await menuIs(a, ['Start~', 'Change run', 'Together']), JSON.stringify(await menu(a)));
        check('the friend is offered Ready', await menuIs(b, ['Ready', 'Together']), JSON.stringify(await menu(b)));
        await sleep(400);
        check('the corner list says the run and who is who', /New run \| Ann Enki \| Bo not ready/.test(await hud(b)), await hud(b));
        await key(a, 'Enter'); // Start, greyed: nothing
        await sleep(300);
        check('a greyed Start does nothing', await a.evaluate(() => !Coop.lobby.going && !Coop.lobby.line.length));
        // His playtest 11/14: a greyed Ready only buzzed until "Come in as..." had been used. Ready is the pick.
        // And the title's menu takes the mouse, as Together does: pointing picks a line, a click chooses it.
        const lineAt = (p, name) => p.evaluate((name) => {
            const w = SceneManager._scene._commandWindow, i = w._list.findIndex((c) => c.name === name);
            const r = w.itemRect(i), box = Graphics._canvas.getBoundingClientRect(), k = box.width / Graphics.width;
            return { x: box.left + (w.x + w.padding + r.x + r.width / 2) * k, y: box.top + (w.y + w.padding + r.y + r.height / 2) * k };
        }, name);
        const together = await lineAt(b, 'Together');
        await b.mouse.move(together.x, together.y);
        await sleep(200);
        check('pointing at a line of the title menu puts the cursor there', (await menu(b)).at === 1, JSON.stringify(await menu(b)));
        const ready = await lineAt(b, 'Ready');
        await b.mouse.move(ready.x, ready.y);
        await sleep(200);
        await b.mouse.click(ready.x, ready.y);
        check('Ready opens the character list, the host\'s greyed', await menuIs(b, ['Cahara', "D'arce", 'Enki~', 'Ragnvaldr', 'Back']), JSON.stringify(await menu(b)));
        await choose(b, "D'arce");
        check('and the pick readies them', await menuIs(b, ['Not ready', 'Together']) && await b.evaluate(() => !!(Coop.lobby.rows[Coop.id] || {}).ready), JSON.stringify(await menu(b)));
        await choose(b, 'Not ready');
        await menuIs(b, ['Ready', 'Together']);
        await sleep(300);
        check('not ready, their pick kept: their row is dim', (await dimRows(a)).some((r) => /Bo D'arce/.test(r)), JSON.stringify(await dimRows(a)));
        // Their list was up while the host took Enki: the room drops that pick, and the Ready sent with it must not stand as D'arce (Grok 11/14).
        await b.evaluate(() => { Coop.send({ t: 'lobby', do: 'pick', pick: 663 }); Coop.send({ t: 'lobby', do: 'ready', on: true, pick: 663 }); });
        await sleep(600);
        check('a pick the room drops does not ready them as their old one', await b.evaluate(() => { const r = Coop.lobby.rows[Coop.id] || {}; return !r.ready && r.pick === 662; }), JSON.stringify(await b.evaluate(() => Coop.lobby.rows[Coop.id])));
        await choose(b, 'Ready');
        check('Ready again: the list opens with the cursor on their pick', await menuIs(b, ['Cahara', "D'arce", 'Enki~', 'Ragnvaldr', 'Back']) && (await menu(b)).at === 1, JSON.stringify(await menu(b)));
        await key(b, 'Enter');
        check('ready: the line turns to Not ready', await menuIs(b, ['Not ready', 'Together']), JSON.stringify(await menu(b)));
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
        check('at the title with the run under way: Join', await menuIs(b, ['Join', 'Together']), JSON.stringify(await menu(b)));
        await sleep(600);
        check('the corner list says it is under way, who is in and who is not', /^Under way.* \| Ann in \| Bo not in/.test(await hud(b)), await hud(b));
        // The same for Join: Enki is Ann's in the run, so that pick is dropped and the Join with it too.
        await b.evaluate(() => { Coop.send({ t: 'lobby', do: 'pick', pick: 663 }); Coop.send({ t: 'lobby', do: 'join', pick: 663 }); });
        await sleep(600);
        check('a pick the room drops does not call them in as their old one', await b.evaluate(() => !Coop.lobby.going && Coop.lobby.line.indexOf(Coop.id) < 0 && SceneManager._scene instanceof Scene_Title), JSON.stringify(await b.evaluate(() => ({ going: Coop.lobby.going, line: Coop.lobby.line }))));
        await b.evaluate(() => { window.__shown = 0; });
        await choose(b, 'Join');
        await waitFor(b, () => Coop.lobby.mode === 'pick', 5000, 'Bo\'s list').catch(() => {});
        const list = await menu(b);
        check('Join opens the list, the cursor on their own character', /D'arce/.test(list.lines[list.at] || ''), JSON.stringify(list));
        await key(b, 'Enter');
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
