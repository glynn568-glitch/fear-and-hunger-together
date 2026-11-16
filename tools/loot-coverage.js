// What Instanced loot reaches, per thing handed out. Every page a player starts is walked path by
// path, the way the game runs it (every If both ways, every choice, every battle outcome, Break
// loop and Exit, jumps to labels). For each command that hands something out (an item, weapon,
// armor or gold, itself or through a common event), the walk notes what the same press writes that
// the event's own pages read: its letters, and the shared switches its pages are conditioned or
// branch on. That is what decides whether a partner can press it again and get their own.
//   instanced    every such mark is kept per player with Instanced loot on (client/census.json)
//   own          every such mark is already per player (private letters)
//   fight        an enemy's drop: the give sits in a battle's win arm (shared by design)
//   unmarked     the press writes nothing the event reads (a trade, or repeatable)
//   first-come   some such mark stays shared; listed with the reason tools/lootmarks.js gives
// This walk is written apart from tools/lootmarks.js on purpose: it checks the census, not itself.
//   node tools/loot-coverage.js            counts, first-come grouped by event name and reason
//   node tools/loot-coverage.js --list     every first-come give as map:event:page@command name
//   node tools/loot-coverage.js --every    every give, with its bucket and marks
const fs = require('fs');
const path = require('path');
const { findGame, readGameJson } = require('./find-game');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(process.env.FH_GAME || findGame(), 'data');
const census = JSON.parse(fs.readFileSync(path.join(ROOT, 'client', 'census.json'), 'utf8'));
const ssLoot = new Set(census.ssLoot), swLoot = new Set(census.swLoot), shared = new Set(census.sw), priv = new Set(census.ssPrivate), sharedVa = new Set(census.va);
const ce = readGameJson(path.join(DATA, 'CommonEvents.json'));

// What one command does, with common events opened up: gives, letters and switches written.
function effects(c, out, seen) {
    const p = c.parameters;
    if ((c.code >= 126 && c.code <= 128 && p[1] === 0) || (c.code === 125 && p[0] === 0)) out.gives = true;
    else if ((c.code === 355 || c.code === 655) && /gainItem|gainGold/.test(p[0])) out.gives = true;
    else if (c.code === 123) out.ss.push(p[0]);
    else if (c.code === 121) for (let id = p[0]; id <= p[1]; id++) out.sw.push(id);
    else if (c.code === 122) for (let id = p[0]; id <= p[1]; id++) out.va.push(id);
    // The Game Over event's own give (dried meat when Not this time sends you back) is no find:
    // every room change can call it.
    else if (c.code === 117 && ce[p[0]] && !seen.has(p[0]) && ce[p[0]].name !== 'GameOver') { seen.add(p[0]); for (const d of ce[p[0]].list) effects(d, out, seen); }
    return out;
}
const effectsOf = (c) => effects(c, { gives: false, ss: [], sw: [], va: [] }, new Set());

