// Two people playing over the real internet, as near as one PC can get.
// The host goes online through a real Cloudflare tunnel (as the Together
// panel does, Hide my IP on); the friend's own server joins through that link,
// behind a line the test can break (test/chaos.js). Keys are pressed at a
// person's pace, with slips. During a fight the friend's Wi-Fi blips, the line
// drops, the tab is suspended, and a long outage gets them dropped. Afterwards:
// nobody stuck, characters and bags as the fight left them, both games agree.
// Needs the internet; creates a short-lived private quick tunnel.
//   node test/humans.js
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const install = require('./helpers');
const { checker } = require('./common');
const { chaosLink } = require('./chaos');

const HOST = 8486, FRIEND = 8586, LINE = 8686;
const rand = (a, b) => a + Math.random() * (b - a);

// A person: looks, thinks, presses; now and then the wrong way first.
async function human(page, key) {
    await sleep(rand(250, 900));
    if (Math.random() < 0.15 && /^Arrow(Up|Down)$/.test(key) === false) {
        await page.keyboard.down('ArrowDown'); await sleep(rand(80, 140)); await page.keyboard.up('ArrowDown');
        await sleep(rand(200, 500));
        await page.keyboard.down('ArrowUp'); await sleep(rand(80, 140)); await page.keyboard.up('ArrowUp');
        await sleep(rand(150, 400));
    }
    await page.keyboard.down(key); await sleep(rand(80, 160)); await page.keyboard.up(key);
}

// Until someone has a move to choose, or the fight is over; a message on the
// owner's screen is read and passed with Enter, as a player would.
async function nextTurn(owner, what) {
    for (let i = 0; i < 120; i++) {
        const st = await owner.evaluate(() => ({ input: BattleManager._phase === 'input' && !!BattleManager.actor(), battle: SceneManager._scene instanceof Scene_Battle, msg: $gameMessage.isBusy(), phase: BattleManager._phase }));
        if (st.input || !st.battle) return st.battle;
        if (st.msg) await human(owner, 'Enter'); else await sleep(400);
    }
    const st = await owner.evaluate(() => ({ phase: BattleManager._phase, msg: $gameMessage.isBusy(), text: $gameMessage._texts.join(' / '), log: Coop.log.slice(-5), event: $gameTroop._interpreter.isRunning(), waitMode: $gameTroop._interpreter._waitMode, logWin: SceneManager._scene._logWindow && SceneManager._scene._logWindow._methods.length }));
    throw new Error(what + ': no next turn; ' + JSON.stringify(st));
}

const inputActor = (p) => p.evaluate(() => (BattleManager._phase === 'input' && BattleManager.actor() ? BattleManager.actor().actorId() : 0));

// One round: each player picks a move for their own character, at their
// pace, until the round runs (or the fight is over).
async function playTurn(owner, guest, guestActor, what) {
    if (!(await nextTurn(owner, what))) return 'over';
    const seen = [];
    for (let i = 0; i < 60; i++) {
        const st = await owner.evaluate(() => ({ phase: BattleManager._phase, actor: BattleManager._phase === 'input' && BattleManager.actor() ? BattleManager.actor().actorId() : 0, battle: SceneManager._scene instanceof Scene_Battle, party: $gameParty._actors.join() }));
        if (!st.battle) return 'over';
        if (seen.length && st.phase !== 'input') return 'ran';
        if (!st.actor) { await sleep(300); continue; }
        seen.push(st.actor);
        const who = st.actor === guestActor ? guest : owner;
        // Guard, so the fight lasts (an attack can take a head off at any health):
        // the cursor is walked to it with the arrow keys, as a player does.
        const nav = await owner.evaluate(() => { const w = SceneManager._scene._actorCommandWindow; return w && w.active ? { at: w.index(), to: w.findSymbol('guard') } : null; });
        if (nav && nav.to >= 0) for (let k = 0; k < Math.abs(nav.to - nav.at); k++) await human(who, nav.to > nav.at ? 'ArrowDown' : 'ArrowUp');
        for (let k = 0; k < 4 && await inputActor(owner) === st.actor; k++) await human(who, 'KeyZ');
        await sleep(300);
    }
    const st = await owner.evaluate(() => ({ phase: BattleManager._phase, actor: BattleManager.actor() && BattleManager.actor().actorId(), party: $gameParty._actors.join(), turn: document.getElementById('coop-turn').textContent, guests: Coop.battle && Array.from(Coop.battle.guests.keys()), pending: Coop.battle && Coop.battle.pending.length }));
    throw new Error(what + ': no round ran; chose for ' + seen.join(',') + '; now ' + JSON.stringify(st));
}

