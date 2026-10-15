// What the guest in a fight actually experiences, measured in a real visible
// Chrome window: how many pictures a second arrive, how old each one is when
// it is shown, and how long a key press takes to reach the owner's game.
// Run twice: live video, then the relayed stills used when video cannot connect.
//   node test/guest-lag.js        (opens a window for about a minute)
const path = require('path');
const puppeteer = require('puppeteer-core');
const { startServer, launch, openPlayer, waitFor, sleep, OUT } = require('./lib');
const install = require('./helpers');

const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ready = () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected;

async function fight(owner, guest, label, noVideo) {
    await owner.evaluate((off) => { Coop.stream.noVideo = off; }, noVideo);
    await owner.evaluate(() => { BattleManager.setup(1, true, true); SceneManager.push(Scene_Battle); });
    await waitFor(guest, () => SceneManager._scene instanceof Scene_CoopSpectate, 15000, 'guest pulled in');
    await waitFor(owner, () => BattleManager._phase === 'input' && Coop.battle.guests.size === 1, 25000, 'owner at input');
    if (!noVideo) await waitFor(guest, () => Coop.viewer.video, 15000, 'video up');
    await sleep(2500);
    // Owner keeps the battle busy: opens and closes a submenu so the picture changes.
    const busy = (async () => { for (let i = 0; i < 14; i++) { await owner.keyboard.down(i % 2 ? 'Escape' : 'Enter'); await sleep(90); await owner.keyboard.up(i % 2 ? 'Escape' : 'Enter'); await sleep(280); } })();
    const result = await guest.evaluate((seconds, useVideo) => new Promise((resolve) => {
        const ages = []; let n = 0;
        const t0 = performance.now();
        // Pictures drawn per second; for the relayed stills, also how old each was when drawn.
        const start = Coop.viewer.frames;
        Coop.viewer.ages = [];
        setTimeout(() => { n = Coop.viewer.frames - start; if (!useVideo) for (const a of Coop.viewer.ages) ages.push(a); done(); }, seconds * 1000);
        function done() {
            const s = ages.slice().sort((a, b) => a - b);
            const q = (p) => (s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))]) : null);
            resolve({ picturesPerSec: Math.round(n / seconds), pictureAgeMs: { typical: q(0.5), p95: q(0.95), worst: q(1) } });
        }
    }), 5, !noVideo);
    await busy;
    // Key press: stamped on the guest, read when the owner's game receives it.
    await owner.evaluate(() => { window.KEYLAG = []; Coop.on('to:bin', (m) => { if (m.sentAt) KEYLAG.push(Date.now() - m.sentAt); }); });
    await guest.evaluate(() => { const send = Coop.sendTo; Coop.sendTo = function (id, kind, body) { if (kind === 'bin') body.sentAt = Date.now(); return send.call(this, id, kind, body); }; });
    for (let i = 0; i < 8; i++) { await guest.keyboard.down('ArrowDown'); await sleep(90); await guest.keyboard.up('ArrowDown'); await sleep(160); }
    const keys = await owner.evaluate(() => { const s = KEYLAG.slice().sort((a, b) => a - b); return s.length ? { typical: s[Math.floor(s.length / 2)], worst: s[s.length - 1] } : null; });
    console.log(label.padEnd(26), JSON.stringify(result), 'key press reaches the owner in ms:', JSON.stringify(keys));
    await owner.evaluate(() => BattleManager.abort());
    await waitFor(owner, () => SceneManager._scene instanceof Scene_Map && !Coop.battle, 20000, 'fight over');
    await waitFor(guest, () => SceneManager._scene instanceof Scene_Map && !Coop.battle, 20000, 'guest back');
    await sleep(1200);
}

(async () => {
    const port = 8454;
    const server = await startServer(port);
    const hidden = await launch();
    const shown = await puppeteer.launch({
        executablePath: CHROME, headless: false, defaultViewport: null,
        args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--window-size=1500,1150', '--window-position=60,60'],
        userDataDir: path.join(OUT, 'chrome-guest-' + process.pid),
    });
    try {
        const owner = await openPlayer(hidden, `http://localhost:${port}/?name=Owner`, 'owner');
        const guest = (await shown.pages())[0];
        guest.label = 'guest'; guest.errors = []; guest.logs = [];
        guest.on('pageerror', (e) => guest.errors.push(String(e && e.stack || e)));
        await guest.goto(`http://localhost:${port}/?name=Guest`, { waitUntil: 'domcontentloaded' });
        for (const p of [owner, guest]) { await waitFor(p, ready, 90000, 'title'); await p.evaluate(install); }
        await owner.evaluate(() => T.quickStart(1, 27, 67));
        await waitFor(owner, () => T.onMap(), 60000, 'owner on map');
        await owner.evaluate(() => { T.settle(); T.begin(); });
        await guest.evaluate(() => T.quickStart(3, 28, 67));
        await waitFor(guest, () => T.onMap(), 60000, 'guest on map');
        await guest.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(guest, () => Coop.world.live && Coop.peersHere().length === 1, 15000, 'together');
        await sleep(1000);
        await fight(owner, guest, 'live video:', false);
        await fight(owner, guest, 'relayed stills (fallback):', true);
        const errs = [...owner.errors, ...guest.errors].filter((e) => !/physical_attack_animation/.test(e));
        console.log('script errors:', errs.length, errs.slice(0, 3).join(' | ').slice(0, 400));
    } catch (e) { console.error(e); }
    await shown.close();
    await hidden.close();
    server.kill();
    process.exit(0);
})();
