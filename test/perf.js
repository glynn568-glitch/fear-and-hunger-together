// How much time the co-op layer costs per frame, measured on the real GPU:
// one player alone with the mod idle, then two players on the same map, then
// the same while one streams their screen to the other.
const path = require('path');
const puppeteer = require('puppeteer-core');
const { startServer, openPlayer, waitFor, sleep, OUT } = require('./lib');
const install = require('./helpers');

const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// Times the engine's logic step and its draw call over a few seconds.
const sample = (page, seconds) => page.evaluate((seconds) => new Promise((resolve) => {
    const upd = SceneManager.updateScene, ren = Graphics.render;
    let tU = 0, nU = 0, tR = 0, nR = 0, worstU = 0;
    SceneManager.updateScene = function () { const t = performance.now(); upd.call(this); const d = performance.now() - t; tU += d; nU++; if (d > worstU) worstU = d; };
    Graphics.render = function (s) { const t = performance.now(); ren.call(this, s); tR += performance.now() - t; nR++; };
    let frames = 0;
    const t0 = performance.now();
    (function tick() { frames++; if (performance.now() - t0 < seconds * 1000) requestAnimationFrame(tick); else finish(); })();
    function finish() {
        SceneManager.updateScene = upd; Graphics.render = ren;
        const secs = (performance.now() - t0) / 1000;
        resolve({ fps: Math.round(frames / secs), logicPerSec: Math.round(nU / secs), logicMs: +(tU / nU).toFixed(2), worstLogicMs: +worstU.toFixed(1), drawMs: +(tR / nR).toFixed(2), events: $gameMap.events().length });
    }
}), seconds);

(async () => {
    const server = await startServer(8448);
    const browser = await puppeteer.launch({
        executablePath: CHROME, headless: 'new',
        args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--window-size=900,700', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11',
            '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
        userDataDir: path.join(OUT, 'chrome-perf-' + process.pid),
    });
    try {
        const a = await openPlayer(browser, 'http://localhost:8448/?name=Ann', 'A');
        await waitFor(a, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 90000, 'title');
        await a.evaluate(install);
        console.log('renderer:', await a.evaluate(() => { const gl = Graphics._renderer.gl; const e = gl && gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; }));
        await a.evaluate(() => T.quickStart(1, 49, 60));
        await waitFor(a, () => T.onMap(), 60000, 'map');
        await a.evaluate(() => T.settle());
        await sleep(1500);
        console.log('solo, mod idle (not yet in the world):', JSON.stringify(await sample(a, 5)));
        // How busy the tab keeps one CPU core, from Chrome's own accounting.
        const busy = async (page, seconds) => {
            const m0 = await page.metrics(); const t0 = Date.now();
            await sleep(seconds * 1000);
            const m1 = await page.metrics(); const wall = (Date.now() - t0) / 1000;
            return { mainThreadPct: Math.round(100 * (m1.TaskDuration - m0.TaskDuration) / wall), scriptPct: Math.round(100 * (m1.ScriptDuration - m0.ScriptDuration) / wall), heapMB: Math.round(m1.JSHeapUsedSize / 1048576) };
        };
        console.log('CPU, solo on the map:               ', JSON.stringify(await busy(a, 6)));
        // A big window: does the picture fill it?
        await a.setViewport({ width: 3840, height: 2160 });
        await sleep(1200);
        console.log('at 3840x2160:', JSON.stringify(await a.evaluate(() => { const c = Graphics._canvas.getBoundingClientRect(); return { drawn: Math.round(c.width) + 'x' + Math.round(c.height), internal: Graphics._canvas.width + 'x' + Graphics._canvas.height, scale: +Graphics._realScale.toFixed(2), hudFont: getComputedStyle(document.getElementById('coop-hud')).fontSize }; })), JSON.stringify(await sample(a, 4)));
        console.log('CPU at 3840x2160:                   ', JSON.stringify(await busy(a, 5)));
        await a.screenshot({ path: path.join(OUT, 'big-window.png') }).catch(() => {});
        await a.setViewport({ width: 900, height: 700 });
        await sleep(600);
        await a.evaluate(() => T.begin());
        await waitFor(a, () => Coop.world.live, 10000, 'live');
        console.log('solo, in the world:                 ', JSON.stringify(await sample(a, 5)));

        const b = await openPlayer(browser, 'http://localhost:8448/?name=Bo', 'B');
        await waitFor(b, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 90000, 'title B');
        await b.evaluate(install);
        await b.evaluate(() => T.quickStart(3, 48, 60));
        await waitFor(b, () => T.onMap(), 60000, 'map B');
        await b.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(b, () => Coop.world.live, 10000, 'live B');
        await sleep(1500);
        const both = await Promise.all([sample(a, 6), sample(b, 6)]);
        console.log('two players, A runs the map:        ', JSON.stringify(both[0]));
        console.log('two players, B follows:             ', JSON.stringify(both[1]));

        // A streams to B, as in a joint fight or while B is dead.
        await b.evaluate((id) => { Coop.viewer.show(id); Coop.sendTo(id, 'watch', { on: true }); }, await a.evaluate(() => Coop.id));
        await sleep(1000);
        const net = await a.evaluate(() => new Promise((resolve) => {
            let bytes = 0, n = 0;
            const send = Coop.sendBinary;
            Coop.sendBinary = function (k, id, buf) { bytes += buf.byteLength; n++; return send.apply(this, arguments); };
            setTimeout(() => { Coop.sendBinary = send; resolve({ framesPerSec: +(n / 5).toFixed(1), kbPerSec: Math.round(bytes / 5 / 1024), kbPerFrame: Math.round(bytes / Math.max(1, n) / 1024) }); }, 5000);
        }));
        console.log('A while streaming:                  ', JSON.stringify(await sample(a, 5)));
        console.log('CPU while streaming:                ', JSON.stringify(await busy(a, 5)));
        console.log('stream A sends:                     ', JSON.stringify(net), ' frames B drew:', await b.evaluate(() => Coop.viewer.frames));
    } catch (e) { console.error(e); }
    await browser.close();
    server.kill();
    process.exit(0);
})();
