// The front door under chaos: two people who each just want to get into the night, while
// pages reload, someone wanders back to the title, someone goes idle, at moments picked by a
// seeded dice. Each plays as a person would: reads the title menu and takes the line that
// gets them in. However a round goes, it must end with both in one run, as different
// characters, each seeing the other, with no script errors.
// 11/03: a Continue at the wrong moment crashed the join and locked the host out of his own
// save. The single ways in are test/frontdoor.js, lobby.js and lobbysave.js; this is them mixed.
//   FH_SOAK_MS    how long to keep starting rounds (default 240000)
//   FH_SOAK_SEED  replay a run (printed at the start)
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const { checker } = require('./common');
const install = require('./helpers');
const { titleReady, key, choose, watch, who } = require('./lobbylib');

const PORT = 8750;
const BUDGET = Number(process.env.FH_SOAK_MS) || 240000;
const SEED = Number(process.env.FH_SOAK_SEED) || (Date.now() % 1000000);
let seed = SEED;
const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const one = (list) => list[Math.floor(rnd() * list.length)];

// What a page shows, as far as someone deciding what to press needs.
const look = (p) => p.evaluate(() => {
    if (!window.SceneManager || !window.Coop || !SceneManager._scene) return { kind: 'boot' };
    const sc = SceneManager._scene;
    const steady = SceneManager.isCurrentSceneStarted() && !SceneManager.isSceneChanging();
    if (sc instanceof Scene_Title && steady && Coop.connected && Coop.name && !window.T) return { kind: 'bare' };
    if (!window.T) return { kind: 'boot' };
    if (sc instanceof Scene_Map && Coop.world.live && !$gamePlayer.isTransferring() && sc.isActive()) return { kind: 'live' };
    if (sc instanceof Scene_Load && steady) return { kind: 'load' };
    // A new character's opening (the picker, the name, the walk in): played by the action key alone.
    // It offers a save on the way: declined, so the save of the night stays theirs.
    if (!(sc instanceof Scene_Title) && Coop.world._how === 'new') { if (sc instanceof Scene_Name && sc._inputWindow) sc._inputWindow.select(89); return { kind: 'opening', save: sc instanceof Scene_Save }; }
    if (!(sc instanceof Scene_Title) || !steady) return { kind: 'busy' };
    if (Coop.together && Coop.together.isOpen()) return { kind: 'panel' };
    const w = sc._commandWindow;
    return { kind: 'title', lines: w._list.map((c) => c.name + (c.enabled ? '' : '~')), active: w.active && w.isOpen() };
}).catch(() => ({ kind: 'boot' }));

