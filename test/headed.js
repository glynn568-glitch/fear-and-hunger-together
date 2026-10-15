// Frame pacing in a real, visible Chrome window on the real monitor: how
// evenly frames arrive with the stream off and on. Headless runs cannot show
// this, because nothing there is tied to the display.
//   node test/headed.js            (opens a window for about half a minute)
const path = require('path');
const puppeteer = require('puppeteer-core');
const { startServer, openPlayer, waitFor, sleep, OUT } = require('./lib');
const install = require('./helpers');

const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// Measures the time between logic steps (what the player feels) and the cost
// of each draw, for a few seconds.
const pacing = (page, seconds) => page.evaluate((seconds) => new Promise((resolve) => {
    const upd = SceneManager.updateScene, ren = Graphics.render;
    const gaps = []; const draws = [];
    let lastStep = 0;
    SceneManager.updateScene = function () { const t = performance.now(); if (lastStep) gaps.push(t - lastStep); lastStep = t; upd.call(this); };
    Graphics.render = function (s) { const t = performance.now(); ren.call(this, s); draws.push(performance.now() - t); };
    const raf = []; let last = 0;
    const t0 = performance.now();
    (function tick(now) { if (last) raf.push(now - last); last = now; if (performance.now() - t0 < seconds * 1000) requestAnimationFrame(tick); else finish(); })(0);
    function pct(a, p) { const s = a.slice().sort((x, y) => x - y); return s.length ? +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(1) : 0; }
    function finish() {
        SceneManager.updateScene = upd; Graphics.render = ren;
        const secs = (performance.now() - t0) / 1000;
        resolve({
            screenHz: Math.round(raf.length / secs), stepsPerSec: Math.round(gaps.length / secs),
            stepGapMs: { typical: pct(gaps, 0.5), p95: pct(gaps, 0.95), worst: pct(gaps, 1) },
            stepsLate: gaps.filter((g) => g > 25).length, // more than a frame and a half
            drawMs: { typical: pct(draws, 0.5), p95: pct(draws, 0.95), worst: pct(draws, 1) },
            refreshGapWorstMs: pct(raf, 1),
        });
    }
}), seconds);

