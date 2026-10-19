// The Together panel on the title screen: host online, a friend joins by
// pasting the link, a bad link is explained, the panel's endpoints refuse
// anyone but this PC, and private hosting keeps the browsers apart.
// The tunnel is faked: its "public" address is the host's own port.
const http = require('http');
const { startServer, launch, openPlayer, waitFor, sleep, shot } = require('./lib');
const install = require('./helpers');
const { checker } = require('./common');

const HOST = 8510, FRIEND = 8511, OTHER = 8512;

function post(port, pathname, body, headers) {
    return new Promise((resolve) => {
        const data = JSON.stringify(body || {});
        const req = http.request({ host: 'localhost', port, path: pathname, method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, headers || {}) }, (res) => {
            let t = ''; res.on('data', (d) => { t += d; }); res.on('end', () => resolve({ status: res.statusCode, text: t }));
        });
        req.on('error', () => resolve({ status: 0, text: '' }));
        req.end(data);
    });
}
const panel = (page) => page.evaluate(() => {
    const box = document.getElementById('coop-together');
    const vis = (sel) => { const el = box.querySelector(sel); return !!el && !el.hidden && !el.closest('[hidden]'); };
    return { open: box.classList.contains('open'), status: box.querySelector('.status').textContent, why: box.querySelector('.why').textContent,
        link: box.querySelector('[data-field=link]').value, joinShown: vis('[data-part=join]'), leaveShown: vis('[data-part=leave]') };
});

