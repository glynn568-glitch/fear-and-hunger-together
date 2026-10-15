// Reads every map, common event and troop in the game and records where each
// switch and variable is read and written. Output: data/usage.json.
const fs = require('fs');
const path = require('path');

const GAME = require('./find-game').findGame();
const DATA = path.join(GAME, 'data');
const OUT = path.join(__dirname, '..', 'data');
const load = (name) => JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8'));

const sys = load('System.json');
const usage = { sw: {}, va: {} };
function slot(kind, id) {
    const u = usage[kind];
    if (!u[id]) {
        u[id] = {
            id, name: (kind === 'sw' ? sys.switches : sys.variables)[id] || '',
            w: {}, // writer context -> count
            r: {}, // reader context -> count
            wMaps: {}, rMaps: {}, // map ids touching it (0 = common event, -1 = troop)
            wVals: {}, // what gets written: on/off, or set/add/sub/rand...
            cond: 0, // times used as an event page condition
            pulse: 0, onLists: 0, offLists: 0, // lists writing it both ways / only on / only off
            pulseIn: {},
            ceCond: [], // common events gated on it
        };
    }
    return u[id];
}
function bump(obj, key) { obj[key] = (obj[key] || 0) + 1; }

// ctx: { where: 'map'|'ce'|'troop', mapId, trig } where trig is the page
// trigger: action/touch/evtouch/auto/par for maps, none/auto/par for common
// events, battle for troops.
function write(kind, id, ctx, val) {
    if (!id) return;
    const s = slot(kind, id);
    bump(s.w, ctx.where + ':' + ctx.trig);
    bump(s.wMaps, ctx.mapId);
    bump(s.wVals, val);
}
function read(kind, id, ctx, how) {
    if (!id) return;
    const s = slot(kind, id);
    bump(s.r, ctx.where + ':' + ctx.trig + (how ? ':' + how : ''));
    bump(s.rMaps, ctx.mapId);
}

const VAR_OPS = ['set', 'add', 'sub', 'mul', 'div', 'mod'];
function scanScript(text, ctx) {
    let m;
    const reSwW = /\$gameSwitches\.setValue\(\s*(\d+)\s*,\s*([^)]+)\)/g;
    while ((m = reSwW.exec(text))) write('sw', Number(m[1]), ctx, 'script');
    const reVaW = /\$gameVariables\.setValue\(\s*(\d+)\s*,/g;
    while ((m = reVaW.exec(text))) write('va', Number(m[1]), ctx, 'script');
    const reSwR = /\$gameSwitches\.value\(\s*(\d+)\s*\)/g;
    while ((m = reSwR.exec(text))) read('sw', Number(m[1]), ctx, 'script');
    const reVaR = /\$gameVariables\.value\(\s*(\d+)\s*\)/g;
    while ((m = reVaR.exec(text))) read('va', Number(m[1]), ctx, 'script');
    const reEsc = /\\V\[(\d+)\]/gi;
    while ((m = reEsc.exec(text))) read('va', Number(m[1]), ctx, 'text');
}