(async () => {
    const server = await startServer(8453);
    const browser = await puppeteer.launch({
        executablePath: CHROME, headless: false, defaultViewport: null,
        args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--window-size=1500,1150', '--window-position=60,60'],
        userDataDir: path.join(OUT, 'chrome-headed-' + process.pid),
    });
    try {
        const a = (await browser.pages())[0];
        a.errors = []; a.logs = []; a.label = 'A';
        await a.goto('http://localhost:8453/?name=Ann', { waitUntil: 'domcontentloaded' });
        await waitFor(a, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 90000, 'title');
        await a.evaluate(install);
        console.log('gpu:', await a.evaluate(() => { const gl = Graphics._renderer.gl; const e = gl && gl.getExtension('WEBGL_debug_renderer_info'); return (e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown') + ' | window ' + innerWidth + 'x' + innerHeight + ' | dpr ' + devicePixelRatio; }));
        await a.evaluate(() => T.quickStart(1, 49, 60));
        await waitFor(a, () => T.onMap(), 60000, 'map');
        await a.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(a, () => Coop.world.live, 10000, 'live');
        await sleep(2000);
        console.log('alone, nothing streaming:   ', JSON.stringify(await pacing(a, 6)));
        // Someone watching (a partner in this player's fight, or a dead partner).
        await a.evaluate(() => Coop.stream.watchers.add(250));
        await sleep(800);
        console.log('streaming to a watcher:     ', JSON.stringify(await pacing(a, 6)));
        await a.evaluate(() => Coop.stream.watchers.clear());
        await sleep(500);
        console.log('stream off again:           ', JSON.stringify(await pacing(a, 4)));
        // The built-in meter, fed with real key presses: walk back and forth for a window.
        const walk = async (ms) => { const end = Date.now() + ms; let i = 0; while (Date.now() < end) { const k = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'][i++ % 4]; await a.keyboard.down(k); await sleep(180); await a.keyboard.up(k); await sleep(120); } };
        await walk(11000);
        console.log('meter, walking alone:       ', JSON.stringify(await a.evaluate(() => Coop.meter.last)));
        await a.evaluate(() => Coop.stream.watchers.add(250));
        await walk(11000);
        console.log('meter, walking + streaming: ', JSON.stringify(await a.evaluate(() => Coop.meter.last)));
        console.log('verdict:', await a.evaluate(() => Coop.meter.verdict(Coop.meter.last)));
        await a.evaluate(() => Coop.stream.watchers.clear());
        // The situation from the lag report: a bot companion following on the same map.
        await a.evaluate(() => { if (SceneManager._scene instanceof Scene_Battle) BattleManager.abort(); });
        await waitFor(a, () => SceneManager._scene instanceof Scene_Map && SceneManager._scene.isActive(), 15000, 'back on the map');
        const { spawn } = require('child_process');
        const bot = spawn(process.execPath, [path.join(__dirname, '..', 'tools', 'bot.js'), 'http://localhost:8453/', '--name', 'Claude'], { stdio: 'ignore' });
        try {
            await waitFor(a, () => Coop.peersHere().length === 1, 60000, 'bot beside the player');
            await sleep(1500);
            await a.evaluate(() => { for (const e of $gameMap.events()) if (e._trigger === 2) e._erased = true; }); // no fights during this measurement
            await walk(11000);
            console.log('meter, bot following:       ', JSON.stringify(await a.evaluate(() => { const s = Coop.meter.last; return { scene: s.scene, screenHz: s.screenHz, stepsPerSec: s.stepsPerSec, lateSteps: s.lateSteps, stepCostMs: s.stepCostMs, stepCostWorstMs: s.stepCostWorstMs, keyToGameMs: s.keyToGameMs, keyToPictureMs: s.keyToPictureMs, keyToPictureWorstMs: s.keyToPictureWorstMs, stalls: s.stalls, others: s.others }; })));
            // A joint fight: the human's own turn.
            await a.evaluate(() => { if (SceneManager._scene instanceof Scene_Battle) BattleManager.abort(); });
            await waitFor(a, () => SceneManager._scene instanceof Scene_Map && SceneManager._scene.isActive() && !Coop.battle, 20000, 'on the map before the joint fight');
            await waitFor(a, () => { const p = Coop.peersHere()[0]; return p && p.st === 'map' && Coop.distanceTo(p) <= 4; }, 30000, 'bot standing by');
            await a.evaluate(() => { BattleManager.setup(1, true, true); SceneManager.push(Scene_Battle); });
            await waitFor(a, () => BattleManager._phase === 'input' && Coop.battle && Coop.battle.guests.size === 1, 25000, 'bot in the fight');
            const t0 = Date.now(); let turns = 0; const waits = [];
            while (Date.now() - t0 < 16000) {
                // Time from the human finishing their command to being asked for the next one.
                if (await a.evaluate(() => BattleManager.isInputting() && BattleManager.actor() && BattleManager.actor().actorId() === 1)) {
                    for (let i = 0; i < 3; i++) { await a.keyboard.down('Enter'); await sleep(110); await a.keyboard.up('Enter'); await sleep(170); }
                    const done = Date.now();
                    await waitFor(a, () => BattleManager.isInputting() && BattleManager.actor() && BattleManager.actor().actorId() === 1, 30000, 'the human is asked again').catch(() => {});
                    waits.push(Date.now() - done); turns++;
                } else await sleep(100);
            }
            console.log('joint fight: rounds', turns, 'ms between finishing a command and being asked for the next:', waits.join(', '));
            console.log('meter, in the joint fight:  ', JSON.stringify(await a.evaluate(() => { const s = Coop.meter.last; return { scene: s.scene, stepsPerSec: s.stepsPerSec, lateSteps: s.lateSteps, keyToGameMs: s.keyToGameMs, keyToPictureMs: s.keyToPictureMs, keyToPictureWorstMs: s.keyToPictureWorstMs, stalls: s.stalls, streamingTo: s.streamingTo, fight: s.fight }; })));
        } finally { bot.kill(); }
        await a.keyboard.press('F9'); await sleep(5500);
        await a.screenshot({ path: path.join(OUT, 'meter.png') }).catch(() => {});
        if (process.argv.includes('--variants')) {
            for (const [label, fn] of Object.entries(module.exports.variants || {})) {
                await a.evaluate(fn);
                await a.evaluate(() => Coop.stream.watchers.add(250));
                await sleep(800);
                console.log(label.padEnd(28), JSON.stringify(await pacing(a, 6)));
                await a.evaluate(() => Coop.stream.watchers.clear());
            }
        }
    } catch (e) { console.error(e); }
    await browser.close();
    server.kill();
    process.exit(0);
})();
