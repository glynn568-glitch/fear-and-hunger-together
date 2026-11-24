// The yard hounds wait until everyone is in, a flaky suite blocks the release, and the
// launchers share the server's one tunnel and will not open a second game (11/22).
// Ports 8576 and 8676 (the joiner, when the line suites run that way).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { startServer, launch, openPlayer, waitFor, sleep, ROOT } = require('./lib');
const { twoPlayers, checker } = require('./common');
const { modeOk, flakyReason } = require('./gate');

const PORT = 8576;
const ALREADY = 'Fear & Hunger Together is already running.';
const HOUNDS = [102, 113, 114]; // Map074 hound1, hound2, hound3
const COMING = 1781, TIMER = 211;

function getJson(port, pathname) {
    return new Promise((resolve, reject) => {
        const req = http.get({ hostname: '127.0.0.1', port, path: pathname, headers: { 'x-fh-app': '1' } }, (res) => {
            let t = '';
            res.on('data', (d) => { t += d; });
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(t || '{}') }); }
                catch (e) { resolve({ status: res.statusCode, body: {} }); }
            });
        });
        req.on('error', reject);
    });
}

function postJson(port, pathname, body) {
    const data = JSON.stringify(body || {});
    return new Promise((resolve) => {
        const req = http.request({
            hostname: '127.0.0.1', port, path: pathname, method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'x-fh-app': '1' },
        }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
        req.on('error', () => resolve(0));
        req.end(data);
    });
}

