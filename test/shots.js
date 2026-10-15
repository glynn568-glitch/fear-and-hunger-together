// Press screenshots for the store pages, from real play: four players, two of
// them joining from their own servers. Not part of the test run.
//   node test/shots.js      -> dist/press/*.png (1800x1400)
const fs = require('fs');
const path = require('path');
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const install = require('./helpers');

const HOST = 8520;
const OUT = path.join(__dirname, '..', 'dist', 'press');
const PLAYERS = [
    { name: 'Ann', actor: 1, x: 27, y: 67 },
    { name: 'Bo', actor: 3, x: 28, y: 67 },
    { name: 'Cy', actor: 4, x: 26, y: 66, join: HOST + 1 },
    { name: 'Di', actor: 5, x: 29, y: 66, join: HOST + 2 },
];
async function press(page, code, ms) {
    await page.keyboard.down(code); await sleep(ms || 130); await page.keyboard.up(code); await sleep(220);
}
const snap = async (page, name) => { await page.screenshot({ path: path.join(OUT, name + '.png') }); console.log(name); };

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const servers = [await startServer(HOST, { FH_TUNNEL_FAKE: 'https://quiet-ritual-candles.trycloudflare.com' })];
    for (const p of PLAYERS) if (p.join) servers.push(await startServer(p.join, { FH_JOIN: `http://localhost:${HOST}/` }));
    const browser = await launch();
    try {
        const pages = [];
        for (const p of PLAYERS) {
            const page = await openPlayer(browser, `http://localhost:${p.join || HOST}/?name=${p.name}`, p.name);
            await page.setViewport({ width: 900, height: 700, deviceScaleFactor: 2 });
            pages.push(page);
        }
        for (const page of pages) {
            await waitFor(page, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 120000, 'title');
            await page.evaluate(install);
        }
        const [a, b, c, d] = pages;

        // 1. The Together panel, hosting.
        await a.evaluate(() => Coop.together.open());
        await a.evaluate(() => Coop.together.act('online'));
        await waitFor(a, () => document.querySelector('#coop-together [data-field=link]').value, 15000, 'a link');
        await a.evaluate(() => { document.querySelector('#coop-together .why').textContent = 'Online. The link is copied: send it to your friends.'; });
        await sleep(800);
        await snap(a, '1-together');
        await a.evaluate(() => Coop.together.close());

        // Everyone into the dungeon.
        for (let i = 0; i < PLAYERS.length; i++) {
            const p = PLAYERS[i], page = pages[i];
            await page.evaluate((act, x, y) => T.quickStart(act, x, y), p.actor, p.x, p.y);
            await waitFor(page, () => T.onMap(), 60000, p.name + ' on map');
            await page.evaluate(() => { T.settle(); T.begin(); });
            await waitFor(page, () => Coop.world.live, 15000, p.name + ' live');
        }
        await sleep(2500);

        // 4. One fight, four players.
        await a.evaluate(() => { BattleManager.setup(1, true, true); SceneManager.push(Scene_Battle); });
        await waitFor(a, () => BattleManager.isInputting() && BattleManager.actor(), 30000, 'the fight asks A');
        await sleep(2500);
        await snap(a, '4-one-fight');
        // The same moment with every window and overlay hidden, for the covers.
        await a.evaluate(() => {
            window.__hidden = Array.from(document.body.children).filter((el) => el.tagName !== 'CANVAS' && el.id !== 'GameCanvas' && el.style.display !== 'none');
            for (const el of window.__hidden) el.style.visibility = 'hidden';
            // Every game window, wherever the battle plugins put it (the log sits outside the window layer).
            window.__windows = [];
            (function walk(node) {
                for (const child of node.children || []) {
                    if (child instanceof Window || child instanceof WindowLayer) { if (child.visible) { window.__windows.push(child); child.visible = false; } } else walk(child);
                }
            })(SceneManager._scene);
        });
        await sleep(300);
        await snap(a, 'clean-fight');
        await a.evaluate(() => { for (const el of window.__hidden) el.style.visibility = ''; for (const w of window.__windows) w.visible = true; });
        // Choose for each character from the page that owns it, until the round runs.
        const owner = { 1: a, 3: b, 4: c, 5: d };
        for (let turn = 0; turn < 8; turn++) {
            const who = await a.evaluate(() => BattleManager.isInputting() && BattleManager.actor() ? BattleManager.actor().actorId() : 0);
            if (!who) break;
            await press(owner[who], 'KeyZ'); await press(owner[who], 'KeyZ'); await press(owner[who], 'KeyZ');
            await sleep(500);
        }
        await sleep(2500);
        await snap(b, '5-a-friends-view-of-the-fight');
        await a.evaluate(() => { if (SceneManager._scene instanceof Scene_Battle && BattleManager._phase !== 'battleEnd') BattleManager.abort(); });
        for (let i = 0; i < 30 && !(await a.evaluate(() => SceneManager._scene instanceof Scene_Map)); i++) {
            if (await a.evaluate(() => $gameMessage.isBusy())) await press(a, 'KeyZ'); else await sleep(500);
        }
        await sleep(2000);
        for (const page of pages) await page.evaluate(() => { if ($gameMessage.isBusy()) $gameMessage.clear(); });

        // 2. The four of them in the flesh room on the second floor.
        const steps = [[], [6], [4, 2], [2]];
        for (let i = 0; i < pages.length; i++) {
            await pages[i].evaluate(() => $gamePlayer.reserveTransfer(5, 43, 45, 2, 0));
            await waitFor(pages[i], () => T.onMap() && $gameMap.mapId() === 5, 30000, 'flesh room');
            await pages[i].evaluate(() => T.settle());
            for (const dir of steps[i]) { await pages[i].evaluate((dd) => $gamePlayer.moveStraight(dd), dir); await sleep(400); }
        }
        await a.evaluate(() => $gamePlayer.setDirection(2));
        await sleep(7000); // the arrival line fades
        await snap(a, '2-together-in-the-flesh-room');

        // 6. Dead, watching a partner who can still call you back.
        await d.evaluate(() => SceneManager.goto(Scene_Gameover));
        await waitFor(d, () => SceneManager._scene instanceof Scene_CoopDead && Coop.viewer.active && Coop.viewer.frames > 10, 20000, 'D watching');
        await a.evaluate(() => { $gamePlayer.moveStraight(4); });
        await sleep(2500);
        await snap(d, '6-dead-and-watching');
    } catch (e) {
        console.error(e);
        process.exitCode = 1;
    } finally {
        await browser.close();
        for (const s of servers) s.kill();
    }
})();