const selfSw = {}; // 'map,event,letter' -> 1 on, 2 off, 3 both
const stats = { commands: {}, scripts: [], plugin: {}, gameovers: [], battles: [], transfers: 0 };
function scanList(list, ctx) {
    if (!list) return;
    const dirs = {}; // switch id -> bitmask (1 = on, 2 = off) written by this list
    for (const c of list) {
        if (c.code === 121) for (let id = c.parameters[0]; id <= c.parameters[1]; id++) dirs[id] = (dirs[id] || 0) | (c.parameters[2] === 0 ? 1 : 2);
    }
    for (const id in dirs) {
        const s = slot('sw', Number(id));
        if (dirs[id] === 3) { s.pulse++; bump(s.pulseIn, ctx.where + ':' + ctx.trig); } else if (dirs[id] === 1) s.onLists++; else s.offLists++;
    }
    for (let i = 0; i < list.length; i++) {
        const c = list[i];
        const p = c.parameters;
        bump(stats.commands, c.code);
        switch (c.code) {
        case 121: // control switches
            for (let id = p[0]; id <= p[1]; id++) write('sw', id, ctx, p[2] === 0 ? 'on' : 'off');
            break;
        case 122: { // control variables
            const op = VAR_OPS[p[2]];
            const src = ['const', 'var', 'rand', 'game', 'script'][p[3]];
            for (let id = p[0]; id <= p[1]; id++) write('va', id, ctx, op + ':' + src + (src === 'game' ? ':' + p[4] + '/' + p[5] : ''));
            if (p[3] === 1) read('va', p[4], ctx, 'operand');
            if (p[3] === 4) scanScript(String(p[4]), ctx);
            break;
        }
        case 111: // conditional branch
            if (p[0] === 0) read('sw', p[1], ctx, 'if');
            if (p[0] === 1) { read('va', p[1], ctx, 'if'); if (p[2] !== 0) read('va', p[3], ctx, 'if'); }
            if (p[0] === 12) scanScript(String(p[1]), ctx);
            break;
        case 101: case 401: case 102: case 402: case 105: case 405:
            for (const x of p) if (typeof x === 'string') scanScript(x, ctx);
            if (c.code === 102) for (const x of p[0]) scanScript(String(x), ctx);
            break;
        case 123: // control self switch
            if (ctx.where === 'map') {
                const key = ctx.mapId + ',' + ctx.eventId + ',' + p[0];
                selfSw[key] = (selfSw[key] || 0) | (p[1] === 0 ? 1 : 2);
            } else stats.selfSwElsewhere = (stats.selfSwElsewhere || 0) + 1;
            break;
        case 103: write('va', p[0], ctx, 'input'); break; // input number
        case 104: write('va', p[0], ctx, 'input'); break; // select item
        case 285: write('va', p[0], ctx, 'locinfo'); break; // get location info
        case 201: stats.transfers++; if (p[0] === 1) { read('va', p[1], ctx, 'transfer'); read('va', p[2], ctx, 'transfer'); read('va', p[3], ctx, 'transfer'); } break;
        case 202: case 203: if (p[1] === 1 || p[0] === 1) { read('va', p[2], ctx, 'locate'); read('va', p[3], ctx, 'locate'); } break;
        case 231: if (p[3] === 1) { read('va', p[4], ctx, 'picture'); read('va', p[5], ctx, 'picture'); } break;
        case 232: if (p[3] === 1) { read('va', p[4], ctx, 'picture'); read('va', p[5], ctx, 'picture'); } break;
        case 301: stats.battles.push({ ctx: ctx.label, kind: p[0], troop: p[1], canEscape: p[2], canLose: p[3] }); if (p[0] === 1) read('va', p[1], ctx, 'troop'); break;
        case 353: stats.gameovers.push(ctx.label); break;
        case 355: { // script, continued by 655 lines
            let text = p[0];
            while (list[i + 1] && list[i + 1].code === 655) text += '\n' + list[++i].parameters[0];
            scanScript(text, ctx);
            stats.scripts.push({ ctx: ctx.label, text: text.slice(0, 600) });
            break;
        }
        case 356: bump(stats.plugin, String(p[0]).split(' ').slice(0, 2).join(' ')); scanScript(String(p[0]), ctx); break;
        case 108: case 408: scanScript(String(p[0]), ctx); break;
        default: break;
        }
        // variable-as-operand in assorted commands (gold, items, hp, ...)
        if ([125, 126, 127, 128, 311, 312, 315, 316, 317, 318, 326].includes(c.code)) {
            const pairs = { 125: [1, 2], 126: [2, 3], 127: [2, 3], 128: [2, 3], 311: [3, 4], 312: [3, 4], 315: [3, 4], 316: [4, 5], 317: [4, 5], 318: [-1, -1], 326: [3, 4] }[c.code];
            if (pairs[0] >= 0 && p[pairs[0]] === 1) read('va', p[pairs[1]], ctx, 'operand');
            if ([311, 312, 315, 316, 317, 326].includes(c.code) && p[0] === 1) read('va', p[1], ctx, 'actorvar');
        }
    }
}

