// Sorts every switch, variable and self switch into "world" (shared between
// players) or "private" (stays on one player's machine), from data/usage.json.
// Output: client/census.json, loaded by the game at boot.
//
// The rules lean on what a wrong guess costs. A private flag wrongly shared
// can drag the other player into a cutscene or flip their status effects. A
// world flag wrongly kept private only means the other player has to pull the
// lever themselves. So anything ambiguous stays private.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { usage } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'usage.json'), 'utf8'));
const self = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'selfswitches.json'), 'utf8'));

const keys = (o) => Object.keys(o);
const any = (o, re) => keys(o).some((k) => re.test(k));

// --- switches ---------------------------------------------------------------

// Flags about the person at the keyboard rather than about the dungeon.
const SW_PRIVATE_NAME = new RegExp([
    'SELECT', '^INITIAL_', '^INTRO', '^Intro', '^START$', '^menu_', '^MENU',
    '^SKILL_', 'AVAILABLE', 'available', 'LEARNED', 'Learned', 'OK\\??$', '_ok$', '_OK$',
    'OUTFIT', 'ROBE', 'ARMOR$', '^location_', '^LOCATION_', '^loc_', '^area\\d',
    '^player_', '^Player_', 'FEAR', '^Fear', '_fear', 'PARANOIA', 'RAPANOIA', 'BLINDNESS', '^Blind_',
    'HALLUCINATION', 'SUICIDE', '[Ss]uicide', 'TIMER', '_timer', 'COOLDOWN', 'cool_?down', 'cooloff',
    '^walk', '^inside_', '^over_the', '^near_', '^sitting$', '^hiding$', '^Sleep', '^Resting$', 'PHASE_STEP',
    '_Succumb$', '^First[ _]time', 'first_?time$', '^Dream', '^dream', 'ENDING', 'REBIRTH', '^Scene_over$',
    '^Light on$', 'Flashlight', '^disabled$', '^Disable npc$', '^TALK$', '^Run!$', '^Steal', '^BACKSTAB$',
    'sawing', 'SAWING', '^Assist_', '^LOVE_', '^LoveCorner', '^DATE_', '^Date_', 'Tonights',
    '^PICTURE', '^NOTIFIED$', '^Ready$', '^ready!$', '^on_hold$', '^hit!$', '_SPOT\\d', '_UP$', '_TALK$',
    '^DAY_RESET$', 'Day\\d_characters', '^Pocket_rewind', '^Pocket_decline', '^SCHOOL_MODE$',
    '^(Domination|Endless|tormented|Enlightened)_soul$', '^Set_D$',
    '^stepped_on_trap$', '^CHOKED$', '^BURNING!$', '^DEATH!$', '^baby$', 'DEMONBABY', '^HEXEN', 'Curse_game',
].join('|'));

// Two-way switches that still describe the shared world: a character's body,
// who is alive, and machinery that stays where it was left.
const SW_WORLD_TWO_WAY = new RegExp([
    '_(arm|leg|paw)[RL12345]?$', '_(arm|leg)\\d', '_leg[RL]$', '_arm[RL]$', 'anal_?bleed', 'KILLED', '_curse$',
    '^Blood_golem', '^blood_golem$', '^guard1$', '^Night_[Ll]urch\\d$', '^door\\d', '^elevator_', '^MECHANISM',
    '^ballista', '^BUCKMAN_OFF$', '^Portal\\d_ON$',
].join('|'));

const SW_PRIVATE_IDS = new Set([
    1, 2, 3, 4, 41, 52, 79, 200, 201, 202, 212, 213, 214, 215, 216, 295, 296, 297, 298, 299, 300, 371, 410,
    695, 800, 802, 813, 814, 815, 816, 837, 863, 1041, 1042, 1043, 1044, 1045, 1530, 3151,
]);
// A playable character's own limbs (CE 240 and the HUNGER_of_* events write
// them) belong to whoever plays that character and travel in their save.
// Shared, a fresh partner taking the same character came in with the last
// one's missing legs.
for (const id of [36, 37, 38, 39, 248, 249, 250, 251, 252, 253, 254, 255, 256, 257, 258, 259, 817, 819, 820, 821]) SW_PRIVATE_IDS.add(id);
// The game mode is chosen once and has to match for everyone.
const SW_WORLD_IDS = new Set([2190, 3153, 3155, 3480]);

