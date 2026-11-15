// Loot, shared and instanced. Shared (the default): a crate is marked taken for
// everyone the moment someone starts searching it, not when their "You find"
// box closes, so a partner pressing it meanwhile finds it searched. With the
// host's Instanced loot on, every crate holds its find for each player: the
// mark stays on the machine of whoever took it. A joiner's own tick changes
// nothing. Turned off, what anyone took is taken for all. The option is kept
// with the run's world, so a restarted server knows it before the host is
// back. Host 8513, joiner 8613; the restarted server 8514.
const fs = require('fs');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const install = require('./helpers');
const { checker } = require('./common');

// Map001 crates by the gate: one roll of a glass vial, a leather vest or nothing; one always a
// blue vial; one roll of the minor item table.
const SHARED = 39; // at 14,44
const OWN = 45; // at 13,44
const LATE = 122; // at 13,40
// Containers marked taken by a shared switch, two tiles each: a chest that asks Open or Leave and
// then plays the coin flip (there only when the floor's layout dice LEVEL1_random1, var 20, is 2
// or more); a crate.
const CHEST = [12, 68], CHEST_SW = 33; // chest1 at 7,54 and 6,54
const CRATE = [44, 119], CRATE_SW = 459; // crate4_1 at 26,40 and 25,40
const LATE_CRATE = 103, LATE_SW = 460; // crate5 at 12,42

function savedWorld(saves) {
    const dir = path.join(saves, 'runs');
    for (const run of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
        try { return { run, world: JSON.parse(fs.readFileSync(path.join(dir, run, 'world.json'), 'utf8')) }; } catch (e) { /* not this one */ }
    }
    return null;
}

// A friend's page back on a server with no host on it yet, carrying run `runId` on, as plain
// socket messages: the rules it is told on hello, and with the world.
function friendBack(port, runId) {
    return new Promise((resolve, reject) => {
        http.get(`http://localhost:${port}/coop/hello`, (res) => {
            let s = '';
            res.on('data', (d) => { s += d; });
            res.on('end', () => {
                const b = JSON.parse(s);
                const q = `?fp=${encodeURIComponent(b.fp)}&build=${encodeURIComponent(b.build)}&mod=${encodeURIComponent(b.mod)}&v=${encodeURIComponent(b.version)}`;
                const ws = new WebSocket(`ws://localhost:${port}/coop/ws${q}`, { headers: { 'x-fh-join': '1' } });
                const out = { hello: null, world: null };
                const done = setTimeout(() => { ws.close(); resolve(out); }, 8000);
                ws.on('error', reject);
                ws.on('message', (raw, binary) => {
                    if (binary) return;
                    const msg = JSON.parse(raw);
                    if (msg.t === 'hello') { out.hello = msg.rules || null; ws.send(JSON.stringify({ t: 'name', name: 'Bo', token: 't-Bo' })); }
                    if (msg.t === 'nameok') {
                        ws.send(JSON.stringify({ t: 'p', st: 'map', m: 1 }));
                        ws.send(JSON.stringify({ t: 'world?', runId, stamp: 0, how: 'again', ini: [662], have: [] }));
                    }
                    if (msg.t === 'world') { out.world = msg.rules || null; clearTimeout(done); ws.close(); resolve(out); }
                });
            });
        }).on('error', reject);
    });
}

// In the page: search crate `id` with the dice fixed on its first find, and press through
// its messages, or stop at the first message or choice matching `hold`.
function search(id, hold) {
    const keep = Math.randomInt;
    Math.randomInt = () => 0;
    const before = $gameParty.allItems().reduce((n, it) => n + $gameParty.numItems(it), 0);
    $gameMap.event(id).start();
    window.__loot = { before, done: false };
    const t = setInterval(() => {
        if ($gameMessage.isBusy()) {
            if (hold && new RegExp(hold).test($gameMessage.allText() + '|' + $gameMessage.choices().join('|'))) { Input._currentState.ok = false; return; }
            Input._currentState.ok = !Input._currentState.ok;
            return;
        }
        if ($gameMap.isEventRunning()) return;
        clearInterval(t);
        Input._currentState.ok = false;
        Math.randomInt = keep;
        window.__loot.done = true;
    }, 60);
    window.__lootStop = () => { hold = false; };
}