const TRIG = ['action', 'touch', 'evtouch', 'auto', 'par'];
const maps = [];
const infos = load('MapInfos.json');
for (const info of infos) {
    if (!info) continue;
    const file = 'Map' + String(info.id).padStart(3, '0') + '.json';
    if (!fs.existsSync(path.join(DATA, file))) continue;
    const map = load(file);
    const summary = { id: info.id, name: info.name, display: map.displayName, w: map.width, h: map.height, events: 0, note: map.note, moving: 0, battle: 0, gameover: 0 };
    for (const ev of map.events) {
        if (!ev) continue;
        summary.events++;
        ev.pages.forEach((page, pi) => {
            const cd = page.conditions;
            const ctx = { where: 'map', mapId: info.id, eventId: ev.id, trig: TRIG[page.trigger], label: `map${info.id}/ev${ev.id}(${ev.name})/p${pi + 1}/${TRIG[page.trigger]}` };
            if (cd.switch1Valid) { read('sw', cd.switch1Id, ctx, 'page'); slot('sw', cd.switch1Id).cond++; }
            if (cd.switch2Valid) { read('sw', cd.switch2Id, ctx, 'page'); slot('sw', cd.switch2Id).cond++; }
            if (cd.variableValid) { read('va', cd.variableId, ctx, 'page'); slot('va', cd.variableId).cond++; }
            if (page.moveType !== 0) summary.moving++;
            scanList(page.list, ctx);
            if (page.list.some((c) => c.code === 301)) summary.battle++;
            if (page.list.some((c) => c.code === 353)) summary.gameover++;
        });
    }
    maps.push(summary);
}

const ces = load('CommonEvents.json');
const CE_TRIG = ['none', 'auto', 'par'];
const ceSummary = [];
for (const ce of ces) {
    if (!ce) continue;
    const ctx = { where: 'ce', mapId: 0, trig: CE_TRIG[ce.trigger], label: `ce${ce.id}(${ce.name})/${CE_TRIG[ce.trigger]}` };
    if (ce.trigger > 0) { read('sw', ce.switchId, ctx, 'gate'); slot('sw', ce.switchId).ceCond.push(ce.id); }
    scanList(ce.list, ctx);
    ceSummary.push({ id: ce.id, name: ce.name, trig: CE_TRIG[ce.trigger], sw: ce.trigger > 0 ? ce.switchId : 0, len: ce.list.length });
}

const troops = load('Troops.json');
for (const troop of troops) {
    if (!troop) continue;
    troop.pages.forEach((page, pi) => {
        const ctx = { where: 'troop', mapId: -1, trig: 'battle', label: `troop${troop.id}(${troop.name})/p${pi + 1}` };
        if (page.conditions.switchValid) { read('sw', page.conditions.switchId, ctx, 'page'); slot('sw', page.conditions.switchId).cond++; }
        scanList(page.list, ctx);
    });
}

// Database entries that fire common events or mention switches in notes.
for (const file of ['Skills', 'Items', 'Weapons', 'Armors', 'States', 'Enemies', 'Actors', 'Classes']) {
    for (const entry of load(file + '.json')) {
        if (!entry) continue;
        const ctx = { where: 'db', mapId: 0, trig: file.toLowerCase(), label: `${file}${entry.id}(${entry.name})` };
        if (entry.note) scanScript(entry.note, ctx);
        if (entry.damage && entry.damage.formula) scanScript(entry.damage.formula, ctx);
    }
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'usage.json'), JSON.stringify({ usage, maps, ceSummary, stats: { commands: stats.commands, plugin: stats.plugin, gameovers: stats.gameovers, battles: stats.battles.length, transfers: stats.transfers } }));
fs.writeFileSync(path.join(OUT, 'selfswitches.json'), JSON.stringify(selfSw));
fs.writeFileSync(path.join(OUT, 'scripts.json'), JSON.stringify(stats.scripts, null, 1));

const swUsed = Object.keys(usage.sw).length, vaUsed = Object.keys(usage.va).length;
console.log(`maps ${maps.length}, common events ${ceSummary.length}, troops ${troops.length - 1}`);
console.log(`switches used ${swUsed}/${sys.switches.length - 1}, variables used ${vaUsed}/${sys.variables.length - 1}`);
console.log(`battle commands ${stats.battles.length}, game over commands ${stats.gameovers.length}, script commands ${stats.scripts.length}, transfers ${stats.transfers}`);
console.log(`self switch keys ${Object.keys(selfSw).length}, written from common events/troops ${stats.selfSwElsewhere || 0}`);
