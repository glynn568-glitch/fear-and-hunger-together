// Joining a fight already under way, the way it happens online: the host plays
// with "Hide my IP" on, as it is by default (pictures only through the relay), a friend from their own
// PC owns the fight, and the host walks up and asks in. They see the fight at
// once, come in at the next turn, and choose their own move.
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const { checker } = require('./common');
const install = require('./helpers');

(async () => {
    const check = checker();
    let host, joiner, browser, pages = [];
    try {
        host = await startServer(8481, { FH_RELAY: null }); // Hide my IP, as it is by default
        joiner = await startServer(8581, { FH_JOIN: 'http://localhost:8481/' });
        browser = await launch();
        const a = await openPlayer(browser, 'http://localhost:8481/?name=Ann', 'host');
        const b = await openPlayer(browser, 'http://localhost:8581/?name=Enki', 'joiner');
        pages = [a, b];
        for (const p of pages) { await waitFor(p, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 90000, 'title'); await p.evaluate(install); }
        await a.evaluate(() => T.quickStart(1, 27, 67)); await waitFor(a, () => T.onMap(), 60000, 'host on the map'); await a.evaluate(() => { T.settle(); T.begin(); });
        await b.evaluate(() => T.quickStart(4, 27, 58)); await waitFor(b, () => T.onMap(), 60000, 'friend on the map'); await b.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(b, () => Coop.world.live, 10000, 'friend live');
        await sleep(800);
        await b.evaluate(() => { BattleManager.setup(1, true, true); SceneManager.push(Scene_Battle); });
        await waitFor(b, () => BattleManager._phase === 'input', 30000, 'the friend\'s fight is under way');
        const idB = await b.evaluate(() => Coop.id);
        await a.evaluate(() => { $gamePlayer.locate(27, 59); });
        await sleep(500);
        await a.evaluate((id) => Coop.askToJoinBattle(id), idB);
        await waitFor(a, () => SceneManager._scene instanceof Scene_CoopSpectate, 20000, 'the host watches');
        await waitFor(a, () => Coop.viewer.frames > 2, 5000, 'pictures before the next turn').catch(() => {});
        const early = await a.evaluate(() => ({ frames: Coop.viewer.frames, toast: document.getElementById('coop-toast').textContent }));
        check('joining mid-fight shows the fight at once, not a black screen', early.frames > 2, JSON.stringify(early));
        check('and says they come in at the next turn', /next turn/.test(early.toast), early.toast);
        // The friend picks their move; the next turn lets the host in, and the host chooses for themselves.
        const press = async (p, code) => { await p.keyboard.down(code); await sleep(130); await p.keyboard.up(code); await sleep(250); };
        const hostsTurn = () => Coop.battle && Coop.battle.guests.size === 1 && BattleManager._phase === 'input' && BattleManager.actor() && BattleManager.actor().actorId() === 1;
        await press(b, 'KeyZ'); await press(b, 'KeyZ'); await press(b, 'KeyZ');
        // Through the round's messages, as a player reads them, until the host's turn comes.
        // In each round the friend, who owns the fight, chooses first.
        for (let i = 0; i < 80 && !(await b.evaluate(hostsTurn)); i++) {
            if (await b.evaluate(() => BattleManager._phase === 'input' && BattleManager.actor() && BattleManager.actor().actorId() === 4)) { await press(b, 'KeyZ'); await press(b, 'KeyZ'); await press(b, 'KeyZ'); }
            else if (await b.evaluate(() => $gameMessage.isBusy())) await press(b, 'KeyZ'); else await sleep(500);
        }
        await waitFor(b, hostsTurn, 5000, 'the host\'s turn');
        check('at the next turn the host is in, and it is their turn to choose', true);
        await sleep(1500);
        check('nobody else chose for them', await b.evaluate(() => BattleManager._phase === 'input' && BattleManager.actor() && BattleManager.actor().actorId() === 1));
        const f0 = await a.evaluate(() => Coop.viewer.frames);
        await sleep(2000);
        const rate = ((await a.evaluate(() => Coop.viewer.frames)) - f0) / 2;
        check('pictures keep coming through the relay', rate >= 5, rate + ' a second');
    } catch (e) { console.error(e); check('test ran to the end', false); if (pages[1]) console.log('STATE', JSON.stringify(await pages[1].evaluate(() => ({ scene: SceneManager._scene.constructor.name, phase: BattleManager._phase, actor: BattleManager.actor() && BattleManager.actor().actorId(), party: $gameParty._actors, guests: Coop.battle && Coop.battle.guests ? Coop.battle.guests.size : -1, pending: Coop.battle && Coop.battle.pending ? Coop.battle.pending.length : -1, invited: Coop.battle && Coop.battle.invited ? Coop.battle.invited.size : -1, msg: $gameMessage.isBusy(), log: Coop.log.slice(-6) })).catch((x) => String(x)))); }
    const code = check.finish(pages);
    if (browser) await browser.close();
    for (const s of [host, joiner]) if (s) s.kill();
    process.exit(code);
})();