// Where each command of a page can go next, as the game runs it: an If either way, each choice,
// each battle outcome, the end of an arm past its siblings, a loop back round, Break loop out of
// its loop (with none around it, to the end of the page: MV's command113), Exit and Game over to
// the end, a jump to its label.
const END = -1;
function graph(list) {
    const next = (i, codes, indent) => { for (let k = i + 1; k < list.length; k++) if (list[k].indent === indent && codes.includes(list[k].code)) return k; return list.length - 1; };
    const labels = {};
    list.forEach((c, i) => { if (c.code === 118 && !(c.parameters[0] in labels)) labels[c.parameters[0]] = i; });
    const loops = []; // open loops while reading forward: [start]
    const loopOf = new Array(list.length).fill(-1);
    list.forEach((c, i) => {
        while (loops.length && list[loops[loops.length - 1]].indent >= c.indent && !(c.code === 413 && list[loops[loops.length - 1]].indent === c.indent)) loops.pop();
        loopOf[i] = loops.length ? loops[loops.length - 1] : -1;
        if (c.code === 112) loops.push(i);
        if (c.code === 413 && loops.length) loops.pop();
    });
    const to = list.map((c, i) => {
        const d = c.indent;
        if (i === list.length - 1 || (c.code === 0 && d === 0)) return [END];
        switch (c.code) {
            case 111: { const els = next(i, [411, 412], d); return [i + 1, els + 1]; }
            case 411: return [next(i, [412], d) + 1];
            case 102: { const end = next(i, [404], d); const arms = []; for (let k = i + 1; k < end; k++) if (list[k].indent === d && (list[k].code === 402 || list[k].code === 403)) arms.push(k + 1); return arms.length ? arms : [end + 1]; }
            case 402: case 403: return [next(i, [404], d) + 1];
            case 601: case 602: case 603: return [next(i, [604], d) + 1];
            case 413: return [loopOf[i] >= 0 ? loopOf[i] + 1 : i + 1];
            case 113: { let lp = loopOf[i]; return [lp >= 0 ? next(lp, [413], list[lp].indent) + 1 : END]; }
            case 115: case 353: return [END];
            case 119: return [c.parameters[0] in labels ? labels[c.parameters[0]] : END];
            case 301: {
                if (!list[i + 1] || list[i + 1].indent !== d || ![601, 602, 603].includes(list[i + 1].code)) return [i + 1];
                const end = next(i, [604], d); const arms = [];
                for (let k = i + 1; k < end; k++) if (list[k].indent === d && [601, 602, 603].includes(list[k].code)) arms.push(k + 1);
                return arms;
            }
            default: return [i + 1];
        }
    }).map((xs) => xs.map((x) => (x >= list.length ? END : x)));
    return to;
}
function reach(from, edges) {
    const seen = new Set(from);
    const todo = [...from];
    while (todo.length) for (const k of edges[todo.pop()] || []) if (k !== END && !seen.has(k)) { seen.add(k); todo.push(k); }
    return seen;
}
// Whether command i sits, at any depth, in the win arm of a battle.
function inWinArm(list, i) {
    for (let k = i - 1, ind = list[i].indent; k >= 0 && ind > 0; k--) {
        if (list[k].indent >= ind) continue;
        if (list[k].code === 601) return true;
        ind = list[k].indent;
    }
    return false;
}
const n = { instanced: 0, own: 0, fight: 0, unmarked: 0, firstCome: 0 };
let selfStarting = 0; // autorun and parallel pages that hand something out: no player presses them
const firstCome = []; // { where, name, marks: [] }
const every = [];
const fightPagesBefore = new Set(), fightPagesHandOutside = new Set();
for (const file of fs.readdirSync(DATA)) {
    if (!/^Map\d+\.json$/.test(file)) continue;
    const map = readGameJson(path.join(DATA, file));
    const mapId = Number(file.slice(3, 6));
    for (const ev of (map && map.events) || []) {
        if (!ev) continue;
        const evKey = mapId + ',' + ev.id;
        // What the event's pages read: their conditions and their branches.
        const readsSs = new Set(), readsSw = new Set(), readsVa = new Set();
        for (const page of ev.pages) {
            const c = page.conditions;
            if (c.selfSwitchValid) readsSs.add(c.selfSwitchCh);
            if (c.switch1Valid) readsSw.add(c.switch1Id);
            if (c.switch2Valid) readsSw.add(c.switch2Id);
            if (c.variableValid) readsVa.add(c.variableId);
            for (const d of page.list) if (d.code === 111 && d.parameters[0] === 2) readsSs.add(d.parameters[1]); else if (d.code === 111 && d.parameters[0] === 0) readsSw.add(d.parameters[1]); else if (d.code === 111 && d.parameters[0] === 1) readsVa.add(d.parameters[1]);
        }
        ev.pages.forEach((page, pi) => {
            if (page.trigger > 2) {
                if (page.list.some((c) => effectsOf(c).gives)) selfStarting++;
                return;
            }
            const list = page.list;
            // With Instanced loot on the client skips these writes (census lootSkip).
            const skipped = new Set(census.lootSkip[evKey + ',' + pi] || []);
            const eff = list.map((c, k) => (skipped.has(k) ? effectsOf({ code: -1, parameters: [] }) : effectsOf(c)));
            if (!eff.some((e) => e.gives)) return;
            // For each give: the commands on some run through it (what leads to it, what follows it).
            const fwd = graph(list);
            const back = list.map(() => []);
            fwd.forEach((xs, i) => { for (const k of xs) if (k !== END) back[k].push(i); });
            const live = reach([0], fwd);
            const sites = new Map(); // give command index -> { fight, marks: Set }
            for (let g = 0; g < list.length; g++) {
                if (!eff[g].gives || !live.has(g)) continue;
                const before = reach([g], back), after = reach([g], fwd);
                const s = { fight: inWinArm(list, g), marks: new Set() };
                for (const k of new Set([...before, ...after])) {
                    if (!live.has(k)) continue;
                    for (const ch of eff[k].ss) if (readsSs.has(ch)) s.marks.add('ss' + evKey + ',' + ch);
                    for (const id of eff[k].sw) if (readsSw.has(id)) s.marks.add('sw' + id);
                    for (const id of eff[k].va) if (readsVa.has(id) && sharedVa.has(id)) s.marks.add('va' + id);
                }
                sites.set(g, s);
            }
            if (list.some((c) => c.code === 301)) {
                fightPagesBefore.add(evKey + ',' + pi);
                if ([...sites.values()].some((s) => !s.fight)) fightPagesHandOutside.add(evKey + ',' + pi);
            }
            for (const [k, s] of sites) {
                const kind = (m) => (m.startsWith('va') ? 'shared' : m.startsWith('ss') ? (priv.has(m.slice(2)) ? 'own' : ssLoot.has(m.slice(2)) ? 'instanced' : 'shared') : (!shared.has(Number(m.slice(2))) ? 'own' : swLoot.has(Number(m.slice(2))) ? 'instanced' : 'shared'));
                const kinds = [...s.marks].map(kind);
                let bucket;
                if (s.fight) bucket = 'fight';
                else if (!kinds.length) bucket = 'unmarked';
                else if (kinds.includes('shared')) bucket = 'firstCome';
                else if (kinds.includes('instanced')) bucket = 'instanced';
                else bucket = 'own';
                n[bucket]++;
                every.push([`${mapId}:${ev.id}:${pi}@${k}`, ev.name, bucket, [...s.marks].join(' ')].join('\t'));
                if (bucket === 'firstCome') firstCome.push({ where: `${mapId}:${ev.id}:${pi}@${k}`, name: ev.name, marks: [...s.marks].filter((m) => kind(m) === 'shared') });
            }
        });
    }
}

