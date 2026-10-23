// The AI partner with no model at all (no subscription, no key): it still
// takes orders from plain words and answers them, says what it needs, and in
// a fight heals a partner close to death before it attacks.
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const { checker } = require('./common');
const install = require('./helpers');
const installBot = require('../tools/bot-page');

(async () => {
    const check = checker();
    const port = 8467;
    const server = await startServer(port);
    const browser = await launch();
    let a, bot;
    const said = (page, re) => page.evaluate((src) => [...document.querySelectorAll('#coop-chat .line')].some((l) => new RegExp(src).test(l.textContent)), re.source);
    try {
        a = await openPlayer(browser, `http://localhost:${port}/?name=Ann`, 'Ann');
        bot = await openPlayer(browser, `http://localhost:${port}/?name=Claude`, 'bot');
        for (const p of [a, bot]) await waitFor(p, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 90000, 'title + connection');
        await a.evaluate(install);
        // What tools/bot.js hands the page when there is no model: every question answered with nothing.
        await bot.exposeFunction('fhBrainCharacter', () => {});
        await bot.exposeFunction('fhBrain', async () => null);
        await bot.evaluate(installBot, { character: 'knight', follow: '' });

        await a.evaluate(() => T.quickStart(1, 27, 67));
        await waitFor(a, () => T.onMap(), 60000, 'Ann on the map');
        await a.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(a, () => Coop.world.live, 10000, 'Ann live');
        await waitFor(bot, () => BOT.status().character === 'knight' && SceneManager._scene instanceof Scene_Map && Coop.world.live, 60000, 'the bot joins as the knight');
        for (const p of [a, bot]) await p.evaluate(() => { for (const ev of $gameMap.events()) if (/guard|enemy|chaser/i.test(ev.event().name)) ev.erase(); });
        await sleep(1500);

        //--- orders in plain words ----------------------------------------------
        await a.evaluate(() => Coop.say('Wait here!'));
        await waitFor(bot, () => BOT.mode === 'wait', 10000, 'the bot takes the wait order');
        await sleep(800);
        check('told to wait, it waits and says so', await said(a, /Claude: Waiting here\./));
        await a.evaluate(() => { $gamePlayer.locate(27, 61); });
        await a.evaluate(() => Coop.say('ok come with me'));
        await waitFor(bot, () => BOT.mode === 'follow', 10000, 'the bot takes the follow order');
        await waitFor(bot, () => Math.abs($gamePlayer.y - 61) <= 3, 15000, 'the bot walks after Ann');
        check('told to come, it follows', await said(a, /Claude: Coming\./));
        await a.evaluate(() => Coop.say('how are you holding up'));
        await sleep(1500);
        check('asked how it is, it says its health and hunger', await said(a, /Claude: \d+ of \d+, /));
        await a.evaluate(() => Coop.say('hand me your torch'));
        await waitFor(a, () => $gameParty.numItems($dataItems[5]) === 1, 20000, 'Ann receives the torch');
        check('asked for its torch, it walks over and hands it across', await bot.evaluate(() => $gameParty.numItems($dataItems[5]) === 0));
        const before = await bot.evaluate(() => BOT.lines.length);
        await a.evaluate(() => Coop.say('lovely weather'));
        await sleep(1500);
        check('small talk it cannot read gets no answer and changes nothing', (await bot.evaluate(() => BOT.lines.length)) === before && (await bot.evaluate(() => BOT.mode)) === 'follow');

        // Lines that read like an order and are not (review 10/22): no order, or the right one.
        const lines = {
            'you can go first': null, 'I need to go home soon': null, 'go home': 'leave',
            'stay close': 'follow', 'stay with me': 'follow', 'stay here': 'wait', "don't wait": null, "don't follow me": null,
            "I'll give you a herb": null, 'give me a second': null, "it's quiet in here": null, 'be quiet': 'quiet',
            'search the room with me': null, 'go look around': 'explore', 'stop': 'wait', 'keep going': null,
            // Grok's (10/22)
            "how come you're still back there": null, "I can't wait to get out": null, "there's a scout ahead": null,
            "I'll use a herb on you once I'm there": null, 'wait in line': 'wait', 'bear with me': null, 'come on': null,
            "it's no use": null, 'give me a herb': 'say', 'come here': 'follow',
        };
        const got = await bot.evaluate((ls) => Object.keys(ls).map((l) => { const r = BOT.plainReply(l); return [l, r ? r.order || (r.give ? 'give' : r.say ? 'say' : '') : null]; }), lines);
        const wrong = got.filter(([l, o]) => (o || null) !== lines[l]);
        check('lines that only sound like orders are not taken as orders', !wrong.length, JSON.stringify(wrong));

        // A wind-up anywhere in the round just played means guard, even with a partner's own guard shown after it;
        // one from an earlier round does not.
        const guardPicks = await bot.evaluate(() => {
            const base = { allies: [{ i: 0, hp: 100, mhp: 100, how: 'unhurt' }], items: [], tell: false, enemies: [{ i: 0, name: 'Guard [torso]', how: 'unhurt', hit: 95, strikes: true, blows: 2 }] };
            const windup = 'The monster takes a step closer...';
            return [BOT.plainPick(Object.assign({}, base, { log: [windup, 'Guard'], round: [windup, 'Guard'] })).do,
                BOT.plainPick(Object.assign({}, base, { log: [windup, 'Guard'], round: [] })).do];
        });
        check('it guards on a wind-up in the round just played, and only then', guardPicks.join() === 'guard,attack', guardPicks.join());
        // Enemies Grok named from the data: the part to cut is the one that takes fewest blows among
        // those that strike or kill (blows = hits needed / chance to hit).
        const bosses = await bot.evaluate(() => {
            const pick = (enemies) => { const b = { allies: [], items: [], tell: false, round: [], log: [], enemies: enemies.map((e, i) => Object.assign({ i, how: 'unhurt' }, e)) }; return b.enemies[BOT.plainPick(b).target].name; };
            return {
                // Moonless: only the head howls (44% to hit); the torso is 1400 HP.
                moonless: pick([{ name: 'Moonless [torso]', strikes: false, blows: 3 / 0.95 }, { name: 'Moonless [head]', strikes: true, blows: 1 / 0.44 }, { name: 'Moonless [paw]', strikes: false, blows: 1 }]),
                // Old guardian: a harmless 2400 HP head, arms that throw boulders.
                guardian: pick([{ name: 'Old guardian [head]', strikes: false, blows: 4 / 0.92 }, { name: 'Old guardian [left arm]', strikes: true, blows: 3 / 0.95 }]),
                // A body with no parts.
                rat: pick([{ name: 'Rat', strikes: true, blows: 1 }]),
            };
        });
        check('Moonless: the head that howls; Old guardian: the arms that throw; a rat: the rat', bosses.moonless === 'Moonless [head]' && bosses.guardian === 'Old guardian [left arm]' && bosses.rat === 'Rat', JSON.stringify(bosses));
        // Grok Build took 9-25 s a fight turn (10/23): a model that slow plays its fights by the same rules, at once.
        const slow = await bot.evaluate(async () => {
            const brief = { turn: 1, you: 'D\'arce', attack: { weapon: 'Sword' }, skills: [], items: [], tell: false, round: [], log: [],
                allies: [{ i: 0, name: 'Ann', how: 'unhurt', hp: 100, mhp: 100, states: [] }],
                enemies: [{ i: 0, name: 'Guard [left arm]', how: 'unhurt', states: [], hit: 90, strikes: true, blows: 1 }, { i: 1, name: 'Guard [torso]', how: 'unhurt', states: [], hit: 95, ends: true, blows: 2 }] };
            BOT.fightMs = [3000, 2500];
            const quickIsSlow = BOT.slowFights();
            BOT.fightMs = [19000, 3000]; // one slow turn (a cold start) is not a slow model
            const oneSlowIsSlow = BOT.slowFights();
            BOT.fightMs = [21000, 9500, 3000];
            const slowIsSlow = BOT.slowFights();
            const t0 = Date.now();
            const pick = await BOT.decide(brief);
            const ms = Date.now() - t0;
            const last = BOT.picks[BOT.picks.length - 1];
            BOT.talked(1200);
            BOT.talked(900);
            const backAfterQuickTalk = !BOT.slowFights();
            BOT.fightMs = [];
            return { quickIsSlow, oneSlowIsSlow, slowIsSlow, ms, pick, slowFlag: last.slow, backAfterQuickTalk };
        });
        check('a model slower than 8 s a fight turn hands its fights to the rules of thumb at once; a quick one keeps them',
            !slow.quickIsSlow && !slow.oneSlowIsSlow && slow.slowIsSlow && slow.backAfterQuickTalk && slow.ms < 500 && slow.slowFlag && slow.pick.target === 0, JSON.stringify(slow));

        //--- needs, said out loud -------------------------------------------------
        await bot.evaluate(() => { for (const it of $gameParty.items()) $gameParty.loseItem(it, 99); $gameParty.leader().changeExp(85, false); });
        let asked = '';
        for (let i = 0; i < 40 && !asked; i++) { await sleep(500); asked = await bot.evaluate(() => BOT.lines.find((l) => /out of food/.test(l)) || ''); }
        // Said on the bot's side first; on a bad line it reaches Ann a moment later.
        let heard = false;
        for (let i = 0; i < 20 && asked && !heard; i++) { heard = await said(a, /Claude: I'm out of food./); if (!heard) await sleep(500); }
        check('hungry with nothing to eat, it asks for food', heard, asked);
        await bot.evaluate(() => { $gameParty.leader().changeExp(140, false); });

        //--- a fight: Ann near death, the bot carrying a herb ---------------------
        await bot.evaluate(() => { $gameParty.gainItem($dataItems[132], 1); }); // Red herb
        await a.evaluate(() => {
            window.picks = [];
            const orig = Coop.applyPick;
            Coop.applyPick = function (actor, pick) { const r = orig.apply(this, arguments); window.picks.push({ actor: actor.actorId(), pick, r, log: Coop.battleBrief(actor).log.slice(-3) });
                // The herb check done, Ann is kept standing: a guard's blow at 10% would end the fight.
                if (actor.actorId() === 3) { const me = $gameParty.leader(); me.setHp(me.mhp); }
                return r; };
        });
        const bx = await bot.evaluate(() => [$gamePlayer.x, $gamePlayer.y]);
        await a.evaluate((x, y) => { $gamePlayer.locate(x, y + 1); }, bx[0], bx[1]);
        await sleep(1500);
        await a.evaluate(() => { const me = $gameParty.leader(); me.setHp(Math.max(1, Math.floor(me.mhp * 0.1))); BattleManager.setup(1, true, true); SceneManager.push(Scene_Battle); });
        await waitFor(bot, () => SceneManager._scene instanceof Scene_CoopSpectate, 10000, 'the bot is pulled into Ann\'s fight');
        await waitFor(a, () => BattleManager._phase === 'input' && BattleManager.actor() && BattleManager.actor().actorId() === 1, 20000, 'Ann chooses first');
        // Ann sits on her move for over 25 s (the clock set back): the partner is still
        // asked for its own the moment hers is in, however long hers took.
        await a.evaluate(() => {
            Coop.battle.ctlAt = Date.now() - 30000;
            for (const g of Coop.battle.guests.values()) g.touchedAt = Date.now() - 30000;
            Coop.applyPick(BattleManager.actor(), { do: 'guard' });
        });
        let asked1 = false;
        for (let i = 0; i < 30 && !asked1; i++) { await sleep(500); asked1 = await a.evaluate(() => window.picks.some((p) => p.actor === 3)); }
        check('after the host took over 25 s on their move, the partner still gets its turn', asked1);
        await waitFor(a, () => window.picks.some((p) => p.actor === 3), 15000, 'the bot sends its move');
        const p1 = await a.evaluate(() => window.picks.find((p) => p.actor === 3));
        check('with Ann close to death, its move is the herb, on her', p1.pick.do === 'item' && p1.pick.id === 132 && p1.pick.target === 0 && p1.r === '', JSON.stringify(p1));

        // The next rounds: Ann keeps choosing, the bot's move is watched.
        async function nextPick(n) {
            for (let i = 0; i < 60; i++) {
                const p = await a.evaluate((k) => window.picks.filter((q) => q.actor === 3)[k] || null, n);
                if (p) return p;
                // Ann guards, so nothing but the bot's blows comes off.
                await a.evaluate(() => { if (BattleManager.isInputting() && BattleManager.actor() && BattleManager.actor().actorId() === 1) Coop.applyPick(BattleManager.actor(), { do: 'guard' }); });
                if (await a.evaluate(() => $gameMessage.isBusy())) { await a.keyboard.down('KeyZ'); await sleep(130); await a.keyboard.up('KeyZ'); }
                await sleep(1000);
            }
            return null;
        }
        // From here the guard does nothing (its grab can end the fight at random); its pages still run.
        await a.evaluate(() => { Game_Enemy.prototype.makeActions = function () { this.clearActions(); }; });
        const nameOf =(i) => a.evaluate((k) => { const e = $gameTroop.members()[k]; return e ? e.name() : 'none (' + SceneManager._scene.constructor.name + ', alive ' + $gameTroop.aliveMembers().map((m) => m.name()).join('/') + ')'; }, i);
        // A guard the way players take one: the cleaver arm, the stinger, then the torso;
        // the head (44% to hit) only once it cannot dodge.
        const order = [];
        let n = 1;
        // Guard turns (a wind-up seen) are right too; the next attack is the one counted.
        async function nextAttack() { for (;;) { const p = await nextPick(n++); if (!p || p.pick.do === 'attack') return p; } }
        for (let k = 0; k < 3; k++) {
            const p = await nextAttack();
            const t = p && await nameOf(p.pick.target);
            order.push(t + (p ? '' : ' (' + await a.evaluate(() => [BattleManager._phase, BattleManager.actor() && BattleManager.actor().actorId(), $gameMessage.isBusy(), JSON.stringify(Coop.battle && [...Coop.battle.guests.values()].map((g) => [g.actors, g.quit]))].join(' ')) + ')'));
            // That part comes off before the next round, as the blow would have done.
            await a.evaluate((k) => { const e = $gameTroop.members()[k]; if (e && !/torso/.test(e.name())) { e.setHp(0); e.die(); } const me = $gameParty.leader(); me.setHp(me.mhp); const body = $gameTroop.members()[0]; body.setHp(body.mhp); }, p ? p.pick.target : -1);
        }
        if (order.some((o) => !/^Guard/.test(o))) console.log('bot side: ' + JSON.stringify(await bot.evaluate(() => ({ scene: SceneManager._scene.constructor.name, battle: Coop.battle && { role: Coop.battle.role, owner: Coop.battle.owner, refused: Coop.battle.refused }, picks: BOT.picks.slice(-4), thinking: BOT.thinking, log: (Coop.log || []).slice(-15) }))) + ' | owner side: ' + JSON.stringify(await a.evaluate(() => ({ seq: Coop.battle && Coop.battle.turnSeq, log: (Coop.log || []).slice(-15) }))));
        if (order.some((o) => !/^Guard/.test(o))) console.log(JSON.stringify(await a.evaluate(() => window.picks.filter((p) => p.actor === 3).slice(-4))));
        check('against a guard it cuts the cleaver arm, then the stinger, then the torso', order.join() === 'Guard [left arm],Guard [stinger],Guard [torso]', order.join(' > '));
        // What the guard's own fight does once both legs are off: Weakness (state 62) on the head.
        await a.evaluate(() => { $gameTroop.members()[1].addState(62); });
        const p4 = await nextAttack();
        const t4 = p4 && await nameOf(p4.pick.target);
        if (!p4) console.log('bot side: ' + JSON.stringify(await bot.evaluate(() => ({ scene: SceneManager._scene.constructor.name, battle: Coop.battle && { role: Coop.battle.role, owner: Coop.battle.owner, refused: Coop.battle.refused }, picks: BOT.picks.slice(-4), thinking: BOT.thinking, log: (Coop.log || []).slice(-15) }))) + ' | owner side: ' + JSON.stringify(await a.evaluate(() => ({ scene: SceneManager._scene.constructor.name, phase: BattleManager._phase, actor: BattleManager.actor() && BattleManager.actor().actorId(), busy: $gameMessage.isBusy(), text: $gameMessage._texts, choices: $gameMessage._choices, alive: $gameTroop.aliveMembers().map((m) => m.name() + ' ' + m.hp), seq: Coop.battle && Coop.battle.turnSeq, picks: window.picks.length, log: (Coop.log || []).slice(-15) }))));
        check('once the head cannot dodge, it goes for the head', p4 && /head/.test(t4), t4 + ' ' + JSON.stringify(p4));
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish([a, bot].filter(Boolean));
    await browser.close();
    server.kill();
    process.exit(code);
})();