// The next thing this person presses on their way in. Returns what it was, for the record.
async function step(p) {
    const s = await look(p);
    if (s.kind === 'bare') { await p.evaluate(install); await p.evaluate(watch); return ''; }
    if (s.kind === 'panel') { await p.evaluate(() => Coop.together.close()); return ''; }
    if (s.kind === 'load') { await key(p, 'Enter'); return 'slot'; }
    if (s.kind === 'opening') { const k = s.save ? 'Escape' : 'Enter'; await p.keyboard.down(k); await sleep(80); await p.keyboard.up(k); return ''; }
    if (s.kind !== 'title' || !s.active) return '';
    const has = (name) => s.lines.indexOf(name) >= 0;
    // Someone who left a run still being played comes back as a new character (room.js worldstale):
    // Join is greyed until they say who. In the list of characters: the first one free.
    const free = s.lines.find((l) => /^(Cahara|D'arce|Enki|Ragnvaldr)$/.test(l));
    const want = has('Back') ? (has('Join~') || has('Ready~') || !free ? 'Back' : free) : has('Join~') && has('Come in as...') ? 'Come in as...' : has('Join') ? 'Join' : has('Start') ? 'Start' : has('Ready') ? 'Ready' : has('Continue') ? 'Continue' : '';
    if (!want) return '';
    await choose(p, want).catch(() => {});
    return want;
}

(async () => {
    const check = checker();
    let server, joiner, browser, pages = [];
    console.log('seed ' + SEED + ' (FH_SOAK_SEED=' + SEED + ' replays it), ' + Math.round(BUDGET / 1000) + ' s of rounds');
    try {
        server = await startServer(PORT, { FH_MIND: 'none' });
        joiner = await startServer(PORT + 100, { FH_JOIN: `http://localhost:${PORT}/` });
        browser = await launch();
        const a = await openPlayer(browser, `http://localhost:${PORT}/?name=Ann`, 'Ann');
        const b = await openPlayer(browser, `http://localhost:${PORT + 100}/?name=Bo`, 'Bo');
        pages = [a, b];
        for (const p of pages) { await waitFor(p, titleReady, 90000, p.label + ' at the title'); await p.evaluate(install); await p.evaluate(watch); }

        // A night played and saved by both, without its opening (as test/lobbysave.js).
        await a.evaluate(() => T.quickStart(4, 27, 67));
        await waitFor(a, () => T.onMap(), 60000, 'Ann on the map');
        await a.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(a, () => Coop.world.live, 15000, 'Ann in');
        await b.evaluate(() => T.quickStart(3, 27, 66));
        await waitFor(b, () => T.onMap(), 60000, 'Bo on the map');
        await b.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(b, () => Coop.world.live, 15000, 'Bo in');
        await sleep(500);
        await a.evaluate(() => { $gameSystem.onBeforeSave(); DataManager.saveGame(1); });
        const saved = await waitFor(b, () => { const info = DataManager.loadGlobalInfo() || []; return info.some((i) => i && i.coopRun === Coop.world.runId); }, 20000, 'Bo saved alongside').then(() => true, () => false);
        check('a night played and saved by both', saved);

        // What can go wrong on the way in. Each is something a person or their line does.
        const chaos = {
            reload: async (p) => { await p.reload({ waitUntil: 'domcontentloaded' }).catch(() => {}); },
            title: async (p) => { if ((await look(p)).kind === 'live') await p.evaluate(() => { T.settle(); SceneManager.goto(Scene_Title); }); },
            idle: async (p) => { await p.evaluate(() => { if (window.Coop && Coop.lobby) Coop.lobby.awayAfter = 1500; }).catch(() => {}); p.idleUntil = Date.now() + 5000; },
        };
        const errs = [];
        const collect = async () => { for (const p of pages) errs.push(...await p.evaluate(() => (window.__errs || []).splice(0)).catch(() => [])); };

        const started = Date.now();
        let round = 0;
        while (Date.now() - started < BUDGET) {
            round++;
            const did = [];
            // How the last round is left: both out (the run ends), one out (it goes on under the other), or a page reloaded.
            if (round > 1) {
                const leave = one(['both title', 'both title', 'Bo title', 'Ann title', 'Bo reload', 'Ann reload', 'both reload']);
                did.push('left: ' + leave);
                const [whom, how] = leave.split(' ');
                for (const p of whom === 'both' ? pages : [whom === 'Ann' ? a : b]) { await collect(); await chaos[how](p); }
            } else for (const p of pages) await chaos.title(p);
            // Up to two things going wrong in the first ten seconds, then left alone to get in.
            const plan = [];
            for (let i = Math.floor(rnd() * 3); i > 0; i--) plan.push({ at: Date.now() + 500 + rnd() * 10000, what: one(['reload', 'reload', 'title', 'idle']), who: one(pages) });
            const until = Date.now() + (Number(process.env.FH_SOAK_ROUND) || 200000);
            let both = false;
            while (Date.now() < until) {
                const due = plan.filter((c) => c.at <= Date.now());
                for (const c of due) { plan.splice(plan.indexOf(c), 1); did.push(c.who.label + ' ' + c.what); await collect(); await chaos[c.what](c.who); }
                for (const p of rnd() < 0.5 ? [a, b] : [b, a]) {
                    if (p.idleUntil && Date.now() < p.idleUntil) continue;
                    if (p.idleUntil) { p.idleUntil = 0; await p.evaluate(() => { if (window.Coop && Coop.lobby) Coop.lobby.awayAfter = 300000; }).catch(() => {}); }
                    const pressed = await step(p);
                    if (pressed) did.push(p.label + ' ' + pressed);
                }
                if (!plan.length && (await look(a)).kind === 'live' && (await look(b)).kind === 'live') { both = true; break; }
                await sleep(150);
            }
            await sleep(1200);
            await collect();
            const state = async (p) => p.evaluate(() => ({
                run: Coop.world.runId, live: Coop.world.live, alone: Coop.world.sameAs || Coop.world.otherRun || '',
                sees: Coop.others().filter((o) => o.st && o.st !== 'title').map((o) => o.name),
                scene: SceneManager._scene && SceneManager._scene.constructor.name, how: Coop.world._how, map: window.$gameMap ? $gameMap.mapId() : 0, wait: Coop.world.hostWait || '', log: Coop.log.slice(-6),
                lobby: { going: Coop.lobby.going, locked: Coop.lobby.locked, run: Coop.lobby.run, row: Coop.lobby.rows[Coop.id], mine: Coop.lobby.mine, founded: Coop.lobby.founded, line: Coop.lobby.line },
            })).catch((e) => ({ error: String(e).slice(0, 80) }));
            const sa = await state(a), sb = await state(b);
            const wa = both ? await who(a) : { is: [] }, wb = both ? await who(b) : { is: [] };
            const ok = both && sa.live && sb.live && !!sa.run && sa.run === sb.run && !sa.alone && !sb.alone
                && sa.sees.indexOf('Bo') >= 0 && sb.sees.indexOf('Ann') >= 0 && wa.is.length === 1 && wb.is.length === 1 && wa.is[0] !== wb.is[0];
            check('round ' + round + ': both in one run, as two characters, each seeing the other', ok,
                JSON.stringify({ did, sa, sb, wa: wa.is, wb: wb.is, a: await look(a), b: await look(b) }));
            if (!ok) break; // what follows a stuck round says nothing new
        }
        check('at least three rounds were played', round >= 3, round + ' rounds');
        check('no script errors in any round', errs.length === 0, errs.join(' || ').slice(0, 800));
    } catch (e) {
        console.error(e);
        check('test ran to the end', false);
    }
    const code = check.finish(pages);
    if (browser) await browser.close();
    for (const s of [server, joiner]) if (s) s.kill();
    process.exit(code);
})();
