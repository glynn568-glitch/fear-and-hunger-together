// Every scene on the end-game maps, with a bystander: A sets the page's flags (or starts it) and plays
// it; B stands on the same map. What counts: A's scene runs without a script error or a hang, and B is
// left as they were: not moved, not holding a tint, a picture, a light or a shut menu from a scene that
// is not theirs. Not in run.js. Report: test/out/latesweep-<port>.json.
//   node test/latesweep.js              all late maps
//   node test/latesweep.js 113 142      those maps
//   FH_PAGES=113.238.4 node test/latesweep.js 113   one page
const fs = require('fs');
const path = require('path');
const { findGame } = require('../tools/find-game');
const { sleep } = require('./common');
const { latePair, onMap, put } = require('./late');

const KNOWN = /physical_attack_animation|VideoFrame was garbage collected/;
const BASE = Number(process.env.FH_BASE) || 8760;
const SOLO = !!process.env.FH_SOLO; // the same pages with one player outside any world: what the game does alone
const PAIRS = 1; // one process per pair: run several with FH_BASE and their own map lists
const LATE = [17, 22, 24, 25, 26, 27, 65, 74, 87, 93, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 129, 131, 133, 134, 135, 136, 137, 138, 139, 140, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 157, 159, 160, 164, 185];
const DATA = path.join(findGame(), 'data');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8').replace(/^﻿/, ''));
const census = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'client', 'census.json'), 'utf8'));
const WS = new Set(census.sw);

// The door spot of every map.
function destinations() {
    const dest = new Map();
    for (const f of fs.readdirSync(DATA)) {
        if (!/^Map\d+\.json$/.test(f)) continue;
        const map = readJson(f);
        for (const ev of (map && map.events) || []) {
            if (!ev) continue;
            for (const page of ev.pages) for (const c of page.list) if (c.code === 201 && c.parameters[0] === 0 && !dest.has(c.parameters[1])) dest.set(c.parameters[1], [c.parameters[2], c.parameters[3]]);
        }
    }
    return dest;
}

// The pages worth playing: scenes that start by themselves on a shared flag, and action or touch pages
// that do something (the same list of commands is played once).
const seenAll = new Set();
function pagesOf(id) {
    const map = readJson('Map' + String(id).padStart(3, '0') + '.json');
    const out = [];
    const seen = seenAll;
    const ask = process.env.FH_PAGES ? process.env.FH_PAGES.split(',') : null;
    for (const ev of map.events) {
        if (!ev) continue;
        ev.pages.forEach((p, i) => {
            if (ask && !ask.includes(`${id}.${ev.id}.${i + 1}`)) return;
            const list = p.list.filter((c) => c.code);
            if (!list.length) return;
            const heavy = list.some((c) => [101, 102, 121, 201, 205, 213, 223, 231, 301, 353, 355, 356, 117, 129, 122, 126, 127, 128].includes(c.code));
            if (!heavy) return;
            const c = p.conditions;
            const sw = [c.switch1Valid && c.switch1Id, c.switch2Valid && c.switch2Id].filter(Boolean);
            const auto = p.trigger === 3 || p.trigger === 4;
            const shared = sw.some((s) => WS.has(s)) || c.selfSwitchValid;
            if (auto && !shared && !sw.length && !c.selfSwitchValid) return; // plays by itself on arrival for anyone: the tour covers it
            const key = JSON.stringify(list.map((x) => [x.code, x.parameters]));
            if (!ask && seen.has(key)) return;
            seen.add(key);
            out.push({ ev: ev.id, page: i + 1, name: ev.name, trigger: p.trigger, sw, self: c.selfSwitchValid ? c.selfSwitchCh : '', va: c.variableValid ? [c.variableId, c.variableValue] : null, item: c.itemValid ? c.itemId : 0, actor: c.actorValid ? c.actorId : 0 });
        });
    }
    return out;
}