console.log(`gives: instanced ${n.instanced}, always each their own ${n.own}, a fight ${n.fight}, unmarked ${n.unmarked}, first-come ${n.firstCome}`);
console.log(`pages with a fight: ${fightPagesBefore.size}; of those, handing out outside the fight: ${fightPagesHandOutside.size} (judged by their marks above)`);
console.log(`not walked: ${selfStarting} autorun and parallel pages that hand something out (no player presses them)`);
if (process.argv.includes('--every')) { console.log(every.join('\n')); process.exit(0); }
if (process.argv.includes('--list')) { console.log(firstCome.map((f) => [f.where, f.name, f.marks.join(' ')].join('\t')).join('\n')); process.exit(0); }
// Why each shared mark is shared, from the census's own judge.
const { usage } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'usage.json'), 'utf8'));
const judge = require('./lootmarks').make({ ces: ce, census, usage });
for (const file of fs.readdirSync(DATA)) if (/^Map\d+\.json$/.test(file)) judge.addMap(Number(file.slice(3, 6)), readGameJson(path.join(DATA, file)));
const why = judge.judge().why;
const groups = new Map();
for (const f of firstCome) {
    const name = f.name.replace(/\d+$/, '').replace(/_+$/, '') || '(no name)';
    for (const m of f.marks) {
        const reason = (why.get(m) || 'never written by a page a player starts').replace(/^\d+:\d+:\d+ /, '');
        const k = name + ' | ' + reason.replace(/sw\d+|ss[\d,]+[A-D]/g, (x) => x.replace(/\d+/g, '#')).replace(/\d+/g, '#');
        if (!groups.has(k)) groups.set(k, { n: 0, eg: f.where + ' ' + m + ': ' + (why.get(m) || 'never written') });
        groups.get(k).n++;
    }
}
for (const [k, g] of [...groups].sort((a, b) => b[1].n - a[1].n)) console.log(String(g.n).padStart(5) + '  ' + k + '\n         e.g. ' + g.eg);