(async () => {
    const check = checker();
    const host = await startServer(HOST, { FH_TUNNEL_FAKE: `http://localhost:${HOST}` });
    const friend = await startServer(FRIEND);
    const other = await startServer(OTHER);
    const browser = await launch();
    let a, b, c;
    try {
        a = await openPlayer(browser, `http://localhost:${HOST}/?name=Ann`, 'host');
        b = await openPlayer(browser, `http://localhost:${FRIEND}/?name=Bo`, 'friend');
        c = await openPlayer(browser, `http://localhost:${OTHER}/?name=Cy`, 'other');
        for (const p of [a, b, c]) {
            await waitFor(p, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && SceneManager._scene._commandWindow && window.Coop && Coop.connected, 90000, 'title');
            await p.evaluate(install);
        }
        const cmds = await a.evaluate(() => SceneManager._scene._commandWindow._list.map((c) => c.name));
        check('the title menu offers Together', cmds.join('|') === 'New Game|Continue|Together' || cmds[cmds.length - 1] === 'Together', cmds.join('|'));
        await a.evaluate(() => { const w = SceneManager._scene._commandWindow; w.select(w._list.length - 1); w.callOkHandler(); });
        await waitFor(a, () => Coop.together.isOpen(), 5000, 'panel opens from the menu');
        await waitFor(a, () => document.querySelector('#coop-together .status').textContent !== '', 5000, 'the panel says where things stand');
        check('choosing it opens the panel', (await panel(a)).status === 'Just you, on this PC.');

        // Outsiders cannot drive the panel.
        const noHeader = await post(HOST, '/coop/app/online', { on: true });
        const remote = await post(HOST, '/coop/app/online', { on: true }, { 'x-fh-app': '1', 'cf-connecting-ip': '203.0.113.9' });
        check('only this PC, with the panel\'s header, may switch modes', noHeader.status === 403 && remote.status === 403, noHeader.status + ' ' + remote.status);

        // Host online.
        await a.evaluate(() => Coop.together.act('online'));
        await waitFor(a, () => document.querySelector('#coop-together [data-field=link]').value, 15000, 'a link');
        const pa = await panel(a);
        const link = pa.link;
        console.log('screenshot', await shot(a, 'together-online'));
        check('hosting online gives a keyed link', new RegExp(`^http://localhost:${HOST}/\\?k=[0-9a-f]{16}$`).test(link) && /Online/.test(pa.status), link);

        // A wrong key, then the real link.
        await b.evaluate(() => Coop.together.open());
        await b.evaluate(() => { document.querySelector('#coop-together [data-field=join]').value = location.origin.replace(/\d+$/, '') + '8510/?k=0000000000000000'; Coop.together.act('join'); });
        await waitFor(b, () => /old or cut short/.test(document.querySelector('#coop-together .why').textContent), 10000, 'bad link explained');
        check('a link with the wrong key is explained', true);
        await b.evaluate((l) => { document.querySelector('#coop-together [data-field=join]').value = l; Coop.together.act('join'); }, link);
        await waitFor(b, () => /Joined/.test(document.querySelector('#coop-together .why').textContent), 15000, 'joined');
        await waitFor(b, () => Coop.connected && Array.from(Coop.peers.values()).some((p) => p.name === 'Ann'), 15000, 'connected to the host');
        const pb = await panel(b);
        check('pasting the link joins the host\'s game', pb.leaveShown && !pb.joinShown && /friend/.test(pb.status), JSON.stringify(pb));
        // Each side hears of the other in its own time over a slow line.
        check('the host sees the friend arrive', await waitFor(a, () => Array.from(Coop.peers.values()).some((p) => p.name === 'Bo'), 15000, 'the host sees Bo').then(() => true, () => false));

        // A bug report: versions, the logs, what the game is doing; never the key.
        await a.evaluate(() => { navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); }; });
        await a.evaluate(() => document.querySelector('#coop-together [data-do=report]').click());
        await waitFor(a, () => window.__copied && /copied/.test(document.querySelector('#coop-together .why').textContent), 8000, 'a report copied');
        const report = await a.evaluate(() => window.__copied);
        const key = link.split('k=')[1];
        check('a bug report holds the versions, the server log and the game\'s own notes', /^Fear & Hunger Together \S+ \(mod \w+\), game build/.test(report)
            && /--- server log \(end\) ---[\s\S]*online at/.test(report) && /--- this game \(end\) ---/.test(report) && /scene: Scene_Title/.test(report), report.slice(0, 300));
        check('...and never the link\'s key or the Windows user folder', !report.includes(key) && /k=\(key\)/.test(report) && !report.includes(require('os').homedir()));
        const remoteReport = await new Promise((resolve) => require('http').get({ host: 'localhost', port: HOST, path: '/coop/app/report', headers: { 'x-fh-app': '1', 'cf-connecting-ip': '203.0.113.9' } }, (r) => { r.resume(); resolve(r.statusCode); }));
        check('...and nobody else can ask for it', remoteReport === 403, remoteReport);

        // A link to someone who is not hosting.
        await c.evaluate(() => Coop.together.open());
        await c.evaluate(() => { document.querySelector('#coop-together [data-field=join]').value = 'http://localhost:8519/?k=x'; Coop.together.act('join'); });
        await waitFor(c, () => /Cannot reach/.test(document.querySelector('#coop-together .why').textContent), 15000, 'dead link explained');
        check('a dead link is explained', true);

        // A link clicked in a chat program reaches the launcher, which hands it to the server; the panel offers it.
        await c.evaluate(() => Coop.together.close());
        const offered = await post(OTHER, '/coop/app/offer', { link }, { 'x-fh-app': '1' });
        await waitFor(c, (l) => Coop.together.isOpen() && document.querySelector('#coop-together [data-field=join]').value === l, 8000, 'the offered link in the panel', link);
        check('a clicked link opens the panel with it filled in', offered.status === 200);

        // Play: both in the dungeon, each seeing the other.
        for (const p of [a, b]) await p.evaluate(() => Coop.together.close());
        await a.evaluate(() => T.quickStart(1, 27, 67));
        await waitFor(a, () => T.onMap(), 60000, 'host on map');
        await a.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(a, () => Coop.world.live, 10000, 'host live');
        await b.evaluate(() => T.quickStart(3, 28, 67));
        await waitFor(b, () => T.onMap(), 60000, 'friend on map');
        await b.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(b, () => Coop.world.live, 10000, 'friend live');
        await sleep(800);
        const idB = await b.evaluate(() => Coop.id);
        const seen = await a.evaluate((id) => T.avatar(id), idB);
        check('host and friend play together', seen && seen.drawn, JSON.stringify(seen));

        // Private hosting, switched on with both pages already open: no direct
        // connection is even attempted (none asks an address server), stills only.
        for (const p of [a, b]) {
            await p.evaluate(() => {
                window.__rtc = 0;
                const Real = window.RTCPeerConnection;
                window.RTCPeerConnection = function (cfg) { window.__rtc++; return new Real(cfg); };
                window.RTCPeerConnection.prototype = Real.prototype;
            });
        }
        await a.evaluate(() => fetch('coop/app/online', { method: 'POST', headers: { 'x-fh-app': '1' }, body: JSON.stringify({ on: true, private: true }) }));
        await waitFor(b, () => Coop.relayOnly === true, 5000, 'the friend told it is private');
        await a.evaluate(() => { BattleManager.setup(1, true, true); SceneManager.push(Scene_Battle); });
        await waitFor(b, () => SceneManager._scene instanceof Scene_CoopSpectate && Coop.viewer.frames > 3, 20000, 'friend watching the fight');
        await sleep(8000);
        const priv = await b.evaluate(() => ({ video: !!Coop.viewer.video, frames: Coop.viewer.frames }));
        priv.attempts = [await a.evaluate(() => window.__rtc), await b.evaluate(() => window.__rtc)];
        check('private hosting: the friend watches relayed pictures, never a direct connection', !priv.video && priv.frames > 10 && priv.attempts[0] === 0 && priv.attempts[1] === 0, JSON.stringify(priv));
        await a.evaluate(() => BattleManager.abort());
        await waitFor(b, () => SceneManager._scene instanceof Scene_Map, 15000, 'friend back on the map');

        // Switching while in a run is refused.
        const busy = await b.evaluate(() => fetch('coop/app/leave', { method: 'POST', headers: { 'x-fh-app': '1' }, body: JSON.stringify({ fromTitle: SceneManager._scene instanceof Scene_Title }) }).then((r) => r.json()).then((j) => j.error || 'ok'));
        const busyJoin = await b.evaluate((l) => fetch('coop/app/join', { method: 'POST', headers: { 'x-fh-app': '1' }, body: JSON.stringify({ link: l, fromTitle: SceneManager._scene instanceof Scene_Title }) }).then((r) => r.json()).then((j) => j.error || 'ok'), link);
        check('joining or leaving mid-run is refused', /title screen/.test(busyJoin) && /title screen/.test(busy), 'leave ' + busy + ', join ' + busyJoin);
    } catch (e) {
        check('ran to the end', false, e.message);
    } finally {
        await browser.close();
        for (const s of [host, friend, other]) s.kill();
    }
    process.exit(check.finish([a, b, c].filter(Boolean)));
})();
