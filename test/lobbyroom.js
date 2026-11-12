// The lobby's rules at the room (room.js lobbySay, 'world?'), spoken to as a page speaks to
// it: plain sockets, no game. One check per guard of docs' spec/Lobby.tla, in the order a
// night goes: who is here, the host's choice, picks, ready, away, Start, the host founds,
// the partner after the people, a late Join, the run ending, a start called off.
const WebSocket = require('ws');
const http = require('http');
const { startServer, sleep } = require('./lib');
const { checker } = require('./common');

const PORT = 8540;
const MERC = 661, KNIGHT = 662, PRIEST = 663, OUTLANDER = 664;

function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => { let s = ''; res.on('data', (d) => { s += d; }); res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } }); }).on('error', reject);
    });
}

let build = null;
// opts.called: a page whose line dropped on its way in, back with its game still running as called.
// opts.joiner: through their own PC's server, as a friend is (never the host). opts.bot: an AI partner's page.
function client(name, opts) {
    const o = opts || {};
    const q = `?fp=${encodeURIComponent(build.fp)}&build=${encodeURIComponent(build.build)}&mod=${encodeURIComponent(build.mod)}&v=${encodeURIComponent(build.version)}`;
    const ws = new WebSocket(`ws://localhost:${PORT}/coop/ws${q}`, { headers: o.joiner ? { 'x-fh-join': '1' } : {} });
    // opts.st 'up': their game was already running when the line came up (begun offline, or the line dropped mid-load).
    const c = { name, ws, id: 0, lobby: null, got: [], st: o.st || 'title' };
    c.send = (msg) => ws.send(JSON.stringify(msg));
    c.say = (what, more) => c.send(Object.assign({ t: 'lobby', do: what }, more || {}));
    // 'up': not in the shared world yet, with a game running (the opening, a save loading).
    c.presence = (st) => { c.st = st || c.st; const out = c.st === 'title' || c.st === 'up'; c.send({ t: 'p', st: out ? 'title' : c.st, up: c.st === 'up' ? 1 : 0, m: out ? 0 : 1, bot: !!o.bot }); };
    c.count = (t) => c.got.filter((m) => m.t === t).length;
    c.last = (t) => c.got.filter((m) => m.t === t).pop() || null;
    c.enter = (ini, how) => c.send({ t: 'world?', runId: '', stamp: 0, how: how || 'new', ini: [ini] });
    c.close = () => new Promise((r) => { ws.on('close', r); ws.close(); });
    ws.on('message', (raw, binary) => {
        if (binary) return;
        const msg = JSON.parse(raw);
        c.got.push(msg);
        // A partner's page says what it is before its name (a partner this server started is known by name at once).
        if (msg.t === 'hello') { c.id = msg.id; if (o.bot) c.presence(); c.send({ t: 'name', name, token: 't-' + name, called: !!o.called }); c.presence(); }
        if (msg.t === 'lobby') c.lobby = msg;
    });
    // As a page does: where it is, said again every second.
    c.beat = setInterval(() => { if (ws.readyState === 1 && c.id) c.presence(); }, 1000);
    ws.on('close', () => clearInterval(c.beat));
    c.ready = new Promise((resolve, reject) => { ws.on('error', reject); const t = setInterval(() => { if (c.got.some((m) => m.t === 'nameok')) { clearInterval(t); resolve(c); } }, 20); });
    return c;
}

// The room answers within a few milliseconds here; a check reads the state once it has settled.
const settle = () => sleep(250);
const row = (c, of) => (c.lobby && c.lobby.rows[(of || c).id]) || {};

