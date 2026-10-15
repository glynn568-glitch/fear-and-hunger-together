// The deep tour: two players (one joining from a server of their own) step
// together onto every map a door or stair in the game leads to, and let that
// map's own scripts and cutscenes run. Nobody plays past the first floor in
// the other suites; this is the stand-in for testers who would.
//
// Recorded per map: script errors, a scene that never settles, the two
// machines' shared state drifting apart, and flags the flap detector demoted.
// Deaths and battles the maps throw at the players are noted and undone.
//
//   node test/tour.js              every map
//   node test/tour.js 30 41 77     just those
// Report: test/out/tour.json. Not in run.js: it takes about fifteen minutes.
const fs = require('fs');
const path = require('path');
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const install = require('./helpers');
const { findGame } = require('../tools/find-game');

const HOST = 8500, JOINER = 8501;
const KNOWN = /physical_attack_animation/; // the game's own plugin, broken in the release

// Where a door or stair puts the player on each map: the first direct
// transfer found in the game data that leads there.
function destinations() {
    const data = path.join(findGame(), 'data');
    const infos = JSON.parse(fs.readFileSync(path.join(data, 'MapInfos.json'), 'utf8')).filter(Boolean);
    const dest = new Map();
    for (const m of infos) {
        let map;
        try { map = JSON.parse(fs.readFileSync(path.join(data, 'Map' + String(m.id).padStart(3, '0') + '.json'), 'utf8')); } catch (e) { continue; }
        for (const ev of map.events || []) {
            if (!ev) continue;
            for (const page of ev.pages) for (const c of page.list) {
                if (c.code !== 201 || c.parameters[0] !== 0) continue;
                const to = c.parameters[1];
                if (to !== m.id && !dest.has(to)) dest.set(to, { from: m.id, x: c.parameters[2], y: c.parameters[3] });
            }
        }
    }
    const names = new Map(infos.map((m) => [m.id, m.name]));
    // Doors the game has to maps it does not (client/fixes.js keeps them shut).
    const missing = Array.from(dest.keys()).filter((id) => !names.has(id));
    if (missing.length) console.log('doors to maps the game does not have (kept shut): ' + missing.join(' '));
    return Array.from(dest.entries()).filter(([id]) => names.has(id)).sort((a, b) => a[0] - b[0]).map(([id, d]) => Object.assign({ id, name: names.get(id) || '' }, d));
}

// Keeps a player going through whatever a map throws at them: messages are
// read on, fights end at once, wounds and hunger are healed.
const tick = (page) => page.evaluate(() => {
    const s = SceneManager._scene;
    const out = { scene: s ? s.constructor.name : '', map: $gameMap.mapId(), msg: $gameMessage.isBusy(), choice: $gameMessage.isChoice() };
    if (s instanceof Scene_Battle && BattleManager._phase && !BattleManager.isBattleEnd()) { BattleManager.abort(); out.battle = true; }
    const lead = $gameParty.leader();
    if (lead && s instanceof Scene_Map) {
        if (lead.hp < lead.mhp) lead.setHp(lead.mhp);
        if (lead.currentExp() < 60) lead.changeExp(160, false);
    }
    return out;
});

async function startPair(stamp) {
    const host = await startServer(HOST);
    const joiner = await startServer(JOINER, { FH_JOIN: `http://localhost:${HOST}/` });
    const browser = await launch();
    const a = await openPlayer(browser, `http://localhost:${HOST}/?name=Ann`, 'A');
    const b = await openPlayer(browser, `http://localhost:${JOINER}/?name=Bo`, 'B');
    for (const p of [a, b]) {
        await waitFor(p, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 120000, 'title + connection');
        await p.evaluate(install);
    }
    for (const [p, actor, x] of [[a, 1, 27], [b, 3, 28]]) {
        await p.evaluate((act, x) => T.quickStart(act, x, 67), actor, x);
        await waitFor(p, () => T.onMap(), 60000, 'on map');
        await p.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(p, () => Coop.world.live, 15000, 'live');
    }
    console.log(`pair ${stamp} up`);
    return { host, joiner, browser, a, b, close: async () => { await browser.close().catch(() => {}); host.kill(); joiner.kill(); } };
}

