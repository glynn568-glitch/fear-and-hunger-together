// A way that asks first, and a way that is shut. 11/06 field report: a Cahara partner on a
// circle trip pressed the Blood pit's hole again and again before it found another way.
// The hole is the way down (map 5 -> the Caverns), but it asks Investigate / Jump down /
// Leave, and the trip left that question to the model, which never jumped. Behind it: the
// Caverns landing leads only to a corner of the Mines, where Nosramus stands in the corridor
// to the circle until his scene. The plan by maps saw neither.
//   A: Nosramus gone: down the hole on the first press, on to the Mines circle.
//   A2: again: the first jump left the hole bare (switch 117); the mechanism beside it,
//       which answers only someone facing left, is the way now.
//   B: Nosramus there (11/08, his call: what a player would do): down the hole anyway, up to him,
//      "Wait for the person to walk away" (never "Show yourself": that marks him met for everyone),
//      and on to the Mines circle once he has gone. The model is never asked.
//   C: the long way round, from the Level 2 basement: its locked door (Force the door open: a
//      fight with the door, which never strikes back). A fresh mercenary cannot break it, so it
//      says there is no way; with a Small key it forces once, then spends the key, and on to
//      Level 1's circle. The model is never asked at the door.
const { startServer, launch, openPlayer, waitFor, sleep, shot } = require('./lib');
const { checker } = require('./common');
const install = require('./helpers');
const installBot = require('../tools/bot-page');

const SPENT = [409, 476, 486, 2046, 2445]; // every circle's spent switch
const NOSRAMUS_GONE = [1292, 1293];
const NOSRAMUS_SCENE = [1290, 1291, 1294, 2126]; // his scene under way, and "met him" (2126): off while he is there

