// A whole run, played: two bots come in through the real title screen (New
// Game, the opening, the character picker) and play on, sped up, until
// everyone is dead, the run ends, or time is up. The host explores and goes
// on into the dungeon; the partner follows it. Nothing is placed or
// teleported by the test; it only watches, and writes down:
//   - the two machines disagreeing about the shared world (DIVERGE)
//   - script errors (ERROR)
//   - a player stuck: nothing about them changes for a while (STUCK, with a picture)
//   - a bot catching up "the quick way" (teleport: its path-finding failed)
//   - deaths, comebacks, fights, maps, choices
//
//   node test/marathon.js [--minutes 30] [--speed 4] [--port 8651] [--host knight] [--partner mercenary]
//                         [--mode hard]  (the opening's difficulty: hard, starvation; default the first)
//                         [--party]      (the partner walks in the host's party)
//                         [--immortal]   (test only: health kept up, the dead called back by the partner, to reach deeper floors)
// Writes test/out/marathon/<time>/report.md, events.log, screenshots and per-page logs.
const fs = require('fs');
const path = require('path');
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const installBot = require('../tools/bot-page');

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : fallback; };
const MINUTES = Number(arg('minutes', 30));
const SPEED = Number(arg('speed', 4));
const PORT = Number(arg('port', 8651));
// --from <map>: once both are in the run, both are put where a door of the game enters that map
// (bots cannot solve Level 3, so deeper floors are otherwise never played). Flagged in the report.
const FROM = Number(arg('from', 0));
function entryOf(id) {
    const data = path.join(require('../tools/find-game').findGame(), 'data');
    for (const f of fs.readdirSync(data).filter((n) => /^Map\d+\.json$/.test(n))) {
        const map = JSON.parse(fs.readFileSync(path.join(data, f), 'utf8'));
        for (const ev of map.events || []) for (const page of (ev && ev.pages) || []) for (const c of page.list) {
            if (c.code === 201 && c.parameters[0] === 0 && c.parameters[1] === id && Number(f.slice(3, 6)) !== id) return { x: c.parameters[2], y: c.parameters[3] };
        }
    }
    // Floors the game picks by a variable have no direct door in: one of the map's own stairs out.
    const own = JSON.parse(fs.readFileSync(path.join(data, 'Map' + String(id).padStart(3, '0') + '.json'), 'utf8'));
    for (const ev of own.events || []) for (const page of (ev && ev.pages) || []) if (page.trigger === 1 || page.trigger === 2) for (const c of page.list) if (c.code === 201) return { x: ev.x, y: ev.y };
    throw new Error('no door leads to map ' + id);
}
const STUCK_S = 90; // real seconds without any change = stuck
const OUT = path.join(__dirname, 'out', 'marathon', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-' + PORT);
fs.mkdirSync(OUT, { recursive: true });

const events = [];
const t0 = Date.now();
const stamp = () => {
    const s = Math.round((Date.now() - t0) / 1000);
    return String(Math.floor(s / 60)).padStart(3, ' ') + 'm' + String(s % 60).padStart(2, '0') + 's';
};
function event(kind, text) {
    const line = stamp() + '  ' + kind.padEnd(9) + ' ' + text;
    events.push({ kind, text, line });
    fs.appendFileSync(path.join(OUT, 'events.log'), line + '\n');
    console.log(line);
}
async function shot(page, name) {
    const file = path.join(OUT, name + '.png');
    try { await page.screenshot({ path: file }); } catch (e) { return '(no screenshot)'; }
    return path.relative(OUT, file);
}

// What the test reads off a page every few seconds.
const look = () => {
    const scene = SceneManager._scene;
    const has = !!(window.$gameMap && window.$gameParty && $gameParty.leader());
    const me = has ? $gameParty.leader() : null;
    const b = Coop.battle;
    return {
        scene: scene ? scene.constructor.name : '',
        map: has ? $gameMap.mapId() : 0, x: has ? $gamePlayer.x : 0, y: has ? $gamePlayer.y : 0,
        who: me ? me.name() : '', hp: me ? me.hp : 0, mhp: me ? me.mhp : 0, mp: me ? me.mp : 0, food: me ? me.currentExp() : 0,
        dead: !!Coop.dead, live: !!Coop.world.live, connected: !!Coop.connected, start: has && !!$gameSwitches.value(79),
        msg: window.$gameMessage ? $gameMessage.allText().replace(/\s+/g, ' ').slice(0, 120) : '',
        choices: window.$gameMessage && $gameMessage.isChoice() ? $gameMessage.choices().join(' / ') : '',
        running: has && $gameMap.isEventRunning(),
        fight: b ? b.role + (b.end ? ':' + b.end : '') : '',
        foes: scene instanceof Scene_Battle ? $gameTroop.members().map((e) => e.name()).join(', ').slice(0, 80) : '',
        doing: window.BOT ? (BOT.mode + (BOT.errand ? ' (' + BOT.errand.kind + ' to ' + (BOT.errand.plan ? BOT.errand.plan.goal : '?') + ')' : '')) : '',
        said: window.BOT ? BOT.said : '',
        party: has ? $gameParty.members().map((m) => m.name()).join('+') : '',
        items: has ? $gameParty.items().length : 0,
        deaths: window.__deaths ? __deaths.length : 0,
        fp: Coop.world.live ? Coop.world.fingerprint() : '',
        stopped: !!SceneManager._stopped,
    };
};

// A busy page stopped in the debugger, three times a second apart: the code it is stuck in.
// The debugger is switched on at the start (p.cdp): Chrome cannot switch it on in a page
// that is already spinning.
async function whereBusy(p) {
    const samples = [];
    try {
        const cdp = p.cdp;
        for (let i = 0; i < 3; i++) {
            const paused = new Promise((r) => cdp.once('Debugger.paused', r));
            await cdp.send('Debugger.pause');
            const ev = await Promise.race([paused, sleep(10000).then(() => null)]);
            if (!ev) { samples.push('(would not pause)'); break; }
            samples.push(ev.callFrames.slice(0, 40).map((f) => (f.functionName || '(anon)') + ' ' + String(p.scripts.get(f.location.scriptId) || '').replace(/^.*\//, '') + ':' + (f.location.lineNumber + 1)).join(' < '));
            await cdp.send('Debugger.resume');
            await sleep(1000);
        }
        // Slow frames rather than one endless loop: where five seconds of time go.
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.start');
        await sleep(5000);
        const { profile } = await cdp.send('Profiler.stop');
        fs.writeFileSync(path.join(OUT, p.label + '-hang.cpuprofile'), JSON.stringify(profile));
        const self = new Map();
        const dt = profile.timeDeltas || [];
        const byId = new Map(profile.nodes.map((n) => [n.id, n]));
        profile.samples.forEach((id, i) => {
            const f = byId.get(id).callFrame;
            const key = (f.functionName || '(anon)') + ' ' + f.url.replace(/^.*\//, '') + ':' + (f.lineNumber + 1);
            self.set(key, (self.get(key) || 0) + (dt[i] || 0) / 1000);
        });
        samples.push('profile (self ms): ' + [...self].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => k + ' ' + Math.round(v)).join(', '));
    } catch (e) { samples.push('(no stack: ' + e.message + ')'); }
    return samples.join('\n            ');
}

(async () => {
    const server = await startServer(PORT);
    const browser = await launch();
    const host = await openPlayer(browser, `http://localhost:${PORT}/?name=Host`, 'Host');
    const partner = await openPlayer(browser, `http://localhost:${PORT}/?name=Partner`, 'Partner');
    const pages = [host, partner];
    let code = 1;
    try {
        for (const p of pages) {
            p.cdp = await p.target().createCDPSession();
            p.scripts = new Map();
            p.cdp.on('Debugger.scriptParsed', (s) => p.scripts.set(s.scriptId, s.url));
            await p.cdp.send('Debugger.enable');
            await p.exposeFunction('fhBrain', () => null); // no model: rules of thumb
            await p.exposeFunction('fhBrainCharacter', () => {});
            await p.exposeFunction('fhLeave', () => {});
            await waitFor(p, () => window.SceneManager && window.Coop && SceneManager._scene instanceof Scene_Title && SceneManager._scene.isReady() && Coop.connected, 90000, 'title');
            // Faster: more logic steps per second of real time.
            await p.evaluate((n) => { SceneManager._dt = 1 / 60 / n; }, SPEED);
            // How often battlers are refreshed and how many actors exist: the 10/21 freezes sat in refresh.
            await p.evaluate(() => {
                window.__refresh = { n: 0, stacks: new Map() };
                const r = Game_BattlerBase.prototype.refresh;
                Game_BattlerBase.prototype.refresh = function () {
                    if (++window.__refresh.n % 200 === 1) {
                        const k = new Error().stack.split('\n').slice(2, 16).map((l) => l.trim().replace(/^at /, '').replace(/\(?https?:\/\/[^)]*\/([^/)]*)\)?/, '$1')).join(' < ');
                        window.__refresh.stacks.set(k, (window.__refresh.stacks.get(k) || 0) + 1);
                    }
                    return r.apply(this, arguments);
                };
            });
            // What called the game over: the event or common event running, the body, the fight.
            await p.evaluate(() => {
                window.__deaths = [];
                // Which script ran the Game Over command, map event or common event (parallel ones too).
                const go = Game_Interpreter.prototype.command353;
                Game_Interpreter.prototype.command353 = function () {
                    const ce = $dataCommonEvents.find((c) => c && c.list === this._list);
                    window.__goBy = ce ? 'ce' + ce.id + ' ' + ce.name : 'ev' + this._eventId + (window.$gameMap && $gameMap.event(this._eventId) ? ' ' + $gameMap.event(this._eventId).event().name : '');
                    return go.apply(this, arguments);
                };
                const goto = SceneManager.goto;
                SceneManager.goto = function (cls) {
                    if (cls === Scene_Gameover && window.$gameMap) {
                        const me = $gameParty.leader();
                        // The map's interpreter and the common events it called, innermost last.
                        const inner = (i) => {
                            const out = [];
                            for (let k = i; k && k.isRunning(); k = k._childInterpreter) {
                                const ce = $dataCommonEvents.find((c) => c && c.list === k._list);
                                out.push((ce ? 'ce' + ce.id + ' ' + ce.name : 'ev' + k._eventId) + '@' + k._index);
                            }
                            return out.join(' > ');
                        };
                        __deaths.push({
                            map: $gameMap.mapId(), x: $gamePlayer.x, y: $gamePlayer.y, hp: me && me.hp, exp: me && me.currentExp(),
                            states: me ? me.states().map((s) => s.name).join(',') : '', battle: $gameParty.inBattle() ? $gameTroop.troop().name : '',
                            by: window.__goBy || '', interp: inner($gameMap._interpreter), troop: inner($gameTroop._interpreter),
                            byEvent: $gameMap.events().filter((e) => e._interpreter && e._interpreter.isRunning() && e._interpreter._index > 1).map((e) => 'ev' + e.eventId() + ' ' + e.event().name + '@' + e._interpreter._index).join(' | '),
                            stack: (new Error().stack || '').split('\n').slice(2, 7).map((l) => l.trim()).join(' < '),
                        });
                    }
                    window.__goBy = '';
                    return goto.apply(this, arguments);
                };
            });
            p.botLines = [];
            p.on('console', (m) => { const t = m.text(); if (t.startsWith('[bot]')) { p.botLines.push(stamp() + ' ' + t); if (/quick way|catching up/.test(t)) event('teleport', p.label + ': ' + t.slice(6)); } });
            p.errorsSeen = 0;
            p.unread = 0;
        }
        const MODES = { hard: 'Hard mode', starvation: 'Terror & Starvation' };
        const prefer = arg('mode') ? [MODES[arg('mode')] || arg('mode')] : [];
        // Deeper floors for the watchers to see: nobody stays hurt, and a scripted death is
        // undone by the partner calling them back (the mod's own revive), as at a ritual circle.
        const IMMORTAL = process.argv.includes('--immortal');
        if (IMMORTAL) {
            for (const p of pages) {
                await p.evaluate(() => setInterval(() => {
                    if (!window.$gameParty || !$gameParty.members || $gameParty.inBattle()) return;
                    for (const m of $gameParty.members()) if (m.isAlive()) { m.setHp(m.mhp); m.setMp(m.mmp); }
                }, 2000));
            }
            event('start', 'immortal: health kept up; the dead are called back by their partner');
        }
        await host.evaluate(installBot, { lead: true, once: true, character: arg('host', 'knight'), brainless: true, prefer });
        event('start', `speed x${SPEED}, ${MINUTES} min, host starts the run` + (prefer.length ? ', ' + prefer[0] : ''));
        await sleep(4000);
        await partner.evaluate(installBot, { intro: true, walkOnly: true, follow: 'Host', character: arg('partner', 'mercenary'), brainless: true, party: process.argv.includes('--party') });
        event('start', 'partner comes in by the opening once the host is in');

        const last = new Map(); // label -> { s, key, changedAt, stuckSaid }
        let disagreeSince = 0;
        const maps = new Set();
        let fights = 0, wasLive = false, endWhy = '';
        let modeSaid = false;
        let divergedAt = 0;
        for (;;) {
            const mins = (Date.now() - t0) / 60000;
            if (mins > MINUTES) { endWhy = 'time up'; break; }
            const st = {};
            for (const p of pages) {
                try {
                    st[p.label] = await Promise.race([p.evaluate(look), sleep(15000).then(() => { throw new Error('no answer in 15 s'); })]);
                    p.unread = 0;
                } catch (e) {
                    st[p.label] = null;
                    event('page', p.label + ' could not be read: ' + e.message.slice(0, 120));
                    // A page that does not answer is busy: where its code is spinning (10/21: the host's
                    // page froze six minutes in and the marathon only said "timed out").
                    if (/no answer/.test(e.message) && !p.hangSaid) { p.hangSaid = true; event('HANG', p.label + ': ' + await whereBusy(p)); }
                    // A moment between pages is normal; for long, the page is gone.
                    if (++p.unread >= 5) { event('ERROR', p.label + ' unreadable for 15 s'); endWhy = p.label + ' unreadable'; }
                }
            }
            const h = st.Host, q = st.Partner;
            if (endWhy) break;
            if (!h || !q) { await sleep(3000); continue; }

            for (const p of pages) {
                const errs = p.errors.filter((e) => !/Greenworks failed|VideoFrame was garbage collected|physical_attack_animation/.test(e));
                for (const e of errs.slice(p.errorsSeen)) event('ERROR', p.label + ': ' + e.slice(0, 400));
                p.errorsSeen = errs.length;
                if (st[p.label].stopped) { event('ERROR', p.label + ': the game stopped (SceneManager stopped)'); endWhy = p.label + "'s game crashed"; }
            }
            if (endWhy) break;
            // Immortal: dead for 6 s with the partner alive, the partner calls them back where it stands.
            if (IMMORTAL) {
                for (const [dead, alive] of [[host, partner], [partner, host]]) {
                    const d = st[dead.label], l = st[alive.label];
                    if (!d.dead) { dead.deadSince = 0; continue; }
                    dead.deadSince = dead.deadSince || Date.now();
                    if (Date.now() - dead.deadSince < 6000 || l.dead || !l.live || l.scene !== 'Scene_Map') continue;
                    dead.deadSince = Date.now() + 30000; // once, then wait a while
                    const id = await dead.evaluate(() => Coop.id);
                    await alive.evaluate((id) => Coop.sendTo(id, 'revive', { m: $gameMap.mapId(), x: $gamePlayer.x, y: $gamePlayer.y, by: Coop.name, limb: 'leg' }), id);
                    event('revive', alive.label + ' calls ' + dead.label + ' back (immortal)');
                }
            }
            // A line that drops comes back within seconds; one that does not is a fault.
            for (const p of pages) {
                const c = st[p.label].connected;
                if (c) { if (p.offSince) event('online', p.label + ' connected again after ' + Math.round((Date.now() - p.offSince) / 1000) + ' s'); p.offSince = 0; p.offSaid = false; continue; }
                if (!p.offSince) { p.offSince = Date.now(); event('offline', p.label + ' lost the connection'); }
                else if (!p.offSaid && Date.now() - p.offSince > 30000) { p.offSaid = true; event('ERROR', p.label + ' has not connected again in 30 s'); }
            }
            // Once both are in the run: is the difficulty the same for both (a shared switch)?
            if (FROM && !pages.moved && h.live && q.live && h.scene === 'Scene_Map' && q.scene === 'Scene_Map') {
                pages.moved = true;
                const at = entryOf(FROM);
                for (const p of pages) await p.evaluate((m, x, y) => { $gamePlayer.reserveTransfer(m, x, y, 2, 0); }, FROM, at.x, at.y);
                event('start', 'both put on map ' + FROM + ' (' + at.x + ',' + at.y + ') by --from');
            }
            if (!modeSaid && h.live && q.live) {
                modeSaid = true;
                const modes = await Promise.all(pages.map((p) => p.evaluate(() => [2190, 3153, 3155].filter((id) => $gameSwitches.value(id)).join(',') || 'none').catch(() => '?')));
                event(modes[0] === modes[1] ? 'mode' : 'DIVERGE', 'mode switches on (2190 hard, 3153 starvation, 3155 tough): host ' + modes[0] + ', partner ' + modes[1]);
            }

            for (const p of pages) {
                const s = st[p.label];
                if (s.map) maps.add(s.map);
                if (Date.now() - (p.refreshAt || t0) > 60000) {
                    p.refreshAt = Date.now();
                    const r = await p.evaluate(() => {
                        const out = { n: window.__refresh.n, actors: $gameActors._data.filter(Boolean).length, party: $gameParty._actors.length, top: [...window.__refresh.stacks].sort((a, b) => b[1] - a[1]).slice(0, 2) };
                        window.__refresh.n = 0; window.__refresh.stacks.clear();
                        return out;
                    }).catch(() => null);
                    if (r) event(r.n > 20000 ? 'REFRESH' : 'refresh', `${p.label}: ${r.n} battler refreshes last minute, ${r.actors} actors, party ${r.party}` + (r.n > 20000 ? '; ' + r.top.map(([k, c]) => c + 'x ' + k).join(' || ') : ''));
                }
                const prev = last.get(p.label);
                // Progress is going somewhere or doing something; hunger ticking down and wounds are not.
                const key = [s.scene, s.map, s.x, s.y, s.msg, s.choices, s.dead, s.fight, s.party, s.items].join('|');
                if (!prev) { last.set(p.label, { s, key, changedAt: Date.now() }); continue; }
                if (prev.s.scene !== s.scene) {
                    event('scene', `${p.label}: ${prev.s.scene} -> ${s.scene}${s.foes ? '  vs ' + s.foes : ''}`);
                    if (s.scene === 'Scene_Battle' && p === host) fights++;
                }
                if (prev.s.map !== s.map && s.map) {
                    event('map', `${p.label}: map ${prev.s.map} -> ${s.map} (${s.x},${s.y})  ${s.doing}`);
                    // Back and forth between the same few maps: going round in circles.
                    const hops = p.hops = (p.hops || []).filter((h) => Date.now() - h.at < 120000).concat({ at: Date.now(), map: s.map });
                    if (hops.length >= 10 && new Set(hops.map((h) => h.map)).size <= 3 && !(p.loopSaid > Date.now() - 300000)) {
                        p.loopSaid = Date.now();
                        event('LOOP', `${p.label} went ${hops.length} times between maps ${[...new Set(hops.map((h) => h.map))].join(', ')} in 2 min, ${s.doing}, said "${s.said}"`);
                    }
                }
                if (prev.s.who !== s.who && s.who) event('who', `${p.label} plays ${s.who}`);
                if (!prev.s.dead && s.dead) event('DEATH', `${p.label} died on map ${s.map} (${s.x},${s.y}), hp ${s.hp}, food ${s.food}  ${await shot(p, 'death-' + p.label + '-' + Math.round(mins))}`);
                if (s.deaths > prev.s.deaths) {
                    const why = await p.evaluate((from) => __deaths.slice(from), prev.s.deaths).catch(() => []);
                    for (const d of why) event('gameover', `${p.label}: ${JSON.stringify(d)}`);
                }
                if (prev.s.dead && !s.dead) event('back', `${p.label} is alive again on map ${s.map}`);
                if (prev.s.live && !s.live) event('world', `${p.label} left the shared world (${s.scene})`);
                if (!prev.s.live && s.live) event('world', `${p.label} is in the shared world as ${s.who} on map ${s.map}`);
                if (prev.s.party !== s.party && prev.s.party && s.party) event('party', `${p.label}: ${prev.s.party} -> ${s.party}`);
                if (prev.s.choices !== s.choices && s.choices) event('choice', `${p.label}: "${s.msg.slice(0, 70)}" [${s.choices}]`);
                if (prev.s.doing !== s.doing && s.doing) event('doing', `${p.label}: ${s.doing}`);
                if (key !== prev.key) { last.set(p.label, { s, key, changedAt: Date.now() }); continue; }
                prev.s = s;
                const still = (Date.now() - prev.changedAt) / 1000;
                // Dead and waiting, or watching a partner's fight, is not stuck.
                const resting = (s.dead || s.scene === 'Scene_CoopDead' || s.scene === 'Scene_CoopSpectate') && !s.msg;
                if (still > STUCK_S && !prev.stuckSaid && !resting) {
                    prev.stuckSaid = true;
                    event('STUCK', `${p.label} unchanged for ${Math.round(still)} s: ${s.scene} map ${s.map} (${s.x},${s.y}) running=${s.running} msg="${s.msg.slice(0, 80)}" choices="${s.choices}" fight=${s.fight} doing=${s.doing} said="${s.said}"  ${await shot(p, 'stuck-' + p.label + '-' + Math.round(mins))}`);
                }
            }

            // The shared world: the two machines must agree (briefly apart while a change is on its way is fine).
            if (h.live && q.live) {
                wasLive = true;
                if (h.fp !== q.fp) {
                    disagreeSince = disagreeSince || Date.now();
                    if (disagreeSince > 0 && Date.now() - disagreeSince > 20000) {
                        const a = new Set(h.fp.split(';')), b = new Set(q.fp.split(';'));
                        event('DIVERGE', `worlds disagree for 20 s: only host ${[...a].filter((k) => !b.has(k)).slice(0, 12).join(' ')} | only partner ${[...b].filter((k) => !a.has(k)).slice(0, 12).join(' ')}`);
                        divergedAt = disagreeSince;
                        disagreeSince = -1; // said; again only after they agree once
                    }
                } else {
                    // Late (a busy machine) or lost: how long it took to agree again tells which.
                    if (divergedAt) event('agree', 'the worlds agree again after ' + Math.round((Date.now() - divergedAt) / 1000) + ' s');
                    divergedAt = 0;
                    disagreeSince = 0;
                }
            }
            if (h.scene === 'Scene_Gameover' || q.scene === 'Scene_Gameover') {
                await shot(host, 'end-host'); await shot(partner, 'end-partner');
                endWhy = 'game over (' + [h.scene === 'Scene_Gameover' ? 'host' : '', q.scene === 'Scene_Gameover' ? 'partner' : ''].filter(Boolean).join(', ') + ')';
                break;
            }
            if (wasLive && h.scene === 'Scene_Title') { endWhy = 'host is back at the title: the run ended'; break; }
            await sleep(3000);
        }
        event('end', endWhy);

        const count = (k) => events.filter((e) => e.kind === k).length;
        const bad = ['ERROR', 'STUCK', 'DIVERGE', 'LOOP'].reduce((n, k) => n + count(k), 0);
        const final = {};
        for (const p of pages) final[p.label] = await p.evaluate(look).catch(() => null);
        const lines = [
            `# Marathon ${path.basename(OUT)}`, '',
            `speed x${SPEED}, ran ${stamp().trim()}, ended: ${endWhy}. Maps seen: ${[...maps].sort((a, b) => a - b).join(' ')}. Host fights: ${fights}.`, '',
            '| kind | count |', '|---|---|',
            ...['ERROR', 'STUCK', 'DIVERGE', 'LOOP', 'teleport', 'DEATH', 'back', 'choice', 'map', 'party'].map((k) => `| ${k} | ${count(k)} |`), '',
            '## Problems', '', ...events.filter((e) => /^(ERROR|STUCK|DIVERGE|LOOP|teleport|gameover)$/.test(e.kind)).map((e) => '- `' + e.line + '`'), '',
            '## End state', '', '```', JSON.stringify(final, (k, v) => (k === 'fp' ? undefined : v), 1), '```', '',
        ];
        fs.writeFileSync(path.join(OUT, 'report.md'), lines.join('\n'));
        for (const p of pages) fs.writeFileSync(path.join(OUT, p.label + '-bot.log'), p.botLines.join('\n'));
        for (const p of pages) fs.writeFileSync(path.join(OUT, p.label + '-console.log'), p.logs.join('\n'));
        fs.writeFileSync(path.join(OUT, 'coop-log.txt'), (await Promise.all(pages.map((p) => p.evaluate(() => Coop.log.join('\n')).catch(() => '')))).join('\n=====\n'));
        console.log('\nreport: ' + path.join(OUT, 'report.md'));
        code = bad ? 1 : 0;
    } catch (e) { console.error(e); event('ERROR', 'harness: ' + e.message); }
    await browser.close();
    server.kill();
    process.exit(code);
})();
