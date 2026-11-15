// Hunt: containers whose "taken" mark is a world switch instead of a self switch. A switch counts
// when every page that writes it is a by-hand page that gives something and changes nothing else
// shared, and every page or branch that reads it belongs to an event that writes it.
const fs = require('fs');
const path = require('path');
const { findGame, readGameJson } = require('../find-game');
const DATA = path.join(process.env.FH_GAME || findGame(), 'data');
const census = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'census.json'), 'utf8'));
const sw = new Set(census.sw), va = new Set(census.va);
const ces = readGameJson(path.join(DATA, 'CommonEvents.json'));
const sys = readGameJson(path.join(DATA, 'System.json'));
const WORLDLY = new Set([201, 203, 129, 301, 353]);
function scan(list, seen, acc) {
    if (seen.has(list)) return acc;
    seen.add(list);
    for (const c of list) {
        const p = c.parameters;
        if ([126, 127, 128].includes(c.code) && p[1] === 0) acc.gives = true;
        else if (WORLDLY.has(c.code)) acc.other = true;
        else if (c.code === 121) { for (let id = p[0]; id <= p[1]; id++) if (sw.has(id)) { if (p[2] === 0) acc.on.add(id); else acc.other = true; } }
        else if (c.code === 122) { for (let id = p[0]; id <= p[1]; id++) if (va.has(id)) acc.other = true; }
        else if ((c.code === 355 || c.code === 655) && /\$gameSwitches|\$gameVariables|reserveTransfer|addActor/.test(p[0])) acc.other = true;
        else if (c.code === 117 && ces[p[0]]) scan(ces[p[0]].list, seen, acc);
        if (c.code === 111 && p[0] === 0) acc.reads.add(p[1]);
    }
    return acc;
}
const writers = {}, badWriter = new Set(), readersBy = {}, condBy = {};
const scriptReads = new Set();
const allLists = [];
for (const ce of ces) if (ce) allLists.push(['CE' + ce.id, null, ce.list, 4]);
for (const file of fs.readdirSync(DATA).filter((n) => /^Map\d+\.json$/.test(n))) {
    const map = readGameJson(path.join(DATA, file));
    const mapId = Number(file.slice(3, 6));
    for (const ev of map.events || []) {
        if (!ev) continue;
        const evKey = mapId + ',' + ev.id;
        for (const page of ev.pages) {
            const c = page.conditions;
            for (const id of [c.switch1Valid && c.switch1Id, c.switch2Valid && c.switch2Id]) if (id) (condBy[id] = condBy[id] || new Set()).add(evKey);
            allLists.push([evKey + ' ' + ev.name, evKey, page.list, page.trigger]);
        }
    }
}
for (const [label, evKey, list, trigger] of allLists) {
    const acc = scan(list, new Set(), { gives: false, other: false, on: new Set(), reads: new Set() });
    for (const id of acc.reads) (readersBy[id] = readersBy[id] || new Set()).add(evKey || label);
    for (const c of list) if ((c.code === 355 || c.code === 655 || c.code === 356) && /\$gameSwitches\.value\((\d+)\)/.test(c.parameters[0])) scriptReads.add(Number(/\$gameSwitches\.value\((\d+)\)/.exec(c.parameters[0])[1]));
    for (const id of acc.on) {
        (writers[id] = writers[id] || new Set()).add(evKey || label);
        if (!evKey || trigger > 2 || !acc.gives || acc.other) badWriter.add(id);
    }
}
// also writers that turn it off anywhere
const out = [];
for (const id of Object.keys(writers).map(Number)) {
    if (badWriter.has(id) || scriptReads.has(id)) continue;
    const ws = writers[id];
    const readers = new Set([...(condBy[id] || []), ...(readersBy[id] || [])]);
    if ([...readers].some((r) => !ws.has(r))) continue;
    if (![...ws].some((w) => (condBy[id] || new Set()).has(w))) continue; // closes nothing
    out.push(id + ':' + sys.switches[id] + ' <- ' + [...ws].join(' | '));
}
console.log(out.length + ' switches');
console.log(out.slice(0, Number(process.env.N || 40)).join('\n'));
