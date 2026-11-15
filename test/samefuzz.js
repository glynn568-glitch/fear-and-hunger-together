// Hunt, not a suite: both players use the same thing at the same moment. For every event on a map
// that a player starts by hand (no fights, no game over), both games start it in the same frame
// and press through its messages taking the first choice. Then: did either get stuck, throw, end
// up with a shared world the other does not see, or hold the same companion as the other?
//   node test/samefuzz.js [map] [maxEvents]     default map 1, every event; 12 minutes at most
// Host 8515, joiner 8615. Prints one line per event with anything wrong, and a summary.
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const install = require('./helpers');

const MAP = Number(process.argv[2]) || 1;
const MAX = Number(process.argv[3]) || 1e9;
const BUDGET = Date.now() + 12 * 60 * 1000;

// In the page: the events worth trying, from this machine's current pages.
function candidates() {
    const out = [];
    for (const ev of $gameMap.events()) {
        const page = ev.page();
        if (!page || ev._erased || page.trigger > 2 || page.list.length <= 1) continue;
        if (page.list.some((c) => c.code === 301 || c.code === 353)) continue;
        // Walled in on every side: no one can stand next to it to press it (Map001 EV140, the
        // developer's kit that hands out Moonless, sits inside a wall).
        const near = [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]].some(([dx, dy]) => $gameMap.isValid(ev.x + dx, ev.y + dy) && [2, 4, 6, 8].some((d) => $gameMap.isPassable(ev.x + dx, ev.y + dy, d)));
        if (!near) continue;
        out.push([ev.eventId(), ev.event().name, page.list.length]);
    }
    return out;
}

// In the page: start event `id` and press through it; resolves once it is over or after 20 s.
function useIt(id) {
    window.__errs = window.__errs || [];
    if (!window.__errHooked) {
        window.__errHooked = true;
        window.addEventListener('error', (e) => window.__errs.push(String(e.message)));
    }
    const ev = $gameMap.event(id);
    if (!ev || !ev.page()) return Promise.resolve({ skipped: true });
    const errs = window.__errs.length;
    ev.start();
    const t0 = Date.now();
    return new Promise((resolve) => {
        let quiet = 0;
        const t = setInterval(() => {
            const busy = $gameMessage.isBusy() || $gameMap.isEventRunning() || SceneManager.isSceneChanging() || !(SceneManager._scene instanceof Scene_Map);
            if (busy) { quiet = 0; Input._currentState.ok = !Input._currentState.ok; } else quiet++;
            if (quiet >= 8 || Date.now() - t0 > 20000) {
                clearInterval(t);
                Input._currentState.ok = false;
                resolve({ stuck: quiet < 8, scene: SceneManager._scene && SceneManager._scene.constructor.name, text: $gameMessage.isBusy() ? $gameMessage.allText().slice(0, 80) : '', errs: window.__errs.slice(errs) });
            }
        }, 60);
    });
}

const look = () => ({
    fp: Coop.world.fingerprint(),
    party: $gameParty._actors.slice(),
    map: $gameMap.mapId(),
    seen: !$gamePlayer.isTransparent(),
    dead: $gameParty.isAllDead(),
    live: Coop.world.live,
});

// In the page: back to a standing start after whatever the event did.
function tidy(home) {
    if ($gameParty.isAllDead()) $gameParty.members().forEach((a) => a.recoverAll());
    if ($gameMap.isEventRunning() || $gameMessage.isBusy()) T.settle();
    $gamePlayer.setTransparent(false);
    if ($gameMap.mapId() !== home[0]) { $gamePlayer.reserveTransfer(home[0], home[1], home[2], 2, 0); return 'sent back'; }
    return '';
}

function diffFp(x, y) {
    const a = new Set(x.split(';')), b = new Set(y.split(';'));
    return { onlyHost: [...a].filter((k) => !b.has(k)).slice(0, 6), onlyFriend: [...b].filter((k) => !a.has(k)).slice(0, 6) };
}