// A twin of a launcher is not a module the test hook can rewrite. Run that copy,
// still aimed at this folder (the script's own folder would be the copy's).
function launcher(file) {
    const disk = path.join(ROOT, file);
    let text = fs.readFileSync(disk, 'utf8');
    if (process.env.FH_TWIN) {
        const next = require('./twins').twinSource(process.env.FH_TWIN, file, text);
        if (next !== null) text = next;
    }
    if (text === fs.readFileSync(disk, 'utf8')) return disk;
    const out = path.join(__dirname, 'out');
    fs.mkdirSync(out, { recursive: true });
    const copy = path.join(out, 'houndhold-' + path.basename(file));
    fs.writeFileSync(copy, text.replace('$root = $PSScriptRoot', "$root = '" + ROOT.replace(/'/g, "''") + "'"));
    return copy;
}

function runPs(args) {
    const file = launcher('start.ps1');
    const base = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, ...args];
    const opt = { encoding: 'utf8', timeout: 120000, cwd: ROOT, windowsHide: true };
    let ran = spawnSync('pwsh', base, opt);
    if (ran.error) ran = spawnSync('powershell', base, opt);
    return ran;
}

function runPlay() {
    const file = launcher('play.sh');
    const args = ['--no-browser', '--port=' + PORT];
    const opt = { encoding: 'utf8', timeout: 30000, cwd: ROOT, windowsHide: true };
    let ran = spawnSync('sh', [file, ...args], opt);
    if (!ran.error) return ran;
    const repo = '/mnt/' + path.dirname(file).replace(/^([A-Za-z]):/, (_, d) => d.toLowerCase()).replace(/\\/g, '/');
    const name = path.basename(file);
    return spawnSync('wsl', ['-e', 'sh', repo + '/' + name, ...args], opt);
}

function stopServer(proc) {
    return new Promise((resolve) => {
        if (!proc || proc.exitCode !== null) { resolve(); return; }
        postJson(PORT, '/coop/app/quit', {});
        const t = setTimeout(() => { try { proc.kill(); } catch (e) { /* already gone */ } resolve(); }, 5000);
        proc.once('exit', () => { clearTimeout(t); resolve(); });
    });
}

(async () => {
    const check = checker();
    let server, browser, hostPage, s;
    try {
        const gateSrc = fs.readFileSync(path.join(__dirname, 'gate.js'), 'utf8');
        const reason = flakyReason({ default: { broken: [], flaky: ['soak'] }, join: { broken: [], flaky: ['soak'] } });
        check('a flaky suite blocks the release and is named',
            modeOk({ broken: [], flaky: ['soak'] }) === false
            && modeOk({ broken: [], flaky: [] }) === true
            && modeOk({ broken: ['events'], flaky: [] }) === false
            && reason === 'soak passed alone 3 of 3'
            && /if \(pass && full && !dirty && same\)/.test(gateSrc),
            reason);

        server = await startServer(PORT, { FH_TUNNEL_FAKE: 'http://127.0.0.1:' + PORT });
        const again = runPs(['-NoBrowser', '-Port', String(PORT)]);
        const againText = (again.stdout || '') + '\n' + (again.stderr || '');
        check('a second start says the game is already running and opens nothing',
            again.status === 0 && againText.includes(ALREADY) && !/The game is at/.test(againText),
            againText.slice(0, 700));
        const local = await getJson(PORT, '/coop/app');
        check('that start left the game on this PC', local.body.mode === 'local', JSON.stringify(local.body));

        const play = runPlay();
        const playText = (play.stdout || '') + '\n' + (play.stderr || '');
        const noPlay = (play.error && play.error.code === 'ENOENT') || /This needs curl|No such file|cannot execute/i.test(playText);
        // A skip that passed let the gate through with play.sh untested (11/24, as deck.js).
        if (noPlay) check('play.sh second start: no sh or WSL answered, so play.sh is untested', false, (playText || 'not run').slice(0, 200));
        else check('play.sh says the game is already running and opens nothing',
            play.status === 0 && playText.includes(ALREADY) && !/The game is at/.test(playText),
            playText.slice(0, 700));

        const hosted = runPs(['-Online', '-NoBrowser', '-Port', String(PORT)]);
        const hostedText = (hosted.stdout || '') + '\n' + (hosted.stderr || '');
        check('the start script prints the server\'s link', hosted.status === 0 && /\?k=[0-9a-f]{16}/.test(hostedText), hostedText.slice(0, 700));
        const online = await getJson(PORT, '/coop/app');
        check('the game is online on that one link, Hide my IP still on',
            online.body.mode === 'online' && online.body.private === true && /\?k=[0-9a-f]{16}/.test(online.body.link || ''),
            JSON.stringify(online.body));
        const againOnline = runPs(['-Online', '-NoBrowser', '-Port', String(PORT)]);
        const kept = await getJson(PORT, '/coop/app');
        check('hosting again keeps the same link', againOnline.status === 0 && !!online.body.link && kept.body.link === online.body.link, kept.body.link);

        browser = await launch();
        hostPage = await openPlayer(browser, 'http://127.0.0.1:' + PORT + '/?name=Ann', 'host');
        await waitFor(hostPage, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected && Coop.together, 90000, 'title');
        await hostPage.evaluate(() => Coop.together.open());
        await waitFor(hostPage, () => /Online/.test((document.querySelector('#coop-together .status') || {}).textContent || ''), 15000, 'Together says online');
        const shown = await hostPage.evaluate(() => ({
            status: document.querySelector('#coop-together .status').textContent,
            link: document.querySelector('#coop-together [data-field=link]').value,
        }));
        check('Together shows that link, not just this PC',
            /Online/.test(shown.status) && shown.status.indexOf('Just you, on this PC') < 0 && shown.link === online.body.link,
            JSON.stringify(shown));
        await browser.close();
        browser = null;
        await stopServer(server);
        server = null;

        // Both are in one run. The bark timer is each machine's own (variable 211).
        s = await twoPlayers(8576);
        const { a, b } = s;
        const gates = await a.evaluate((id) => {
            const L = Coop.lobby;
            const line = (L.line || []).slice(), calls = (L.held || []).slice();
            const peer = Coop.others()[0];
            const saved = peer ? { m: peer.m, st: peer.st, up: peer.up } : null;
            const v0 = $gameVariables.value(211) || 0;
            const put = (n) => { if (peer) { peer.m = n.m; peer.st = n.st; peer.up = n.up; peer.alone = n.alone || 0; } };
            const out = {};
            L.line = [id]; L.held = [];
            put({ m: 1, st: 'map', up: 0 });
            $gameVariables.setValue(211, v0 + 3);
            out.lineHolds = $gameVariables.value(211) === v0;
            $gameVariables.setValue(211, 0);
            out.down = $gameVariables.value(211) === 0;
            L.line = []; L.held = [661];
            $gameVariables.setValue(211, 4);
            out.heldHolds = $gameVariables.value(211) === 0;
            L.line = []; L.held = [];
            put({ m: 1, st: 'map', up: 0 });
            $gameVariables.setValue(211, 5);
            out.free = $gameVariables.value(211) === 5;
            put({ m: 0, st: 'title', up: 0 });
            out.idle = !Coop.events.barkHeld();
            put({ m: 10, st: 'map', up: 0 });
            out.map10 = !!peer && Coop.events.barkHeld();
            put({ m: 0, st: 'title', up: 1 });
            out.before = !!peer && Coop.events.barkHeld();
            put({ m: 0, st: 'title', up: 1, alone: 1 }); // refused, playing a game of their own
            out.alone = !!peer && !Coop.events.barkHeld();
            put({ m: 0, st: 'title', up: 1, alone: 0 });
            $gameVariables._data[211] = 100;
            $gameVariables.setValue(211, 101);
            out.step = $gameVariables.value(211) === 101;
            $gameVariables.setValue(211, 102);
            out.stepHeld = $gameVariables.value(211) === 101;
            if (saved) put(saved);
            L.line = line; L.held = calls;
            $gameVariables._data[211] = v0;
            return out;
        }, s.idB);
        check('the bark timer waits for a line, a held call, the opening, or before the run, not for someone playing alone',
            gates.lineHolds && gates.down && gates.heldHolds && gates.free && gates.idle && gates.map10 && gates.before && gates.alone && gates.step && gates.stepHeld,
            JSON.stringify(gates));

        await a.evaluate(() => $gamePlayer.reserveTransfer(74, 20, 12, 2, 0));
        await waitFor(a, () => T.onMap() && $gameMap.mapId() === 74 && !$gamePlayer.isTransferring(), 30000, 'A in the yard');
        await a.evaluate(() => T.settle());
        const spot = await a.evaluate(() => {
            const open = (x, y) => $gameMap.isValid(x, y) && !$gameMap.eventsXy(x, y).length && [2, 4, 6, 8].every((d) => $gameMap.isPassable(x, y, d));
            for (let r = 0; r < 12; r++) for (let dx = -r; dx <= r; dx++) for (const dy of [r - Math.abs(dx), Math.abs(dx) - r]) {
                const x = 20 + dx, y = 12 + dy;
                if (open(x, y)) return [x, y];
            }
            return null;
        });
        check('found open floor in the yard', !!spot, JSON.stringify(spot));
        if (spot) await a.evaluate((x, y) => { $gamePlayer.locate(x, y); }, spot[0], spot[1]);
        check('hunger is not pausing the bark timer', !(await a.evaluate(() => $gameSwitches.value(202))));

        // The opening, as the host actually hears it: not in the shared world, game still up
        // (presence: title, up). Leaving the run keeps the server from taking that for a ghost.
        await b.evaluate(() => { Coop.world.leave(); });
        await waitFor(a, () => Coop.events.barkHeld() && Coop.others().some((p) => (p.st || 'title') === 'title' && p.up), 15000, 'A sees Bo in the opening');
        check('the host is still in the yard', await a.evaluate(() => $gameMap.mapId() === 74 && T.onMap()));
        await a.evaluate((t, c) => { $gameSwitches.setValue(c, false); $gameVariables._data[t] = 249; }, TIMER, COMING);
        // One tick would do it. A real minute, so a slow frame cannot pass the old timer.
        await sleep(60000);
        const quiet = await a.evaluate((ids, t, c) => ({
            coming: $gameSwitches.value(c),
            timer: $gameVariables.value(t),
            battle: $gameParty.inBattle(),
            map: $gameMap.mapId(),
            held: Coop.events.barkHeld(),
            line: (Coop.lobby.line || []).slice(),
            calls: (Coop.lobby.held || []).slice(),
            hounds: ids.map((id) => {
                const ev = $gameMap.event(id), page = ev && ev.page();
                return { image: ev ? ev.characterName() : '', trigger: page ? ev._trigger : null };
            }),
        }), HOUNDS, TIMER, COMING);
        const notOut = quiet.hounds.every((h) => !h.image && h.trigger === null);
        check('a minute in the yard with a friend still in the opening: no hounds',
            !quiet.coming && quiet.timer <= 249 && !quiet.battle && quiet.map === 74 && quiet.held && notOut,
            JSON.stringify(quiet));

        // Refused into a game of their own (someone has the character): Bo's page says so, and the host stops
        // holding for him. Read off what Bo's page sends, then put him back on his way in (11/24).
        // The timer starts low so the hounds do not come during the moment it is not held.
        await a.evaluate((t) => { $gameVariables._data[t] = 0; }, TIMER);
        const alone = await b.evaluate(() => new Promise((resolve) => {
            const send = Coop.send;
            Coop.send = function (m) { if (m && m.t === 'p') { Coop.send = send; resolve({ alone: m.alone, up: m.up, st: m.st }); } return send.apply(this, arguments); };
            Coop.world.sameAs = 'Ann';
            Coop.reportPresence(true);
        }));
        const freed = await waitFor(a, () => !Coop.events.barkHeld(), 8000, 'the host stops holding').then(() => true, () => false);
        await b.evaluate(() => { Coop.world.sameAs = ''; Coop.reportPresence(true); });
        await waitFor(a, () => Coop.events.barkHeld(), 8000, 'held again while Bo is on his way in').catch(() => {});
        await a.evaluate((t) => { $gameVariables._data[t] = 249; }, TIMER);
        check('a friend refused into a game of their own says so, and the host stops holding for them',
            alone.alone === 1 && alone.up === 1 && alone.st === 'title' && freed, JSON.stringify({ alone, freed }));

        await b.evaluate(() => { Coop.world.live = true; Coop.reportPresence(true); });
        await waitFor(a, () => !Coop.events.barkHeld(), 15000, 'everyone is in');
        await waitFor(a, (c) => $gameSwitches.value(c), 20000, 'the hounds come once everyone is in', COMING);
        await sleep(800);
        const out = await a.evaluate((ids) => ids.map((id) => {
            const ev = $gameMap.event(id), page = ev && ev.page();
            return { image: ev ? ev.characterName() : '', trigger: page ? ev._trigger : null };
        }), HOUNDS);
        check('once everyone is in, the hounds come as before', out.every((h) => /moonless/.test(h.image) && h.trigger === 2), JSON.stringify(out));
    } catch (e) {
        console.error(e);
        check('test ran to the end', false, e && e.message);
    }
    const pages = [];
    if (hostPage) pages.push(hostPage);
    if (s) pages.push(s.a, s.b);
    const code = check.finish(pages);
    if (browser) { try { await browser.close(); } catch (e) { /* gone */ } }
    if (s) { try { await s.close(); } catch (e) { /* gone */ } }
    else if (server) { try { await stopServer(server); } catch (e) { /* gone */ } }
    process.exit(code);
})().catch((e) => { console.error(e); process.exit(1); });