(async () => {
    const check = checker();
    const port = 8479;
    const server = await startServer(port);
    const browser = await launch();
    const asked = [];
    let a, bot;
    try {
        a = await openPlayer(browser, `http://localhost:${port}/?name=Ann`, 'Ann');
        bot = await openPlayer(browser, `http://localhost:${port}/?name=Claude`, 'bot');
        let lines = [];
        bot.on('console', (m) => { const t = m.text(); if (t.startsWith('[bot]')) lines.push(t.slice(6)); });
        for (const p of [a, bot]) await waitFor(p, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 90000, 'title + connection');
        await a.evaluate(install);

        // What a model with no notion of the trip says: look into the pit, leave the mechanism alone.
        // Neither is the way, so a trip that left it to the model would not get through by luck.
        await bot.exposeFunction('fhBrainCharacter', () => {});
        await bot.exposeFunction('fhBrain', async (kind, text) => {
            asked.push({ kind, text });
            await sleep(200);
            // At a locked door: Leave, the last answer.
            if (kind === 'choice' && /locked/.test(text)) return { pick: (text.split('Choices:')[1].match(/|/g) || []).length, say: '' };
            if (kind === 'choice') return { pick: /mechanism/.test(text) ? 1 : 0, say: '' };
            return { say: '' };
        });
        await bot.evaluate(installBot, { character: 'mercenary', follow: '' });

        await a.evaluate(() => T.quickStart(3, 27, 67));
        await waitFor(a, () => T.onMap(), 60000, 'Ann on the map');
        await a.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(a, () => Coop.world.live, 10000, 'Ann live');
        await waitFor(bot, () => BOT.status().character === 'mercenary' && SceneManager._scene instanceof Scene_Map && Coop.world.live, 60000, 'the bot joins as the mercenary');
        await bot.evaluate(() => {
            // Every press on the hole's tiles; the partner kept alive and out of fights on the way.
            window.pitPresses = [];
            const start = Game_Event.prototype.start;
            Game_Event.prototype.start = function () {
                if ($gameMap.mapId() === 5 && [16, 17, 18, 21, 101].indexOf(this.eventId()) >= 0) window.pitPresses.push(this.eventId());
                return start.apply(this, arguments);
            };
            setInterval(() => { const m = $gameParty.leader(); if (m) { m.setHp(m.mhp); m.setMp(m.mmp); } }, 500);
            // What it sees, read the way its remark timer can: the moment the next map's data is in and this
            // map's events are still listed (each change of map on these trips).
            window.sightErrors = [];
            const onLoad = DataManager.onLoad;
            DataManager.onLoad = function (object) {
                onLoad.apply(this, arguments);
                if (object === window.$dataMap && $gamePlayer.isTransferring()) { try { BOT.situationText(); } catch (e) { window.sightErrors.push(String(e)); } }
            };
        });

        async function trip(label, gone, limit) {
            const at = { map: 5, x: 43, y: 45, near: [39, 48] };
            // This run's floors: the A layouts everywhere (the hole goes to map 8). No circle spent.
            for (const p of [a, bot]) {
                await p.evaluate((spent, nos, scene, gone, at) => {
                    for (let v = 121; v <= 136; v++) $gameVariables._data[v] = 1;
                    for (const s of spent) $gameSwitches._data[s] = false;
                    for (const s of nos) $gameSwitches._data[s] = gone;
                    if (!gone) for (const s of scene) $gameSwitches._data[s] = false;
                    if (window.BOT) { BOT.mode = 'wait'; BOT.errand = null; BOT.nav.banned.clear(); BOT.noWayUntil = 0; BOT.calledAt = 0; }
                    $gamePlayer.reserveTransfer(at.map, at.x, at.y, 2, 0);
                }, SPENT, NOSRAMUS_GONE, NOSRAMUS_SCENE, gone, at);
            }
            for (const p of [a, bot]) await waitFor(p, (m) => $gameMap.mapId() === m && SceneManager._scene instanceof Scene_Map && !$gamePlayer.isTransferring(), 20000, 'on map ' + at.map, at.map);
            await sleep(1500);
            for (const p of [a, bot]) {
                await p.evaluate(() => {
                    $gameMap._interpreter.clear(); $gameMessage.clear();
                    for (const ev of $gameMap.events()) if (ev.page() && (ev.isTriggerIn([3, 4]) || /lizard|guard|enemy|chaser/i.test(ev.event().name))) ev.erase();
                });
            }
            // Ann a few steps from the hole (or the start), the partner a little further.
            const spots = await bot.evaluate((near) => {
                const open = (x, y) => $gameMap.isValid(x, y) && [2, 4, 6, 8].some((d) => $gameMap.isPassable(x, y, d)) && !$gameMap.eventsXyNt(x, y).length;
                const out = [];
                for (let r = 2; r <= 6 && out.length < 2; r++) {
                    for (let dy = -r; dy <= r && out.length < 2; dy++) for (let dx = -r; dx <= r && out.length < 2; dx++) {
                        if (Math.abs(dx) + Math.abs(dy) === r && open(near[0] + dx, near[1] + dy)) out.push({ x: near[0] + dx, y: near[1] + dy });
                    }
                }
                return out;
            }, at.near);
            if (spots.length < 2) throw new Error('no open tiles by the start: ' + JSON.stringify(spots));
            await a.evaluate((s) => $gamePlayer.locate(s.x, s.y), spots[0]);
            await bot.evaluate((s) => { $gamePlayer.locate(s.x, s.y); BOT.mode = 'follow'; window.pitPresses = []; }, spots[1]);
            await sleep(1000);
            lines = [];
            asked.length = 0;

            await a.evaluate(() => SceneManager.goto(Scene_Gameover));
            await waitFor(a, () => Coop.dead && SceneManager._scene instanceof Scene_CoopDead, 10000, label + ': Ann is dead and watching');
            await waitFor(bot, () => BOT.errand && BOT.errand.plan, 30000, label + ': the partner plans a way to a circle');
            const plan = await bot.evaluate(() => ({ goal: BOT.errand.plan.goal, hops: BOT.errand.plan.hops.map((h) => h.map + ':' + h.ev + '>' + h.to) }));
            console.log(label, 'plan', JSON.stringify(plan));
            return Object.assign({ plan }, await watch(label, limit));
        }

        // Until Ann is back or the limit; fights on the way are broken off (unless fight), a door's never.
        async function watch(label, limit, fight) {
            const t0 = Date.now();
            const maps = new Set();
            for (;;) {
                const st = await bot.evaluate(() => ({ map: $gameMap.mapId(), scene: SceneManager._scene.constructor.name }));
                maps.add(st.map);
                if (await a.evaluate(() => !Coop.dead)) break;
                if (Date.now() - t0 > limit) { console.log(label, 'stopped watching', JSON.stringify(st)); break; }
                if (st.scene === 'Scene_Battle' && !fight) await bot.evaluate(() => { const t = $dataTroops[$gameTroop._troopId]; const door = t && t.members.every((m) => !$dataEnemies[m.enemyId].actions.length); if (!door && BattleManager._phase && BattleManager._phase !== 'battleEnd') BattleManager.abort(); });
                await sleep(1000);
            }
            const secs = Math.round((Date.now() - t0) / 1000);
            console.log('screenshot', await shot(bot, 'pit-' + label));
            const presses = await bot.evaluate(() => window.pitPresses.slice());
            const back = await a.evaluate(() => ({ dead: Coop.dead, map: $gameMap.mapId() }));
            console.log(label, 'presses', JSON.stringify(presses), 'maps', [...maps].join(','), secs + ' s');
            console.log(label, 'partner said:\n  ' + lines.join('\n  '));
            const gaveUp = lines.filter((l) => /did not take me|going round in circles|no way to a working circle|no path from/.test(l));
            return { presses, maps, back, secs, gaveUp, lines: lines.slice(), pitAsked: asked.filter((q) => q.kind === 'choice' && /pit leading to darkness|strange mechanism/.test(q.text)).length, doorAsked: asked.filter((q) => q.kind === 'choice' && /locked/.test(q.text)).length };
        }

        // FH_PIT=A, B or C (or A,B): only those cases, for the twins (each under the twins' 10 minutes).
        const only = (process.env.FH_PIT || '').split(',').filter(Boolean);
        const runs = (k) => !only.length || only.indexOf(k) >= 0;
        if (runs('A')) {
            //--- A: the hole is the way --------------------------------------------------
            const A = await trip('A', true, 150000);
            check('A: with Nosramus gone, the way to a circle is down the hole', A.plan.goal === 11 && /^5:(16|17|18|21)>8$/.test(A.plan.hops[0] || ''), JSON.stringify(A.plan));
            check('A: it jumped down on its first press, and the model was not asked', A.presses.length === 1 && A.maps.has(8) && A.pitAsked === 0, JSON.stringify({ presses: A.presses, maps: [...A.maps], asked: A.pitAsked }));
            check('A: no way given up on the way', A.gaveUp.length === 0, A.gaveUp.join(' | '));
            check('A: it called Ann back', !A.back.dead, JSON.stringify(A.back) + ' in ' + A.secs + ' s');

            //--- A again: once someone has gone down, the hole is bare and the mechanism beside it is the way
            const A2 = await trip('A2', true, 150000);
            check('A2: the second time down is by the mechanism, on the first press', /^5:101>8$/.test(A2.plan.hops[0] || '') && A2.presses.length === 1 && A2.maps.has(8) && A2.pitAsked === 0 && A2.gaveUp.length === 0 && !A2.back.dead, JSON.stringify({ plan: A2.plan, presses: A2.presses, asked: A2.pitAsked, maps: [...A2.maps], gaveUp: A2.gaveUp, back: A2.back, secs: A2.secs }));
        }
        if (runs('B')) {
            //--- B: Nosramus in the corridor: the partner lets him walk away, as a player would -----
            const B = await trip('B', false, 180000);
            const waited = B.lines.filter((l) => /took "Wait for the person to walk away" so they move/.test(l)).length;
            const met = await Promise.all([a, bot].map((p) => p.evaluate(() => ({ met: $gameSwitches.value(2126), gone: $gameSwitches.value(1293) }))));
            check('B: with Nosramus in the corridor, the way is still down the hole, to the Mines circle', B.plan.goal === 11 && /^5:(16|17|18|21|101)>8$/.test(B.plan.hops[0] || ''), JSON.stringify(B.plan));
            check('B: it waits for him to walk away, never shows itself, and the model is not asked', waited === 1 && !B.lines.some((l) => /Show yourself/.test(l)) && !asked.some((q) => q.kind === 'choice' && /kneeling|walk away/.test(q.text)),
                JSON.stringify({ waited, asked: asked.map((q) => q.text.slice(0, 60)), lines: B.lines }));
            check('B: he is gone for everyone and nobody has met him', met.every((m) => m.gone && !m.met), JSON.stringify(met));
            check('B: no way given up on the way, and Ann is back', B.gaveUp.length === 0 && !B.back.dead, JSON.stringify({ gaveUp: B.gaveUp, back: B.back, secs: B.secs }));
        }

        //--- C: the long way round, through the Level 2 basement's locked door ------------
        // Nosramus back in the corridor and Ann dead again (B brought her back). The partner from where
        // the stairs from Level 2 come down (127,15).
        if (runs('C')) await caseC();
        async function caseC() {
        await bot.evaluate(() => { BOT.mode = 'wait'; BOT.errand = null; BOT.nav.banned.clear(); BOT.noWayUntil = Date.now() + 600000; $gamePlayer.reserveTransfer(182, 127, 15, 2, 0); });
        await waitFor(bot, () => $gameMap.mapId() === 182 && SceneManager._scene instanceof Scene_Map && !$gamePlayer.isTransferring(), 20000, 'the partner in the Level 2 basement');
        for (const p of [a, bot]) {
            await p.evaluate((spent, nos) => {
                for (let v = 121; v <= 136; v++) $gameVariables._data[v] = 1;
                for (const s of spent.concat(nos)) $gameSwitches._data[s] = false;
            }, SPENT, NOSRAMUS_GONE.concat(NOSRAMUS_SCENE));
        }
        // Every circle but Level 1's (409) spent: past Nosramus the hole now reaches the Mines' and,
        // further down, the Catacombs' (11/08). Through the world, so the server's copy agrees.
        const ELSEWHERE = SPENT.filter((s) => s !== 409);
        await a.evaluate((sws) => { for (const s of sws) $gameSwitches.setValue(s, true); }, ELSEWHERE);
        await waitFor(bot, (sws) => sws.every((s) => $gameSwitches.value(s)), 5000, 'the other circles spent for the partner too', ELSEWHERE);
        if (!(await a.evaluate(() => Coop.dead))) {
            await a.evaluate(() => SceneManager.goto(Scene_Gameover));
            await waitFor(a, () => Coop.dead && SceneManager._scene instanceof Scene_CoopDead, 10000, 'C: Ann is dead and watching');
        }
        await sleep(1500);
        await bot.evaluate(() => {
            $gameMap._interpreter.clear(); $gameMessage.clear();
            for (const ev of $gameMap.events()) if (ev.page() && ev.isTriggerIn([3, 4])) ev.erase();
            $gamePlayer.locate(127, 16);
            // A maneba (fights whoever touches it) standing still in the one-tile corridor to the door (107,45):
            // the only way on is through it. Not on the door's front tile: its remains there would answer every press.
            const m = $gameMap.event(13);
            m.locate(107, 45);
            m._moveType = 0;
        });
        lines = [];
        asked.length = 0;
        await bot.evaluate(() => { BOT.mode = 'follow'; BOT.noWayUntil = 0; });
        await waitFor(bot, () => BOT.errand && BOT.errand.plan, 30000, 'C: the partner plans a way to a circle');
        const C = Object.assign({ plan: await bot.evaluate(() => ({ goal: BOT.errand.plan.goal, hops: BOT.errand.plan.hops.map((h) => h.map + ':' + h.ev + '>' + h.to) })) }, await watch('C', 180000, true));
        console.log('C plan', JSON.stringify(C.plan));
        const forced = (r) => r.lines.filter((l) => /took "Force the door open" at a locked door/.test(l)).length;
        check('C: its way to Level 1 goes through the basement', C.plan.goal === 1 && C.plan.hops[0] === '182:85>76', JSON.stringify(C.plan));
        check('C: it walks into the maneba standing in the corridor to the door and fights it', await bot.evaluate(() => { const m = $gameMap.event(13); return !m.page() || !m.page().list.some((c) => c.code === 301); }) && C.lines.some((l) => /in a fight of my own/.test(l)), JSON.stringify(C.lines));
        check('C: with nothing but its hands, it forces the locked door, is not strong enough, and says there is no way; the model is never asked', forced(C) >= 1 && C.doorAsked === 0 && C.back.dead && C.lines.some((l) => /no way to a working circle/.test(l)) && !(await bot.evaluate(() => $gameSwitches.value(2842))), JSON.stringify({ forced: forced(C), asked: C.doorAsked, back: C.back, lines: C.lines }));
        // A Small key in its pack, and its "no way" over: the next trip.
        await bot.evaluate(() => { $gameParty.gainItem($dataItems[20], 1); BOT.nav.banned.clear(); BOT.noWayUntil = 0; BOT.door = null; });
        lines = [];
        asked.length = 0;
        const C2 = await watch('C2', 240000, true);
        const keyAt = C2.lines.findIndex((l) => /took "Use Small key" at a locked door/.test(l));
        check('C2: with a Small key, it forces once, then spends the key, and the door opens', keyAt > 0 && forced(C2) >= 1 && C2.lines.findIndex((l) => /Force the door open/.test(l)) < keyAt && C2.doorAsked === 0 && await bot.evaluate(() => $gameSwitches.value(2842) && !$gameParty.hasItem($dataItems[20])), JSON.stringify({ lines: C2.lines, asked: C2.doorAsked }));
        check('C2: on through the door to Level 1\'s circle, and Ann is back', !C2.back.dead && C2.maps.has(76) && C2.maps.has(1), JSON.stringify({ back: C2.back, maps: [...C2.maps], secs: C2.secs }));
        }
        // 11/06: mid-transfer the old map's events met the next map's data: an event id it has not got, a crash.
        const sightErrors = await bot.evaluate(() => window.sightErrors.slice(0, 3));
        check('its look around never breaks between maps', sightErrors.length === 0, sightErrors.join(' | '));
    } catch (e) {
        console.error(e);
        check('test ran to the end', false);
        if (bot) console.log('screenshot', await shot(bot, 'pit-fail'));
    }
    const code = check.finish([a, bot].filter(Boolean));
    await browser.close();
    server.kill();
    process.exit(code);
})();
