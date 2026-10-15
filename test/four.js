// Four players, one world: all four protagonists, two of them joining from
// servers of their own as friends on other PCs would. One fight with all four,
// the party limit with a full lobby, and deaths until nobody is left.
const { startServer, launch, openPlayer, waitFor, sleep, shot } = require('./lib');
const install = require('./helpers');
const { checker, canRecruit } = require('./common');

const HOST = 8490;
const PLAYERS = [
    { name: 'Ann', actor: 1, x: 27, y: 67 }, // Cahara, on the host
    { name: 'Bo', actor: 3, x: 28, y: 67 }, // D'arce, on the host
    { name: 'Cy', actor: 4, x: 27, y: 66, join: HOST + 1 }, // Enki, own server
    { name: 'Di', actor: 5, x: 28, y: 66, join: HOST + 2 }, // Ragnvaldr, own server
];

async function press(page, code) {
    await page.keyboard.down(code); await sleep(130); await page.keyboard.up(code); await sleep(220);
}

(async () => {
    const check = checker();
    const servers = [await startServer(HOST)];
    for (const p of PLAYERS) if (p.join) servers.push(await startServer(p.join, { FH_JOIN: `http://localhost:${HOST}/` }));
    const browser = await launch();
    const pages = [];
    try {
        for (const p of PLAYERS) pages.push(await openPlayer(browser, `http://localhost:${p.join || HOST}/?name=${p.name}`, p.name));
        for (const page of pages) {
            await waitFor(page, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 120000, 'title + connection');
            await page.evaluate(install);
        }
        for (let i = 0; i < PLAYERS.length; i++) {
            const p = PLAYERS[i], page = pages[i];
            await page.evaluate((act, x, y) => T.quickStart(act, x, y), p.actor, p.x, p.y);
            await waitFor(page, () => T.onMap(), 60000, p.name + ' on map');
            await page.evaluate(() => T.settle());
            await page.evaluate(() => T.begin());
            await waitFor(page, () => Coop.world.live, 15000, p.name + ' live');
        }
        await sleep(1200);
        const ids = await Promise.all(pages.map((pg) => pg.evaluate(() => Coop.id)));
        const [a, b, c, d] = pages;

        const counts = await Promise.all(pages.map((pg) => pg.evaluate(() => Coop.peersHere().length)));
        check('each of the four sees the other three here', counts.every((n) => n === 3), counts.join(','));
        const seen = await a.evaluate((ids) => ids.map((id) => T.avatar(id)).filter((v) => v && v.drawn).map((v) => v.x + ',' + v.y), ids.slice(1));
        check('the host sees the others drawn where they stand', seen.join(' ') === '28,67 27,66 28,66', seen.join(' '));
        const who = await Promise.all(pages.map((pg) => pg.evaluate(() => $gameParty.leader().actorId())));
        check('four players, four protagonists', who.join(',') === '1,3,4,5', who.join(','));

        await d.evaluate(() => $gameSwitches.setValue(22, true));
        await sleep(700);
        const got = await Promise.all(pages.map((pg) => pg.evaluate(() => $gameSwitches.value(22))));
        check('a world switch from one joiner reaches all four', got.every(Boolean), got.join(','));
        const fps = await Promise.all(pages.map((pg) => pg.evaluate(() => Coop.world.fingerprint())));
        check('shared state identical on all four machines', fps.every((f) => f === fps[0]));

        // A full lobby: four bodies already, so nobody may recruit.
        const rec = await Promise.all(pages.map((pg) => canRecruit(pg)));
        check('with four players nobody may recruit', rec.every((r) => !r.can && r.counted === 1 && !r.stuck), JSON.stringify(rec.map((r) => r.can)));

        // One fight, all four in it.
        await a.evaluate(() => { BattleManager.setup(1, true, true); SceneManager.push(Scene_Battle); });
        for (const pg of [b, c, d]) await waitFor(pg, () => SceneManager._scene instanceof Scene_CoopSpectate, 15000, pg.label + ' pulled into the fight');
        await waitFor(a, () => BattleManager._phase === 'input' && BattleManager.actor(), 30000, 'command input');
        const party = await a.evaluate(() => ({ party: $gameParty._actors.slice().sort(), guests: Coop.battle.guests.size, shown: $gameParty.battleMembers().length }));
        check('all four fight together', party.party.join() === '1,3,4,5' && party.guests === 3 && party.shown === 4, JSON.stringify(party));
        for (const pg of [b, c, d]) await waitFor(pg, () => Coop.viewer.video, 25000, pg.label + ' gets live video');
        check('all three guests watch live video', true);
        const f0 = await Promise.all([b, c, d].map((pg) => pg.evaluate(() => Coop.viewer.frames)));
        await sleep(3000);
        const f1 = await Promise.all([b, c, d].map((pg) => pg.evaluate(() => Coop.viewer.frames)));
        const rates = f1.map((f, i) => Math.round((f - f0[i]) / 3));
        // One machine here runs all four games in software rendering; this is a floor, not a promise.
        check('the owner keeps three guests fed at a watchable rate', rates.every((r) => r >= 10), rates.join(', ') + ' frames a second');
        console.log('screenshot', await shot(d, 'four-guest'), await shot(a, 'four-owner'));

        // Each player picks for their own character, in the order the game asks.
        const byActor = { 1: a, 3: b, 4: c, 5: d };
        const order = [];
        for (let turn = 0; turn < 4; turn++) {
            const actor = await a.evaluate(() => (BattleManager._phase === 'input' && BattleManager.actor() ? BattleManager.actor().actorId() : 0));
            if (!actor) break;
            order.push(actor);
            const pg = byActor[actor];
            await press(pg, 'KeyZ'); await press(pg, 'KeyZ'); await press(pg, 'KeyZ');
            await waitFor(a, (was) => BattleManager._phase !== 'input' || !BattleManager.actor() || BattleManager.actor().actorId() !== was, 10000, 'input moves on from ' + actor, actor);
        }
        check('each player chose for their own character, all four', order.slice().sort().join() === '1,3,4,5', order.join(' > '));
        await waitFor(a, () => BattleManager._phase !== 'input', 10000, 'the round plays');

        await a.evaluate(() => { $gameActors.actor(4).setHp(21); $gameActors.actor(5).setHp(33); BattleManager.abort(); });
        for (const pg of pages) await waitFor(pg, () => SceneManager._scene instanceof Scene_Map && !SceneManager.isSceneChanging(), 20000, pg.label + ' back on the map');
        const after = await Promise.all(pages.map((pg) => pg.evaluate(() => ({ party: $gameParty._actors.join(), hp: $gameParty.leader().hp, battle: !!Coop.battle }))));
        check('everyone comes home with their own character', after.map((x) => x.party).join(' ') === '1 3 4 5' && after.every((x) => !x.battle), JSON.stringify(after));
        check('wounds come home with them', after[2].hp === 21 && after[3].hp === 33, after.map((x) => x.hp).join(','));

        // Deaths: the run lasts while anyone lives.
        for (const pg of [d, c, b]) {
            await pg.evaluate(() => SceneManager.goto(Scene_Gameover));
            await waitFor(pg, () => SceneManager._scene instanceof Scene_CoopDead, 10000, pg.label + ' dead');
        }
        await sleep(800);
        check('three dead, one alive: the run goes on', await a.evaluate(() => SceneManager._scene instanceof Scene_Map && !Coop.dead));
        for (const pg of [b, c, d]) await waitFor(pg, () => Coop.viewer.active && Coop.viewer.frames > 3, 15000, pg.label + ' watching');
        check('the three dead all watch the last one standing', true);
        await a.evaluate(() => { $gameMap._interpreter.clear(); $gameMessage.clear(); SceneManager.goto(Scene_Gameover); });
        for (const pg of pages) await waitFor(pg, () => SceneManager._scene instanceof Scene_Gameover, 15000, pg.label + ' game over');
        check('the last death ends it for all four', true);
    } catch (e) {
        check('ran to the end', false, e.message);
    } finally {
        await browser.close();
        for (const s of servers) s.kill();
    }
    process.exit(check.finish(pages));
})();
