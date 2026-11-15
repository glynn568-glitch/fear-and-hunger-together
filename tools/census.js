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
    // The loot dice's "this player is short of cloth / vials / torches" (CE 214, 215), worked out
    // from the searcher's own bag on every search. Shared, one player's want leaked into the other's.
    '^needs_', '^maybe_needs_', '_would_be_nice$',
].join('|'));

// Two-way switches that still describe the shared world: a character's body,
// who is alive, and machinery that stays where it was left.
const SW_WORLD_TWO_WAY = new RegExp([
    // An enemy's death (the cave gnomes, 10/21: Gnome3Dead and the rest are also
    // turned off, by the one autorun on map 165 that brings them all back): one
    // player's kill has to stand for everyone, or it comes back to fight the other.
    'Dead$', '_dead$',
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
// Set from inside move routes (seen by the scan since 0.1.2) but each player's
// own: an ambush walk-in that arms a chase (the bloody men 2-5, the miner
// ghost) and the library door, whose parallel event re-runs Enki's rejoin.
// Shared, one player's ambush or rejoin would play out on the other's screen.
for (const id of [2271, 2282, 2294, 2311, 2638, 1643]) SW_PRIVATE_IDS.add(id);
// A fight's outcome that starts a scene on the map belongs to whoever fought:
// the jaggedjaws' "takes a great leap at you" (the hound then mauls whoever it
// touches), Trortur lowering his weapon (the scene takes the player to
// Buckman), Moonless joining (an autorun that adds him to the party), Seril's
// senses. Shared, the other player was mauled, moved or given the dog too.
// What those scenes set afterwards is still world state.
// A save carried into someone else's run must not bring the latch along:
// the scene would play there and its shared writes would hit everyone.
const DUE_SCENES = [2881, 2888, 2895, 2909, 2916, 2923, 2970, 724, 2374, 2187, 2947, 2761];
for (const id of DUE_SCENES) SW_PRIVATE_IDS.add(id);
// The game mode is chosen once and has to match for everyone.
// The Crow Mauler's route and "he has been sent" (773, 774, 779): his alert 786 and his death 771 are
// shared, and one roll on one machine left the partner an empty floor and, if they owned the map, him frozen.
// The same for two more whose every fighting page waits on one switch (tools/hunt/ghosts.js, 11/13): the hounds of
// the Fortress and Dream Oldegård (1781 HOUNDS_ARE_COMING, turned on by each machine's own bark timer, off by
// the exits and a mauling) and the old knight's spectre on level 5 (360, armed and sent home by floor tiles).
// Kept per player, they hunted one player while the partner saw nothing there (report 11/13: "invisible wolves
// started a fight with his AI companion"). Shared, they are out for everyone on the floor once they are out.
// The black witch of the Ancient city too (maps 114/116, his call 11/14): her tiles' touch turns 3453 or 3457
// on, whose parallel page brings her and wakes her (3454 visible, 3451 to fight); every room change (common
// event 271) turns all four off. All four, since each machine runs those parallel pages: shared, she wakes
// for everyone there, and either player changing rooms anywhere sends her away for both. Known gap (Grok
// 11/14): both floors' tiles read the same switches, so a partner standing on the other floor gets that
// floor's copy of her woken too, though nobody stepped on its tile.
// The smash pit's guard (map 62 EV34, his call 11/14): his own timer arms him (2933) to walk up and strike on
// touch, the blow's scene (EV1) holds him while it plays (2934) and turns both off. Kept per player, he hunted
// one player while the partner saw him stand still. Shared, he goes after whoever is nearest and stands still
// for everyone while he strikes; the blow is only the struck player's scene (the others' is held as someone
// else's). Not his swing pose (2935: six flips a blow, which the room takes for a script's scratch flag).
const SW_WORLD_IDS = new Set([2190, 3153, 3155, 3480, 773, 774, 779, 1781, 360, 3451, 3453, 3454, 3457, 2933, 2934]);
// His blows are counted per body (2937 after the first, 2938 after the second; the third kills). The game
// only ever turns them on, so the census took them for world latches: one player's blows counted against
// the other, who died of their second.
SW_PRIVATE_IDS.add(2937);
SW_PRIVATE_IDS.add(2938);

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
// So does every other layout dice the game throws when a run starts: which
// version of a floor, which enemies stand where (the Blood pit's lizardman),
// where D'arce and the others turn up. Shared but thrown again by a later
// start event, a player's new throw changed the floor under everyone (10/21).
// Not RanLevel1_1 and RanLevel1_3: the story sets those later on purpose.
const LAYOUT_DICE = /^LEVEL|^Level\d|^level\d|^RanLevel|^RanThicket|^RanMahabre|^RanStaircase|^VILLAGE_random|VARIABLE$/;
const STORY_SETS = new Set([121, 123]);
for (const v of Object.values(usage.va)) {
    if (!va[v.id] || ONCE.includes(v.id) || STORY_SETS.has(v.id) || !LAYOUT_DICE.test(v.name)) continue;
    const how = keys(v.wVals);
    const where = keys(v.w);
    if (how.includes('set:rand') && how.every((k) => k === 'set:rand' || k === 'set:const') && where.every((k) => k === 'map:auto' || k === 'map:touch')) ONCE.push(v.id);
}
// knight_random is thrown in the same start-of-run block as those dice and decides whether the old knight's
// spectre stands on level 5; its name kept it out, so each player had their own knight or none.
ONCE.push(61);
va[61] = 1;

// --- what a save's flags stand for, beyond the flags --------------------------
// kept: events a scene that writes a shared flag walks or sets down, with their
// home tile. A save from before locations were shared says where they stand only
// in the plugin's own table, next to every wanderer; this says which ones count.
// recruits: a shared flag written beside an Add Actor. A body that holds that
// person came through the flag, so a save brings the flag along.
const { findGame, readGameJson } = require('./find-game');
const DATA = path.join(process.env.FH_GAME || findGame(), 'data');
const commonEvents = readGameJson(path.join(DATA, 'CommonEvents.json'));
const kept = {};
const recruits = {};
function writesShared(list, seen, key) {
    if (seen.has(list)) return false;
    seen.add(list);
    return list.some((c) => {
        if (c.code === 121) { for (let id = c.parameters[0]; id <= c.parameters[1]; id++) if (sw[id]) return true; return false; }
        if (c.code === 123) return !ssPrivate[key + ',' + c.parameters[0]];
        const ce = c.code === 117 && commonEvents[c.parameters[0]];
        return !!ce && writesShared(ce.list, seen, key);
    });
}
const JUST_FORMS = new Set([8, 9, 11, 12]); // the demon baby and the fused forms: nobody's recruit

// loot: the self switches and shared switches that only say "this crate, chest, shelf, body or
// coin is taken". With the host's Instanced loot on they stay on each player's machine, so
// everyone finds their own. A page counts when it hands something out (itself or through a
// common event), turns on its mark, and does nothing else to the world: no other shared switch
// or variable, no transfer, fight, party change, game over or moved event. A mark that any other
// kind of page also turns on, or that opens a page which starts by itself or changes the world,
// is not loot. Most named containers (chest1, bookshelf1, captains_desk: two tiles, and the same
// container on each version of a floor) are marked with a shared switch; crates with a letter.
const LOOT_WORLDLY = new Set([201, 203, 129, 301, 353]);
const LOOT_WORLDLY_SCRIPT = /reserveTransfer|Scene_Gameover|addActor|removeActor|BattleManager|\$gameSwitches|\$gameVariables|\$gameSelfSwitches/;
function lootOf(list, seen, acc) {
    if (seen.has(list)) return acc;
    seen.add(list);
    for (const c of list) {
        const p = c.parameters;
        if ((c.code === 126 || c.code === 127 || c.code === 128) && p[1] === 0) acc.gives = true;
        else if (c.code === 125 && p[0] === 0) acc.gives = true;
        else if (LOOT_WORLDLY.has(c.code)) acc.worldly = true;
        else if (c.code === 121) { for (let id = p[0]; id <= p[1]; id++) if (sw[id]) { if (p[2] === 0) acc.sw.add(id); else acc.worldly = true; } }
        else if (c.code === 111 && p[0] === 0) acc.reads.add(p[1]);
        else if (c.code === 122) { for (let id = p[0]; id <= p[1]; id++) if (va[id]) acc.worldly = true; }
        else if (c.code === 355 || c.code === 655) {
            if (/gainItem|gainGold/.test(p[0])) acc.gives = true;
            if (LOOT_WORLDLY_SCRIPT.test(p[0])) acc.worldly = true;
        } else if (c.code === 117 && commonEvents[p[0]]) lootOf(commonEvents[p[0]].list, seen, acc);
    }
    return acc;
}
const lootYes = new Set();
const lootNo = new Set();
const lootAcc = () => ({ gives: false, worldly: false, sw: new Set(), reads: new Set() });
const swWriters = {}; // switch -> events whose pages turn it on
const swReaders = {}; // switch -> events whose pages are conditioned on it or branch on it
const swNo = new Set();
const add = (o, k, v) => (o[k] = o[k] || new Set()).add(v);
for (const file of fs.readdirSync(DATA)) {
    if (!/^Map\d+\.json$/.test(file)) continue;
    const map = readGameJson(path.join(DATA, file));
    if (!map || !Array.isArray(map.events)) continue;
    const mapId = Number(file.slice(3, 6));
    const mapKept = /<save event locations?>/i.test(map.note || '');
    for (const ev of map.events) {
        if (!ev) continue;
        for (const page of ev.pages) {
            const letters = new Set(page.list.filter((c) => c.code === 123 && c.parameters[1] === 0).map((c) => c.parameters[0]));
            const what = lootOf(page.list, new Set(), lootAcc());
            const evKey = mapId + ',' + ev.id;
            if (letters.size) {
                const into = page.trigger <= 2 && what.gives && !what.worldly && !what.sw.size ? lootYes : lootNo;
                for (const ch of letters) into.add(evKey + ',' + ch);
            }
            // A container's shared mark: the only shared thing its page writes.
            for (const id of what.sw) {
                add(swWriters, id, evKey);
                if (page.trigger > 2 || !what.gives || what.worldly || what.sw.size > 1) swNo.add(id);
            }
            const cond = page.conditions;
            for (const id of [cond.switch1Valid && cond.switch1Id, cond.switch2Valid && cond.switch2Id]) {
                if (!id) continue;
                add(swReaders, id, evKey);
                if (page.trigger > 2 || what.worldly || what.sw.size) swNo.add(id);
            }
            for (const id of what.reads) add(swReaders, id, evKey);
            // What a letter opens counts too: a page it starts by itself, or one that changes the world.
            // The merchant's B (Map131/Map074 EV47) starts his farewell, which sends him away for everyone:
            // kept on each machine, both players bought his one potion (Grok g16).
            if (cond.selfSwitchValid && (page.trigger > 2 || what.worldly || what.sw.size)) lootNo.add(evKey + ',' + cond.selfSwitchCh);
            const shares = writesShared(page.list, new Set(), mapId + ',' + ev.id);
            page.list.forEach((c, i) => {
                if (c.code === 129 && c.parameters[1] === 0 && !JUST_FORMS.has(c.parameters[0]) && mapId !== 160 && mapId !== 185) {
                    for (const near of page.list.slice(Math.max(0, i - 4), i + 5)) {
                        if (near.code !== 121 || near.parameters[2] !== 0) continue;
                        for (let id = near.parameters[0]; id <= near.parameters[1]; id++) if (sw[id]) recruits[id] = c.parameters[0];
                    }
                }
                const walks = c.code === 205 && c.parameters[1].list.some((r) => r.code >= 1 && r.code <= 14);
                if (!shares || !(walks || c.code === 203)) return;
                const target = c.parameters[0] === 0 ? ev : map.events[c.parameters[0]];
                if (!target || c.parameters[0] < 0 || target.pages.some((p) => p.moveType !== 0)) return;
                if (mapKept || /<save event locations?>/i.test(target.note || '')) kept[mapId + ',' + target.id] = [target.x, target.y];
            });
        }
    }
}

// A shared mark counts as loot when the scan saw it written only on, only by pages a player
// starts, read only by those pages, and every event that reads it also writes it.
const BY_HAND_W = /^map:(action|touch|evtouch)$/;
const BY_HAND_R = /^map:(action|touch|evtouch):(page|if)$/;
const swLoot = keys(swWriters).map(Number).filter((id) => {
    const u = usage.sw[id];
    if (swNo.has(id) || !sw[id] || !u) return false;
    if (keys(u.wVals).some((k) => k !== 'on') || keys(u.w).some((k) => !BY_HAND_W.test(k)) || keys(u.r).some((k) => !BY_HAND_R.test(k))) return false;
    return [...(swReaders[id] || [])].every((e) => swWriters[id].has(e));
});

const census = {
    kept,
    recruits,
    once: ONCE,
    sw: keys(sw).map(Number),
    va: keys(va).map(Number),
    ssPrivate: keys(ssPrivate),
    ssLoot: [...lootYes].filter((k) => !lootNo.has(k) && !ssPrivate[k]),
    swLoot,
    identity: [242, 243, 244, 245, 246],
    start: 79,
    // Private latches that only mean "a fight just ended and a scene is due".
    dueScenes: DUE_SCENES,
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
console.log(`self switches: ${ssTotal} written, ${keys(ssPrivate).length} private, ${census.ssLoot.length} loot`);
console.log(`loot switches: ${swLoot.length}`);
if (process.argv.includes('-v')) {
    console.log('\nTWO-WAY WORLD:\n' + report.twoWayWorld.join(' | '));
    console.log('\nWORLD VARIABLES:\n' + report.vaWorld.join(' | '));
    console.log('\nPRIVATE LATCHES:\n' + report.latchPrivate.join(' | '));
}
