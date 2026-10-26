// Step 6: one fight, two players.
const { twoPlayers, checker, sleep, waitFor } = require('./common');
const { shot } = require('./lib');

async function press(page, code, ms) {
    await page.keyboard.down(code); await sleep(ms || 130); await page.keyboard.up(code); await sleep(220);
}
const battle = (p) => p.evaluate(() => ({
    scene: SceneManager._scene.constructor.name, phase: BattleManager._phase,
    actor: BattleManager.actor() ? BattleManager.actor().actorId() : 0,
    party: $gameParty._actors.slice(), role: Coop.battle ? Coop.battle.role : null,
    guests: Coop.battle && Coop.battle.guests ? Coop.battle.guests.size : 0,
}));

(async () => {
    const check = checker();
    let s;
    try {
        s = await twoPlayers(8435);
        const { a, b } = s;
        await b.evaluate(() => { $gameParty.gainItem($dataItems[1], 3); });
        await a.evaluate(() => { BattleManager.setup(1, true, true); SceneManager.push(Scene_Battle); });
        await waitFor(b, () => SceneManager._scene instanceof Scene_CoopSpectate, 10000, 'B pulled into the fight');
        await waitFor(a, () => BattleManager._phase === 'input' && BattleManager.actor(), 20000, 'A reaches command input');
        let st = await battle(a);
        check('B was pulled in and A commands first', st.guests === 1 && st.actor === 1 && st.party.join() === '1,3', JSON.stringify(st));
        await waitFor(b, () => Coop.viewer.frames > 3, 10000, 'B receives frames');
        check('B is watching a live picture', await b.evaluate(() => Coop.viewer.active && Coop.viewer.frames > 3));
        const lit = await b.evaluate(() => {
            const d = Coop.viewer.ctx.getImageData(0, 0, 816, 624).data;
            let n = 0;
            for (let i = 0; i < d.length; i += 4000) if (d[i] + d[i + 1] + d[i + 2] > 60) n++;
            return n;
        });
        check('the picture is not blank', lit > 20, 'bright samples ' + lit);
        console.log('screenshot', await shot(b, 'battle-guest'));
        // The stills are only the opening act. With Hide my IP off the two
        // browsers then connect directly (live video); with it on (the default)
        // the picture is video through the host.
        const relayed = await b.evaluate(() => Coop.relayOnly);
        if (relayed) await waitFor(b, () => Coop.viewer.clip, 15000, 'B switches to video through the host');
        else await waitFor(b, () => Coop.viewer.video, 45000, 'B switches to live video');
        await sleep(2000);
        const vid = await b.evaluate(() => { const c = document.createElement('canvas'); c.width = 204; c.height = 156; const x = c.getContext('2d'); x.drawImage(Coop.viewer.el, 0, 0, 204, 156); const d = x.getImageData(0, 0, 204, 156).data; let lit = 0; for (let i = 0; i < d.length; i += 400) if (d[i] + d[i + 1] + d[i + 2] > 60) lit++; return { size: Coop.viewer.videoSize, clip: Coop.viewer.clip, shown: Coop.viewer.el.style.display !== 'none', bareVideoShown: !!document.querySelector('video') && getComputedStyle(document.querySelector('video')).opacity > 0.5, lit, frames: Coop.viewer.frames }; });
        if (relayed) check('B is watching video of the fight through the host, painted on the page canvas', vid.clip && vid.shown && !vid.bareVideoShown && vid.lit > 20, JSON.stringify(vid));
        else check('B is watching live video of the fight, painted on the page canvas', vid.size && vid.size.w === 816 && vid.size.h === 624 && vid.shown && !vid.bareVideoShown && vid.lit > 20, JSON.stringify(vid));
        // Once it has settled, not in the moment it starts. Measured here with software
        // rendering: 24 to 50 a second depending on what else the PC is doing.
        const r0 = await b.evaluate(() => Coop.viewer.frames);
        await sleep(3000);
        const rate = Math.round(((await b.evaluate(() => Coop.viewer.frames)) - r0) / 3);
        check('the video runs at a playable rate', rate >= 20, rate + ' frames a second');
        if (relayed) check('no direct connection between the browsers was made', await a.evaluate((id) => !Coop.stream.onVideo.has(id), s.idB));
        else check('A stopped sending stills to B once video was up', await a.evaluate((id) => Coop.stream.onVideo.has(id), s.idB));

        // B's keys must not move A's cursor while A is choosing.
        await press(b, 'KeyZ');
        await sleep(300);
        st = await battle(a);
        check('B cannot act for the character A owns', st.actor === 1 && st.phase === 'input', JSON.stringify(st));
        // A: Attack -> first target.
        await press(a, 'KeyZ'); await press(a, 'KeyZ'); await press(a, 'KeyZ');
        await waitFor(a, () => BattleManager.actor() && BattleManager.actor().actorId() === 3, 8000, 'input moves to the knight B owns');
        check('command input passes to the character B owns', true);
        await sleep(400);
        const banners = { b: await b.evaluate(() => document.getElementById('coop-turn').textContent + '|' + document.getElementById('coop-turn').style.display), a: await a.evaluate(() => document.getElementById('coop-turn').textContent) };
        check('each player is told plainly whose turn it is', /^Your turn: choose for Knight\|$/.test(banners.b) && /Waiting for Bo to choose for Knight/.test(banners.a), JSON.stringify(banners));
        check('A is holding the bag B brought', await a.evaluate(() => $gameParty.numItems($dataItems[1]) === 3));
        // A's keys must do nothing now.
        await press(a, 'KeyZ'); await press(a, 'KeyZ');
        await sleep(300);
        st = await battle(a);
        check('A cannot act for the character B owns', st.actor === 3 && st.phase === 'input', JSON.stringify(st));
        // B: Attack -> target, through the stream.
        await press(b, 'KeyZ'); await press(b, 'KeyZ'); await press(b, 'KeyZ');
        await waitFor(a, () => BattleManager._phase !== 'input', 8000, 'keys from B finish the input phase');
        check('B commanded their own character from the other browser', true);
        await sleep(1500);
        console.log('screenshot', await shot(b, 'battle-guest-turn'), await shot(a, 'battle-owner-turn'));

        // End the fight with the knight hurt, and check it comes home that way.
        await a.evaluate(() => { $gameActors.actor(3).setHp(37); BattleManager.abort(); });
        await waitFor(a, () => SceneManager._scene instanceof Scene_Map, 15000, 'A back on the map');
        await waitFor(b, () => SceneManager._scene instanceof Scene_Map, 15000, 'B back on the map');
        check('the video is put away when the fight ends', await b.evaluate(() => !Coop.viewer.video && Coop.viewer.el.style.display === 'none' && document.getElementById('coop-turn').style.display === 'none'));
        const end = await b.evaluate(() => ({ hp: $gameActors.actor(3).hp, party: $gameParty._actors.slice(), items: $gameParty.numItems($dataItems[1]), battle: !!Coop.battle, view: Coop.viewer.active }));
        check('the knight comes home with the wounds from the fight', end.hp === 37 && end.party.join() === '3' && !end.battle && !end.view, JSON.stringify(end));
        check('the bag B brought comes home', end.items === 3);
        const endA = await a.evaluate(() => ({ party: $gameParty._actors.slice(), items: $gameParty.numItems($dataItems[1]), battle: !!Coop.battle, watchers: Coop.stream.watchers.size }));
        check('A has their own party and bag again', endA.party.join() === '1' && endA.items === 0 && !endA.battle && endA.watchers === 0, JSON.stringify(endA));
        // The next fight finds its pictures still on the card (10/24: every fight start on the Deck
        // drew 290+ ms, re-uploading each 2074x1382 battler sheet the map had just thrown away).
        await sleep(3000);
        await a.evaluate(() => {
            window._big = [];
            for (const P of [WebGLRenderingContext.prototype, window.WebGL2RenderingContext && WebGL2RenderingContext.prototype].filter(Boolean)) {
                const o = P.texImage2D;
                P.texImage2D = function () { const src = arguments[arguments.length - 1]; if (src && src.width >= 1000) _big.push(src.width + 'x' + src.height); return o.apply(this, arguments); };
            }
            window._tones = 0;
            const tone = Bitmap.prototype.adjustTone;
            Bitmap.prototype.adjustTone = function () { _tones++; return tone.apply(this, arguments); };
            BattleManager.setup(1, true, true); SceneManager.push(Scene_Battle);
        });
        await waitFor(a, () => BattleManager._phase === 'input' && BattleManager.actor(), 20000, 'A in a second fight');
        await sleep(1500);
        const big = await a.evaluate(() => _big.slice());
        check('a second fight uploads no big picture again', big.length === 0, JSON.stringify(big));
        const tones = await a.evaluate(() => _tones);
        check('...and paints no window back pixel by pixel again', tones === 0, tones + ' painted');
        await a.evaluate(() => BattleManager.abort());
        await waitFor(a, () => SceneManager._scene instanceof Scene_Map, 15000, 'A back from the second fight');
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
