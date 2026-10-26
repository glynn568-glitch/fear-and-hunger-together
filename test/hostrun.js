// The host's game decides which run is played. A friend who gets into the
// dungeon first waits for the host to start or continue one, and then joins
// it, instead of founding a run of their own that the host cannot join.
// Not for ever: a host who does not start lets them go on alone, and a host
// waiting as the dead (loaded a save they died in) holds nobody up.
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const install = require('./helpers');
const { checker } = require('./common');

const hud = (p) => p.evaluate(() => (document.getElementById('coop-hud') ? document.getElementById('coop-hud').innerText : ''));

// A host on this PC and a friend through their own server.
async function pair(browser, port, env) {
    const host = await startServer(port, env);
    const joiner = await startServer(port + 100, Object.assign({ FH_JOIN: `http://localhost:${port}/` }, env));
    const a = await openPlayer(browser, `http://localhost:${port}/?name=Ann`, 'host');
    const b = await openPlayer(browser, `http://localhost:${port + 100}/?name=Bo`, 'friend');
    for (const p of [a, b]) {
        await waitFor(p, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected && Coop.peers.size === 1, 90000, 'title + connection');
        await p.evaluate(install);
    }
    await sleep(600);
    return { a, b, close: async () => { await a.close(); await b.close(); host.kill(); joiner.kill(); } };
}

const friendEnters = async (b) => {
    await b.evaluate(() => T.quickStart(3, 28, 67));
    await waitFor(b, () => T.onMap(), 60000, 'friend on map');
    await b.evaluate(() => T.begin());
};

// Same swing title.js uses: 400 landed hits, states the morning star added.
function balanceSwing() {
    const actor = $gameActors.actor(1), keep = actor._equips[0].object();
    $gameTroop.setup(1);
    actor._equips[0].setObject($dataWeapons[38]);
    actor.refresh();
    const n = {};
    let landed = 0, added = 0;
    for (let i = 0; landed < 400 && i < 4000; i++) {
        const t = $gameTroop.members()[i % 4];
        t.recoverAll();
        t.clearStates();
        const act = new Game_Action(actor);
        act.setAttack();
        act.apply(t);
        if (!(t.result().isHit() && t.isAlive())) continue;
        landed++;
        for (const sid of t.result().addedStates) { n[sid] = (n[sid] || 0) + 1; added++; }
    }
    const st = $dataStates[29];
    const hrgT = st.traits.find((x) => x.code === 22 && x.dataId === 7);
    const item = $dataItems[115];
    if ($gameParty.numItems(item) < 2) $gameParty.gainItem(item, 2);
    let stone = 'missing';
    if (window.Coop && Coop.soulStone) { const got = Coop.soulStone(); stone = got ? got.id : null; }
    actor._equips[0].setObject(keep);
    actor.refresh();
    $gameTroop.clear();
    return {
        bleed: landed ? (n[29] || 0) / landed : null, stun: landed ? (n[28] || 0) / landed : null,
        added, landed, hrg: hrgT ? hrgT.value : null, auto: st.autoRemovalTiming, turns: st.maxTurns,
        stone, run: window.Coop ? Coop.balance : null,
    };
}

