// A real enemy from the game's own map data: the map owner's machine walks it
// to the OTHER player, it attacks them there, the owner is pulled into the
// fight as a guest, and the kill shows up in both worlds.
const { twoPlayers, checker, sleep, waitFor } = require('./common');
const { shot } = require('./lib');

(async () => {
    const check = checker();
    let s;
    try {
        s = await twoPlayers(8439);
        const { a, b, idA, idB } = s;
        // The first guard of the dungeon, and walkable tiles near it.
        const spot = await a.evaluate(() => {
            const guard = $gameMap.events().find((e) => e.event().name === 'guard1');
            const seen = new Map([[guard.x + ',' + guard.y, 0]]);
            const queue = [[guard.x, guard.y, 0]];
            const at = {};
            while (queue.length) {
                const [x, y, d] = queue.shift();
                if (d >= 6) continue;
                for (const dir of [2, 4, 6, 8]) {
                    if (!$gameMap.isPassable(x, y, dir)) continue;
                    const nx = $gameMap.roundXWithDirection(x, dir), ny = $gameMap.roundYWithDirection(y, dir);
                    const key = nx + ',' + ny;
                    if (seen.has(key) || $gameMap.eventsXyNt(nx, ny).some((e) => e.isNormalPriority())) continue;
                    seen.set(key, d + 1);
                    (at[d + 1] = at[d + 1] || []).push([nx, ny]);
                    queue.push([nx, ny, d + 1]);
                }
            }
            return { id: guard._eventId, x: guard.x, y: guard.y, near: at[3][0], far: at[6][0], page: guard._pageIndex, trig: guard._trigger };
        });
        console.log('guard', JSON.stringify(spot));
        // This run uses the fallback: no direct video, stills through the relay.
        await b.evaluate(() => { Coop.stream.noVideo = true; });
        await b.evaluate((p) => $gamePlayer.locate(p[0], p[1]), spot.near);
        await a.evaluate((p) => $gamePlayer.locate(p[0], p[1]), spot.far);
        await sleep(300);
        check('A simulates the map', await a.evaluate(() => Coop.events.amOwner()) && !(await b.evaluate(() => Coop.events.amOwner())));

        await waitFor(b, () => SceneManager._scene instanceof Scene_Battle, 30000, 'the guard reaches B and attacks');
        check("the guard, walked by A's machine, attacked B on B's machine", await b.evaluate(() => $gameTroop._troopId) === 1);
        await waitFor(a, () => SceneManager._scene instanceof Scene_CoopSpectate, 10000, 'A pulled into the fight');
        await waitFor(b, () => BattleManager._phase === 'input' && Coop.battle.guests.size === 1, 20000, 'B reaches input with A on board');
        check('A joined as a guest with their mercenary', await b.evaluate(() => $gameParty._actors.join()) === '3,1');
        check('everyone else sees the guard as locked in a fight', await a.evaluate((id) => { const h = Coop.events.holdOf(id); return h && h.k === 'battle'; }, spot.id));
        await waitFor(a, () => Coop.viewer.frames > 3, 10000, 'A receives frames');
        const f0 = await a.evaluate(() => Coop.viewer.frames);
        await sleep(2000);
        const rate = ((await a.evaluate(() => Coop.viewer.frames)) - f0) / 2;
        check('without direct video, stills still arrive at a usable rate', !(await a.evaluate(() => Coop.viewer.video)) && rate >= 8, rate + ' a second');
        console.log('screenshot', await shot(a, 'encounter-guest'));

        // Kill the guard outright and let the game's own victory script run.
        await b.evaluate(() => { for (const e of $gameTroop.members()) e.addState(e.deathStateId()); SceneManager._scene._actorCommandWindow.deactivate(); SceneManager._scene._actorCommandWindow.close(); BattleManager.processVictory(); });
        for (let i = 0; i < 40; i++) {
            if (await b.evaluate(() => SceneManager._scene instanceof Scene_Map && !$gameMap.isEventRunning())) break;
            await b.keyboard.down('Enter'); await sleep(100); await b.keyboard.up('Enter'); await sleep(300);
        }
        await waitFor(b, () => SceneManager._scene instanceof Scene_Map, 15000, 'B back on the map');
        await waitFor(a, () => SceneManager._scene instanceof Scene_Map, 15000, 'A back on the map');
        await sleep(1200);
        const after = async (p) => p.evaluate((id) => {
            const e = $gameMap.event(id);
            return { dead: $gameSwitches.value(23), page: e._pageIndex, img: e.characterName(), x: e.x, y: e.y, hold: !!Coop.events.holdOf(id), party: $gameParty._actors.join(), battle: !!Coop.battle };
        }, spot.id);
        const ra = await after(a), rb = await after(b);
        console.log('after', JSON.stringify(ra), JSON.stringify(rb));
        check('the guard is dead in both worlds', ra.dead && rb.dead && ra.page === rb.page);
        check('its corpse lies on the same tile for both', ra.x === rb.x && ra.y === rb.y);
        check('the fight is released and parties are back to normal', !ra.hold && !rb.hold && ra.party === '1' && rb.party === '3' && !ra.battle && !rb.battle);
        const fa = await a.evaluate(() => Coop.world.fingerprint()), fb = await b.evaluate(() => Coop.world.fingerprint());
        check('shared state identical after the fight', fa === fb, fa === fb ? '' : diff(fa, fb));
        console.log('demoted', await a.evaluate(() => Array.from(Coop.world.demoted).join(',')), '|', await b.evaluate(() => Array.from(Coop.world.demoted).join(',')));
        console.log('screenshot', await shot(a, 'encounter-after-a'), await shot(b, 'encounter-after-b'));
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();

function diff(x, y) {
    const sx = new Set(x.split(';')), sy = new Set(y.split(';'));
    return 'only A: ' + [...sx].filter((k) => !sy.has(k)).slice(0, 12).join(' ') + ' | only B: ' + [...sy].filter((k) => !sx.has(k)).slice(0, 12).join(' ');
}