const enemy = (p, name) => p.evaluate((name) => {
    const ev = $gameMap.events().find((e) => e.event().name === name && e.page() && e.page().list.some((c) => c.code === 301));
    if (!ev) return null;
    for (const d of [2, 4, 6, 8]) {
        const x = $gameMap.roundXWithDirection(ev.x, d), y = $gameMap.roundYWithDirection(ev.y, d);
        if ($gameMap.isPassable(x, y, 10 - d) && !$gameMap.eventsXyNt(x, y).length) return { id: ev._eventId, x, y };
    }
    return null;
}, name);

(async () => {
    const check = checker();
    const host = await startServer(HOST, { FH_RELAY: null });
    let friendServer, line, browser, a, b;
    const ages = [], keyLag = [];
    try {
        // FH_TEST_TUNNEL=1: the host goes online, privately, the way the Together
        // panel does, and the friend comes in over the internet. Otherwise the
        // friend's breakable line runs straight to the host on this PC.
        let link;
        if (process.env.FH_TEST_TUNNEL === '1') {
            const res = await fetch(`http://localhost:${HOST}/coop/app/online`, { method: 'POST', headers: { 'x-fh-app': '1', 'content-type': 'application/json' }, body: JSON.stringify({ on: true, private: true }) });
            let app = await res.json();
            // As the Together panel does: it follows on until Cloudflare has published the link.
            for (let i = 0; i < 60 && app.mode === 'online' && !app.ready; i++) { await sleep(2000); app = await (await fetch(`http://localhost:${HOST}/coop/app`, { headers: { 'x-fh-app': '1' } })).json(); }
            check('the host is online through a tunnel', /^https:\/\/.+trycloudflare\.com\/\?k=/.test(app.link || ''), JSON.stringify(app).slice(0, 200));
            check('and its link works once it is handed out', !!app.ready, JSON.stringify(app).slice(0, 200));
            link = new URL(app.link);
        } else {
            link = new URL(`http://localhost:${HOST}/`);
        }
        line = await chaosLink(LINE, link.origin);
        const key = link.searchParams.get('k');
        friendServer = await startServer(FRIEND, { FH_JOIN: `${line.url}/` + (key ? '?k=' + key : '') });
        browser = await launch();
        a = await openPlayer(browser, `http://localhost:${HOST}/?name=Ann`, 'host');
        b = await openPlayer(browser, `http://localhost:${FRIEND}/?name=Bo`, 'friend');
        for (const p of [a, b]) {
            await waitFor(p, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected && Coop.peers.size === 1, 120000, 'title + connection');
            await p.evaluate(install);
        }
        check('the friend reaches the host over the internet, with Hide my IP on', await b.evaluate(() => Coop.relayOnly));

        //--- the friend is quicker through the intro; the host's game decides the run
        await b.evaluate(() => T.quickStart(3, 28, 67));
        await waitFor(b, () => T.onMap(), 60000, 'friend on map');
        await b.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(b, () => Coop.world.hostWait === 'Ann', 15000, 'the friend waits for the host');
        await a.evaluate(() => T.quickStart(1, 27, 67));
        await waitFor(a, () => T.onMap(), 60000, 'host on map');
        await a.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(b, () => Coop.world.live, 20000, 'the friend joins the host\'s run');
        check('the friend who was first waited and then joined the host\'s run', await a.evaluate(() => Coop.world.runId) === await b.evaluate(() => Coop.world.runId));
        await waitFor(a, () => Coop.peersHere().some((p) => p.st === 'map'), 15000, 'host sees the friend');

        // What the friend sees and how fast their keys land, all fight long.
        await b.evaluate(() => { Coop.viewer.ages = []; const send = Coop.sendTo; Coop.sendTo = function (id, kind, body) { if (kind === 'bin') body.at = Date.now(); return send.call(this, id, kind, body); }; });
        await a.evaluate(() => { window.KEYLAG = []; Coop.on('to:bin', (m) => { if (m.at) KEYLAG.push(Date.now() - m.at); }); });
        const bagBefore = await b.evaluate(() => ({ items: JSON.stringify($gameParty._items), weapons: JSON.stringify($gameParty._weapons) }));

        //--- a fight with a real enemy; the host touches it, the friend is pulled in
        const guard = await enemy(a, 'guard1');
        check('found the guard', !!guard, JSON.stringify(guard));
        // Near the fight, not on the guard (it would go for whoever stands next to it).
        const near = await b.evaluate((g) => { for (let r = 3; r <= 5; r++) for (let dx = -r; dx <= r; dx++) { const dy = r - Math.abs(dx); for (const y of [g.y + dy, g.y - dy]) { const x = g.x + dx; if ($gameMap.isValid(x, y) && $gameMap.isPassable(x, y, 2) && !$gameMap.eventsXyNt(x, y).length) return { x, y }; } } return null; }, guard);
        await b.evaluate((p) => $gamePlayer.locate(p.x, p.y), near);
        await waitFor(a, (p) => Coop.peersHere().some((q) => q.x === p.x && q.y === p.y && q.st === 'map'), 10000, 'the friend is near the host', near);
        await a.evaluate((g) => { $gamePlayer.locate(g.x, g.y); $gameMap.event(g.id).start(); }, guard);
        await waitFor(a, () => SceneManager._scene instanceof Scene_Battle && Coop.battle && Coop.battle.role === 'owner', 15000, 'the host fights the guard');
        // A guard that lasts and barely hurts: the fight has to outlive every outage below.
        await waitFor(a, () => $gameTroop.members().length > 0, 10000, 'the troop is up');
        await a.evaluate(() => { for (const e of $gameTroop.members()) { e.addParam(0, 20000); e.setHp(e.mhp); e.addParam(2, -e.param(2) + 1); } });
        await waitFor(b, () => SceneManager._scene instanceof Scene_CoopSpectate && Coop.viewer.frames > 5, 20000, 'the friend is pulled in and sees it');
        check('the friend sees the fight through the host as video', await b.evaluate(() => Coop.viewer.clip));

        await playTurn(a, b, 3, 'turn 1');
        // Wi-Fi blips for six seconds on the friend's turn.
        if (!(await nextTurn(a, 'turn 2'))) throw new Error('the fight ended too soon');
        line.stall(true); await sleep(6000); line.stall(false);
        await playTurn(a, b, 3, 'turn 2 after a Wi-Fi blip');
        check('a six-second Wi-Fi blip: the friend plays on in their seat', await b.evaluate(() => SceneManager._scene instanceof Scene_CoopSpectate && !!Coop.battle));
        // The line drops for twelve seconds.
        if (!(await nextTurn(a, 'turn 3'))) throw new Error('the fight ended too soon');
        line.cut(); await sleep(12000); line.restore();
        await waitFor(b, () => Coop.connected && Coop.battle && !Coop.battle.lost, 40000, 'the friend back in the fight after the drop');
        check('a twelve-second drop: the friend gets back into the fight', true);
        await playTurn(a, b, 3, 'turn 3 after a drop');
        // Each minimises the game for eight seconds (a look at Discord): the
        // host's fight goes on meanwhile, and the friend still sees it.
        const minimise = async (p, on) => {
            const cdp = await p.target().createCDPSession();
            const { windowId } = await cdp.send('Browser.getWindowForTarget');
            await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: on ? 'minimized' : 'normal' } });
        };
        if (!(await nextTurn(a, 'turn 4'))) throw new Error('the fight ended too soon');
        await minimise(b, true); await sleep(8000); await minimise(b, false);
        await sleep(1000);
        check('the friend minimises for eight seconds: still in their seat', await b.evaluate(() => SceneManager._scene instanceof Scene_CoopSpectate && !!Coop.battle && !Coop.battle.lost));
        await playTurn(a, b, 3, 'turn 4 after the friend minimised');
        if (!(await nextTurn(a, 'turn 5'))) throw new Error('the fight ended too soon');
        const seen0 = await b.evaluate(() => Coop.viewer.frames);
        await minimise(a, true);
        await a.evaluate(() => { for (const e of $gameTroop.members()) e.startAnimation(1, false, 0); }); // something moving on the host's screen
        await sleep(8000);
        const seenWhileHidden = (await b.evaluate(() => Coop.viewer.frames)) - seen0;
        await minimise(a, false);
        check('the host minimises for eight seconds: the friend still sees the fight', seenWhileHidden > 30, seenWhileHidden + ' pictures in 8 s');
        await playTurn(a, b, 3, 'turn 5 after the host minimised');
        // A long outage: forty seconds, long enough for the host to let go of the line.
        if (await a.evaluate(() => SceneManager._scene instanceof Scene_Battle)) {
            line.stall(true); await sleep(40000); line.stall(false);
            await waitFor(b, () => Coop.connected && Coop.battle && !Coop.battle.lost, 60000, 'the friend back after a long outage');
            check('a forty-second outage: the friend is back in the fight', true);
        }
        const g = await b.evaluate(() => Coop.viewer.ages.slice());
        ages.push(...g);
        keyLag.push(...await a.evaluate(() => KEYLAG.slice()));
        // Finish it: the guard falls.
        await a.evaluate(() => { $gameActors.actor(3).setHp(55); for (const e of $gameTroop.members()) e.addState(e.deathStateId()); const w = SceneManager._scene._actorCommandWindow; if (w) { w.deactivate(); w.close(); } BattleManager.processVictory(); });
        for (const p of [a, b]) {
            for (let i = 0; i < 40 && !(await p.evaluate(() => SceneManager._scene instanceof Scene_Map && !$gameMap.isEventRunning() && !Coop.battle)); i++) {
                if (await p.evaluate(() => $gameMessage.isBusy())) await human(p, 'Enter'); else await sleep(400);
            }
        }
        const home = await b.evaluate(() => ({ scene: SceneManager._scene.constructor.name, battle: !!Coop.battle, hp: $gameActors.actor(3).hp, party: $gameParty._actors.join(), items: JSON.stringify($gameParty._items), weapons: JSON.stringify($gameParty._weapons) }));
        check('afterwards the friend is home, not stuck', home.scene === 'Scene_Map' && !home.battle, JSON.stringify(home));
        check('their knight comes home with the wounds from the fight', home.hp === 55 && home.party === '3', JSON.stringify(home));
        check('and the same bag (nothing used from it in this fight)', home.items === bagBefore.items && home.weapons === bagBefore.weapons, home.items + ' vs ' + bagBefore.items);
        await sleep(2500);
        const state = (p) => p.evaluate((id) => { const e = $gameMap.event(id); return { page: e._pageIndex, x: e.x, y: e.y, held: !!Coop.events.holdOf(id) }; }, guard.id);
        const sa = await state(a), sb = await state(b);
        check('both games agree on the guard afterwards', JSON.stringify(sa) === JSON.stringify(sb) && !sa.held, JSON.stringify(sa) + ' vs ' + JSON.stringify(sb));
        const sw = (p) => p.evaluate(() => Coop.world.live && Array.from({ length: 1000 }, (_, i) => ($gameSwitches.value(i) ? 1 : 0)).join(''));
        const swA = await sw(a), swB = await sw(b);
        const differ = [];
        for (let i = 0; i < 1000; i++) if (swA[i] !== swB[i]) differ.push(i);
        // Only what the world shares has to agree; some switches are each player's own (body, limbs, who they are).
        const shared = await a.evaluate((ids) => ids.filter((id) => Coop.world.isShared('sw', id)), differ);
        check('both games agree on every shared switch', shared.length === 0, 'shared and differing: ' + shared.join(',') + '; private and differing: ' + differ.filter((i) => shared.indexOf(i) < 0).join(','));
        const sorted = ages.slice().sort((x, y) => x - y), q = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : -1);
        const kl = keyLag.slice().sort((x, y) => x - y);
        console.log(`over the internet: ${sorted.length} pictures, age typical ${q(0.5)} ms, p90 ${q(0.9)} ms; key to owner typical ${kl[kl.length >> 1]} ms, worst ${kl[kl.length - 1]} ms`);
        check('pictures through the tunnel are mostly fresh (p90 under a second)', sorted.length > 50 && q(0.9) < 1000, `typical ${q(0.5)} p90 ${q(0.9)}`);
    } catch (e) { console.error(e); check('test ran to the end', false); }
    if (a && b) for (const p of [a, b]) console.log(p.label, JSON.stringify(await p.evaluate(() => ({ scene: SceneManager._scene.constructor.name, frame: Graphics.frameCount, battle: Coop.battle && { role: Coop.battle.role, lost: Coop.battle.lost, askedBack: Coop.battle.askedBack, owner: Coop.battle.owner, ownerName: Coop.battle.ownerName, fight: Coop.battle.fight }, peers: Coop.others().map((p) => p.id + ':' + p.name + ':' + p.st), now: Date.now(), id: Coop.id, live: Coop.world.live, log: Coop.log.slice(-12) })).catch((x) => String(x))));
    const code = check.finish([a, b].filter(Boolean));
    if (browser) await browser.close();
    if (line) line.close();
    if (friendServer) friendServer.kill();
    host.kill();
    process.exit(code);
})();
