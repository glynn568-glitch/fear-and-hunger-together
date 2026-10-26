// Calling an AI partner in from the game and sending it home: F8 on the
// host's own browser starts one (the server runs it), F8 again sends it home.
// Nobody coming in through the tunnel may do either.
process.env.FH_BOT_ARGS = '--brain none'; // no model calls in the tests
const WebSocket = require('ws');
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const { checker } = require('./common');
const install = require('./helpers');

async function press(page, code) {
    await page.keyboard.down(code); await sleep(130); await page.keyboard.up(code); await sleep(250);
}

(async () => {
    const check = checker();
    const port = 8446;
    const server = await startServer(port);
    const logs = [];
    server.stdout.on('data', (d) => logs.push(String(d)));
    const browser = await launch();
    let a;
    try {
        a = await openPlayer(browser, `http://localhost:${port}/?name=Ann`, 'Ann');
        await waitFor(a, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 90000, 'title');
        await a.evaluate(install);
        await a.evaluate(() => T.quickStart(1, 27, 67));
        await waitFor(a, () => T.onMap(), 60000, 'Ann on the map');
        await a.evaluate(() => { T.settle(); T.begin(); for (const ev of $gameMap.events()) if (/guard|enemy|chaser/i.test(ev.event().name)) ev.erase(); });
        await waitFor(a, () => Coop.world.live, 10000, 'Ann live');

        //--- someone through the tunnel may not call one ---------------------
        const visitor = new WebSocket(`ws://localhost:${port}/coop/ws` + require('../tools/version').socketQuery(), { headers: { 'cf-connecting-ip': '203.0.113.9' } });
        const notes = [];
        visitor.on('message', (raw) => { try { const m = JSON.parse(raw); if (m.t === 'partnernote') notes.push(m.text); } catch (e) { /* binary */ } });
        await new Promise((r) => visitor.on('open', r));
        visitor.send(JSON.stringify({ t: 'partner', on: true }));
        await sleep(1500);
        check('a friend coming in through the tunnel cannot call a partner', notes.some((t) => /Only the player hosting/.test(t)) && !/\[Claude\]/.test(logs.join('')), notes.join(' | '));
        visitor.close();

        //--- sent home while the title is still loading ----------------------
        await press(a, 'F8');
        const tOpen = Date.now();
        let sawOpen = false;
        while (Date.now() - tOpen < 25000) {
            const text = logs.join('');
            if ((/\[[^\]]+\] .*opening/.test(text) || /\[[^\]]+\] mind:/.test(text)) && !/at the title screen/.test(text)) { sawOpen = true; break; }
            await sleep(40);
        }
        await press(a, 'F8');
        await sleep(7000);
        const noise = logs.join('');
        const bad = [/puppeteer/i, /Protocol error/, /Target closed/, /Execution context was destroyed/, /taskkill/i, /stopped \(1\)/].filter((re) => re.test(noise)).map((re) => String(re));
        check('sent home while the title is still loading, it leaves quietly', sawOpen && bad.length === 0, 'saw ' + sawOpen + ' ' + bad.join(' '));
        await waitFor(a, () => !Coop.others().some((p) => p.bot), 20000, 'the half-started partner is gone');
        await sleep(3000);

        //--- F8: one is called in --------------------------------------------
        await a.evaluate(() => { window.toasts = []; const t = Coop.toast; Coop.toast = function (text) { window.toasts.push(text); return t.apply(this, arguments); }; });
        await press(a, 'F8');
        await waitFor(a, () => window.toasts.some((t) => /on the way/.test(t)), 5000, 'the call is confirmed');
        await waitFor(a, () => Coop.others().some((p) => p.bot === 1 && p.st === 'map'), 90000, 'the partner arrives in the dungeon');
        const who = await a.evaluate(() => { const p = Coop.others().find((q) => q.bot); return { name: p.name, an: p.an }; });
        check('F8 calls an AI partner into the dungeon, no console needed', who.name === "D'arce", JSON.stringify(who));
        const line = (src) => a.evaluate((re) => [...document.querySelectorAll('#coop-chat .line')].some((l) => new RegExp(re).test(l.textContent)), src);
        await a.evaluate(() => Coop.say('Claude, wait here'));
        let toClaude = false;
        for (let i = 0; i < 20 && !toClaude; i++) { toClaude = await line("D'arce: Waiting here\\."); if (!toClaude) await sleep(500); }
        await a.evaluate(() => Coop.say("D'arce, come with me"));
        let toStory = false;
        for (let i = 0; i < 20 && !toStory; i++) { toStory = await line("D'arce: Coming\\."); if (!toStory) await sleep(500); }
        check('Claude and the character name both address the partner', toClaude && toStory, JSON.stringify({ toClaude, toStory }));
        await waitFor(a, () => [...document.querySelectorAll('#coop-chat .line')].some((l) => /No AI model is connected/.test(l.textContent)), 15000, 'the no-model notice');
        check('without a model it says so plainly in the chat', true);
        await sleep(2000);
        check('its arrival is not announced as "Player N connected"', !(await a.evaluate(() => window.toasts.some((t) => /^Player d+ connected/.test(t)))), JSON.stringify(await a.evaluate(() => window.toasts)));

        //--- F8 again: it goes home ------------------------------------------
        await sleep(1000);
        await press(a, 'F8');
        await waitFor(a, () => !Coop.others().some((p) => p.bot), 20000, 'the partner leaves');
        check('F8 again sends it home', true);
        await sleep(2000);
        check('the partner left on purpose, so nothing was kept as a dropped player', parked(server.saves).length === 0, parked(server.saves).join(','));

        //--- two called at once: they cannot both be the knight --------------
        await press(a, 'F8');
        await a.keyboard.down('Shift'); await press(a, 'F8'); await a.keyboard.up('Shift');
        await waitFor(a, () => Coop.others().filter((p) => p.bot === 1 && p.st === 'map').length === 2, 120000, 'both partners in the dungeon');
        await sleep(6000);
        const pair = await a.evaluate(() => Coop.others().filter((p) => p.bot).map((p) => ({ name: p.name, ini: (p.ini || []).join(), st: p.st })));
        check('two partners called together come in as two different characters', pair.length === 2 && pair[0].ini && pair[1].ini && pair[0].ini !== pair[1].ini, JSON.stringify(pair));
        await press(a, 'F8'); await sleep(1500); await press(a, 'F8');
        await waitFor(a, () => !Coop.others().some((p) => p.bot), 30000, 'both partners leave');

        // A dead partner sent home must come back that same body (10/24: the
        // title made a fresh knight, and the next call was alive, gear and all).
        await press(a, 'F8');
        await waitFor(a, () => Coop.others().some((p) => p.bot === 1 && p.st === 'map'), 90000, 'the partner is back to be killed');
        await a.evaluate(() => {
            const p = Coop.others().find((q) => q.bot);
            $gameParty.gainItem($dataArmors[36], 1);
            $gameParty.loseItem($dataArmors[36], 1);
            Coop.sendTo(p.id, 'give', { kind: 'armor', id: 36 });
        });
        await a.keyboard.down('Tab');
        await waitFor(a, () => /Crow Mauler soul/.test(document.getElementById('coop-sheets').textContent), 8000, 'the partner is holding the soul');
        await a.keyboard.up('Tab');
        await waitFor(a, () => {
            const p = Coop.others().find((q) => q.bot);
            return p && p.st === 'map' && p.m === $gameMap.mapId() && Math.abs(p.x - $gamePlayer.x) + Math.abs(p.y - $gamePlayer.y) <= 6;
        }, 30000, 'the partner is close enough to pull into a fight');
        await a.evaluate(() => { BattleManager.setup(1, true, true); SceneManager.push(Scene_Battle); });
        await waitFor(a, () => Coop.battle && Coop.battle.guests && [...Coop.battle.guests.values()].some((g) => g.actors && g.actors.length), 20000, 'the partner is in the fight');
        await a.evaluate(() => {
            for (const g of Coop.battle.guests.values()) for (const id of g.actors) {
                const actor = $gameActors.actor(id);
                actor.addState(actor.deathStateId());
                actor.setHp(0);
            }
            for (const e of $gameTroop.members()) e.addState(e.deathStateId());
            const w = SceneManager._scene._actorCommandWindow;
            if (w) { w.deactivate(); w.close(); }
            BattleManager.processVictory();
        });
        for (let i = 0; i < 40 && !(await a.evaluate(() => SceneManager._scene instanceof Scene_Map && !Coop.battle)); i++) {
            if (await a.evaluate(() => $gameMessage.isBusy())) await press(a, 'Enter'); else await sleep(400);
        }
        await waitFor(a, () => Coop.others().some((p) => p.bot && p.st === 'dead'), 20000, 'the partner is dead');
        await sleep(800);
        const gearOf = () => a.evaluate(() => {
            const text = document.getElementById('coop-sheets').textContent;
            const wearing = (text.split('Wearing')[1] || '').split('Carrying')[0].replace(/\s+/g, ' ').trim();
            const carrying = (text.split('Carrying')[1] || '').replace(/\s+/g, ' ').trim();
            const health = (text.split('Health')[1] || '').split('Mind')[0];
            const who = (document.querySelector('#coop-sheets h2') || {}).textContent || '';
            return { dead: /dead/.test(health), wearing, carrying, who };
        });
        await a.keyboard.down('Tab');
        await waitFor(a, () => /Crow Mauler soul/.test(document.getElementById('coop-sheets').textContent) && /dead/.test(document.getElementById('coop-sheets').textContent), 8000, 'the dead partner\'s sheet');
        const before = await gearOf();
        await a.keyboard.up('Tab');
        await press(a, 'F8');
        await waitFor(a, () => !Coop.others().some((p) => p.bot), 20000, 'the dead partner is sent home');
        await sleep(2500);
        await press(a, 'F8');
        await waitFor(a, () => Coop.others().some((p) => p.bot && (p.st === 'dead' || p.st === 'map')), 90000, 'the partner is called back');
        await sleep(3000);
        await a.keyboard.down('Tab');
        await waitFor(a, () => { const t = document.getElementById('coop-sheets').textContent; return t.length > 40 && !/Nobody else/.test(t); }, 8000, 'the called-back partner\'s sheet');
        const after = await gearOf();
        await a.keyboard.up('Tab');
        check('a dead partner sent home and called back is still dead with the same gear', after.dead && before.dead && after.who === before.who && after.wearing === before.wearing && after.carrying === before.carrying && /Crow Mauler soul/.test(after.wearing + after.carrying), JSON.stringify({ before, after }));
    } catch (e) {
        console.error(e);
        check('test ran to the end', false);
        if (a) console.log('toast: ' + await a.evaluate(() => document.getElementById('coop-toast').textContent).catch(() => '?'));
        console.log('server said:\n' + logs.join('').split('\n').filter((l) => /\[(Claude|D'arce|Ragnvaldr|Enki|Cahara)|partner|could not/i.test(l)).slice(-12).join('\n'));
    }
    const code = check.finish([a].filter(Boolean));
    await browser.close();
    server.kill();
    process.exit(code);
})();

function parked(saves) {
    const dir = require('path').join(saves, 'parked');
    // The partner's, whatever name it took; the players' own parks are not its.
    try { return require('fs').readdirSync(dir).filter((n) => /\.json$/i.test(n) && !/^(ann|bo)\.json$/i.test(n)); } catch (e) { return []; }
}
