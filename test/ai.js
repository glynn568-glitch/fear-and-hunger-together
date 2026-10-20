// The AI partner, with a scripted mind in place of the model: joins, talks,
// takes orders, fights its own turns as a guest and as the owner, answers a
// dialogue choice, and walks to a ritual circle to call a dead partner back.
const { startServer, launch, openPlayer, waitFor, sleep, shot } = require('./lib');
const { checker } = require('./common');
const install = require('./helpers');
const installBot = require('../tools/bot-page');

async function press(page, code, ms) {
    await page.keyboard.down(code); await sleep(ms || 130); await page.keyboard.up(code); await sleep(220);
}

(async () => {
    const check = checker();
    const port = 8441;
    const server = await startServer(port);
    const browser = await launch();
    let a, bot;
    const asked = [];
    try {
        a = await openPlayer(browser, `http://localhost:${port}/?name=Ann`, 'Ann');
        bot = await openPlayer(browser, `http://localhost:${port}/?name=Claude`, 'bot');
        for (const p of [a, bot]) await waitFor(p, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 90000, 'title + connection');
        await a.evaluate(install);

        // The scripted mind: answers by kind, records what it was told.
        await bot.exposeFunction('fhBrainCharacter', () => {});
        await bot.exposeFunction('fhBrain', async (kind, text) => {
            asked.push({ kind, text });
            await sleep(300);
            if (kind === 'battle') {
                const m = /(\d+) Guard \[left arm\] (?!gone)/.exec(text);
                return { do: 'attack', target: m ? Number(m[1]) : 0, say: 'The arm first.' };
            }
            if (kind === 'chat') {
                if (/"[^"]*party[^"]*"$/.test(text)) return { say: 'In line.', order: 'party' };
                if (/"[^"]*wait[^"]*"$/.test(text)) return { say: 'Holding here.', order: 'wait' };
                if (/"[^"]*follow[^"]*"$/.test(text)) return { say: 'Right behind you.', order: 'follow' };
                if (/"[^"]*torch[^"]*"$/.test(text)) return { say: 'Take it.', give: { kind: 'item', id: 5 } };
                if (/"[^"]*explore[^"]*"$/.test(text)) return { say: 'I will look around.', order: 'explore' };
                return { say: 'Mm.' };
            }
            if (kind === 'choice') return { pick: 1, say: '' };
            return { say: '' };
        });
        await bot.evaluate(installBot, { character: 'knight', follow: '' });

        await a.evaluate(() => T.quickStart(1, 27, 67));
        await waitFor(a, () => T.onMap(), 60000, 'Ann on the map');
        await a.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(a, () => Coop.world.live, 10000, 'Ann live');

        //--- joining ----------------------------------------------------------
        await waitFor(bot, () => BOT.status().character === 'knight' && SceneManager._scene instanceof Scene_Map && Coop.world.live, 60000, 'the bot joins as the knight');
        await waitFor(a, () => Coop.others().some((p) => p.bot === 1 && p.st === 'map'), 10000, 'Ann sees a bot on the map');
        check('the partner joins as the knight and says it is a bot', true);
        // Keep the test's roaming guards out of the way until the fights below.
        for (const p of [a, bot]) await p.evaluate(() => { for (const ev of $gameMap.events()) if (/guard|enemy|chaser/i.test(ev.event().name)) ev.erase(); });

        //--- talking and orders -----------------------------------------------
        await sleep(1500);
        await a.evaluate(() => Coop.say('wait here a moment'));
        await waitFor(bot, () => BOT.mode === 'wait', 10000, 'the bot takes the wait order');
        await waitFor(a, () => [...document.querySelectorAll('#coop-chat .line')].some((l) => /Claude: Holding here\./.test(l.textContent)), 5000, 'Ann sees the reply');
        check('told to wait, it answers in the chat and waits', true);
        check('the model was told who said what', asked.some((q) => q.kind === 'chat' && /Ann says to you: "wait here a moment"/.test(q.text) && /You: Knight/.test(q.text)), (asked.find((q) => q.kind === 'chat') || {}).text);
        const before = await bot.evaluate(() => [$gamePlayer.x, $gamePlayer.y].join());
        await a.evaluate(() => { $gamePlayer.locate(27, 61); });
        await sleep(3000);
        check('while waiting it stays put', (await bot.evaluate(() => [$gamePlayer.x, $gamePlayer.y].join())) === before, before);
        await waitFor(a, () => /Claude.*waiting/.test(document.getElementById('coop-hud').textContent), 5000, 'the corner list shows it waiting');
        check('the corner list says what the partner is doing', true);
        await a.evaluate(() => Coop.say('follow me'));
        await waitFor(bot, () => BOT.mode === 'follow', 10000, 'the bot takes the follow order');
        await waitFor(bot, () => Math.abs($gamePlayer.y - 61) <= 3, 15000, 'the bot walks after Ann');
        check('told to follow, it comes', true);

        //--- Ann goes through a door with the bot beside her: it comes at once ---
        const door = await bot.evaluate(() => BOT.nav.exits($dataMap, 1).find((e) => e.to === 4));
        const tNear = Date.now();
        await a.evaluate((d) => { $gamePlayer.reserveTransfer(4, d.tx, d.ty, 2, 0); }, door);
        await waitFor(a, () => $gameMap.mapId() === 4 && T.onMap(), 20000, 'Ann on the next map');
        await waitFor(bot, () => $gameMap.mapId() === 4 && SceneManager._scene instanceof Scene_Map && !$gamePlayer.isTransferring(), 20000, 'the bot right behind her');
        check('beside her when she goes through a door, it follows at once, as a player pressing F does', true, Math.round((Date.now() - tNear) / 1000) + ' s');

        //--- far off when she goes: it walks to the door and through ----------
        await a.evaluate(() => { $gamePlayer.reserveTransfer(1, 27, 61, 2, 0); });
        await waitFor(a, () => $gameMap.mapId() === 1 && T.onMap(), 20000, 'Ann back on map 1');
        await waitFor(bot, () => $gameMap.mapId() === 1 && SceneManager._scene instanceof Scene_Map && !$gamePlayer.isTransferring(), 60000, 'the bot back on map 1');
        for (const p of [a, bot]) await p.evaluate(() => { for (const ev of $gameMap.events()) if (/guard|enemy|chaser/i.test(ev.event().name)) ev.erase(); });
        await bot.evaluate(() => { BOT.mode = 'wait'; });
        await a.evaluate(() => { $gamePlayer.locate(27, 61); });
        await sleep(1500);
        // Too far for the offer (more than 8 tiles): she leaves from the door, the
        // bot back in the first room, then she calls it after her.
        await bot.evaluate(() => { $gamePlayer.locate(27, 68); });
        await sleep(800);
        await a.evaluate((d) => { $gamePlayer.locate(d.x, d.y); $gamePlayer.reserveTransfer(4, d.tx, d.ty, 2, 0); }, door);
        await waitFor(a, () => $gameMap.mapId() === 4 && T.onMap(), 20000, 'Ann on the next map again');
        await a.evaluate(() => { $gamePlayer.locate($gamePlayer.x, $gamePlayer.y - 2); });
        await bot.evaluate(() => { BOT.mode = 'follow'; });
        const trail = [];
        const tDoor = Date.now();
        for (;;) {
            const st = await bot.evaluate(() => BOT.status());
            trail.push(st);
            if (st.map === 4 || Date.now() - tDoor > 90000) break;
            await sleep(500);
        }
        let jumped = 0;
        for (let i = 1; i < trail.length; i++) if (trail[i].map === trail[i - 1].map && Math.abs(trail[i].x - trail[i - 1].x) + Math.abs(trail[i].y - trail[i - 1].y) > 8) jumped++;
        const arrived = trail[trail.length - 1];
        // Walked, not caught up the quick way: last seen on this side close to the door.
        const last = trail.filter((t) => t.map !== 4).pop();
        const atDoor = last ? Math.abs(last.x - door.x) + Math.abs(last.y - door.y) : 99;
        check('far off when she went, it walks to that door and comes through after her', arrived.map === 4 && jumped === 0 && atDoor <= 4 && trail.some((t) => t.errand && t.errand.kind === 'follow'),
            'arrived on map ' + arrived.map + ' at ' + arrived.x + ',' + arrived.y + ' in ' + Math.round((Date.now() - tDoor) / 1000) + ' s, jumps ' + jumped + ', last seen ' + atDoor + ' tiles from the door; it said: ' + [...new Set(trail.map((t) => t.said))].join(' | '));

        //--- Tab shows what the partner wears and carries ----------------------
        await a.keyboard.down('Tab');
        await waitFor(a, () => /Long sword/.test(document.getElementById('coop-sheets').textContent), 8000, 'the partner\'s sheet');
        const sheet = await a.evaluate(() => document.getElementById('coop-sheets').textContent);
        await a.keyboard.up('Tab');
        await sleep(300);
        check('holding Tab shows the partner: health, hunger, what it wears and carries', /Knight/.test(sheet) && /AI partner/.test(sheet) && /Hunger/.test(sheet) && /Plate mail/.test(sheet) && /Torch/.test(sheet)
            && !(await a.evaluate(() => document.getElementById('coop-sheets').classList.contains('on'))), sheet.slice(0, 200));
        // Back to the first map together for the rest.
        await a.evaluate(() => { $gamePlayer.reserveTransfer(1, 27, 61, 2, 0); });
        await waitFor(a, () => $gameMap.mapId() === 1 && T.onMap(), 20000, 'Ann back on map 1');
        await waitFor(bot, () => $gameMap.mapId() === 1 && SceneManager._scene instanceof Scene_Map && !$gamePlayer.isTransferring(), 90000, 'the bot back on map 1');
        for (const p of [a, bot]) await p.evaluate(() => { for (const ev of $gameMap.events()) if (/guard|enemy|chaser/i.test(ev.event().name)) ev.erase(); });
        await waitFor(bot, () => { const p = Coop.others().find((q) => !q.bot); return p && Math.abs(p.x - $gamePlayer.x) + Math.abs(p.y - $gamePlayer.y) <= 3; }, 60000, 'the bot beside Ann again');

        //--- told to explore alone, it searches and comes back when called ------
        await bot.evaluate(() => { window.found = []; const g = Game_Party.prototype.gainItem; Game_Party.prototype.gainItem = function (item, n) { if (item && n > 0) window.found.push(item.name); return g.apply(this, arguments); }; });
        await a.evaluate(() => Coop.say('go explore on your own for a bit'));
        await waitFor(bot, () => BOT.mode === 'explore', 10000, 'the bot takes the explore order');
        await waitFor(bot, () => window.found.length > 0 || BOT.visited.size >= 6, 180000, 'the bot finds something');
        const ex = await bot.evaluate(() => ({ searched: [...BOT.visited].map((k) => { const ev = $gameMap.event(Number(k.split(':')[1])); return k + ' ' + (ev ? ev.event().name + '@' + ev.x + ',' + ev.y : '?'); }), found: window.found, at: [$gamePlayer.x, $gamePlayer.y] }));
        const annAt = await a.evaluate(() => [$gamePlayer.x, $gamePlayer.y]);
        check('told to explore, it goes off alone and finds things', ex.found.length > 0, JSON.stringify(ex) + ' Ann at ' + annAt);
        await a.evaluate(() => Coop.say('come back and follow me'));
        await waitFor(bot, () => BOT.mode === 'follow', 10000, 'the bot takes the follow order');
        await waitFor(bot, () => { const p = Coop.others().find((q) => !q.bot); return p && p.m === $gameMap.mapId() && Math.abs(p.x - $gamePlayer.x) + Math.abs(p.y - $gamePlayer.y) <= 3; }, 120000, 'the bot comes back');
        check('called back, it comes back to her', true);

        //--- told to join her party, it walks in her line through a door ------
        await a.evaluate(() => Coop.say('join my party'));
        await waitFor(bot, () => Coop.partyLeader && !Coop.peers.get(Coop.partyLeader).bot, 10000, 'the bot joins her party');
        await a.evaluate(() => { $gamePlayer.reserveTransfer(74, 15, 22, 8, 0); });
        await waitFor(a, () => $gameMap.mapId() === 74 && T.onMap(), 20000, 'Ann on map 74');
        await a.evaluate(() => T.settle());
        await waitFor(bot, () => $gameMap.mapId() === 74 && SceneManager._scene instanceof Scene_Map && !$gamePlayer.isTransferring(), 20000, 'the bot follows in her line');
        await sleep(1500);
        const inLine = await bot.evaluate(() => { const p = Coop.peers.get(Coop.partyLeader); return { gap: Math.abs(p.x - $gamePlayer.x) + Math.abs(p.y - $gamePlayer.y), act: Coop.botActivity() }; });
        check('in her party, it goes through the door with her at once and stays in line', inLine.gap <= 2 && inLine.act === 'walking in line', JSON.stringify(inLine));
        await a.evaluate(() => Coop.say('wait here'));
        await waitFor(bot, () => BOT.mode === 'wait' && !Coop.partyLeader, 10000, 'the bot steps out of line to wait');
        check('told to wait, it steps out of her line', true);
        await a.evaluate(() => Coop.say('follow me'));
        await waitFor(bot, () => BOT.mode === 'follow', 10000, 'following again');
        await a.evaluate(() => { $gamePlayer.reserveTransfer(1, 27, 61, 2, 0); });
        await waitFor(a, () => $gameMap.mapId() === 1 && T.onMap(), 20000, 'Ann back on map 1');
        await waitFor(bot, () => $gameMap.mapId() === 1 && SceneManager._scene instanceof Scene_Map && !$gamePlayer.isTransferring(), 90000, 'the bot back on map 1');
        for (const p of [a, bot]) await p.evaluate(() => { for (const ev of $gameMap.events()) if (/guard|enemy|chaser/i.test(ev.event().name)) ev.erase(); });
        await waitFor(bot, () => { const p = Coop.others().find((q) => !q.bot); return p && Math.abs(p.x - $gamePlayer.x) + Math.abs(p.y - $gamePlayer.y) <= 3; }, 60000, 'the bot beside Ann again');
        await bot.evaluate(() => { for (const ev of $gameMap.events()) if (/guard|enemy|chaser/i.test(ev.event().name)) ev.erase(); });

        //--- hunger and the bag -----------------------------------------------
        check('it starts with the torch the intro hands out', await bot.evaluate(() => $gameParty.numItems($dataItems[5]) === 1));
        await bot.evaluate(() => { const me = $gameParty.leader(); me.changeExp(95, false); $gameParty.gainItem($dataItems[16], 1); }); // Dried meat
        await waitFor(bot, () => $gameParty.numItems($dataItems[16]) === 0 && $gameParty.leader().currentExp() > 100, 15000, 'the bot eats when hungry');
        check('hungry, it eats from its own bag', true, 'hunger now ' + (await bot.evaluate(() => $gameParty.leader().currentExp())));
        await bot.evaluate(() => { $gameParty.leader().changeExp(85, false); });
        await sleep(12000);
        check('hungry with nothing to eat, it is told to ask for food', asked.some((q) => q.kind === 'note' && /no food/.test(q.text)), (asked.filter((q) => q.kind === 'note').pop() || {}).text);
        await bot.evaluate(() => { $gameParty.leader().changeExp(140, false); });
        await a.evaluate(() => Coop.say('can I have your torch'));
        await waitFor(a, () => $gameParty.numItems($dataItems[5]) === 1, 20000, 'Ann receives the torch');
        check('asked for something, it walks over and hands it across', await bot.evaluate(() => $gameParty.numItems($dataItems[5]) === 0));
        check('the model sees its bag and hunger', asked.some((q) => q.kind === 'chat' && /Your bag: item 5 Torch x1/.test(q.text) && /full|fed/.test(q.text)));

        //--- looking after itself ----------------------------------------------
        await bot.evaluate(() => { $gameParty.gainItem($dataItems[8], 1); $gameParty.leader().addState(5); });
        await waitFor(bot, () => !$gameParty.leader().isStateAffected(5), 8000, 'the bot binds its bleeding');
        check('bleeding, it binds the wound with a cloth fragment from its bag', await bot.evaluate(() => $gameParty.numItems($dataItems[8]) === 0));
        await bot.evaluate(() => { $gameParty.leader().clearResult(); $gameParty.leader().addState(5); });
        let toldNothing = false;
        for (let i = 0; i < 40 && !toldNothing; i++) {
            await sleep(200);
            toldNothing = asked.some((q) => /bleeding and have nothing for it/.test(q.text)) || await bot.evaluate(() => BOT.notes.some((t) => /bleeding and have nothing for it/.test(t)));
        }
        await bot.evaluate(() => { $gameParty.leader().removeState(5); $gameParty.gainItem($dataItems[132], 1); const me = $gameParty.leader(); me.setHp(Math.floor(me.mhp * 0.15)); });
        await waitFor(bot, () => $gameParty.numItems($dataItems[132]) === 0, 8000, 'the bot heals near death');
        const hpNow = await bot.evaluate(() => $gameParty.leader().hp + '/' + $gameParty.leader().mhp);
        check('close to death, it heals with a herb; with nothing for bleeding it is told to ask', toldNothing && Number(hpNow.split('/')[0]) > 15, 'told ' + toldNothing + ', hp ' + hpNow + ' ' + asked.slice(-3).map((q) => q.text.slice(0, 120)).join(' / '));
        await bot.evaluate(() => { const me = $gameParty.leader(); me.setHp(me.mhp); });
        const seenRow = await bot.evaluate(() => BOT.situationText ? BOT.situationText() : '');
        check('the model is told which enemies are in sight', /Enemies in sight: |No enemy in sight\./.test(seenRow), seenRow.slice(-160));

        //--- a fight Ann starts: the bot is a guest ---------------------------
        await a.evaluate(() => {
            window.picks = [];
            const orig = Coop.applyPick;
            Coop.applyPick = function (actor, pick) { const r = orig.apply(this, arguments); const act = actor._actions[0]; window.picks.push({ actor: actor.actorId(), pick, r }); return r; };
            const setTarget = Game_Action.prototype.setTarget;
            Game_Action.prototype.setTarget = function (i) { if (this.subject().isActor() && this.subject().actorId() === 3) window.knightTarget = i; return setTarget.call(this, i); };
        });
        const bx = await bot.evaluate(() => [$gamePlayer.x, $gamePlayer.y]);
        await a.evaluate((x, y) => { $gamePlayer.locate(x, y + 1); }, bx[0], bx[1]);
        await sleep(600);
        await a.evaluate(() => { BattleManager.setup(1, true, true); SceneManager.push(Scene_Battle); });
        await waitFor(bot, () => SceneManager._scene instanceof Scene_CoopSpectate, 10000, 'the bot is pulled into Ann\'s fight');
        await waitFor(a, () => BattleManager._phase === 'input' && BattleManager.actor() && BattleManager.actor().actorId() === 1, 20000, 'Ann chooses first');
        await press(a, 'KeyZ'); await press(a, 'KeyZ'); await press(a, 'KeyZ');
        await waitFor(a, () => window.picks.length > 0, 15000, 'the bot sends its move');
        const p1 = await a.evaluate(() => ({ picks: window.picks, target: window.knightTarget, enemy: $gameTroop.members()[window.knightTarget] && $gameTroop.members()[window.knightTarget].name() }));
        check('as a guest, its chosen move is set on the owner\'s machine', p1.picks[0].actor === 3 && p1.picks[0].r === '' && p1.enemy === 'Guard [left arm]', JSON.stringify(p1));
        const brief = asked.find((q) => q.kind === 'battle');
        check('the fight is described in words, wounds without numbers', brief && /Enemies: 0 Guard \[torso\] unhurt/.test(brief.text) && /skill 66 Fast attack/.test(brief.text) && !/1300/.test(brief.text), brief && brief.text.slice(0, 400));
        // The round plays out and comes back to Ann.
        try {
            await waitFor(a, () => (BattleManager._phase === 'input' && BattleManager.actor() && BattleManager.actor().actorId() === 1) || BattleManager._phase === 'battleEnd', 30000, 'the next round, or the fight won');
            check('the round plays out after its move', true);
        } catch (e) {
            const st = await a.evaluate(() => { const s = SceneManager._scene; const w = {}; for (const k in s) if (s[k] && s[k].active !== undefined && s[k].isOpen) w[k] = (s[k].active ? 'A' : '') + (s[k].isOpen() ? 'O' : '') + (s[k].visible ? 'V' : ''); return { phase: BattleManager._phase, windows: w, busy: s.isAnyInputWindowActive(), log: s._logWindow && s._logWindow.isBusy(), msg: $gameMessage.isBusy() }; });
            check('the round plays out after its move', false, JSON.stringify(st));
        }
        // Now and then the round itself kills the guard; then "won" is the true report.
        const wonInRound = await a.evaluate(() => BattleManager._phase === 'battleEnd' && $gameTroop.isAllDead());
        await a.evaluate(() => { if (BattleManager._phase !== 'battleEnd') BattleManager.abort(); });
        // A won fight ends on its own text; Ann reads through it.
        for (let i = 0; i < 30 && !(await a.evaluate(() => SceneManager._scene instanceof Scene_Map)); i++) await press(a, 'KeyZ');
        await waitFor(a, () => SceneManager._scene instanceof Scene_Map, 15000, 'Ann back on the map');
        await waitFor(bot, () => SceneManager._scene instanceof Scene_Map && !Coop.battle, 15000, 'the bot back on the map');
        const told = asked.map((q) => q.text).concat(await bot.evaluate(() => BOT.notes.slice())).join('\n').split('\n').filter((t) => /fight is over/.test(t));
        if (wonInRound) check('a fight won in the round is reported as won', told.some((t) => /won: Guard.* is dead/.test(t)), told.join(' | '));
        else check('a fight that only broke off is not reported as a kill', told.some((t) => /nobody won: it broke off, and Guard.* is still alive/.test(t)), told.join(' | '));

        //--- busy when Ann's fight starts: it joins once free ------------------
        await bot.evaluate(() => { $gameMessage.add('Something holds your attention.'); });
        await sleep(300);
        await a.evaluate(() => { BattleManager.setup(1, true, true); SceneManager.push(Scene_Battle); });
        await waitFor(bot, () => SceneManager._scene instanceof Scene_CoopSpectate, 20000, 'the bot joins the fight already under way');
        check('busy when a fight starts beside it, it joins once free', true);
        await sleep(1000);
        await a.evaluate(() => { BattleManager.abort(); });
        for (let i = 0; i < 30 && !(await a.evaluate(() => SceneManager._scene instanceof Scene_Map)); i++) await press(a, 'KeyZ');
        await waitFor(a, () => SceneManager._scene instanceof Scene_Map, 15000, 'Ann back on the map');
        await waitFor(bot, () => SceneManager._scene instanceof Scene_Map && !Coop.battle, 15000, 'the bot back on the map');

        //--- a fight the bot starts: Ann is the guest -------------------------
        await bot.evaluate(() => {
            window.picks = [];
            const orig = Coop.applyPick;
            Coop.applyPick = function (actor, pick) { const r = orig.apply(this, arguments); window.picks.push({ actor: actor.actorId(), pick, r }); return r; };
        });
        await sleep(800);
        const ax = await a.evaluate(() => [$gamePlayer.x, $gamePlayer.y]);
        await bot.evaluate((x, y) => { $gamePlayer.locate(x + 1, y); BattleManager.setup(1, true, true); SceneManager.push(Scene_Battle); }, ax[0], ax[1]);
        await waitFor(a, () => SceneManager._scene instanceof Scene_CoopSpectate, 10000, 'Ann is pulled into the bot\'s fight');
        // The game's "did the player guard in time" check, run on the bot's machine with Ann guarding.
        await waitFor(bot, () => Coop.battle && Coop.battle.guests && Coop.battle.guests.size === 1, 10000, 'Ann in the bot\'s party');
        const justGuard = await bot.evaluate(() => {
            const ask = () => {
                $gameSwitches.setValue(1281, false);
                window.jg = 0;
                const i = new Game_Interpreter();
                i.setup([{ code: 111, indent: 0, parameters: [0, 1281, 0] }, { code: 355, indent: 1, parameters: ['window.jg = 1'] }, { code: 0, indent: 1, parameters: [] },
                    { code: 412, indent: 0, parameters: [] }, { code: 0, indent: 0, parameters: [] }]);
                while (i.isRunning()) i.update();
                return window.jg;
            };
            const before = ask();
            $gameActors.actor(1).addState(2); // Ann's character guards
            const guarding = ask();
            $gameActors.actor(1).removeState(2);
            return { before, guarding };
        });
        check("in the bot's fight, Ann's own guard counts for dodging a charge", justGuard.before === 0 && justGuard.guarding === 1, JSON.stringify(justGuard));
        await waitFor(bot, () => window.picks.length > 0, 25000, 'the bot chooses in its own fight');
        const p2 = await bot.evaluate(() => window.picks);
        check('as the owner, it chooses its own moves', p2[0].actor === 3 && p2[0].r === '', JSON.stringify(p2));
        await waitFor(bot, () => BattleManager.isInputting() && BattleManager.actor() && BattleManager.actor().actorId() === 1, 15000, 'Ann\'s turn in the bot\'s fight');
        await press(a, 'KeyZ'); await press(a, 'KeyZ'); await press(a, 'KeyZ');
        await waitFor(bot, () => !BattleManager.isInputting() || (BattleManager.actor() && BattleManager.actor().actorId() !== 1), 10000, 'Ann commands her own character in the bot\'s fight');
        check('the human still commands their own character there', true);
        await waitFor(bot, () => window.picks.length > 1 || BattleManager._phase === 'battleEnd' || SceneManager._scene instanceof Scene_Map, 40000, 'a second round in the bot\'s fight, or the fight won');
        check('its own fight plays out round after round', true);
        // Won already: the bot reads its own closing text through.
        await bot.evaluate(() => { if (SceneManager._scene instanceof Scene_Battle && BattleManager._phase !== 'battleEnd') BattleManager.abort(); });
        await waitFor(bot, () => SceneManager._scene instanceof Scene_Map, 30000, 'the bot back on the map');
        await waitFor(a, () => SceneManager._scene instanceof Scene_Map && !Coop.battle, 15000, 'Ann back on the map');

        //--- a dialogue choice the bot runs into ------------------------------
        await bot.evaluate(() => {
            window.answer = -1;
            Coop.answerTest = (n) => { window.answer = n; };
            const list = [
                { code: 101, indent: 0, parameters: ['', 0, 0, 2] },
                { code: 401, indent: 0, parameters: ['A voice asks which way.'] },
                { code: 102, indent: 0, parameters: [['Left', 'Right'], 1, 0, 2, 0] },
                { code: 402, indent: 0, parameters: [0, 'Left'] }, { code: 355, indent: 1, parameters: ['Coop.answerTest(0)'] }, { code: 0, indent: 1, parameters: [] },
                { code: 402, indent: 0, parameters: [1, 'Right'] }, { code: 355, indent: 1, parameters: ['Coop.answerTest(1)'] }, { code: 0, indent: 1, parameters: [] },
                { code: 404, indent: 0, parameters: [] }, { code: 0, indent: 0, parameters: [] },
            ];
            $gameMap._interpreter.setup(list, 0);
        });
        await waitFor(bot, () => window.answer >= 0, 20000, 'the bot answers a choice');
        const ch = await bot.evaluate(() => window.answer);
        check('it answers a dialogue choice the way the model says', ch === 1 && asked.some((q) => q.kind === 'choice' && /A voice asks which way/.test(q.text) && /1 Right/.test(q.text)), 'picked ' + ch);

        //--- Ann dies; the bot walks to the circle ----------------------------
        await a.evaluate(() => SceneManager.goto(Scene_Gameover));
        await waitFor(a, () => Coop.dead && SceneManager._scene instanceof Scene_CoopDead, 10000, 'Ann is dead and watching');
        await waitFor(bot, () => BOT.errand && BOT.errand.plan, 20000, 'the bot plans a way to a circle');
        const plan = await bot.evaluate(() => ({ goal: BOT.errand.plan.goal, hops: BOT.errand.plan.hops.length, at: [$gameMap.mapId(), $gamePlayer.x, $gamePlayer.y] }));
        console.log('plan', JSON.stringify(plan));
        // Keep the walker alive for the test; a real one has to survive the way.
        await bot.evaluate(() => { window.keepAlive = setInterval(() => { const m = $gameParty.leader(); if (m) m.setHp(m.mhp); }, 500); });
        const t0 = Date.now();
        let line = '', prevPos = null, jumps = 0;
        for (;;) {
            const st = await bot.evaluate(() => ({ s: BOT.status(), said: BOT.said }));
            line = JSON.stringify(st);
            if (prevPos && prevPos.map === st.s.map && Math.abs(prevPos.x - st.s.x) + Math.abs(prevPos.y - st.s.y) > 14) jumps++;
            prevPos = st.s;
            if (await a.evaluate(() => !Coop.dead)) break;
            if (Date.now() - t0 > 240000) { console.log('last bot state', line); break; }
            if (st.s.scene === 'Scene_Battle') await bot.evaluate(() => { if (BattleManager._phase && BattleManager._phase !== 'battleEnd') BattleManager.abort(); });
            await sleep(1000);
        }
        console.log('screenshot', await shot(bot, 'ai-errand'));
        const back = await a.evaluate(() => ({ dead: Coop.dead, scene: SceneManager._scene.constructor.name, hp: $gameParty.leader().hp }));
        const spent = await bot.evaluate(() => [409, 476, 486, 2046, 2445].filter((s) => $gameSwitches.value(s)));
        check('it walked to a ritual circle and called Ann back', !back.dead && spent.length === 1, JSON.stringify(back) + ' circles spent ' + spent + ' in ' + Math.round((Date.now() - t0) / 1000) + ' s');
        check('it walked: no jumps on the way', jumps === 0, jumps + ' jumps');

        //--- again, from the next map: through a door and back ----------------
        for (const p of [a, bot]) await p.evaluate(() => { $gameSwitches._data[409] = false; });
        await bot.evaluate(() => {
            BOT.mode = 'wait';
            const exit = BOT.nav.exits($dataMap, 1).find((e) => e.to === 4);
            $gamePlayer.reserveTransfer(4, exit.tx, exit.ty, 2, 0);
        });
        await waitFor(bot, () => $gameMap.mapId() === 4 && SceneManager._scene instanceof Scene_Map && !$gamePlayer.isTransferring(), 20000, 'the bot is on the next map');
        await sleep(1000);
        await a.evaluate(() => SceneManager.goto(Scene_Gameover));
        await waitFor(a, () => Coop.dead && SceneManager._scene instanceof Scene_CoopDead, 10000, 'Ann is dead again');
        await waitFor(bot, () => BOT.errand && BOT.errand.plan, 20000, 'the bot plans again');
        const plan2 = await bot.evaluate(() => ({ goal: BOT.errand.plan.goal, hops: BOT.errand.plan.hops.map((h) => h.map + '>' + h.to), at: [$gameMap.mapId(), $gamePlayer.x, $gamePlayer.y] }));
        console.log('plan', JSON.stringify(plan2));
        const t1 = Date.now();
        const maps = new Set();
        for (;;) {
            const st = await bot.evaluate(() => BOT.status());
            maps.add(st.map);
            if (await a.evaluate(() => !Coop.dead)) break;
            if (Date.now() - t1 > 240000) { console.log('last bot state', JSON.stringify(st), await bot.evaluate(() => BOT.said)); break; }
            if (st.scene === 'Scene_Battle') await bot.evaluate(() => { if (BattleManager._phase && BattleManager._phase !== 'battleEnd') BattleManager.abort(); });
            await sleep(1000);
        }
        const back2 = await a.evaluate(() => !Coop.dead);
        // Where a door leads can hang on the run's random floor layout; the
        // test put both players on map 1 by hand, so the far side may be
        // another version of the floor. Either way it must go through and finish.
        // (The bot plans by the run's own rolls, which may name another entrance than the map 1 the test chose.)
        check('from the next map it found the door, came through and called Ann back', back2 && plan2.hops.length === 1 && plan2.hops[0].startsWith('4>') && maps.has(4) && maps.size >= 2, plan2.hops.join() + ', maps seen ' + [...maps] + ', ' + Math.round((Date.now() - t1) / 1000) + ' s');
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish([a, bot].filter(Boolean));
    await browser.close();
    server.kill();
    process.exit(code);
})();
