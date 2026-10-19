// A line that drops in the middle of a fight, on a lagging link: the guest
// waits in their seat and gets back in, the owner's drop does not throw the
// guest out, the enemy being fought stays put for everyone else while its
// fighter is offline, and a fight begun offline is announced on the way back.
const { twoPlayers, checker, sleep, waitFor } = require('./common');

async function press(page, code) {
    await page.keyboard.down(code); await sleep(130); await page.keyboard.up(code); await sleep(250);
}
// The line goes and stays gone until it is let back.
const cut = (p) => p.evaluate(() => { Coop._realConnect = Coop._realConnect || Coop.connect; Coop.connect = function () {}; Coop._ws.close(); });
const mend = (p) => p.evaluate(() => { Coop.connect = Coop._realConnect; Coop.connect(); });
const inputFor = (p, actorId) => waitFor(p, (id) => BattleManager._phase === 'input' && BattleManager.actor() && BattleManager.actor().actorId() === id, 20000, 'input for actor ' + actorId, actorId);
const turnText = (p) => p.evaluate(() => document.getElementById('coop-turn').textContent);

// Wins it outright and lets the game's own victory script run: an enemy
// left standing next to its fighter attacks again at once.
async function win(p, what) {
    await p.evaluate(() => { for (const e of $gameTroop.members()) e.addState(e.deathStateId()); const w = SceneManager._scene._actorCommandWindow; if (w) { w.deactivate(); w.close(); } BattleManager.processVictory(); });
    await backOnMap(p, what);
}
// An enemy of this map by name, and a free tile next to it.
const enemy = (p, name) => p.evaluate((name) => {
    const ev = $gameMap.events().find((e) => e.event().name === name && e.page() && e.page().list.some((c) => c.code === 301));
    if (!ev) return null;
    for (const d of [2, 4, 6, 8]) {
        const x = $gameMap.roundXWithDirection(ev.x, d), y = $gameMap.roundYWithDirection(ev.y, d);
        if ($gameMap.isPassable(x, y, 10 - d) && !$gameMap.eventsXyNt(x, y).length) return { id: ev._eventId, x, y };
    }
    return null;
}, name);

async function backOnMap(p, what) {
    for (let i = 0; i < 40; i++) {
        if (await p.evaluate(() => SceneManager._scene instanceof Scene_Map && !$gameMap.isEventRunning() && !SceneManager.isSceneChanging())) return;
        if (await p.evaluate(() => $gameMessage.isBusy())) await press(p, 'Enter'); else await sleep(300);
    }
    await waitFor(p, () => SceneManager._scene instanceof Scene_Map, 5000, what);
}