(async () => {
    const browser = await launch();
    const host = await startServer(8515, {});
    const joiner = await startServer(8615, { FH_JOIN: 'http://localhost:8515/' });
    const found = [];
    try {
        const a = await openPlayer(browser, 'http://localhost:8515/?name=Ann', 'host');
        const b = await openPlayer(browser, 'http://localhost:8615/?name=Bo', 'friend');
        for (const p of [a, b]) {
            await waitFor(p, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected && Coop.peers.size === 1, 90000, 'title + connection');
            await p.evaluate(install);
        }
        await a.evaluate(() => T.quickStart(1, 27, 66));
        await waitFor(a, () => T.onMap(), 60000, 'host on map');
        await a.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(a, () => Coop.world.live, 10000, 'host live');
        await b.evaluate(() => T.quickStart(3, 27, 67));
        await waitFor(b, () => T.onMap(), 60000, 'friend on map');
        await b.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(b, () => Coop.world.live, 10000, 'friend live');
        const homeA = [1, 27, 66], homeB = [1, 27, 67];
        if (MAP !== 1) {
            await a.evaluate((m) => $gamePlayer.reserveTransfer(m[0], m[1], m[2], 2, 0), [MAP, 10, 10]);
            await b.evaluate((m) => $gamePlayer.reserveTransfer(m[0], m[1], m[2], 2, 0), [MAP, 10, 11]);
            homeA[0] = homeB[0] = MAP; homeA[1] = homeB[1] = 10; homeA[2] = 10; homeB[2] = 11;
            await waitFor(a, () => T.onMap(), 30000, 'host on the map');
            await waitFor(b, () => T.onMap(), 30000, 'friend on the map');
        }
        await sleep(1500);
        for (const p of [a, b]) await p.evaluate(() => T.settle());
        const list = (await a.evaluate(candidates)).slice(0, MAX);
        console.log(`map ${MAP}: ${list.length} events to try`);
        let n = 0;
        for (const [id, name, len] of list) {
            if (Date.now() > BUDGET) { console.log('time budget spent after ' + n + ' events'); break; }
            n++;
            const before = await a.evaluate(look);
            const [ra, rb] = await Promise.all([a.evaluate(useIt, id), b.evaluate(useIt, id)]);
            await sleep(1500);
            const [la, lb] = [await a.evaluate(look), await b.evaluate(look)];
            const wrong = [];
            if (ra.stuck) wrong.push('host stuck in ' + ra.scene + ' "' + ra.text + '"');
            if (rb.stuck) wrong.push('friend stuck in ' + rb.scene + ' "' + rb.text + '"');
            if (ra.errs && ra.errs.length) wrong.push('host threw: ' + ra.errs.join(' / ').slice(0, 200));
            if (rb.errs && rb.errs.length) wrong.push('friend threw: ' + rb.errs.join(' / ').slice(0, 200));
            const both = la.party.filter((x) => lb.party.indexOf(x) >= 0);
            if (both.length) wrong.push('same companion in both parties: ' + both.join(','));
            if (la.map === lb.map && la.fp !== lb.fp) wrong.push('worlds differ ' + JSON.stringify(diffFp(la.fp, lb.fp)));
            if (!la.seen || !lb.seen) wrong.push('left invisible: ' + (!la.seen ? 'host ' : '') + (!lb.seen ? 'friend' : ''));
            if (!la.live || !lb.live) wrong.push('out of the shared world: ' + (!la.live ? 'host ' : '') + (!lb.live ? 'friend' : ''));
            if (la.party.length !== before.party.length) wrong.push('host party ' + before.party.join(',') + ' -> ' + la.party.join(','));
            const line = `ev ${id} ${name} (${len} cmds)` + (ra.skipped || rb.skipped ? ' [skipped on one side]' : '');
            if (wrong.length) { found.push(line + ': ' + wrong.join('; ')); console.log('ODD ' + line + ': ' + wrong.join('; ')); }
            const back = [await a.evaluate(tidy, homeA), await b.evaluate(tidy, homeB)];
            if (back.some(Boolean)) {
                await waitFor(a, () => T.onMap(), 30000, 'host back');
                await waitFor(b, () => T.onMap(), 30000, 'friend back');
                await sleep(800);
            }
            // A world that split stays split: line the friend up with the host's so the next event starts even.
            if (la.fp !== lb.fp) { await sleep(2000); }
        }
        console.log(`\n${n} events tried, ${found.length} odd`);
    } catch (e) { console.error(e); }
    await browser.close();
    host.kill();
    joiner.kill();
    process.exit(0);
})();