(async () => {
    const only = process.argv.slice(2).map(Number).filter(Boolean);
    const stops = destinations().filter((d) => !only.length || only.includes(d.id));
    console.log(`${stops.length} maps on the tour`);
    const report = [];
    let pair = await startPair(1), restarts = 0;
    const demotedSeen = new Set();
    const started = Date.now();
    for (const stop of stops) {
        const row = { id: stop.id, name: stop.name, at: [stop.x, stop.y], errors: [], notes: [] };
        report.push(row);
        try {
            const { a, b } = pair;
            for (const p of [a, b]) { p.errors.length = 0; }
            // Both go through the "door" at once; B lands beside A when it can.
            for (const [p, dx] of [[a, 0], [b, 1]]) {
                await p.evaluate((m, x, y, dx) => {
                    $gameMap._interpreter.clear(); $gameMessage.clear();
                    if (SceneManager._scene instanceof Scene_Battle) BattleManager.abort();
                    $gamePlayer.reserveTransfer(m, x + dx, y, 2, 0);
                }, stop.id, stop.x, stop.y, dx);
            }
            // A message still open from the last map holds the transfer: read it on.
            for (let t = 0; t < 120; t++) {
                const here = await Promise.all([a, b].map((p) => p.evaluate((m) => ({ ok: $gameMap.mapId() === m && T.onMap() || !(SceneManager._scene instanceof Scene_Map), msg: $gameMessage.isBusy() }), stop.id)));
                if (here.every((h) => h.ok)) break;
                for (const [i, p] of [a, b].entries()) if (here[i].msg) { await p.keyboard.down('KeyZ'); await sleep(60); await p.keyboard.up('KeyZ'); }
                if (t === 119) throw new Error('never arrived on map ' + stop.id);
                await sleep(250);
            }
            // Let the map run: autoruns, parallels, whoever walks up.
            const seen = new Set();
            for (let t = 0; t < 14; t++) {
                for (const p of [a, b]) {
                    const st = await tick(p);
                    if (st.battle) seen.add(p.label + ' pulled into a fight');
                    if (st.scene === 'Scene_CoopDead' || st.scene === 'Scene_Gameover') seen.add(p.label + ' died (' + st.scene + ')');
                    else if (st.scene !== 'Scene_Map' && st.scene !== 'Scene_Battle' && st.scene !== 'Scene_CoopSpectate') seen.add(p.label + ' in ' + st.scene);
                    if (st.map !== stop.id) seen.add(p.label + ' moved on to map ' + st.map);
                    if (st.msg) { await p.keyboard.down('KeyZ'); await sleep(60); await p.keyboard.up('KeyZ'); }
                }
                await sleep(250);
            }
            row.notes.push(...seen);
            const died = Array.from(seen).some((n) => / died /.test(n));
            const states = await Promise.all([a, b].map((p) => p.evaluate(() => ({
                scene: SceneManager._scene.constructor.name, map: $gameMap.mapId(), busy: $gameMap._interpreter.isRunning(),
                demoted: Array.from(Coop.world.demoted),
            })).catch((e) => ({ scene: 'gone: ' + e.message }))));
            row.end = states;
            for (const st of states) for (const k of st.demoted || []) if (!demotedSeen.has(k)) { demotedSeen.add(k); row.notes.push('demoted ' + k); }
            if (!died && states.every((s) => s.scene === 'Scene_Map') && states[0].map === states[1].map) {
                await sleep(600);
                const fa = await a.evaluate(() => Coop.world.fingerprint()), fb = await b.evaluate(() => Coop.world.fingerprint());
                if (fa !== fb) row.errors.push('shared state differs between the two machines');
            }
            for (const p of [a, b]) for (const e of p.errors) if (!KNOWN.test(e)) row.errors.push(p.label + ': ' + e.slice(0, 300));
            if (died || states.some((s) => !/^Scene_(Map|Battle|CoopSpectate)$/.test(s.scene))) {
                row.notes.push('pair restarted');
                restarts++;
                await pair.close();
                pair = await startPair(restarts + 1);
            }
        } catch (e) {
            row.errors.push('tour: ' + e.message);
            // Where each player was stuck, for working out why.
            for (const p of [pair.a, pair.b]) {
                const st = await p.evaluate(() => ({ scene: SceneManager._scene && SceneManager._scene.constructor.name, map: $gameMap.mapId(),
                    transferring: $gamePlayer.isTransferring(), newMap: $gamePlayer._newMapId, active: SceneManager._scene.isActive && SceneManager._scene.isActive(),
                    changing: SceneManager.isSceneChanging(), busy: $gameMap._interpreter.isRunning(), ev: $gameMap._interpreter._eventId,
                    msg: $gameMessage.isBusy(), coopHold: !!(Coop.battle || Coop.dead), log: Coop.log.slice(-4) })).catch((x) => ({ gone: x.message }));
                row.errors.push(p.label + ' state: ' + JSON.stringify(st));
            }
            restarts++;
            await pair.close();
            pair = await startPair(restarts + 1);
        }
        const mark = row.errors.length ? 'ERR ' : 'ok  ';
        console.log(`${mark}${String(stop.id).padStart(3)} ${stop.name.padEnd(22)} ${row.notes.join('; ')}${row.errors.length ? '\n      ' + row.errors.join('\n      ') : ''}`);
    }
    await pair.close();
    fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, 'out', 'tour.json'), JSON.stringify(report, null, 1));
    const bad = report.filter((r) => r.errors.length);
    console.log(`\n${report.length} maps in ${Math.round((Date.now() - started) / 60000)} min, ${restarts} restarts, ${bad.length} with errors: ${bad.map((r) => r.id).join(' ') || 'none'}`);
    process.exit(bad.length ? 1 : 0);
})();