(async () => {
    const check = checker();
    let s;
    try {
        s = await twoPlayers(8494, { env: { FH_LAG: '60' } });
        const { a, b } = s;
        const idA0 = s.idA;
        // Ann (mercenary) brings a bag Bo does not have.
        await a.evaluate(() => $gameParty.gainItem($dataItems[1], 3));
        await b.evaluate(() => $gameParty.loseItem($dataItems[1], 99));

        //--- 1. Bo's fight; Ann is pulled in and watches before the first turn
        await b.evaluate(() => { BattleManager.setup(1, true, true); SceneManager.push(Scene_Battle); });
        await waitFor(b, () => Coop.battle && Coop.battle.pending && Coop.battle.pending.length === 1, 10000, 'Ann asks in');
        const early = await b.evaluate((id) => ({ watching: Coop.stream.watchers.has(id), started: !!Coop.battle.started }), idA0);
        check('a guest asked in before the first turn is sent pictures at once', early.watching && !early.started, JSON.stringify(early));
        await waitFor(a, () => SceneManager._scene instanceof Scene_CoopSpectate && Coop.viewer.frames > 0, 15000, 'Ann sees the fight');
        await inputFor(b, 3);
        await press(b, 'KeyZ'); await press(b, 'KeyZ'); await press(b, 'KeyZ');
        await inputFor(b, 1);

        //--- 2. Ann's line drops on her turn
        await cut(a);
        await waitFor(a, () => Coop.battle && Coop.battle.lost, 5000, 'Ann knows she lost the line');
        await waitFor(b, (id) => Coop.battle.guests.get(id) && Coop.battle.guests.get(id).away, 5000, 'Bo sees Ann gone', idA0);
        await sleep(1500);
        const away = await b.evaluate(() => ({ party: $gameParty._actors.join(), bag: $gameParty.numItems($dataItems[1]), actor: BattleManager.actor() && BattleManager.actor().actorId() }));
        check("Ann's characters stay in the fight while she is away", away.party === '3,1' && away.actor === 1, JSON.stringify(away));
        check("her mercenary still draws on Ann's bag, not Bo's", away.bag === 3, JSON.stringify(away));
        check('Bo is told he may choose for her meanwhile', /^Your turn: choose for Mercenary/.test(await turnText(b)), await turnText(b));
        const seat = await a.evaluate(() => ({ scene: SceneManager._scene.constructor.name, party: $gameParty._actors.join(), battle: !!Coop.battle }));
        check('Ann stays in her seat instead of being put back on the map', seat.scene === 'Scene_CoopSpectate' && seat.battle, JSON.stringify(seat));

        //--- 3. She comes back under a new id and gets back in
        await mend(a);
        await waitFor(a, () => Coop.connected && Coop.battle && !Coop.battle.lost, 15000, 'Ann back in the fight');
        const idA1 = await a.evaluate(() => Coop.id);
        await waitFor(b, (id) => Coop.battle.guests.has(id), 5000, 'Bo has Ann under her new id', idA1);
        check('she is back in under her new id', idA1 !== idA0 && await b.evaluate((o, n) => !Coop.battle.guests.has(o) && Coop.stream.watchers.has(n), idA0, idA1));
        const f0 = await a.evaluate(() => Coop.viewer.frames);
        await sleep(1200);
        check('and sees the fight again', (await a.evaluate(() => Coop.viewer.frames)) > f0);
        await sleep(300);
        check('it is her turn again, not Bo\'s', /^Waiting for Ann to choose for Mercenary/.test(await turnText(b)), await turnText(b));
        await press(a, 'KeyZ'); await press(a, 'KeyZ'); await press(a, 'KeyZ');
        await waitFor(b, () => BattleManager._phase !== 'input', 8000, "Ann's keys choose her move");
        check('her keys choose her move', true);
        await b.evaluate(() => { $gameActors.actor(1).setHp(41); BattleManager.abort(); });
        await backOnMap(a, 'Ann back on the map');
        await backOnMap(b, 'Bo back on the map');
        const home = await a.evaluate(() => ({ hp: $gameActors.actor(1).hp, party: $gameParty._actors.join(), bag: $gameParty.numItems($dataItems[1]), battle: !!Coop.battle }));
        check('she comes home with the wounds and the bag from the fight', home.hp === 41 && home.party === '1' && home.bag === 3 && !home.battle, JSON.stringify(home));
        await sleep(1500);
        check('and nothing older overwrites it later', await a.evaluate(() => $gameActors.actor(1).hp === 41));

        //--- 4. The owner's line drops: the guest waits for him
        await waitFor(b, () => Coop.peersHere().some((p) => p.name === 'Ann' && p.st === 'map'), 5000, 'Bo sees Ann on the map');
        await b.evaluate(() => { BattleManager.setup(1, true, true); SceneManager.push(Scene_Battle); });
        await waitFor(a, () => SceneManager._scene instanceof Scene_CoopSpectate, 10000, 'Ann pulled in again');
        await inputFor(b, 3);
        await cut(b);
        await waitFor(a, () => Coop.battle && Coop.battle.lost, 5000, 'Ann sees Bo gone');
        await sleep(3000);
        check('the owner dropping does not throw the guest out', await a.evaluate(() => SceneManager._scene instanceof Scene_CoopSpectate && !!Coop.battle));
        await mend(b);
        const idB1 = await waitFor(b, () => Coop.connected && Coop.world.live, 15000, 'Bo back').then(() => b.evaluate(() => Coop.id));
        await waitFor(a, (id) => Coop.battle && !Coop.battle.lost && Coop.battle.owner === id, 10000, 'Ann follows Bo to his new id', idB1);
        check('she is back in his fight under his new id', true);
        await b.evaluate(() => { $gameActors.actor(1).setHp(33); BattleManager.abort(); });
        await backOnMap(a, 'Ann home');
        await backOnMap(b, 'Bo home');
        check('and comes home from it as it left her', await a.evaluate(() => $gameActors.actor(1).hp === 33 && !Coop.battle));

        //--- 4b. Back while the fight is being won: what it left her still reaches her
        await waitFor(b, () => Coop.peersHere().some((p) => p.name === 'Ann' && p.st === 'map'), 5000, 'Bo sees Ann back on the map');
        await b.evaluate(() => { BattleManager.setup(1, true, true); SceneManager.push(Scene_Battle); });
        await waitFor(a, () => SceneManager._scene instanceof Scene_CoopSpectate, 10000, 'Ann pulled in once more');
        await inputFor(b, 3);
        await cut(a);
        await waitFor(b, () => Array.from(Coop.battle.guests.values()).some((g) => g.away), 5000, 'Bo sees Ann gone');
        await b.evaluate(() => { $gameActors.actor(1).setHp(27); for (const e of $gameTroop.members()) e.addState(e.deathStateId()); const w = SceneManager._scene._actorCommandWindow; w.deactivate(); w.close(); BattleManager.processVictory(); });
        await mend(a);
        await waitFor(a, () => Coop.connected, 10000, 'Ann reconnects during the victory');
        await backOnMap(b, 'Bo through the victory');
        await waitFor(a, () => SceneManager._scene instanceof Scene_Map && !Coop.battle, 20000, 'Ann home after the win');
        await sleep(1500);
        check('back during the victory, she still gets what the fight left her', await a.evaluate(() => $gameActors.actor(1).hp === 27), String(await a.evaluate(() => $gameActors.actor(1).hp)));

        //--- 5. A real enemy: its fighter's line drops mid-fight
        const spot = await enemy(b, 'guard1');
        check('found the guard', !!spot, JSON.stringify(spot));
        // Ann well out of reach, so she is not pulled in.
        await a.evaluate(() => $gamePlayer.locate(27, 67));
        await b.evaluate((p) => { $gamePlayer.locate(p.x, p.y); $gameMap.event(p.id).start(); }, spot);
        await waitFor(b, () => SceneManager._scene instanceof Scene_Battle && Coop.battle && Coop.battle.role === 'owner', 15000, 'Bo fights the guard');
        const idB2 = idB1;
        await waitFor(a, (id, by) => { const h = Coop.events.holdOf(id); return h && h.k === 'battle' && h.by === by; }, 5000, 'Ann sees the guard held', spot.id, idB2);
        await cut(b);
        await waitFor(a, () => Coop.peers.size === 0, 5000, 'Ann sees Bo gone');
        const at = await a.evaluate((id) => { const e = $gameMap.event(id); return e.x + ',' + e.y; }, spot.id);
        await sleep(3000);
        const held = await a.evaluate((id) => { const h = Coop.events.holdOf(id); const e = $gameMap.event(id); return { held: !!h && h.k === 'battle', at: e.x + ',' + e.y }; }, spot.id);
        check('the guard stays held in his fight while his line is down', held.held && held.at === at, JSON.stringify(held) + ' was ' + at);
        await a.evaluate((id) => $gameMap.event(id).start(), spot.id);
        await sleep(1500);
        check('touching it starts no second fight', await a.evaluate((id) => SceneManager._scene instanceof Scene_Map && !$gameMap.event(id)._starting && !Coop.battle, spot.id));
        await mend(b);
        const idB3 = await waitFor(b, () => Coop.connected && Coop.world.live, 15000, 'Bo back mid-fight').then(() => b.evaluate(() => Coop.id));
        await waitFor(a, (id, by) => { const h = Coop.events.holdOf(id); return h && h.by === by && !h.gone; }, 5000, 'the hold is his again', spot.id, idB3);
        check('back, his fight holds the guard again under his new id', true);
        // Fled, well away from it: the guard lives on for part 7.
        await b.evaluate(() => { $gamePlayer.locate(27, 67); BattleManager.abort(); });
        await backOnMap(b, 'Bo off the guard');
        await waitFor(a, (id) => { const h = Coop.events.holdOf(id); return !h || h.k !== 'battle'; }, 8000, 'the guard is free again', spot.id);
        check('once his fight is over the guard is free again', true);

        //--- 6. A fight begun while the line is down
        const spot2 = await enemy(b, 'guard3');
        check('found another guard', !!spot2, JSON.stringify(spot2));
        await cut(b);
        await waitFor(a, () => Coop.peers.size === 0, 5000, 'Bo gone again');
        await b.evaluate((p) => { $gamePlayer.locate(p.x, p.y); if (!$gameMap.isEventRunning()) $gameMap.event(p.id).start(); }, spot2);
        await waitFor(b, () => SceneManager._scene instanceof Scene_Battle, 15000, 'Bo fights the guard offline');
        check('a fight begun offline is still a shared fight', await b.evaluate(() => !!Coop.battle && Coop.battle.role === 'owner' && !!Coop.battle.eventId));
        await mend(b);
        const idB4 = await waitFor(b, () => Coop.connected && Coop.world.live, 15000, 'Bo back').then(() => b.evaluate(() => Coop.id));
        await waitFor(a, (id, by) => { const h = Coop.events.holdOf(id); return h && h.k === 'battle' && h.by === by; }, 5000, 'Ann hears of it', spot2.id, idB4);
        check('on his way back everyone hears which enemy he is fighting', true);
        // The line goes again and the guard dies while it is down.
        await cut(b);
        await waitFor(a, () => Coop.peers.size === 0, 5000, 'Bo gone once more');
        await win(b, 'Bo wins offline');
        await mend(b);
        await waitFor(b, () => Coop.connected && Coop.world.live, 15000, 'Bo back after');
        await sleep(2500);
        const dead = async (p) => p.evaluate((id) => { const e = $gameMap.event(id); return { page: e._pageIndex, erased: !!e._erased, img: e.characterName(), hold: !!Coop.events.holdOf(id) }; }, spot2.id);
        const da = await dead(a), db = await dead(b);
        check('a guard killed offline is dead for the other player too, and no longer held', JSON.stringify(da) === JSON.stringify(db) && !da.hold, JSON.stringify(da) + ' vs ' + JSON.stringify(db));

        //--- 7. Both fight the same enemy, one of them offline: the offline fight gives way
        const spot3 = await enemy(b, 'guard1');
        check('found a third enemy', !!spot3, JSON.stringify(spot3));
        await cut(b);
        await waitFor(a, () => Coop.peers.size === 0, 5000, 'Bo gone for the last time');
        await b.evaluate((p) => { $gamePlayer.locate(p.x, p.y); if (!$gameMap.isEventRunning()) $gameMap.event(p.id).start(); }, spot3);
        await waitFor(b, () => SceneManager._scene instanceof Scene_Battle && Coop.battle && Coop.battle.offline, 15000, 'Bo fights it offline');
        await a.evaluate((p) => { $gamePlayer.locate(p.x, p.y); if (!$gameMap.isEventRunning()) $gameMap.event(p.id).start(); }, spot3);
        await waitFor(a, () => SceneManager._scene instanceof Scene_Battle && Coop.battle && Coop.battle.role === 'owner', 15000, 'Ann fights the same enemy, knowing nothing of his');
        await mend(b);
        await waitFor(b, () => SceneManager._scene instanceof Scene_Map && !Coop.battle, 20000, 'Bo\'s fight called off');
        check('back, the fight he began offline is called off for the one everyone knew of', await a.evaluate(() => SceneManager._scene instanceof Scene_Battle && !!Coop.battle && Coop.battle.role === 'owner'));
        await backOnMap(b, 'Bo on the map after his fight is called off');
        check('and the enemy stays held in her fight on his screen', await b.evaluate((id) => { const h = Coop.events.holdOf(id); return !!h && h.k === 'battle'; }, spot3.id));
        await win(a, 'Ann wins it');
    } catch (e) { console.error(e); check('test ran to the end', false); }
    if (s) for (const p of [s.a, s.b]) console.log(p.label, JSON.stringify(await p.evaluate(() => ({ scene: SceneManager._scene.constructor.name, battle: Coop.battle && { role: Coop.battle.role, lost: Coop.battle.lost, owner: Coop.battle.owner, guests: Coop.battle.guests ? Array.from(Coop.battle.guests.keys()) : null }, id: Coop.id, me: { st: Coop.reportPresence && SceneManager._scene.constructor.name, x: $gamePlayer.x, y: $gamePlayer.y, live: Coop.world.live, cut: Coop.world.cut }, peers: Coop.others().map((p) => ({ id: p.id, name: p.name, st: p.st, m: p.m, x: p.x, y: p.y })), log: Coop.log.slice(-8) })).catch((x) => String(x))));
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