const state = (id, sw) => ({
    mark: sw ? $gameSwitches.value(sw) : !!$gameSelfSwitches.value([1, id, 'A']),
    choices: $gameMessage.isBusy() ? $gameMessage.choices().join('|') : '',
    carried: $gameParty.allItems().reduce((n, it) => n + $gameParty.numItems(it), 0),
    busy: $gameMessage.isBusy(),
    running: $gameMap.isEventRunning(),
    text: $gameMessage.isBusy() ? $gameMessage.allText() : '',
    loot: Coop.rules.loot,
});

// What the page is saying in its notice line, and the loot row of the F1 panel.
const toastNow = () => { const t = document.getElementById('coop-toast'); return t && t.style.display !== 'none' ? t.textContent : ''; };
function bagsRow() {
    const fire = () => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'F1', key: 'F1' }));
    fire(); // opens it, filled in for the run as it is now
    const text = document.querySelector('#coop-help [data-row=Bags]').textContent;
    fire();
    return text;
}

(async () => {
    const check = checker();
    const browser = await launch();
    const pages = [];
    let host, joiner, lone;
    try {
        host = await startServer(8513, {});
        joiner = await startServer(8613, { FH_JOIN: 'http://localhost:8513/' });
        const a = await openPlayer(browser, 'http://localhost:8513/?name=Ann', 'host');
        const b = await openPlayer(browser, 'http://localhost:8613/?name=Bo', 'friend');
        pages.push(a, b);
        for (const p of [a, b]) {
            await waitFor(p, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected && Coop.peers.size === 1, 90000, 'title + connection');
            await p.evaluate(install);
        }
        await a.evaluate(() => T.quickStart(1, 14, 45));
        await waitFor(a, () => T.onMap(), 60000, 'host on map');
        await a.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(a, () => Coop.world.live, 10000, 'host live');
        await b.evaluate(() => T.quickStart(3, 13, 45));
        await waitFor(b, () => T.onMap(), 60000, 'friend on map');
        await b.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(b, () => Coop.world.live, 10000, 'friend in the host\'s run');
        await sleep(800);
        for (const p of [a, b]) await p.evaluate(() => T.settle());

        //--- shared: the host searches and leaves the "You find" box up
        const census = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'client', 'census.json'), 'utf8'));
        check('the census counts crates as loot, and not the merchant\'s potion (its letter starts his farewell)',
            census.ssLoot.includes('1,' + SHARED + ',A') && census.ssLoot.includes('1,' + LATE + ',A') && !census.ssLoot.includes('131,47,B') && !census.ssLoot.includes('74,47,B')
            && census.swLoot.includes(CHEST_SW) && census.swLoot.includes(CRATE_SW) && census.swLoot.includes(LATE_SW),
            census.ssLoot.length + ' loot letters, ' + census.swLoot.length + ' loot switches');
        const rules = [await a.evaluate(() => Coop.rules.loot), await b.evaluate(() => Coop.rules.loot)];
        check('loot is shared unless the host says otherwise', rules[0] === false && rules[1] === false, JSON.stringify(rules));
        await a.evaluate(search, SHARED, 'You find');
        await waitFor(a, () => $gameMessage.isBusy() && /Glass vial/.test($gameMessage.allText()), 8000, 'the host\'s find is on screen');
        await sleep(1200);
        const mid = { a: await a.evaluate(state, SHARED), b: await b.evaluate(state, SHARED) };
        check('the crate is marked searched for the partner while the host\'s find is still on screen',
            mid.a.busy && mid.a.mark && mid.b.mark, JSON.stringify(mid));
        await b.evaluate(search, SHARED, false);
        await waitFor(b, () => window.__loot && window.__loot.done, 15000, 'the partner\'s search ends');
        await a.evaluate(() => window.__lootStop());
        await waitFor(a, () => window.__loot && window.__loot.done, 15000, 'the host\'s search ends');
        const after = { a: await a.evaluate(state, SHARED), b: await b.evaluate(state, SHARED), bBefore: await b.evaluate(() => window.__loot.before), aBefore: await a.evaluate(() => window.__loot.before) };
        check('the host got the vial and the partner found the crate empty',
            after.a.carried === after.aBefore + 1 && after.b.carried === after.bBefore && after.a.mark && after.b.mark, JSON.stringify(after));

        //--- shared, a chest marked by a shared switch: taken for everyone once the host picks Open
        await a.evaluate(() => { $gameVariables.setValue(20, 2); $gameMap.requestRefresh(); });
        await waitFor(b, (id) => $gameVariables.value(20) === 2 && $gameMap.event(id).page(), 5000, 'the chest stands for the partner too', CHEST[1]);
        await waitFor(a, (id) => !!$gameMap.event(id).page(), 5000, 'the chest stands for the host', CHEST[0]);
        await a.evaluate(search, CHEST[0], 'HEADS');
        await waitFor(a, () => $gameMessage.isBusy() && $gameMessage.choices().indexOf('HEADS') >= 0, 10000, 'the host picked Open and flips the coin');
        await sleep(1200);
        const chestMid = { a: await a.evaluate(state, CHEST[0], CHEST_SW), b: await b.evaluate(state, CHEST[1], CHEST_SW) };
        check('the chest is marked opened for the partner while the host is still at the coin flip',
            chestMid.a.busy && chestMid.a.mark && chestMid.b.mark, JSON.stringify(chestMid));
        await b.evaluate(search, CHEST[1], false);
        await waitFor(b, () => window.__loot && window.__loot.done, 15000, 'the partner\'s look into the chest ends');
        await a.evaluate(() => window.__lootStop());
        await waitFor(a, () => window.__loot && window.__loot.done, 20000, 'the host\'s chest ends');
        const chestEnd = { b: await b.evaluate(state, CHEST[1], CHEST_SW), bBefore: await b.evaluate(() => window.__loot.before) };
        check('the partner opening its other half meanwhile finds the chest empty', chestEnd.b.carried === chestEnd.bBefore && chestEnd.b.mark, JSON.stringify(chestEnd));

        //--- the host turns Instanced loot on in Options
        await a.evaluate(() => SceneManager.push(Scene_Options));
        await waitFor(a, () => SceneManager._scene instanceof Scene_Options && SceneManager._scene._categoryWindow && !SceneManager.isSceneChanging(), 10000, 'host Options open');
        const opt = await a.evaluate(() => {
            const s = SceneManager._scene, cats = s._categoryWindow;
            cats.select(cats._list.findIndex((c) => c.name === 'General'));
            cats.updateHelp();
            const w = s._optionsWindow, i = w._list.findIndex((c) => c.symbol === 'coopLoot');
            if (i < 0) return { listed: false, symbols: w._list.map((c) => c.symbol) };
            const was = ConfigManager.coopLoot;
            w.select(i);
            w.processOk();
            const out = { listed: true, name: w.commandName(i), was, now: ConfigManager.coopLoot, saved: ConfigManager.makeData().coopLoot, run: Coop.rules.loot };
            SceneManager.pop();
            return out;
        });
        check('Options lists Instanced loot under General for the host, off, and OK turns it on',
            opt.listed && opt.name === 'Instanced loot' && opt.was === false && opt.now === true && opt.saved === true && opt.run === true, JSON.stringify(opt));
        await waitFor(b, () => Coop.rules.loot === true, 5000, 'the partner hears Instanced loot');
        const toldOn = await b.evaluate(toastNow);
        check('the partner is told Instanced loot is on', /Instanced loot is on/.test(toldOn), toldOn);
        const bagsOn = await b.evaluate(bagsRow);
        check('the partner\'s F1 says each of them has their own loot', /Instanced loot is on/.test(bagsOn), bagsOn);
        await waitFor(a, () => T.onMap(), 10000, 'host back on the map');

        //--- instanced: the host takes the vial, then the partner takes their own
        await a.evaluate(search, OWN, false);
        await waitFor(a, () => window.__loot && window.__loot.done, 15000, 'the host\'s instanced search ends');
        await sleep(1200);
        const one = { a: await a.evaluate(state, OWN), b: await b.evaluate(state, OWN) };
        check('the host\'s mark stays on the host\'s machine', one.a.mark && !one.b.mark, JSON.stringify(one));
        await b.evaluate(search, OWN, false);
        await waitFor(b, () => window.__loot && window.__loot.done, 15000, 'the partner\'s instanced search ends');
        const two = { a: await a.evaluate(state, OWN), b: await b.evaluate(state, OWN), bBefore: await b.evaluate(() => window.__loot.before) };
        check('the partner finds their own vial in the same crate', two.b.carried === two.bBefore + 1 && two.b.mark && two.a.mark, JSON.stringify(two));
        await sleep(800);
        const prints = [await a.evaluate(() => Coop.world.fingerprint()), await b.evaluate(() => Coop.world.fingerprint())];
        check('both still see the same shared world', prints[0] === prints[1], prints.map((p) => p.length).join(' vs '));

        //--- instanced, a crate marked by a shared switch: the host's mark stays home, the partner finds their own
        await a.evaluate(search, CRATE[0], false);
        await waitFor(a, () => window.__loot && window.__loot.done, 15000, 'the host\'s switch crate ends');
        await sleep(1200);
        const crateOne = { a: await a.evaluate(state, CRATE[0], CRATE_SW), b: await b.evaluate(state, CRATE[1], CRATE_SW) };
        await b.evaluate(search, CRATE[1], false);
        await waitFor(b, () => window.__loot && window.__loot.done, 15000, 'the partner\'s switch crate ends');
        const crateTwo = { b: await b.evaluate(state, CRATE[1], CRATE_SW), bBefore: await b.evaluate(() => window.__loot.before) };
        check('a crate marked by a shared switch holds the partner\'s own find too',
            crateOne.a.mark && !crateOne.b.mark && crateTwo.b.mark && crateTwo.b.carried > crateTwo.bBefore, JSON.stringify({ crateOne, crateTwo }));

        //--- a joiner's own tick changes nothing
        const flip = await b.evaluate(() => { ConfigManager.coopLoot = false; return { choice: ConfigManager.coopLoot, run: Coop.rules.loot }; });
        await sleep(600);
        const still = [await a.evaluate(() => Coop.rules.loot), await b.evaluate(() => Coop.rules.loot)];
        check('a joiner turning its own Instanced loot off changes nothing', flip.choice === false && flip.run === true && still[0] && still[1], JSON.stringify({ flip, still }));

        //--- the option is kept with the run's world on disk, without the crates taken under it
        await sleep(5500); // the room writes world.json every 5 s
        const disk = savedWorld(host.saves);
        check('the run\'s world on disk holds Instanced loot and not the crates taken under it',
            !!(disk && disk.world.rules && disk.world.rules.loot === true && !disk.world.ss['1,' + OWN + ',A']), JSON.stringify(disk && { rules: disk.world.rules, own: disk.world.ss['1,' + OWN + ',A'] }));

        //--- the partner takes a crate the host has not; the host turns Instanced loot off: taken for both
        await b.evaluate(search, LATE, false);
        await waitFor(b, () => window.__loot && window.__loot.done, 15000, 'the partner\'s last instanced search ends');
        await b.evaluate(search, LATE_CRATE, false);
        await waitFor(b, () => window.__loot && window.__loot.done, 15000, 'the partner\'s last switch crate ends');
        const lateA = await a.evaluate(state, LATE);
        const lateSwA = await a.evaluate(state, LATE_CRATE, LATE_SW);
        await a.evaluate(() => { ConfigManager.coopLoot = false; });
        await waitFor(b, () => Coop.rules.loot === false, 5000, 'the partner hears Instanced loot is off');
        const toldOff = await b.evaluate(toastNow);
        const bagsOff = await b.evaluate(bagsRow);
        check('the partner is told Instanced loot is off, and F1 says an emptied chest stays empty',
            /Instanced loot is off/.test(toldOff) && /emptied chest stays empty/.test(bagsOff), JSON.stringify({ toldOff, bagsOff }));
        await sleep(1200);
        const lateAfter = { before: lateA, a: await a.evaluate(state, LATE), b: await b.evaluate(state, LATE), swBefore: lateSwA.mark, swA: (await a.evaluate(state, LATE_CRATE, LATE_SW)).mark };
        const printsOff = [await a.evaluate(() => Coop.world.fingerprint()), await b.evaluate(() => Coop.world.fingerprint())];
        check('host turns Instanced loot off: a crate only the partner took is taken for the host too, and both see one world',
            !lateA.mark && lateAfter.a.mark && lateAfter.b.mark && !lateAfter.swBefore && lateAfter.swA && !lateAfter.a.loot && printsOff[0] === printsOff[1], JSON.stringify(lateAfter) + ' ' + printsOff.map((p) => p.length).join(' vs '));

        //--- a restarted server: whoever comes back first, before the host, hears the run's option
        lone = await startServer(8514, {});
        const runDir = path.join(lone.saves, 'runs', 'r1');
        fs.mkdirSync(runDir, { recursive: true });
        fs.writeFileSync(path.join(runDir, 'world.json'), JSON.stringify({ sw: {}, va: {}, ss: {}, el: {}, rules: { balance: true, loot: true } }));
        const back = await friendBack(8514, 'r1');
        check('a friend back first on a restarted server is told the run\'s Instanced loot before the world',
            back.hello && back.hello.loot === false && back.world && back.world.loot === true, JSON.stringify(back));
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(pages);
    await browser.close();
    for (const s of [host, joiner, lone]) if (s) s.kill();
    process.exit(code);
})();
