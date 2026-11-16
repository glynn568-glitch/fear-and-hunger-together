// Which marks only say "this crate, chest, shelf, body or coin is taken" (tools/census.js: ssLoot,
// swLoot). With the host's Instanced loot on, those marks stay on each player's machine, so the
// other player can press the same thing again and find their own. So a mark counts when doing
// that again changes nothing in the shared world:
// - every write of it turns it on, on a page a player starts, and whatever can run in the same
//   press hands something out and leaves the world alone (no other shared write, transfer, fight,
//   party change, game over or moved event). Judged per write, not per page: a corpse's page also
//   offers Devour or Demon seed in their own branches, and a branch that the press cannot reach
//   on the way to the mark does not count (a sibling choice, or a branch that ends the event: MV's
//   Break loop outside a loop runs to the end of the page);
// - whatever it opens is pressed by hand and offers no world change the page it replaces lacked
//   (a page that starts by itself is never loot: the merchant's B starts his farewell);
// - a shared switch is written and read only by map pages a player presses, and every page that
//   reads it is its own container or a plain page that only shows text (base-game chest6_2 on
//   three floors reads chest3_1's switch).
// The loot dice's own bookkeeping (PASSAGES_got: one Passages book a run) is written and read only
// inside common events. It stays shared and does not count against the container.
const WORLDLY_CODES = new Set([201, 203, 129, 301, 353]);
const WORLDLY_SCRIPT = /reserveTransfer|Scene_Gameover|addActor|removeActor|BattleManager|\$gameSwitches|\$gameVariables|\$gameSelfSwitches/;
const BY_HAND_W = /^map:(action|touch|evtouch)$/;
const BY_HAND_R = /^map:(action|touch|evtouch):(page|if)$/;
const OPENERS = new Set([111, 102, 112]);
const ARM_MARKS = { 411: () => 1, 402: (c) => 'c' + c.parameters[0], 403: () => 'cancel', 601: () => 'win', 602: () => 'escape', 603: () => 'lose' };
const CLOSERS = new Set([412, 404, 604, 413]);

// Each command's branch arms, outermost first, as "start:arm", and which arms end the event.
function structure(list) {
    const stack = [];
    const where = new Array(list.length);
    const blocks = {}; // start -> { arms: Set, end, hasElse, loop }
    for (let i = 0; i < list.length; i++) {
        const c = list[i];
        const top = stack[stack.length - 1];
        if (ARM_MARKS[c.code] && top && top.indent === c.indent) {
            top.arm = ARM_MARKS[c.code](c);
            blocks[top.start].arms.add(top.arm);
        } else if (CLOSERS.has(c.code) && top && top.indent === c.indent) {
            blocks[top.start].end = i;
            stack.pop();
        }
        where[i] = stack.map((b) => b.start + ':' + b.arm);
        const battle = c.code === 301 && list[i + 1] && list[i + 1].indent === c.indent && ARM_MARKS[list[i + 1].code];
        if (OPENERS.has(c.code) || battle) {
            const b = { start: i, indent: c.indent, arm: c.code === 111 ? 0 : c.code === 112 ? 'loop' : null };
            blocks[i] = { arms: new Set(b.arm === null ? [] : [b.arm]), end: list.length - 1, loop: c.code === 112, code: c.code };
            stack.push(b);
        }
    }
    const armOf = where.map((w) => new Map(w.map((a) => a.split(':'))));
    const inLoop = (i) => where[i].some((a) => blocks[a.split(':')[0]].loop);
    // An arm ends the event when a command right in it does: Exit, Game over, Break loop with no
    // loop around it, or a branch all of whose arms end it (an If needs its Else for that).
    const ends = new Map();
    const armEnds = (key) => {
        if (ends.has(key)) return ends.get(key);
        ends.set(key, false);
        const [start, arm] = key.split(':');
        const b = blocks[start];
        const depth = list[start].indent + 1;
        let out = false;
        for (let k = Number(start) + 1; k < b.end && !out; k++) {
            const c = list[k];
            if (c.indent !== depth || where[k][where[k].length - 1] !== key) continue;
            if (c.code === 115 || c.code === 353 || (c.code === 113 && !inLoop(k))) out = true;
            else if (blocks[k] && !blocks[k].loop) out = blockEnds(k);
        }
        ends.set(key, out);
        return out;
    };
    const blockEnds = (start) => {
        const b = blocks[start];
        if (b.code === 111 && !b.arms.has(1)) return false;
        return b.arms.size > 0 && [...b.arms].every((a) => armEnds(start + ':' + a));
    };
    // Each jump and where it lands: [jump, label] (-1 when no such label).
    const jumps = [];
    list.forEach((c, k) => { if (c.code === 119) jumps.push([k, list.findIndex((d) => d.code === 118 && d.parameters[0] === c.parameters[0])]); });
    return { where, armOf, blocks, armEnds, jumps };
}

