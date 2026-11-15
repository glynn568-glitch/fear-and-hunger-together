// Hunt: shared switches and variables that a common event works out from the player's own state
// (items, party, actors, private flags) and that many events call. Shared, one player's answer
// lands in the other's game (the loot dice's needs_white_vial was one).
const fs = require('fs');
const path = require('path');
const { findGame, readGameJson } = require('../find-game');
const DATA = path.join(process.env.FH_GAME || findGame(), 'data');
const census = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'census.json'), 'utf8'));
const sw = new Set(census.sw), va = new Set(census.va);
const ces = readGameJson(path.join(DATA, 'CommonEvents.json'));
const sys = readGameJson(path.join(DATA, 'System.json'));
const callers = {};
const note = (id, who) => (callers[id] = callers[id] || new Set()).add(who);
function lists() {
    const out = [];
    for (const ce of ces) if (ce) out.push(['CE' + ce.id, ce.list]);
    for (const file of fs.readdirSync(DATA).filter((n) => /^Map\d+\.json$/.test(n))) {
        const map = readGameJson(path.join(DATA, file));
        for (const ev of map.events || []) if (ev) ev.pages.forEach((p, i) => out.push([file.slice(0, 6) + ':' + ev.id, p.list]));
    }
    for (const t of readGameJson(path.join(DATA, 'Troops.json'))) if (t) t.pages.forEach((p) => out.push(['T' + t.id, p.list]));
    return out;
}
for (const [who, list] of lists()) for (const c of list) if (c.code === 117) note(c.parameters[0], who.split(':')[0]);
// a branch on the player's own state: item/weapon/armor held (8,9,10), actor (4), gold (7), or a private switch/variable
const LOCAL_BRANCH = (p) => [4, 7, 8, 9, 10].includes(p[0]) || (p[0] === 0 && !sw.has(p[1])) || (p[0] === 1 && !va.has(p[1]));
const rows = [];
for (const ce of ces) {
    if (!ce) continue;
    const n = (callers[ce.id] || new Set()).size;
    if (n < 3 && ce.trigger === 0) continue;
    const stack = [];
    const writes = new Map();
    for (const c of ce.list) {
        while (stack.length && stack[stack.length - 1] >= c.indent) stack.pop();
        if (c.code === 111) stack.push(c.indent);
        const local = c.code === 111 && LOCAL_BRANCH(c.parameters);
        if (local) stack.localDepth = Math.min(stack.localDepth || 99, c.indent);
        if (!stack.length) stack.localDepth = 99;
        const underLocal = stack.length && (stack.localDepth || 99) < c.indent;
        const p = c.parameters;
        if (c.code === 121) for (let id = p[0]; id <= p[1]; id++) if (sw.has(id)) writes.set('sw' + id + ':' + sys.switches[id], (writes.get('sw' + id + ':' + sys.switches[id]) || '') + (underLocal ? 'L' : '.'));
        if (c.code === 122) for (let id = p[0]; id <= p[1]; id++) if (va.has(id)) writes.set('va' + id + ':' + sys.variables[id] + (p[3] === 3 ? '(from game data)' : ''), (writes.get('va' + id + ':' + sys.variables[id] + (p[3] === 3 ? '(from game data)' : '')) || '') + (underLocal ? 'L' : '.'));
    }
    for (const [k, how] of writes) if (how.includes('L') || /from game data/.test(k)) rows.push(`CE${ce.id} ${ce.name} [${ce.trigger ? 'trigger ' + ce.trigger : n + ' callers'}] writes ${k} ${how.includes('L') ? 'under a branch on own state' : ''}`);
}
console.log(rows.join('\n'));