(async () => {
    const check = checker();
    let server;
    const open = [];
    try {
        server = await startServer(PORT, { FH_HOST_WAIT: '1200', FH_LINE_TITLE: '1500', FH_LINE_HOLD: '2500', FH_MIND: 'none' });
        build = await getJson(`http://localhost:${PORT}/coop/hello`);
        const join = async (name, opts) => { const c = client(name, opts); open.push(c); await c.ready; await settle(); return c; };

        // Who is here.
        let A = await join('Ann');
        check('one person: no lobby', A.lobby && A.lobby.on === false, JSON.stringify(A.lobby));
        const B = await join('Bo', { joiner: true });
        check('two people: the lobby is on, and the host is the one on the host\'s PC', A.lobby.on && B.lobby.on && B.lobby.host === A.id, JSON.stringify(B.lobby));

        // Nothing before the host has said what this night is.
        B.say('ready', { on: true });
        A.say('start');
        await settle();
        check('no run chosen: nobody is ready, and Start does nothing', !row(B).ready && A.count('go') === 0 && B.count('go') === 0);
        B.say('run', { run: { kind: 'new' }, pick: PRIEST });
        await settle();
        check('only the host chooses the run', A.lobby.run === null);

        // A new run: characters are picked here, one each.
        A.say('run', { run: { kind: 'new' }, pick: MERC });
        await settle();
        check('the host chooses a new run and their character', B.lobby.run && B.lobby.run.kind === 'new' && row(B, A).pick === MERC, JSON.stringify(B.lobby));
        B.say('ready', { on: true });
        await settle();
        check('not ready without a character', !row(B).ready);
        B.say('pick', { pick: MERC });
        await settle();
        check('the host\'s character cannot be picked', row(B).pick === 0);
        B.say('pick', { pick: PRIEST });
        let C = await join('Cy', { joiner: true });
        C.say('pick', { pick: PRIEST });
        await settle();
        check('a character someone here has picked cannot be picked again', row(A, B).pick === PRIEST && row(A, C).pick === 0, JSON.stringify(A.lobby.rows));
        C.say('pick', { pick: OUTLANDER });
        B.say('ready', { on: true });
        await settle();
        check('picked and ready', row(A, B).ready && row(A, C).pick === OUTLANDER && !row(A, C).ready);
        B.say('pick', { pick: KNIGHT });
        await settle();
        check('ready holds the character: no other pick while ready', row(A, B).pick === PRIEST);

        // Start waits for everyone here; someone away does not hold it up.
        A.say('start');
        await settle();
        check('Start does nothing while someone here is not ready', A.count('go') === 0 && A.lobby.line.length === 0);
        B.say('away', { on: true });
        C.say('away', { on: true });
        await settle();
        check('away: only someone who is not ready', !row(A, B).away && row(A, C).away === true);
        C.say('ready', { on: true });
        await settle();
        check('not ready while away', !row(A, C).ready);
        A.say('start');
        await settle();
        check('Start calls the host and everyone ready, at once, and not the one away',
            A.count('go') === 1 && B.count('go') === 1 && C.count('go') === 0 && A.lobby.line.slice().sort().join() === [A.id, B.id].sort().join(), JSON.stringify(A.lobby.line));
        B.say('ready', { on: false });
        A.say('run', { run: null });
        await settle();
        check('once called: no stepping back, and no other run', row(A, B).ready && A.lobby.run && A.lobby.line.length === 2, JSON.stringify(A.lobby));

        // Only the host's game founds the run, however long it takes.
        B.presence('up');
        A.presence('up');
        B.enter(PRIEST);
        await sleep(1500); // past FH_HOST_WAIT, after which someone not called would go on alone
        B.enter(PRIEST);
        await settle();
        check('a joiner whose game is up first waits for the host, with no going on alone', B.count('world') === 0 && B.count('worldhost') >= 2, 'world ' + B.count('world') + ', worldhost ' + B.count('worldhost'));
        const P = await join("D'arce", { bot: true });
        P.presence('up');
        A.enter(MERC);
        await settle();
        check('the host founds the run', A.last('world') && A.last('world').founded === true && B.lobby.founded === true && B.lobby.line.join() === String(B.id), JSON.stringify(B.lobby));
        P.enter(KNIGHT);
        await settle();
        check('an AI partner waits while a person is still on the way in', P.count('world') === 0 && P.count('worldhost') >= 1);
        B.enter(PRIEST);
        await settle();
        check('the joiner comes into the host\'s run, and is no longer "ready"', B.last('world') && B.last('world').mode === 'join' && A.lobby.line.length === 0 && !row(A, B).ready, JSON.stringify(A.lobby));
        P.enter(KNIGHT);
        await settle();
        check('then the partner comes in', P.count('world') === 1);

        // A run under way: someone at the title joins it.
        C.say('away', { on: false });
        C.say('pick', { pick: 0 });
        await settle();
        check('under way, without a character: no Join', (C.say('join'), await settle(), C.count('go') === 0));
        C.say('pick', { pick: KNIGHT });
        await settle();
        check('a character someone in the run plays cannot be picked', row(C).pick === 0, JSON.stringify(row(C)));
        C.say('pick', { pick: OUTLANDER });
        C.say('join');
        await settle();
        check('Join calls them in', C.count('go') === 1 && A.lobby.line.join() === String(C.id), JSON.stringify(A.lobby.line));
        C.presence('up');
        // Someone whose game was running uncalled (begun before the lobby, or their line dropped
        // mid-load) arrives as the same character: they yield, not the one the lobby called.
        const D = await join('Di', { joiner: true, st: 'up' });
        D.enter(OUTLANDER);
        await settle();
        check('an uncalled game arriving as a called person\'s character is refused', D.count('worldclash') === 1 && D.count('world') === 0, 'clash ' + D.count('worldclash') + ', world ' + D.count('world'));
        await D.close();
        C.enter(OUTLANDER);
        await settle();
        check('and they are in', C.last('world') && C.last('world').mode === 'join' && A.lobby.line.length === 0);

        // The run ends with the last one out, and the lobby starts clean.
        await P.close();
        for (const c of [B, C, A]) { c.send({ t: 'leftworld' }); c.presence('title'); }
        await settle();
        check('the last one out ends the run; the next is chosen afresh',
            A.lobby.founded === false && A.lobby.run === null && [A, B, C].every((c) => !row(A, c).pick && !row(A, c).ready), JSON.stringify(A.lobby));

        // Carrying a save on: each is who their own save says, and two of the same cannot both be ready.
        A.say('run', { run: { kind: 'save', runId: 'abc123', stamp: 5, map: 3 }, has: MERC });
        B.say('has', { has: PRIEST });
        C.say('has', { has: PRIEST });
        await settle();
        A.say('pick', { pick: KNIGHT });
        B.say('ready', { on: true });
        C.say('ready', { on: true });
        await settle();
        check('a save: the host is who their save is', row(A).pick === 0 && A.lobby.run.kind === 'save' && A.lobby.run.runId === 'abc123');
        check('two saves of one character: the second cannot be ready', row(A, B).ready === true && !row(A, C).ready, JSON.stringify(A.lobby.rows));
        C.say('pick', { pick: OUTLANDER });
        C.say('ready', { on: true });
        await settle();
        check('coming in as someone new instead', row(A, C).ready === true && row(A, C).pick === OUTLANDER);
        B.say('has', { has: KNIGHT });
        await settle();
        check('a ready person whose save turns out another: no longer ready', !row(A, B).ready && row(A, B).has === KNIGHT);
        A.say('run', { run: { kind: 'new' }, pick: MERC });
        await settle();
        check('another run: nobody stays ready, no pick stays', A.lobby.run.kind === 'new' && [B, C].every((c) => !row(A, c).ready && !row(A, c).pick), JSON.stringify(A.lobby.rows));

        // The host's game drops with a start under way: the start is off, and nobody founds the run alone.
        B.say('pick', { pick: PRIEST });
        C.say('pick', { pick: OUTLANDER });
        await settle();
        B.say('ready', { on: true });
        C.say('ready', { on: true });
        await settle();
        A.say('start');
        await settle();
        check('a start with all three', A.lobby.line.length === 3 && B.count('go') === 2 && C.count('go') === 2, JSON.stringify(A.lobby.line));
        B.presence('up');
        const worlds = B.count('world');
        await A.close();
        await settle();
        check('the host drops before the run exists: the start is called off and the lobby cleared',
            B.lobby.line.length === 0 && B.lobby.run === null && B.lobby.founded === false && !row(B).ready && !row(B).pick, JSON.stringify(B.lobby));
        B.enter(PRIEST);
        await sleep(1500);
        B.enter(PRIEST);
        await settle();
        check('someone called by that start does not found a run on their way back to the title', B.count('world') === worlds, 'world ' + B.count('world'));
        B.presence('title');
        await settle();

        // Called in, and their game never starts: they are not waited for.
        A = await join('Ann');
        A.say('run', { run: { kind: 'new' }, pick: MERC });
        await settle();
        B.say('pick', { pick: PRIEST });
        C.say('pick', { pick: OUTLANDER });
        await settle();
        B.say('ready', { on: true });
        C.say('ready', { on: true });
        await settle();
        A.say('start');
        await settle();
        A.presence('up');
        B.presence('up'); // Cy stays at the title
        await sleep(3200);
        check('called and still at the title: dropped from the call, the others go on', A.lobby.line.slice().sort().join() === [A.id, B.id].sort().join() && A.lobby.run, JSON.stringify(A.lobby.line));
        A.presence('title'); // the host's game never started either
        await sleep(3200);
        check('the host called and still at the title: the start is off', B.lobby.line.length === 0 && B.lobby.run === null, JSON.stringify(B.lobby));

        // A run founded by someone the lobby did not call (their game was running before the host
        // chose): what was said for the host's night does not carry into it.
        B.presence('title');
        await settle();
        A.say('run', { run: { kind: 'new' }, pick: MERC });
        await settle();
        B.say('pick', { pick: PRIEST });
        await settle();
        B.say('ready', { on: true });
        await settle();
        await C.close();
        C = await join('Cy', { joiner: true, st: 'up' });
        C.enter(OUTLANDER);
        await sleep(1500); // past FH_HOST_WAIT: the host has not started, the one waiting goes on alone
        C.enter(OUTLANDER);
        await settle();
        check('a game begun uncalled founds the run once the host has not started in time', C.last('world') && C.last('world').founded === true && A.lobby.founded === true, JSON.stringify(A.lobby));
        check('and nobody stays ready or picked for the night that was not started', !row(A, B).ready && !row(A, B).pick && !row(A).pick, JSON.stringify(A.lobby.rows));

        // The run is lost (the only one in drops) with someone on the way in: their game does not
        // found a run of its own.
        B.say('pick', { pick: KNIGHT });
        await settle();
        B.say('join');
        await settle();
        B.presence('up');
        check('called into the run under way', B.lobby.line.join() === String(B.id), JSON.stringify(B.lobby.line));
        const before = B.count('world');
        await C.close();
        await settle();
        B.enter(KNIGHT);
        await sleep(1500);
        B.enter(KNIGHT);
        await settle();
        check('the run ended under someone called in: they do not found one on the way back', A.lobby.founded === false && B.count('world') === before, 'founded ' + A.lobby.founded + ', world ' + (B.count('world') - before));
        B.presence('title');
        await settle();

        // An AI partner follows people into a run. It never starts one, however long it waits.
        const Q = await join('Cahara', { bot: true, st: 'up' });
        Q.enter(MERC);
        await sleep(1500);
        Q.enter(MERC);
        await settle();
        check('an AI partner never founds a run', Q.count('world') === 0 && Q.count('worldhost') >= 2 && A.lobby.founded === false, 'world ' + Q.count('world') + ', worldhost ' + Q.count('worldhost'));

        // A name changed in the name box is still the same person (Grok g14): called in under the
        // old one, they are still awaited; having been in the run, their save of it is still its past.
        Q.ws.terminate();
        await settle();
        A.say('run', { run: { kind: 'new' }, pick: PRIEST });
        await settle();
        B.say('pick', { pick: KNIGHT });
        B.say('ready', { on: true });
        await settle();
        A.say('start');
        await settle();
        A.presence('up');
        B.presence('up');
        B.send({ t: 'name', name: 'Bob', token: 't-Bo' });
        await settle();
        check('renamed while called in: still in the line, the character still theirs', A.lobby.line.indexOf(B.id) >= 0 && A.lobby.line.length === 2, JSON.stringify(A.lobby.line));
        A.enter(PRIEST);
        await settle();
        B.enter(KNIGHT);
        await settle();
        check('and the line empties once they are in', A.lobby.founded && A.lobby.line.length === 0, JSON.stringify(A.lobby.line));
        const runId = (B.last('world') || {}).runId;
        A.presence('map');
        B.presence('title');
        await settle();
        B.send({ t: 'name', name: 'Bo', token: 't-Bo' });
        await settle();
        const stale = B.count('worldstale');
        B.send({ t: 'world?', runId, stamp: 0, how: 'load', ini: [KNIGHT] });
        await settle();
        check('renamed after leaving the run: their save is still not let back into it', !!runId && B.count('worldstale') === stale + 1, 'worldstale ' + (B.count('worldstale') - stale));

        // A line that drops on the way in (Grok g14): the page plays on through its opening, so the
        // call and the character are kept for it. Ann is in the run; Flo joins as the outlander.
        let F = await join('Flo', { joiner: true });
        F.say('pick', { pick: OUTLANDER });
        await settle();
        F.say('join');
        await settle();
        F.presence('up');
        F.ws.terminate();
        await settle();
        const E = await join('Ed', { joiner: true });
        E.say('pick', { pick: OUTLANDER });
        await settle();
        check('called, and the line drops: the character is still theirs', A.lobby.held.indexOf(OUTLANDER) >= 0 && row(E).pick !== OUTLANDER, JSON.stringify(A.lobby.held) + ' ' + JSON.stringify(row(E)));
        let U = await join('Uma', { joiner: true, st: 'up' });
        U.enter(OUTLANDER);
        await settle();
        check('and an uncalled game arriving as that character is refused', U.count('worldclash') === 1 && U.count('world') === 0, 'clash ' + U.count('worldclash') + ', world ' + U.count('world'));
        U.ws.terminate();
        F = await join('Flo', { joiner: true, st: 'up', called: true });
        check('the page back with its game still running: called again, as before', A.lobby.line.indexOf(F.id) >= 0 && A.lobby.held.length === 0, JSON.stringify(A.lobby.line) + ' ' + JSON.stringify(A.lobby.held));
        F.enter(OUTLANDER);
        await settle();
        check('and let in as that character', F.count('world') === 1 && A.lobby.line.length === 0, 'world ' + F.count('world') + ', clash ' + F.count('worldclash'));
        // Back without that game (the page was reloaded): the call is dropped, and they choose again.
        E.say('pick', { pick: MERC });
        await settle();
        E.say('join');
        await settle();
        E.presence('up');
        E.ws.terminate();
        await settle();
        const held = JSON.stringify(A.lobby.held);
        const E2 = await join('Ed', { joiner: true });
        check('back at the title instead: no longer called, the character free', held === JSON.stringify([MERC]) && A.lobby.held.length === 0 && A.lobby.line.length === 0 && !row(E2).pick, held + ' ' + JSON.stringify(A.lobby.line) + ' ' + JSON.stringify(row(E2)));
        // Never back: the call is dropped after a while, so a partner is not kept waiting for ever.
        E2.say('pick', { pick: MERC });
        await settle();
        E2.say('join');
        await settle();
        E2.presence('up');
        E2.ws.terminate();
        await settle();
        const during = JSON.stringify(A.lobby.held);
        await sleep(2800);
        check('never back: the call is dropped after a while', during === JSON.stringify([MERC]) && A.lobby.held.length === 0 && A.lobby.line.length === 0, during + ' ' + JSON.stringify(A.lobby.held));

        // Someone called who takes a held name as their own (Grok g15): the hold ends, their own call stays.
        const G = await join('Gus', { joiner: true });
        G.say('pick', { pick: MERC });
        await settle();
        G.say('join');
        await settle();
        G.presence('up');
        G.ws.terminate();
        B.say('pick', { pick: KNIGHT });
        await settle();
        // (Bo said title while in the run a moment ago: the room takes them out of it within ten seconds.)
        for (let i = 0; i < 50 && A.lobby.line.indexOf(B.id) < 0; i++) { B.say('join'); await settle(); }
        B.presence('up');
        await settle();
        const wasHeld = JSON.stringify([A.lobby.held, A.lobby.line.indexOf(B.id) >= 0]);
        B.send({ t: 'name', name: 'Gus', token: 't-Bo' });
        await settle();
        check('a called person renamed onto a held name: the hold ends, their own call stays', wasHeld === JSON.stringify([[MERC], true]) && A.lobby.held.length === 0 && A.lobby.line.indexOf(B.id) >= 0 && A.lobby.line.length === 1, wasHeld + ' ' + JSON.stringify(A.lobby.held) + ' ' + JSON.stringify(A.lobby.line));
    } catch (e) {
        console.error(e);
        check('test ran to the end', false);
    }
    for (const c of open) try { c.ws.terminate(); } catch (e) { /* closed */ }
    const code = check.finish([]);
    if (server) server.kill();
    process.exit(code);
})();