(async () => {
    const check = checker();
    const browser = await launch();
    const pages = [];
    try {
        //--- the friend is first; the host starts; the friend joins the host's run
        let s = await pair(browser, 8498, {});
        let { a, b } = s;
        pages.push(a, b);
        check('the friend\'s title screen says whose game sets the run', /Ann's game sets the run/.test(await hud(b)), await hud(b));
        check('the host\'s does not', !/sets the run/.test(await hud(a)), await hud(a));
        await friendEnters(b);
        await waitFor(b, () => Coop.world.hostWait === 'Ann', 10000, 'the friend is told to wait');
        await sleep(3000);
        check('the friend waits instead of founding a run of their own', await b.evaluate(() => !Coop.world.live && Coop.world.hostWait === 'Ann'));
        check('and is told so on screen', /waiting for Ann to start or continue a game/.test(await hud(b)), await hud(b));
        await a.evaluate(() => T.quickStart(1, 27, 67));
        await waitFor(a, () => T.onMap(), 60000, 'host on map');
        await a.evaluate(() => { $gameSwitches.setValue(25, true); T.begin(); });
        await waitFor(a, () => Coop.world.live, 10000, 'host live');
        await waitFor(b, () => Coop.world.live, 10000, 'friend joins the host\'s run');
        const runs = [await a.evaluate(() => Coop.world.runId), await b.evaluate(() => Coop.world.runId)];
        check('once the host is in, the friend joins the host\'s run', runs[0] && runs[0] === runs[1], runs.join(' vs '));
        check('and has the host\'s world', await b.evaluate(() => $gameSwitches.value(25) && !Coop.world.hostWait));
        await sleep(600); // the corner list redraws four times a second
        check('the waiting notice is gone', !/waiting for/.test(await hud(b)), await hud(b));
        await s.close();

        //--- a host who never starts: after the wait, the friend goes on alone
        s = await pair(browser, 8499, { FH_HOST_WAIT: '5000' });
        ({ a, b } = s);
        pages.push(a, b);
        await friendEnters(b);
        await waitFor(b, () => Coop.world.hostWait === 'Ann', 10000, 'the friend waits');
        await waitFor(b, () => Coop.world.live, 15000, 'the friend goes on alone');
        check('a host who does not start within the wait does not keep the friend out for ever', await b.evaluate(() => Coop.world.live && !Coop.world.hostWait));
        await s.close();

        //--- the host loads a save they died in: they wait for a living player, and hold nobody up
        s = await pair(browser, 8497, {});
        ({ a, b } = s);
        pages.push(a, b);
        await a.evaluate(() => Coop.send({ t: 'world?', how: 'load', dead: true, ini: [], runId: '', stamp: 0 }));
        await sleep(800);
        await friendEnters(b);
        await waitFor(b, () => Coop.world.live, 15000, 'the friend founds the run');
        check('a host waiting as the dead does not hold the friend up', await b.evaluate(() => Coop.world.live && !Coop.world.hostWait));
        await s.close();

        //--- Balance changes: the host's switch, on both games. Host 8502, joiner 8602.
        s = await pair(browser, 8502, {});
        ({ a, b } = s);
        pages.push(a, b);
        await friendEnters(b);
        await waitFor(b, () => Coop.world.hostWait === 'Ann', 10000, 'the friend waits for balance');
        await a.evaluate(() => T.quickStart(1, 27, 67));
        await waitFor(a, () => T.onMap(), 60000, 'host on map for balance');
        await a.evaluate(() => T.begin());
        await waitFor(a, () => Coop.world.live, 10000, 'host live for balance');
        await waitFor(b, () => Coop.world.live, 10000, 'friend in the host\'s run for balance');
        await sleep(400);
        await a.evaluate(() => SceneManager.push(Scene_Options));
        await waitFor(a, () => SceneManager._scene instanceof Scene_Options && SceneManager._scene._categoryWindow && !SceneManager.isSceneChanging(), 10000, 'host Options open');
        const offOpt = await a.evaluate(() => {
            const s = SceneManager._scene, cats = s._categoryWindow;
            cats.select(cats._list.findIndex((c) => c.name === 'General'));
            cats.updateHelp();
            const w = s._optionsWindow, i = w._list.findIndex((c) => c.symbol === 'coopBalance');
            const cat = window.Yanfly && Yanfly.Param && Yanfly.Param.OptionsCategories && Yanfly.Param.OptionsCategories.find((c) => c.Name === 'General');
            const opt = cat && cat.OptionsList.find((o) => o.Symbol === 'coopBalance');
            const help = opt ? JSON.parse(opt.HelpDesc) : '';
            if (i < 0) return { listed: false, symbols: w._list.map((c) => c.symbol), help, decides: !!Coop.decides };
            const was = ConfigManager.coopBalance;
            w.select(i);
            w.processOk();
            return { listed: true, name: w.commandName(i), was, now: ConfigManager.coopBalance, saved: ConfigManager.makeData().coopBalance, help, decides: !!Coop.decides };
        });
        check('Options lists Balance changes under General for the host, on, and OK turns it off',
            offOpt.listed === true && offOpt.name === 'Balance changes' && offOpt.was === true && offOpt.now === false && offOpt.saved === false
            && offOpt.help === 'Weapons do what their text says; two soul stones can call a partner back. Set by the host for everyone.',
            JSON.stringify(offOpt));
        await sleep(800);
        const off = await b.evaluate(balanceSwing);
        const sawOff = !!(off && off.added === 0 && off.landed > 0 && off.hrg === -0.1 && off.auto === 0 && off.stone === null);
        check('host turns balance off: the joiner\'s morning star inflicts nothing, bleed is the old one, and two soul stones call nobody', sawOff, JSON.stringify(off));
        const onOpt = await a.evaluate(() => {
            const w = SceneManager._scene && SceneManager._scene._optionsWindow;
            if (!w) return { listed: false };
            const i = w._list.findIndex((c) => c.symbol === 'coopBalance');
            if (i < 0) return { listed: false };
            w.select(i);
            w.processOk();
            return { now: ConfigManager.coopBalance };
        });
        await a.evaluate(() => { if (SceneManager._scene instanceof Scene_Options) SceneManager.pop(); });
        await sleep(800);
        const back = await b.evaluate(balanceSwing);
        check('host turns balance on again: the joiner\'s morning star rates return',
            !!(onOpt.now === true && sawOff && back.bleed > 0.25 && back.bleed < 0.45 && back.stun > 0.05 && back.stun < 0.2 && back.turns === 4 && back.hrg === -0.05 && back.auto === 2 && back.stone === 115),
            JSON.stringify({ onOpt, back }));
        await b.evaluate(() => SceneManager.push(Scene_Options));
        await waitFor(b, () => SceneManager._scene instanceof Scene_Options && SceneManager._scene._categoryWindow && !SceneManager.isSceneChanging(), 10000, 'joiner Options open');
        const flip = await b.evaluate(() => {
            const s = SceneManager._scene, cats = s._categoryWindow;
            cats.select(cats._list.findIndex((c) => c.name === 'General'));
            cats.updateHelp();
            const w = s._optionsWindow;
            const listed = w._list.some((c) => c.symbol === 'coopBalance');
            ConfigManager.coopBalance = false;
            ConfigManager.save();
            if (SceneManager._scene instanceof Scene_Options) SceneManager.pop();
            return { listed, choice: ConfigManager.coopBalance, run: Coop.balance };
        });
        await sleep(600);
        const still = await b.evaluate(balanceSwing);
        check('a joiner flipping its own option changes nothing',
            flip.listed === false && flip.choice === false && flip.run === true && still.run === true
            && still.bleed > 0.25 && still.bleed < 0.45 && still.stun > 0.05 && still.stun < 0.2 && still.hrg === -0.05 && still.stone === 115,
            JSON.stringify({ flip, still }));
        await s.close();
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(pages);
    await browser.close();
    process.exit(code);
})();
