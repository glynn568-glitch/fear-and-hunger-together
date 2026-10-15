// Joins the running session as an extra player, stands where a named player
// is, and measures what one step of the game costs there in that world's real
// state. Usage: node tools/probe.js [url] [--at Name] [--seconds 8]
const path = require('path');
const os = require('os');
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const installBot = require('./bot-page');

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const urlArg = args.find((a) => /^https?:\/\//.test(a)) || 'http://localhost:8420/';
const CHROME = process.env.CHROME || ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => fs.existsSync(p));

(async () => {
    const url = new URL(urlArg);
    url.searchParams.set('name', 'Probe');
    const browser = await puppeteer.launch({
        executablePath: CHROME, headless: 'new', defaultViewport: { width: 816, height: 624 },
        args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11',
            '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
        userDataDir: path.join(os.tmpdir(), 'fh-coop-probe-' + process.pid),
    });
    try {
        const page = (await browser.pages())[0];
        const errors = [];
        page.on('pageerror', (e) => { if (!/physical_attack_animation/.test(String(e && e.stack))) errors.push(String(e && e.message)); });
        await page.goto(url.href, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, { timeout: 120000, polling: 250 });
        await page.evaluate(installBot, { character: '', follow: option('at', '') });
        await page.waitForFunction(() => Coop.world.live && SceneManager._scene instanceof Scene_Map && SceneManager._scene.isActive() && !$gamePlayer.isTransferring(), { timeout: 90000, polling: 250 });
        await new Promise((r) => setTimeout(r, 4000));
        const seconds = Number(option('seconds', 8));
        const result = await page.evaluate((seconds) => new Promise((resolve) => {
            const timed = {};
            const restore = [];
            function wrap(obj, name, label) {
                const orig = obj[name];
                timed[label] = { ms: 0, n: 0, worst: 0 };
                obj[name] = function () {
                    const t = performance.now();
                    try { return orig.apply(this, arguments); } finally {
                        const d = performance.now() - t; const e = timed[label]; e.ms += d; e.n++; if (d > e.worst) e.worst = d;
                    }
                };
                restore.push(() => { obj[name] = orig; });
            }
            wrap(SceneManager, 'updateScene', 'whole step');
            wrap(Game_Map.prototype, 'update', 'map update');
            wrap(Game_Map.prototype, 'refresh', 'map refresh (all events re-pick their page)');
            wrap(Game_Map.prototype, 'updateEvents', 'events + common events');
            wrap(Game_Map.prototype, 'updateInterpreter', 'running event script');
            wrap(Spriteset_Map.prototype, 'update', 'sprites');
            wrap(Graphics, 'render', 'draw call');
            wrap(Game_Event.prototype, 'meetsConditions', 'page condition checks');
            wrap(Game_Switches.prototype, 'setValue', 'switch writes');
            wrap(Game_Variables.prototype, 'setValue', 'variable writes');
            const sent = { n: 0, bytes: 0 };
            const send = Coop.send;
            Coop.send = function (msg) { const s = JSON.stringify(msg); sent.n++; sent.bytes += s.length; return send.call(this, msg); };
            let frames = 0;
            const t0 = performance.now();
            (function tick() { frames++; if (performance.now() - t0 < seconds * 1000) requestAnimationFrame(tick); else done(); })();
            function done() {
                for (const r of restore) r();
                Coop.send = send;
                const secs = (performance.now() - t0) / 1000;
                const rows = {};
                for (const k in timed) rows[k] = { perSecond: Math.round(timed[k].n / secs), msEach: +(timed[k].ms / Math.max(1, timed[k].n)).toFixed(3), msPerSecond: Math.round(timed[k].ms / secs), worstMs: +timed[k].worst.toFixed(1) };
                resolve({
                    map: $gameMap.mapId(), mapName: $dataMapInfos[$gameMap.mapId()].name, events: $gameMap.events().length, at: $gamePlayer.x + ',' + $gamePlayer.y,
                    screenRefreshPerSecond: Math.round(frames / secs), messagesSentPerSecond: +(sent.n / secs).toFixed(1), bytesSentPerSecond: Math.round(sent.bytes / secs),
                    players: Coop.others().map((p) => p.name + ':' + p.st + '@' + p.m), owner: Coop.events.owners[$gameMap.mapId()], me: Coop.id, demoted: Array.from(Coop.world.demoted),
                    rows,
                });
            }
        }), seconds);
        console.log(JSON.stringify(result, null, 1));
        if (errors.length) console.log('script errors:', errors.slice(0, 5));
    } catch (e) { console.error(e); }
    await browser.close();
    process.exit(0);
})();