const sw = {};
const report = { swWorld: 0, swPrivate: 0, vaWorld: [], vaPrivate: 0, twoWayWorld: [], latchPrivate: [] };
for (const s of Object.values(usage.sw)) {
    const on = (s.wVals.on || 0) + (s.wVals.script || 0);
    const off = s.wVals.off || 0;
    const twoWay = on > 0 && off > 0;
    let world;
    if (SW_WORLD_IDS.has(s.id)) world = true;
    else if (SW_PRIVATE_IDS.has(s.id)) world = false;
    else if (!on && !off) world = false; // never written: nothing to share
    else if (twoWay) world = SW_WORLD_TWO_WAY.test(s.name) && !SW_PRIVATE_NAME.test(s.name);
    else world = !SW_PRIVATE_NAME.test(s.name);
    if (world) {
        sw[s.id] = 1;
        report.swWorld++;
        if (twoWay) report.twoWayWorld.push(s.id + ':' + s.name);
    } else {
        report.swPrivate++;
        if (!twoWay && (on || off)) report.latchPrivate.push(s.id + ':' + s.name);
    }
}

// --- variables --------------------------------------------------------------

const VA_PRIVATE_NAME = new RegExp([
    '^character', '^Character', 'MapID', 'MapX', 'MapY', 'MAP_?ID', 'PartySize', 'Party_Member',
    '^random', 'random$', '_ran$', 'coin', 'COIN', 'MENU', 'class_select', 'HUNGER', 'PLAYER_MP', 'PlayerMP',
    'battleturn', 'Affinity', 'NAME$', 'Lightswitch', 'HEXEN', 'SAWING', 'choke', 'fall_scene', 'sleeping',
    'enemy_surprise', 'succumb', 'walking_circles', '^fear', 'fear$', '_X$', '_Y$', '[XYxy]$', 'TIMER', '_timer',
    'cooldown', 'bleeding', 'pain$', 'Consciousness', 'Crippled', 'temp_', 'Tiles', 'var$', '_var$',
].join('|'));
// Counters only the host's clock should drive are handled in state.js; the
// dungeon layout rolls are plain world variables.
const VA_WORLD_NAME = /^LEVEL|^Level\d|^level\d|^RanLevel|^RanThicket|^RanMahabre|^RanStaircase|^VILLAGE_random|^BlackSteelRandom|VARIABLE$|^AFFECTION|affection(_2)?$|infection|_curse$|^DAY_/;
const VA_WORLD_IDS = new Set([35, 36, 37, 38, 79, 81, 2]);
const VA_PRIVATE_IDS = new Set([33, 60, 359, 401, 403]);

const va = {};
for (const v of Object.values(usage.va)) {
    const wroteHot = any(v.w, /:par$|^troop/);
    let world;
    if (VA_PRIVATE_IDS.has(v.id)) world = false;
    else if (VA_WORLD_IDS.has(v.id) || VA_WORLD_NAME.test(v.name)) world = !any(v.w, /:par$/);
    else if (!keys(v.w).length || !keys(v.r).length) world = false;
    else world = !wroteHot && !VA_PRIVATE_NAME.test(v.name);
    if (world) { va[v.id] = 1; report.vaWorld.push(v.id + ':' + v.name); } else report.vaPrivate++;
}

// --- self switches ----------------------------------------------------------
// Shared unless the same event flips the letter both on and off (an animation
// loop or a trap cycle, which every machine can run for itself).
const ssPrivate = {};
let ssTotal = 0;
for (const key of keys(self)) {
    ssTotal++;
    if (self[key] === 3) ssPrivate[key] = 1;
}

// LEVEL1-3_random1..3 decide which enemies and items stand on a dozen maps.
// A parallel event throws them, which is why the general rule left them
// private; they are world state, and the first throw has to stand.
const ONCE = [24, 25, 29];
for (const id of ONCE) va[id] = 1;

const census = {
    once: ONCE,
    sw: keys(sw).map(Number),
    va: keys(va).map(Number),
    ssPrivate: keys(ssPrivate),
    identity: [242, 243, 244, 245, 246],
    start: 79,
    // The build this census was made from (tools/version.js).
    fp: process.env.FH_FP || require('./version').fingerprint(require('./find-game').findGame()).fp,
};
// Written whole or not at all: a half-written file would be taken for a good one.
function writeWhole(file, text) { fs.writeFileSync(file + '.tmp', text); fs.renameSync(file + '.tmp', file); }
writeWhole(path.join(ROOT, 'client', 'census.json'), JSON.stringify(census));

// What each map calls itself on screen, for telling a player where their partner is.
const { maps } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'usage.json'), 'utf8'));
const mapNames = {};
for (const m of maps) if (m.display) mapNames[m.id] = m.display;
writeWhole(path.join(ROOT, 'client', 'mapnames.json'), JSON.stringify(mapNames));

console.log(`switches: ${report.swWorld} world, ${report.swPrivate} private`);
console.log(`variables: ${report.vaWorld.length} world, ${report.vaPrivate} private`);
console.log(`self switches: ${ssTotal} written, ${keys(ssPrivate).length} private`);
if (process.argv.includes('-v')) {
    console.log('\nTWO-WAY WORLD:\n' + report.twoWayWorld.join(' | '));
    console.log('\nWORLD VARIABLES:\n' + report.vaWorld.join(' | '));
    console.log('\nPRIVATE LATCHES:\n' + report.latchPrivate.join(' | '));
}