function installSweep() {
    window.S = {
        // What a bystander must still be after someone else's scene.
        look() {
            const tone = $gameScreen.tone();
            const pics = ($gameScreen._pictures || []).filter(Boolean).filter((x) => x.opacity() > 0).map((x) => x.name());
            return { map: $gameMap.mapId(), x: $gamePlayer.x, y: $gamePlayer.y, tone: tone.join(','), pics: pics.join(','), menu: $gameSystem.isMenuEnabled(), trans: $gamePlayer.isTransparent(),
                suicide: $gameSwitches.value(202), bow: $gameSwitches.value(410), through: $gamePlayer.isThrough(), followers: $gamePlayer.followers().isVisible(), running: $gameMap._interpreter.isRunning() ? $gameMap._interpreter.eventId() : 0,
                msg: $gameMessage.isBusy(), scene: SceneManager._scene.constructor.name, role: Coop.battle ? Coop.battle.role : '', dead: !!Coop.dead, party: $gameParty._actors.join() };
        },
        // Clean slate between pages: nothing running, nothing on screen.
        reset() {
            const it = $gameMap._interpreter;
            it.clear();
            $gameMessage.clear();
            $gameTemp.clearCommonEvent();
            $gameScreen.clear();
            $gameScreen.startFadeIn(1);
            $gameSystem.enableMenu();
            $gamePlayer.setTransparent(false);
            $gamePlayer.setThrough(false);
            $gameSwitches._data[202] = false;
            $gameSwitches._data[410] = false;
            $gameSwitches._data[52] = false;
            $gamePlayer.followers().show();
            for (const m of $gameParty.members()) { m.recoverAll(); if (m.currentExp() < 200) m.changeExp(300, false); }
            $gameVariables._data[101] = 0; // the Passages' clock on maps 26 and 164
            D.win = true; D.picks = []; D.read = true; D.choices.length = 0;
        },
    };
}

async function playPage(s, mapId, spot, pg) {
    const a = s.a, b = SOLO ? s.a : s.b;
    const row = { map: mapId, ev: pg.ev, page: pg.page, name: pg.name, trigger: pg.trigger, errors: [], notes: [] };
    for (const p of [a, b]) p.errors.length = 0;
    for (const p of [a, b]) await p.evaluate(() => S.reset());
    await sleep(100);
    const before = await b.evaluate(() => S.look());
    // Sets what the page asks for, and starts it if it does not start itself.
    const snap = await a.evaluate((pg) => {
        const set = [];
        const on = (id) => { if (!$gameSwitches.value(id)) { $gameSwitches.setValue(id, true); set.push(['sw', id]); } };
        for (const id of pg.sw) on(id);
        const key = [$gameMap.mapId(), pg.ev, pg.self];
        if (pg.self && !$gameSelfSwitches.value(key)) { $gameSelfSwitches.setValue(key, true); set.push(['ss', key]); }
        if (pg.va) $gameVariables.setValue(pg.va[0], Math.max($gameVariables.value(pg.va[0]), pg.va[1]));
        if (pg.item) $gameParty.gainItem($dataItems[pg.item], 1);
        if (pg.actor && !$gameParty._actors.includes(pg.actor)) $gameParty.addActor(pg.actor);
        $gameMap.requestRefresh();
        const ev = $gameMap.event(pg.ev);
        window.__mark = Object.keys($gameSwitches._data).length;
        return { set, has: !!ev };
    }, pg);
    await sleep(80);
    if (!snap.has) { row.notes.push('no such event here'); return row; }
    if (pg.trigger < 3) {
        await a.evaluate((pg) => {
            const ev = $gameMap.event(pg.ev);
            if (ev.page() && ev._pageIndex + 1 === pg.page) ev.start();
            else {
                // A later page wins by the game's rules; play this one's commands anyway.
                const data = ev.event().pages[pg.page - 1];
                $gameMap._interpreter.setup(data.list, pg.ev);
            }
        }, pg);
    }
    const t0 = Date.now();
    let quiet = 0, sa = null, sb = null;
    while (Date.now() - t0 < 45000) {
        [sa, sb] = await Promise.all([a, b].map((p) => p.evaluate(() => S.look()).catch((e) => ({ gone: e.message }))));
        if (sa.gone || sb.gone) break;
        if (sa.scene === 'Scene_Battle' || sb.scene === 'Scene_CoopSpectate') { await a.evaluate(() => { D.win = true; }); quiet = 0; }
        else if (sa.scene === 'Scene_Map' && !sa.running && !sa.msg && !sb.running) { if (++quiet >= 4) break; } else quiet = 0;
        if (/Gameover|CoopDead|Title/.test(sa.scene) || /Gameover|CoopDead|Title/.test(sb.scene)) break;
        await sleep(200);
    }
    if (sa && sa.gone) { row.errors.push('page gone'); row.restart = true; return row; }
    const hung = sa.running || sa.msg || sa.scene !== 'Scene_Map';
    if (/Gameover|CoopDead|Title/.test(sa.scene) || /Gameover|CoopDead|Title/.test(sb.scene)) { row.notes.push('run ended: ' + sa.scene + '/' + sb.scene); row.restart = true; }
    else if (hung) {
        const info = await a.evaluate(() => { const it = $gameMap._interpreter; return { wait: it._waitMode, count: it._waitCount, idx: it._index, ev: it._eventId, ch: !!it._childInterpreter, msg: $gameMessage.allText().slice(0, 60), mv: $gamePlayer.isMoveRouteForcing(), tr: $gamePlayer.isTransferring() }; });
        row.notes.push('still running after 45 s: ' + JSON.stringify(info));
        row.restart = true; // a scene that never ends here would hang every page after it
    }
    await sleep(200);
    const after = await b.evaluate(() => S.look()).catch(() => null);
    if (after && !row.restart && !SOLO) {
        const diff = [];
        for (const k of Object.keys(before)) if (before[k] !== after[k] && !['followers'].includes(k)) diff.push(k + ': ' + before[k] + ' -> ' + after[k]);
        if (diff.length) row.bystander = diff;
    }
    if (sa.map !== mapId) row.notes.push('A went to map ' + sa.map);
    if (sa.map === 86) row.restart = true; // an ending: the run is over
    for (const p of [a, b]) for (const e of p.errors) if (!KNOWN.test(e)) row.errors.push(p.label + ': ' + e.slice(0, 500));
    const dem = await a.evaluate(() => Array.from(Coop.world.demoted));
    if (dem.length) row.notes.push('demoted ' + dem.join(' '));
    // Back as it was: what this page was given goes again, so the next page plays on its own terms.
    if (!row.restart) {
        await a.evaluate((set) => {
            for (const [k, key] of set) { if (k === 'sw') $gameSwitches.setValue(key, false); else $gameSelfSwitches.setValue(key, false); }
            $gameMap.requestRefresh();
        }, snap.set);
    }
    return row;
}

