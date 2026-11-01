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
    let bo = null;
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

        //--- the last person leaving ends the run; a dropped line does not ---
        // New Game while a partner is still in the dungeon used to be that same run.
        try {
            await press(a, 'F8');
            await waitFor(a, () => Coop.others().some((p) => p.bot === 1 && p.st === 'map'), 90000, 'a partner for the reroll');
            await a.evaluate(() => $gameVariables.setValue(32, 2));
            await sleep(700);
            const dice = await a.evaluate(() => $gameVariables.value(32));
            const runId = await a.evaluate(() => Coop.world.runId);
            check('a layout die can be set on this run', dice === 2, String(dice));

            await a.evaluate(() => Coop._ws.close());
            await waitFor(a, () => Coop.connected && Coop.world.live, 15000, 'Ann reconnects after a dropped line');
            await waitFor(a, () => Coop.others().some((p) => p.bot && p.st === 'map'), 8000, 'the partner is still in after the drop');
            check('a dropped line leaves the partner and the run', (await a.evaluate(() => Coop.world.runId)) === runId, await a.evaluate(() => Coop.world.runId));

            bo = await openPlayer(browser, `http://localhost:${port}/?name=Bo`, 'Bo');
            await waitFor(bo, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 90000, 'Bo at the title');
            await bo.evaluate(install);
            await bo.evaluate(() => T.quickStart(4, 27, 65));
            await waitFor(bo, () => T.onMap(), 60000, 'Bo on the map, not in the run yet');
            await bo.evaluate(() => T.settle());
            await bo.evaluate(() => { window.toasts = []; const t = Coop.toast; Coop.toast = function (text) { window.toasts.push(text); return t.apply(this, arguments); }; });
            const partnerName = await a.evaluate(() => (Coop.others().find((p) => p.bot) || {}).name || '');
            // Bo is on the map but not in the run, so he still reports "title" and the
            // partner will not follow him. Ann stays offline only for this join: with
            // nobody to follow for 12s the partner goes home on its own.
            await a.evaluate(() => { Coop.refused = true; Coop._ws.close(); });
            await waitFor(bo, () => !Coop.others().some((p) => p.name === 'Ann'), 8000, 'Bo sees Ann gone');
            await bo.evaluate(() => T.begin());
            await waitFor(bo, () => Coop.world.live, 15000, 'Bo joins the run the partner is still in');
            const toast = await bo.evaluate(() => (window.toasts || []).find((t) => /already in progress/.test(t)) || '');
            check('joining a run whose only other player is a partner says it is that same run', toast.includes(partnerName) && toast.includes('already in progress with') && toast.includes('It is the same run.') && !toast.includes('\n') && !toast.includes('Ann'), JSON.stringify(toast));
            await a.evaluate(() => { Coop.refused = false; Coop.connect(); });
            await waitFor(bo, () => Coop.others().some((p) => p.bot && p.st && p.st !== 'title'), 8000, 'the partner stayed while Ann was gone');
            await waitFor(a, () => Coop.connected && Coop.world.live, 15000, 'Ann back before Bo leaves');

            await bo.evaluate(() => SceneManager.goto(Scene_Title));
            await waitFor(bo, () => SceneManager._scene instanceof Scene_Title && !Coop.world.live, 20000, 'Bo back at the title');
            await sleep(800);
            const stayed = await a.evaluate(() => {
                const bots = Coop.others().filter((p) => p.bot).map((p) => ({ name: p.name, st: p.st }));
                return { run: Coop.world.runId, live: Coop.world.live, partner: bots.some((p) => p.st && p.st !== 'title'), bots };
            });
            const stayedOk = stayed.live && stayed.partner && stayed.run === runId;
            check('a second person leaving does not end the run', stayedOk, JSON.stringify(stayed));
            // The rest of this block needs the partner still in the run. The catch drains it.
            if (!stayedOk) throw new Error('stop');
            const boErrs = bo.errors.filter((e) => !/physical_attack_animation|VideoFrame was garbage collected/.test(e));
            check('Bo has no script errors', boErrs.length === 0, boErrs.slice(0, 2).join(' || ').slice(0, 400));
            await bo.close();
            bo = null;

            await a.evaluate(() => {
                const p = Coop.others().find((q) => q.bot && q.st && q.st !== 'title');
                if (!p) throw new Error('no partner in the world');
                $gameParty.gainItem($dataArmors[36], 1);
                $gameParty.loseItem($dataArmors[36], 1);
                Coop.sendTo(p.id, 'give', { kind: 'armor', id: 36 });
            });
            await a.keyboard.down('Tab');
            await waitFor(a, () => /Crow Mauler soul/.test(document.getElementById('coop-sheets').textContent), 8000, 'the partner is holding the soul');
            await a.keyboard.up('Tab');
            await a.evaluate(() => $gameVariables.setValue(32, 2));
            await sleep(700);
            await a.evaluate(() => { window.runEnded = false; Coop.on('runover', () => { window.runEnded = true; }); });
            await a.evaluate((n) => { $gameSystem.onBeforeSave(); DataManager.saveGame(n); }, 1);
            const savedRun = await a.evaluate(() => Coop.world.runId);
            await a.evaluate(() => SceneManager.goto(Scene_Title));
            await waitFor(a, () => window.runEnded && !Coop.world.live, 20000, 'the run to end when Ann returns to the title');
            await waitFor(a, () => !Coop.others().some((p) => p.bot), 30000, 'the partner to go home with the run');
            let parks = [];
            for (let i = 0; i < 20 && !parks.length; i++) { parks = parked(server.saves); if (!parks.length) await sleep(250); }
            const ended = await a.evaluate(() => ({ over: !!window.runEnded, live: Coop.world.live }));
            check('the last person returning to the title ends the run and sends the partner home', ended.over && !ended.live && parks.length > 0, JSON.stringify(ended) + ' ' + parks.join(','));

            await a.evaluate(() => { DataManager.loadGame(1); SceneManager.goto(Scene_Map); $gameSystem.onAfterLoad(); });
            await waitFor(a, () => SceneManager._scene instanceof Scene_Map && Coop.world.live, 30000, 'Ann continues the run');
            check('Continue is the same run', (await a.evaluate(() => Coop.world.runId)) === savedRun);
            await waitFor(a, () => Coop.others().some((p) => p.bot && (p.st === 'map' || p.st === 'dead')), 90000, 'the partner is back without F8');
            await sleep(6500);
            await a.keyboard.down('Tab');
            await waitFor(a, () => document.getElementById('coop-sheets').textContent.length > 40, 8000, 'the continued partner\'s sheet');
            const kept = await a.evaluate(() => ({
                run: Coop.world.runId,
                soul: /Crow Mauler soul/.test(document.getElementById('coop-sheets').textContent),
                map: Coop.others().some((p) => p.bot && p.st === 'map'),
                dice: $gameVariables.value(32),
                name: (Coop.others().find((p) => p.bot) || {}).name,
            }));
            await a.keyboard.up('Tab');
            check('Continue brings the parked body back, still in the run', kept.run === savedRun && kept.soul && kept.map && kept.dice === 2 && kept.name === partnerName, JSON.stringify(kept));

            await a.evaluate(() => { window.runEnded = false; SceneManager.goto(Scene_Title); });
            await waitFor(a, () => window.runEnded && !Coop.world.live, 20000, 'the run ends again');
            await waitFor(a, () => !Coop.others().some((p) => p.bot), 30000, 'the partner goes home again');
            let parkedAgain = [];
            for (let i = 0; i < 20 && !parkedAgain.length; i++) { parkedAgain = parked(server.saves); if (!parkedAgain.length) await sleep(250); }
            check('the body is parked again for the run that just ended', parkedAgain.length > 0, parkedAgain.join(','));

            await a.evaluate(() => T.quickStart(1, 27, 67));
            await waitFor(a, () => T.onMap(), 60000, 'Ann\'s new game');
            await a.evaluate(() => { T.settle(); T.begin(); });
            await waitFor(a, () => Coop.world.live, 15000, 'the new run');
            const freshId = await a.evaluate(() => Coop.world.runId);
            check('New Game after that is a new run', freshId && freshId !== savedRun, freshId + ' ' + savedRun);
            await waitFor(a, () => Coop.others().some((p) => p.bot && p.st === 'map'), 90000, 'the partner is back in the new run without F8');
            await sleep(6500);
            await a.keyboard.down('Tab');
            await waitFor(a, () => document.getElementById('coop-sheets').textContent.length > 40, 8000, 'the new partner\'s sheet');
            const fresh = await a.evaluate(() => ({
                run: Coop.world.runId,
                soul: /Crow Mauler soul/.test(document.getElementById('coop-sheets').textContent),
                map: Coop.others().some((p) => p.bot && p.st === 'map'),
                dice: $gameVariables.value(32),
                me: Coop.world.runId,
            }));
            await a.keyboard.up('Tab');
            check('the new run calls a new body, not the parked one', fresh.run === freshId && fresh.map && !fresh.soul && fresh.dice === 0, JSON.stringify(fresh));

            await press(a, 'F8');
            await waitFor(a, () => !Coop.others().some((p) => p.bot), 30000, 'the new partner goes home');
            await sleep(2000);
            check('nothing is left parked for the next call', parked(server.saves).length === 0, parked(server.saves).join(','));
        } catch (e) {
            const msg = String(e && e.message || e);
            if (msg !== 'stop') check(msg, false);
            try {
                await a.keyboard.up('Tab');
                if (bo) { await bo.close(); bo = null; }
                if (await a.evaluate(() => Coop.refused)) await a.evaluate(() => { Coop.refused = false; Coop.connect(); });
                await waitFor(a, () => Coop.connected, 15000, 'Ann connected again').catch(() => {});
                if (!(await a.evaluate(() => Coop.world.live))) {
                    if (!(await a.evaluate(() => window.T && T.onMap()))) {
                        if (!(await a.evaluate(() => SceneManager._scene instanceof Scene_Title))) {
                            await a.evaluate(() => SceneManager.goto(Scene_Title));
                            await waitFor(a, () => SceneManager._scene instanceof Scene_Title, 20000, 'Ann at the title to restart').catch(() => {});
                        }
                        await a.evaluate(() => T.quickStart(1, 27, 67));
                        await waitFor(a, () => T.onMap(), 60000, 'Ann back on the map');
                    }
                    await a.evaluate(() => { T.settle(); T.begin(); });
                    await waitFor(a, () => Coop.world.live, 15000, 'Ann live again');
                }
                await a.evaluate(() => {
                    window.partnerNotes = [];
                    if (!window._partnerNotes) {
                        window._partnerNotes = true;
                        Coop.on('partnernote', (m) => window.partnerNotes.push(String(m.text || '')));
                    }
                });
                // A partner the page can no longer see can still be running. F8 then
                // sends that one home instead of calling, and the two-partner section
                // never gets two. Drain until a toggle would call, then let stop() finish.
                let homed = false;
                for (let pass = 0; pass < 4; pass++) {
                    if (await a.evaluate(() => Coop.others().some((p) => p.bot))) {
                        await press(a, 'F8');
                        await waitFor(a, () => !Coop.others().some((p) => p.bot), 35000, 'the partner is sent home so the rest can run').catch(() => {});
                        homed = true;
                        continue;
                    }
                    if (parked(server.saves).length) {
                        await press(a, 'F8');
                        await waitFor(a, () => Coop.others().some((p) => p.bot), 90000, 'a parked body called so it can be sent home').catch(() => {});
                        continue;
                    }
                    break;
                }
                if (!homed && !(await a.evaluate(() => Coop.others().some((p) => p.bot))) && !parked(server.saves).length) {
                    await a.evaluate(() => { window.partnerNotes = []; });
                    await press(a, 'F8');
                    await sleep(700);
                    const said = await a.evaluate(() => (window.partnerNotes || []).join(' | '));
                    if (/on the way back/.test(said)) {
                        await waitFor(a, () => Coop.others().some((p) => p.bot), 90000, 'the recalled partner arrives to be sent home').catch(() => {});
                        await press(a, 'F8');
                        await waitFor(a, () => !Coop.others().some((p) => p.bot), 35000, 'the recalled partner is sent home').catch(() => {});
                        homed = true;
                    } else if (/on the way/.test(said)) {
                        await press(a, 'F8');
                        homed = true;
                    } else if (/going home/.test(said)) homed = true;
                }
                if (homed) await sleep(12000);
            } catch (e2) { console.error(e2); }
        }

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
        if (bo) { try { await bo.close(); } catch (e2) { /* gone */ } }
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
