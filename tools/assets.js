// Lists every image and sound the game's data refers to that is not on disk.
// A missing file stops an RPG Maker MV game with a "Failed to load" screen.
const fs = require('fs');
const path = require('path');

const { findGame, readGameJson } = require('./find-game');
const GAME = findGame();
const DATA = path.join(GAME, 'data');
const load = (name) => readGameJson(path.join(DATA, name));

const listing = {};
function has(folder, name, exts) {
    if (!listing[folder]) {
        try { listing[folder] = new Set(fs.readdirSync(path.join(GAME, folder)).map((f) => f.toLowerCase())); } catch (e) { listing[folder] = new Set(); }
    }
    return exts.some((ext) => listing[folder].has((name + ext).toLowerCase()));
}

const missing = new Map(); // 'folder/name' -> first place it is used
function need(folder, name, where, exts) {
    if (!name) return;
    if (has(folder, name, exts)) return;
    const key = folder + '/' + name;
    if (!missing.has(key)) missing.set(key, { where, count: 0 });
    missing.get(key).count++;
}
const img = (folder, name, where) => need('img/' + folder, name, where, ['.png', '.rpgmvp']);
const snd = (folder, audio, where) => need('audio/' + folder, audio && audio.name, where, ['.ogg', '.rpgmvo']);

function scanList(list, where) {
    if (!list) return;
    for (const c of list) {
        const p = c.parameters;
        switch (c.code) {
        case 101: img('faces', p[0], where); break;
        case 231: img('pictures', p[1], where); break;
        case 241: snd('bgm', p[0], where); break;
        case 245: snd('bgs', p[0], where); break;
        case 249: snd('me', p[0], where); break;
        case 250: snd('se', p[0], where); break;
        case 132: snd('bgm', p[0], where); break;
        case 133: snd('me', p[0], where); break;
        case 139: snd('me', p[0], where); break;
        case 140: snd('bgm', p[1], where); break;
        case 261: need('movies', p[0], where, ['.webm', '.mp4']); break;
        case 283: img('battlebacks1', p[0], where); img('battlebacks2', p[1], where); break;
        case 284: img('parallaxes', p[0], where); break;
        case 322: img('characters', p[1], where); img('faces', p[3], where); img('sv_actors', p[5], where); break;
        case 323: img('characters', p[1], where); break;
        case 205: for (const m of p[1].list) moveCommand(m, where); break;
        default: break;
        }
    }
}
function moveCommand(m, where) {
    if (m.code === 41) img('characters', m.parameters[0], where);
    if (m.code === 44) snd('se', m.parameters[0], where);
}

const sys = load('System.json');
img('titles1', sys.title1Name, 'System'); img('titles2', sys.title2Name, 'System');
img('battlebacks1', sys.battleback1Name, 'System'); img('battlebacks2', sys.battleback2Name, 'System');
for (const s of sys.sounds) snd('se', s, 'System sounds');
for (const k of ['titleBgm', 'battleBgm']) snd('bgm', sys[k], 'System ' + k);
for (const k of ['victoryMe', 'defeatMe', 'gameoverMe']) snd('me', sys[k], 'System ' + k);
for (const k of ['boat', 'ship', 'airship']) { img('characters', sys[k].characterName, 'System ' + k); snd('bgm', sys[k].bgm, 'System ' + k); }

for (const a of load('Actors.json')) if (a) { img('characters', a.characterName, 'Actor ' + a.id); img('faces', a.faceName, 'Actor ' + a.id); img('sv_actors', a.battlerName, 'Actor ' + a.id); }
for (const e of load('Enemies.json')) if (e) img(sys.optSideView ? 'sv_enemies' : 'enemies', e.battlerName, 'Enemy ' + e.id + ' ' + e.name);
for (const t of load('Tilesets.json')) if (t) for (const n of t.tilesetNames) img('tilesets', n, 'Tileset ' + t.id);
for (const a of load('Animations.json')) {
    if (!a) continue;
    img('animations', a.animation1Name, 'Animation ' + a.id); img('animations', a.animation2Name, 'Animation ' + a.id);
    for (const t of a.timings) snd('se', t.se, 'Animation ' + a.id);
}
for (const ce of load('CommonEvents.json')) if (ce) scanList(ce.list, 'common event ' + ce.id + ' ' + ce.name);
for (const t of load('Troops.json')) if (t) t.pages.forEach((pg, i) => scanList(pg.list, 'troop ' + t.id + ' ' + t.name + ' page ' + (i + 1)));
for (const info of load('MapInfos.json')) {
    if (!info) continue;
    const file = 'Map' + String(info.id).padStart(3, '0') + '.json';
    if (!fs.existsSync(path.join(DATA, file))) { console.log('map file missing: ' + file + ' (' + info.name + ')'); continue; }
    const map = load(file);
    const at = 'map ' + info.id + ' ' + info.name;
    img('parallaxes', map.parallaxName, at); img('battlebacks1', map.battleback1Name, at); img('battlebacks2', map.battleback2Name, at);
    if (map.autoplayBgm) snd('bgm', map.bgm, at);
    if (map.autoplayBgs) snd('bgs', map.bgs, at);
    for (const ev of map.events) {
        if (!ev) continue;
        ev.pages.forEach((pg, i) => {
            const where = at + ' event ' + ev.id + ' page ' + (i + 1);
            img('characters', pg.image.characterName, where);
            if (pg.moveRoute) for (const m of pg.moveRoute.list) moveCommand(m, where);
            scanList(pg.list, where);
        });
    }
}

const rows = [...missing.entries()].sort();
console.log(rows.length ? `${rows.length} referenced file(s) not on disk:` : 'every referenced image and sound is on disk');
for (const [key, info] of rows) console.log(`  ${key}  (${info.count} use${info.count > 1 ? 's' : ''}; first: ${info.where})`);