(async () => {
    const asked = process.argv.slice(2).map(Number).filter(Boolean);
    const queue = (asked.length ? asked : LATE).slice();
    const dest = destinations();
    const report = [];
    const started = Date.now();
    const out = path.join(__dirname, 'out', 'latesweep-' + (SOLO ? 'solo-' : '') + BASE + '.json');
    await Promise.all(Array.from({ length: Math.min(PAIRS, queue.length) }, async (_, n) => {
        const port = BASE + n * 2;
        let s = null;
        const up = async () => {
            s = await latePair(port, { speed: 6, actorA: 1, actorB: 3 });
            for (const p of [s.a, s.b]) await p.evaluate(installSweep);
            if (SOLO) { await s.b.evaluate(() => SceneManager.goto(Scene_Title)); await s.a.evaluate(() => Coop.world.leave()); }
        };
        while (queue.length) {
            const mapId = queue.shift();
            const spot = dest.get(mapId) || [10, 10];
            const pages = pagesOf(mapId);
            console.log(`map ${mapId}: ${pages.length} pages`);
            for (const pg of pages) {
                let row;
                try {
                    if (!s) await up();
                    const here = await s.a.evaluate(() => $gameMap.mapId());
                    const hereB = await s.b.evaluate(() => $gameMap.mapId());
                    if (here !== mapId) { await s.a.evaluate(() => S.reset()); await put(s.a, mapId, spot[0], spot[1]); }
                    if (hereB !== mapId && !SOLO) { await s.b.evaluate(() => S.reset()); await put(s.b, mapId, spot[0] + 1, spot[1]); }
                    row = await playPage(s, mapId, spot, pg);
                } catch (e) {
                    row = { map: mapId, ev: pg.ev, page: pg.page, name: pg.name, errors: ['test: ' + e.message.slice(0, 300)], notes: [], restart: true };
                }
                report.push(row);
                const bad = row.errors.length || row.bystander || row.notes.length;
                if (bad) console.log(`  M${row.map}.E${row.ev}.p${row.page} "${row.name}" ${row.errors.join(' | ')} ${row.notes.join(' | ')} ${row.bystander ? 'BYSTANDER ' + row.bystander.join('; ') : ''}`.slice(0, 700));
                if (row.restart && s) { await s.close().catch(() => {}); s = null; }
            }
            fs.writeFileSync(out, JSON.stringify(report, null, 1));
        }
        if (s) await s.close().catch(() => {});
    }));
    fs.writeFileSync(out, JSON.stringify(report, null, 1));
    const errs = report.filter((r) => r.errors.length), by = report.filter((r) => r.bystander);
    console.log(`${report.length} pages in ${Math.round((Date.now() - started) / 60000)} min. Errors ${errs.length}, bystander changes ${by.length}.`);
    process.exit(errs.length ? 1 : 0);
})();
