// Hunt: enemies that can be out on one machine and not on the other. An event counts when every page that
// starts something on touch (a fight; with "touch", any scene) and has a picture waits on a condition the census
// keeps per player: a private switch, variable or self switch, an item, a party member. One player's own state
// then brings it out while the partner's copy has no page: unseen there, and, if the partner runs the map,
// never moved (11/13, the Fortress hounds: "invisible wolves started a fight with his AI companion").
// Usage: node tools/hunt/ghosts.js [touch]
const fs = require('fs');
const path = require('path');
const { findGame, readGameJson } = require('../find-game');
const DATA = path.join(process.env.FH_GAME || findGame(), 'data');
const census = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'census.json'), 'utf8'));
const sys = readGameJson(path.join(DATA, 'System.json'));
const infos = readGameJson(path.join(DATA, 'MapInfos.json'));
const ces = readGameJson(path.join(DATA, 'CommonEvents.json'));
const swShared = new Set(census.sw), vaShared = new Set(census.va), ssPrivate = new Set(census.ssPrivate);
const anyScene = process.argv[2] === 'touch';

function fights(list, seen = new Set()) {
    for (const cmd of list) {
        if (cmd.code === 301) return true;
        if (cmd.code === 117 && !seen.has(cmd.parameters[0])) {
            seen.add(cmd.parameters[0]);
            const ce = ces[cmd.parameters[0]];
            if (ce && fights(ce.list, seen)) return true;
        }
    }
    return false;
}

function privateConditions(mapId, ev, page) {
    const k = page.conditions, out = [];
    for (const [on, id] of [[k.switch1Valid, k.switch1Id], [k.switch2Valid, k.switch2Id]]) if (on && !swShared.has(id)) out.push('sw' + id + ':' + sys.switches[id]);
    if (k.variableValid && !vaShared.has(k.variableId)) out.push('va' + k.variableId + ':' + sys.variables[k.variableId]);
    if (k.selfSwitchValid && ssPrivate.has(mapId + ',' + ev.id + ',' + k.selfSwitchCh)) out.push('ss' + k.selfSwitchCh);
    if (k.itemValid) out.push('item' + k.itemId);
    if (k.actorValid) out.push('actor' + k.actorId);
    return out;
}

const byGate = new Map();
for (const file of fs.readdirSync(DATA).filter((f) => /^Map\d+\.json$/.test(f))) {
    const mapId = Number(file.slice(3, 6));
    const map = readGameJson(path.join(DATA, file));
    for (const ev of map.events || []) {
        if (!ev) continue;
        const touching = ev.pages.filter((p) => p.trigger === 2 && p.image.characterName && (anyScene ? p.list.length > 1 : fights(p.list)));
        if (!touching.length || !touching.every((p) => privateConditions(mapId, ev, p).length)) continue;
        const gate = privateConditions(mapId, ev, touching[0]).join(' & ');
        if (!byGate.has(gate)) byGate.set(gate, []);
        byGate.get(gate).push('map ' + mapId + ' ' + ((infos[mapId] || {}).name || '') + ' ev ' + ev.id + ' ' + ev.name);
    }
}
for (const [gate, list] of [...byGate].sort((x, y) => y[1].length - x[1].length)) {
    console.log(gate + '  (' + list.length + ')');
    for (const line of list) console.log('    ' + line);
}
console.log(byGate.size ? byGate.size + ' gate(s)' : 'none');