// Can commands i and j of one page both run in one press?
function coRuns(st, i, j) {
    if (inLine(st, i, j)) return true;
    // A jump to a label: what led up to the jump runs with what follows the label (MV's
    // command119 goes to the first label of that name).
    for (const [k, to] of st.jumps) {
        if (to < 0) continue;
        if ((inLine(st, i, k) && j > to && inLine(st, to, j)) || (inLine(st, j, k) && i > to && inLine(st, to, i))) return true;
    }
    return false;
}
function inLine(st, i, j) {
    if (i === j) return true;
    const wi = st.where[i], wj = st.where[j];
    const ai = st.armOf[i], aj = st.armOf[j];
    for (const [s, arm] of ai) if (aj.has(s) && aj.get(s) !== arm) return false;
    // A branch that ends the event: whatever comes after it never runs with what is inside it.
    const [wEarly, wLate] = i < j ? [wi, wj] : [wj, wi];
    for (const a of wEarly) if (!wLate.includes(a) && st.armEnds(a)) return false;
    return true;
}

function make({ ces, census, usage }) {
    const sw = new Set(census.sw), va = new Set(census.va), ssPrivate = new Set(census.ssPrivate);
    // Switches only common events write and read, and never as a page or event trigger.
    const ceTriggers = new Set(ces.filter((c) => c && c.trigger > 0).map((c) => c.switchId));
    const latch = (id) => {
        const u = usage.sw[id];
        if (!u || u.cond || ceTriggers.has(id)) return false;
        const w = Object.keys(u.w), r = Object.keys(u.r);
        return w.length > 0 && w.every((k) => k.startsWith('ce:')) && r.every((k) => /^ce:.*:if$/.test(k)) && Object.keys(u.wVals).every((k) => k === 'on');
    };
    // What a command does, as facts: gives, marks (shared switch or letter turned on), world
    // (anything else shared), each with a short reason. Common events are opened up.
    function facts(c, evKey, acc, seen) {
        const p = c.parameters;
        if ((c.code >= 126 && c.code <= 128 && p[1] === 0) || (c.code === 125 && p[0] === 0)) acc.gives = true;
        else if (c.code === 201 && p[0] === 0 && p[1] === Number(evKey.split(',')[0])) return acc; // a fade on the same map (digging up a chest): only the presser moves
        else if (WORLDLY_CODES.has(c.code)) acc.world.push(String(c.code));
        else if (c.code === 121) {
            for (let id = p[0]; id <= p[1]; id++) {
                if (!sw.has(id)) continue;
                if (p[2] !== 0) acc.world.push('sw' + id + ' off');
                else if (seen.ce && latch(id)) acc.latches.add(id);
                else acc.marks.add('sw' + id);
            }
        } else if (c.code === 122) { for (let id = p[0]; id <= p[1]; id++) if (va.has(id)) acc.world.push('va' + id); }
        else if (c.code === 123) {
            const key = evKey + ',' + p[0];
            if (!ssPrivate.has(key)) { if (p[1] === 0) acc.marks.add('ss' + key); else acc.world.push('self ' + p[0] + ' off'); }
        } else if (c.code === 355 || c.code === 655) {
            if (/gainItem|gainGold/.test(p[0])) acc.gives = true;
            if (WORLDLY_SCRIPT.test(p[0])) acc.world.push('script');
        } else if (c.code === 117 && ces[p[0]] && !seen.has(p[0])) {
            seen.add(p[0]);
            const was = seen.ce;
            seen.ce = true;
            for (const d of ces[p[0]].list) facts(d, evKey, acc, seen);
            seen.ce = was;
        }
        return acc;
    }
    const newAcc = () => ({ gives: false, world: [], marks: new Set(), latches: new Set() });
    // One page command's facts, worked out once: a page command belongs to one event.
    const memo = new Map();
    const one = (c, evKey) => { let f = memo.get(c); if (!f) { f = facts(c, evKey, newAcc(), new Set()); memo.set(c, f); } return f; };
    const merge = (acc, f) => {
        if (f.gives) acc.gives = true;
        for (const x of f.world) acc.world.push(x);
        for (const x of f.marks) acc.marks.add(x);
        for (const x of f.latches) acc.latches.add(x);
        return acc;
    };
    const factsOf = (list, evKey) => { const acc = newAcc(); for (const c of list) merge(acc, one(c, evKey)); return acc; };
    // A page's world changes, compared between the page a mark opens and the ones it replaces.
    const changes = (list, evKey, except) => {
        const out = new Set();
        for (const c of list) {
            const f = one(c, evKey);
            for (const m of f.marks) if (m !== except) out.add(m);
            if (f.world.length) out.add(c.code === 117 ? 'ce' + c.parameters[0] : JSON.stringify([c.code, c.parameters]));
        }
        return out;
    };

    const writes = new Map(); // mark -> [{ at, gives, why, with: marks set in the same press }]
    const needs = new Map(); // mark -> marks the pages it opens set (loot only if those are too)
    const isMark = (x) => /^s[sw]\d/.test(x);
    const marks = new Set();
    const no = new Map(); // mark -> why it is not loot
    const say = (m, why) => { if (!no.has(m)) no.set(m, why); };
    const pages = []; // [mapId, ev, pageIndex, page]
    function addMap(mapId, map) {
        for (const ev of (map && map.events) || []) {
            if (!ev) continue;
            ev.pages.forEach((page, pi) => pages.push([mapId, ev, pi, page]));
        }
    }
    // A search that also turns the enemy's own "dead" switch back off (guard1 on three of the four
    // Entrance layouts, the Night lurches): on the searcher's machine the searched page sits above
    // every page that switch opens, so it changes nothing there, but kept per player the partner
    // would meet the enemy alive again. With Instanced loot on, that one write is skipped (lootSkip);
    // the bed on those floors then no longer wakes you to guard1 after you searched him.
    const conds = (page) => {
        const c = page.conditions, out = [];
        if (c.switch1Valid) out.push('sw' + c.switch1Id);
        if (c.switch2Valid) out.push('sw' + c.switch2Id);
        if (c.selfSwitchValid) out.push('ss?' + c.selfSwitchCh);
        if (c.variableValid || c.itemValid || c.actorValid) out.push('other');
        return out;
    };
    function demotes(ev, evKey, id, m) {
        const mark = m.startsWith('ss') ? 'ss?' + m.slice(-1) : m;
        const top = ev.pages.reduce((k, p, n) => (conds(p).length === 1 && conds(p)[0] === mark ? n : k), -1);
        const low = ev.pages.reduce((k, p, n) => (conds(p).includes('sw' + id) ? n : k), -1);
        const branches = ev.pages.some((p) => p.list.some((d) => d.code === 111 && d.parameters[0] === 0 && d.parameters[1] === id));
        return top > low && low >= 0 && !branches;
    }
    const skips = new Map(); // mark -> [[ 'map,event,page', command index ]]
    function judge() {
        // Every write of every mark, judged by what runs with it.
        for (const [mapId, ev, pi, page] of pages) {
            const evKey = mapId + ',' + ev.id;
            const list = page.list;
            let st = null;
            list.forEach((c, i) => {
                const own = one(c, evKey);
                const here = [...own.marks];
                if (c.code === 123 && c.parameters[1] !== 0) { const k = 'ss' + evKey + ',' + c.parameters[0]; marks.add(k); say(k, `${mapId}:${ev.id}:${pi} turns it off`); }
                if (c.code === 121 && c.parameters[2] !== 0) for (let id = c.parameters[0]; id <= c.parameters[1]; id++) if (sw.has(id)) { marks.add('sw' + id); say('sw' + id, `${mapId}:${ev.id}:${pi} turns it off`); }
                if (!here.length) return;
                st = st || structure(list);
                const co = list.map((d, j) => j !== i && coRuns(st, i, j));
                for (const m of here) {
                    const acc = newAcc();
                    const skip = [];
                    list.forEach((d, j) => {
                        if (!co[j]) return;
                        const p = d.parameters;
                        // Only demotes this event, and always runs with a write of the mark (one
                        // sits in its own branch; no jumps on the page).
                        const paired = () => list.some((x, k) => st.where[k].join() === st.where[j].join() && one(x, evKey).marks.has(m));
                        if (d.code === 121 && p[2] !== 0 && p[0] === p[1] && sw.has(p[0]) && !st.jumps.length && demotes(ev, evKey, p[0], m) && paired()) { skip.push([evKey + ',' + pi, j]); return; }
                        merge(acc, one(d, evKey));
                    });
                    marks.add(m);
                    if (skip.length) skips.set(m, (skips.get(m) || []).concat(skip));
                    const w = { at: `${mapId}:${ev.id}:${pi}`, gives: acc.gives, with: new Set([...acc.marks].filter((x) => x !== m)) };
                    if (c.code === 117) w.why = 'set inside a common event';
                    else if (page.trigger > 2) w.why = 'a page that starts by itself';
                    else if (acc.world.length) w.why = 'with ' + [...new Set(acc.world)].join(', ');
                    if (!writes.has(m)) writes.set(m, []);
                    writes.get(m).push(w);
                    if (w.why) say(m, w.at + ' ' + w.why);
                }
            });
        }
        // What each mark opens: pages conditioned on it, and branches on it.
        const byEvent = new Map();
        for (const row of pages) { const k = row[0] + ',' + row[1].id; if (!byEvent.has(k)) byEvent.set(k, []); byEvent.get(k).push(row); }
        const condOn = (page, evKey, m) => {
            const c = page.conditions;
            if (m.startsWith('ss')) return c.selfSwitchValid && 'ss' + evKey + ',' + c.selfSwitchCh === m;
            const id = Number(m.slice(2));
            return (c.switch1Valid && c.switch1Id === id) || (c.switch2Valid && c.switch2Id === id);
        };
        for (const [evKey, rows] of byEvent) {
            const evMarks = new Set();
            for (const [, , , page] of rows) {
                const c = page.conditions;
                if (c.selfSwitchValid) evMarks.add('ss' + evKey + ',' + c.selfSwitchCh);
                if (c.switch1Valid && sw.has(c.switch1Id)) evMarks.add('sw' + c.switch1Id);
                if (c.switch2Valid && sw.has(c.switch2Id)) evMarks.add('sw' + c.switch2Id);
                for (const d of page.list) {
                    if (d.code !== 111) continue;
                    if (d.parameters[0] === 2) evMarks.add('ss' + evKey + ',' + d.parameters[1]);
                    if (d.parameters[0] === 0 && sw.has(d.parameters[1])) evMarks.add('sw' + d.parameters[1]);
                }
            }
            for (const m of evMarks) {
                if (!writes.has(m)) continue; // never turned on by a page: not a container's mark
                const writer = rows.some(([, , , page]) => page.list.some((d) => one(d, evKey).marks.has(m)));
                // Read by another event that hands nothing out but changes the world itself: a person,
                // whose mood it is (Nosramus stops talking once you open his chest: sw372 stays one
                // Nosramus for both). The chest's lid, its light or its other tile only show it.
                if (!writer && !rows.some(([, , , page]) => factsOf(page.list, evKey).gives) && rows.some(([, , , page]) => changes(page.list, evKey, m).size)) { say(m, `${evKey.replace(',', ':')} reads it, a person rather than a container`); continue; }
                const replaced = new Set();
                for (const [, , , page] of rows) if (!condOn(page, evKey, m)) for (const x of changes(page.list, evKey, m)) replaced.add(x);
                for (const [mapId, ev, pi, page] of rows) {
                    const at = `${mapId}:${ev.id}:${pi}`;
                    const reads = page.list.some((d) => d.code === 111 && ((m.startsWith('ss') && d.parameters[0] === 2 && 'ss' + evKey + ',' + d.parameters[1] === m)
                        || (m.startsWith('sw') && d.parameters[0] === 0 && 'sw' + d.parameters[1] === m)));
                    const opens = condOn(page, evKey, m);
                    if (!reads && !opens) continue;
                    if (page.trigger > 2) { say(m, at + ' starts by itself and reads it'); continue; }
                    if (opens) {
                        const extra = [...changes(page.list, evKey, m)].filter((x) => !replaced.has(x));
                        for (const x of extra.filter(isMark)) { if (!needs.has(m)) needs.set(m, new Set()); needs.get(m).add(x); }
                        const world = extra.filter((x) => !isMark(x));
                        if (world.length) say(m, at + ' opens with a world change the page below lacks: ' + world[0].slice(0, 60));
                        if (!writer && (factsOf(page.list, evKey).gives || extra.length)) say(m, at + ' reads it and is another event that hands things out');
                    }
                    if (reads) {
                        // The part a branch on it opens: no world change in there.
                        const st = structure(page.list);
                        page.list.forEach((d, i) => {
                            if (d.code !== 111) return;
                            const hit = (m.startsWith('ss') && d.parameters[0] === 2 && 'ss' + evKey + ',' + d.parameters[1] === m) || (m.startsWith('sw') && d.parameters[0] === 0 && 'sw' + d.parameters[1] === m);
                            if (!hit) return;
                            const arm = i + ':' + (d.parameters[2] === 0 ? 0 : 1);
                            const acc = newAcc();
                            page.list.forEach((x, k) => { if (k > i && k < st.blocks[i].end && st.where[k].includes(arm)) merge(acc, one(x, evKey)); });
                            const world = acc.world.concat([...acc.marks].filter((x) => x !== m));
                            if (world.length) say(m, at + ' branches on it into ' + world[0]);
                        });
                    }
                }
            }
        }
        // A shared switch: by-hand map pages only, on only.
        for (const m of marks) {
            if (!m.startsWith('sw')) continue;
            const u = usage.sw[Number(m.slice(2))];
            if (!u) { say(m, 'not in the scan'); continue; }
            if (Object.keys(u.wVals).some((k) => k !== 'on')) say(m, 'written as ' + Object.keys(u.wVals).join('/'));
            const w = Object.keys(u.w).find((k) => !BY_HAND_W.test(k));
            if (w) say(m, 'written by ' + w);
            const r = Object.keys(u.r).find((k) => !BY_HAND_R.test(k));
            if (r) say(m, 'read by ' + r);
        }
        // A mark no press hands anything out with is not a container's (drinking the bucket dry
        // still counts, since scooping it is the same mark).
        for (const [m, ws] of writes) if (!ws.some((w) => w.gives)) say(m, ws[0].at + ' nothing handed out with it');
        // Marks set together must both stay home, or neither.
        let changed = true;
        while (changed) {
            changed = false;
            for (const [m, ws] of writes) {
                if (no.has(m)) continue;
                for (const w of ws) {
                    const bad = [...w.with].find((x) => no.has(x) || !writes.has(x));
                    if (bad) { say(m, w.at + ' sets it with ' + bad + ', which is not loot'); changed = true; break; }
                }
                const next = [...(needs.get(m) || [])].find((x) => no.has(x) || !writes.has(x));
                if (!no.has(m) && next) { say(m, 'opens a page that sets ' + next + ', which is not loot'); changed = true; }
            }
        }
        const loot = [...writes.keys()].filter((m) => !no.has(m));
        const lootSkip = {}; // 'map,event,page' -> command indexes skipped with Instanced loot on
        for (const m of loot) for (const [page, j] of skips.get(m) || []) if (!(lootSkip[page] || []).includes(j)) (lootSkip[page] = lootSkip[page] || []).push(j);
        return {
            ssLoot: loot.filter((m) => m.startsWith('ss')).map((m) => m.slice(2)).filter((k) => !ssPrivate.has(k)),
            swLoot: loot.filter((m) => m.startsWith('sw')).map((m) => Number(m.slice(2))),
            lootSkip,
            why: no,
        };
    }
    return { addMap, judge };
}

module.exports = { make, structure, coRuns };
