// Hunt: one-time things a second player can also get while the first one's dialogue is up.
// A page started by hand that does something (gives, recruits, fights, moves, ends) before it
// writes the shared flag that turns the event to its "done" page, with a message, choice or
// wait in between. Prints one line per page, grouped by what is doubled.
const fs = require('fs');
const path = require('path');
const { findGame, readGameJson } = require('../find-game');
const DATA = path.join(process.env.FH_GAME || findGame(), 'data');
const census = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'census.json'), 'utf8'));
const sw = new Set(census.sw), priv = new Set(census.ssPrivate), loot = new Set(census.ssLoot);
const ces = readGameJson(path.join(DATA, 'CommonEvents.json'));
const actors = readGameJson(path.join(DATA, 'Actors.json'));
const items = readGameJson(path.join(DATA, 'Items.json'));
const WINDOW = new Set([101, 102, 103, 104, 230, 301]);
const EFFECT = { 126: 'item', 127: 'weapon', 128: 'armor', 125: 'gold', 129: 'recruit', 301: 'fight', 201: 'transfer', 353: 'gameover', 313: 'state', 311: 'hp' };

function flat(list, seen, out) {
    if (seen.has(list)) return out;
    seen.add(list);
    for (const c of list) {
        out.push(c);
        if (c.code === 117 && ces[c.parameters[0]]) flat(ces[c.parameters[0]].list, seen, out);
    }
    return out;
}
const rows = {};
for (const file of fs.readdirSync(DATA).filter((n) => /^Map\d+\.json$/.test(n))) {
    const map = readGameJson(path.join(DATA, file));
    const mapId = Number(file.slice(3, 6));
    for (const ev of map.events || []) {
        if (!ev) continue;
        const condSw = new Set(), condSs = new Set();
        for (const p of ev.pages) {
            const c = p.conditions;
            if (c.switch1Valid) condSw.add(c.switch1Id);
            if (c.switch2Valid) condSw.add(c.switch2Id);
            if (c.selfSwitchValid) condSs.add(c.selfSwitchCh);
        }
        ev.pages.forEach((page, pi) => {
            if (page.trigger > 2) return;
            const cmds = flat(page.list, new Set(), []);
            let windowAt = -1, doneAt = -1, doneWhat = '';
            const effects = [];
            for (let i = 0; i < cmds.length && doneAt < 0; i++) {
                const c = cmds[i], p = c.parameters;
                if (WINDOW.has(c.code) && windowAt < 0) windowAt = i;
                let done = '';
                if (c.code === 123 && p[1] === 0 && condSs.has(p[0])) {
                    const key = mapId + ',' + ev.id + ',' + p[0];
                    if (!priv.has(key)) done = 'ss' + p[0] + (loot.has(key) ? '(loot)' : '');
                } else if (c.code === 121) {
                    for (let id = p[0]; id <= p[1]; id++) if (sw.has(id) && condSw.has(id)) done = 'sw' + id;
                }
                if (done) { doneAt = i; doneWhat = done; break; }
                const kind = EFFECT[c.code];
                const adds = (c.code >= 125 && c.code <= 128) ? (c.code === 125 ? p[0] === 0 : p[1] === 0) : c.code === 129 ? p[1] === 0 : true;
                if (kind && adds && windowAt >= 0 || (kind && adds && windowAt < 0 && false)) effects.push(kind + (c.code === 129 ? ':' + (actors[p[0]] || {}).name : c.code === 126 ? ':' + (items[p[0]] || {}).name : ''));
                else if (kind && adds) effects.push(kind + (c.code === 129 ? ':' + (actors[p[0]] || {}).name : c.code === 126 ? ':' + (items[p[0]] || {}).name : ''));
            }
            if (doneAt < 0 || windowAt < 0 || windowAt > doneAt || !effects.length) return;
            const kinds = [...new Set(effects.map((e) => e.split(':')[0]))].sort().join('+');
            (rows[kinds] = rows[kinds] || []).push(`${mapId},${ev.id} p${pi} ${ev.name} done=${doneWhat} :: ${[...new Set(effects)].slice(0, 5).join(', ')}`);
        });
    }
}
for (const k of Object.keys(rows).sort((a, b) => rows[b].length - rows[a].length)) {
    console.log(`\n== ${k}: ${rows[k].length}`);
    for (const r of rows[k].slice(0, Number(process.env.N || 6))) console.log('  ' + r);
}
