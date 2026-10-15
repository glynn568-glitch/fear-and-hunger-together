// The internet path, by hand: the host plays on localhost, the friend through
// the tunnel link that start-online prints. Not part of `node test/run.js`,
// because it needs a live tunnel.
//
//   node test/tunnel.js http://localhost:8431/ "https://....trycloudflare.com/?k=KEY"
//
// Both browsers are on this PC, so it measures the tunnel and the relay, not
// two home routers: the direct video link here never has to cross one.
const { launch, openPlayer, waitFor, sleep, shot } = require('./lib');
const { checker } = require('./common');
const install = require('./helpers');

const [hostUrl, friendLink] = process.argv.slice(2);
const titleReady = () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected;
const median = (list) => list.slice().sort((x, y) => x - y)[Math.floor(list.length / 2)];
const worst = (list) => Math.max.apply(null, list);

(async () => {
    if (!hostUrl || !friendLink) { console.error('usage: node test/tunnel.js <host url> <friend link>'); process.exit(2); }
    const check = checker();
    let browser, a, b;
    try {
        // The key is what keeps strangers out.
        const bare = new URL(friendLink);
        bare.search = '';
        const noKey = await fetch(bare).then((r) => r.status).catch((e) => 'failed: ' + e.message);
        check('the tunnel address without the key is refused', noKey === 403, 'status ' + noKey);
        const wrong = new URL(friendLink);
        wrong.searchParams.set('k', 'not-the-key');
        check('a wrong key is refused', await fetch(wrong).then((r) => r.status).catch(() => 0) === 403);

        browser = await launch();
        a = await openPlayer(browser, hostUrl + (hostUrl.includes('?') ? '&' : '?') + 'name=Host', 'host');
        await waitFor(a, titleReady, 90000, 'host at the title');
        const t0 = Date.now();
        b = await openPlayer(browser, friendLink + '&name=Friend', 'friend');
        await waitFor(b, titleReady, 180000, 'friend at the title, through the tunnel');
        const loadMs = Date.now() - t0;
        check('the friend reaches the title screen through the link', true, Math.round(loadMs / 100) / 10 + ' s from a cold start');
        check('the friend is connected to the relay over a secure socket', await b.evaluate(() => Coop.connected && /^wss:/.test(Coop._ws.url) && isSecureContext));
        const bad = b.logs.filter((l) => /^\[(http \d+|requestfailed)\]/.test(l));
        check('nothing failed to download', bad.length === 0, bad.slice(0, 4).join(' | '));

        for (const p of [a, b]) await p.evaluate(install);
        await a.evaluate(() => T.quickStart(1, 27, 67));
        await waitFor(a, () => T.onMap(), 60000, 'host on the map');
        await a.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(a, () => Coop.world.live, 10000, 'host in the world');
        const t1 = Date.now();
        await b.evaluate(() => T.quickStart(3, 28, 67));
        await waitFor(b, () => T.onMap(), 120000, 'friend on the map');
        const mapMs = Date.now() - t1;
        await b.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(b, () => Coop.world.live, 10000, 'friend in the world');
        await sleep(800);
        check('they see each other in the dungeon', await a.evaluate(() => Coop.peersHere().length) === 1 && await b.evaluate(() => Coop.peersHere().length) === 1, 'first map took the friend ' + Math.round(mapMs / 100) / 10 + ' s');

        // How long a message takes each way through the relay (both clocks are this PC's).
        for (const p of [a, b]) await p.evaluate(() => { window._lat = []; Coop.on('to:tping', (m) => window._lat.push(Date.now() - m.at)); });
        const idA = await a.evaluate(() => Coop.id), idB = await b.evaluate(() => Coop.id);
        for (let i = 0; i < 25; i++) {
            await a.evaluate((id) => Coop.sendTo(id, 'tping', { at: Date.now() }), idB);
            await b.evaluate((id) => Coop.sendTo(id, 'tping', { at: Date.now() }), idA);
            await sleep(120);
        }
        await sleep(1500);
        const toFriend = await b.evaluate(() => window._lat), toHost = await a.evaluate(() => window._lat);
        check('messages cross the tunnel both ways', toFriend.length >= 20 && toHost.length >= 20,
            `host to friend ${median(toFriend)} ms (worst ${worst(toFriend)}), friend to host ${median(toHost)} ms (worst ${worst(toHost)})`);

        // A world change made by the friend reaches the host and is kept.
        await b.evaluate(() => $gameSwitches.setValue(25, true));
        await waitFor(a, () => $gameSwitches.value(25), 8000, "the friend's change reaches the host");
        check('what the friend changes in the world reaches the host', true);

        // A fight the host starts, watched by the friend as relayed snapshots only.
        await a.evaluate(() => { Coop.stream.noVideo = true; });
        await b.evaluate(() => { Coop.viewer.ages = []; });
        await a.evaluate(() => { BattleManager.setup(1, true, true); SceneManager.push(Scene_Battle); });
        await waitFor(b, () => SceneManager._scene instanceof Scene_CoopSpectate, 15000, 'friend pulled into the fight');
        await waitFor(a, () => BattleManager._phase === 'input' && BattleManager.actor(), 30000, 'host reaches command input');
        await waitFor(b, () => Coop.viewer.frames > 3, 15000, 'friend receives pictures');
        let f0 = await b.evaluate(() => Coop.viewer.frames);
        await sleep(5000);
        const stills = await b.evaluate(() => ({ frames: Coop.viewer.frames, video: !!Coop.viewer.video, ages: Coop.viewer.ages.slice(-60) }));
        const stillFps = Math.round((stills.frames - f0) / 5);
        check('with no direct link, the fight still reaches the friend as relayed snapshots', !stills.video && stillFps >= 8,
            `${stillFps} pictures a second, each ${median(stills.ages)} ms old on arrival (worst ${worst(stills.ages)})`);
        console.log('screenshot', await shot(b, 'tunnel-friend-stills'));

        // The friend's keys reach the host's fight: host attacks, then it is the friend's turn.
        const press = async (page, code) => { await page.keyboard.down(code); await sleep(130); await page.keyboard.up(code); await sleep(250); };
        await press(a, 'KeyZ'); await press(a, 'KeyZ'); await press(a, 'KeyZ');
        await waitFor(a, () => BattleManager.actor() && BattleManager.actor().actorId() === 3, 10000, "input moves to the friend's knight");
        await sleep(500);
        check('the friend is told it is their turn', /^Your turn/.test(await b.evaluate(() => document.getElementById('coop-turn').textContent)));
        await press(b, 'KeyZ'); await press(b, 'KeyZ'); await press(b, 'KeyZ');
        await waitFor(a, () => BattleManager._phase !== 'input' || (BattleManager.actor() && BattleManager.actor().actorId() !== 3), 10000, "the friend's choice is taken");
        check("the friend's keys command their own character in the host's fight", true);
        await a.evaluate(() => BattleManager.abort());
        await waitFor(a, () => SceneManager._scene instanceof Scene_Map && !Coop.battle, 20000, 'the fight ends');
        await waitFor(b, () => SceneManager._scene instanceof Scene_Map, 20000, 'friend back on the map');

        // The same again with live video allowed.
        await a.evaluate(() => { Coop.stream.noVideo = false; });
        await sleep(600);
        await a.evaluate(() => { BattleManager.setup(1, true, true); SceneManager.push(Scene_Battle); });
        await waitFor(b, () => SceneManager._scene instanceof Scene_CoopSpectate, 15000, 'friend pulled into the second fight');
        const gotVideo = await waitFor(b, () => Coop.viewer.video, 20000, 'live video').then(() => true, () => false);
        f0 = await b.evaluate(() => Coop.viewer.frames);
        await sleep(4000);
        const fps = Math.round((await b.evaluate(() => Coop.viewer.frames) - f0) / 4);
        check('live video between the two browsers comes up (same PC: no router in the way)', gotVideo && fps > 25, fps + ' frames a second');
        await a.evaluate(() => BattleManager.abort());
        await waitFor(b, () => SceneManager._scene instanceof Scene_Map, 20000, 'friend back on the map again');

        // Saving: the friend's save lands on the host, through the tunnel.
        await a.evaluate(() => { $gameSystem.onBeforeSave(); DataManager.saveGame(1); });
        await waitFor(b, () => StorageManager.exists(1), 15000, 'friend saved alongside');
        check("the friend's save is written on the host through the tunnel", true);
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish([a, b].filter(Boolean));
    if (browser) await browser.close();
    process.exit(code);
})();
