// The AI partner with no model at all (no subscription, no key): it still
// takes orders from plain words and answers them, says what it needs, and in
// a fight heals a partner close to death before it attacks.
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const { checker } = require('./common');
const install = require('./helpers');
const installBot = require('../tools/bot-page');

// Keep a bear trap on its armed page. Its parallel compares its own tile to other
// characters and would set self switch A again; holding it leaves the graphic up.
function holdTraps(ids) {
    if (!Game_Event.prototype._trapHoldInstalled) {
        const orig = Game_Event.prototype.updateParallel;
        Game_Event.prototype.updateParallel = function () {
            if (this._trapHeld) return;
            orig.call(this);
        };
        Game_Event.prototype._trapHoldInstalled = true;
    }
    let pick = null;
    const armedPage = (ev) => {
        const page = ev && ev.page();
        const graphic = (page && page.image && page.image.characterName) || '';
        const cond = (page && page.conditions) || {};
        const ok = !!(page && ev && !ev._erased && /beartrap/i.test(graphic) && !(cond.selfSwitchValid && cond.selfSwitchCh === 'A') && (page.list || []).some((cmd) => cmd && cmd.code));
        return { ok, graphic, page: ev ? ev._pageIndex : -1 };
    };
    for (const id of ids) {
        const ev = $gameMap.event(id);
        if (!ev) continue;
        ev._erased = false;
        $gameSelfSwitches.setValue([$gameMap.mapId(), id, 'A'], false);
        ev.refresh();
        ev._trapHeld = true;
        ev._interpreter = null;
        const state = armedPage(ev);
        if (!pick || (state.ok && !pick.ok)) pick = state;
    }
    return pick ? { graphic: pick.graphic, armed: pick.ok, page: pick.page } : { graphic: '', armed: false, page: -1 };
}

// Tiles where this page's follower actually walks, traps counted as floor.
// Same order as Nav.search: careful first, then not; stop on the leader or beside them.

(async () => {
    const check = checker();
    const port = 8467;
    const server = await startServer(port);
    const logs = [];
    server.stdout.on('data', (d) => logs.push(String(d)));
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
        let noted = false;
        for (let i = 0; i < 16 && !noted; i++) {
            noted = /note Claude: heard Ann: "Wait here!" -> wait/.test(logs.join(''));
            if (!noted) await sleep(500);
        }
        await bot.evaluate(() => { const me = $gameParty.leader(); me.setHp(Math.max(1, me.hp - 1)); });
        let hurt = false;
        for (let i = 0; i < 20 && !hurt; i++) { await sleep(200); hurt = await bot.evaluate(() => BOT.mode === 'follow'); }
        await a.evaluate(() => Coop.say('Wait here!'));
        await waitFor(bot, () => BOT.mode === 'wait', 8000, 'waiting again');
        const left = await bot.evaluate(async () => {
            const ann = Coop.others().find((p) => !p.bot);
            const m = ann.m;
            // Not m + 1. That is map 2, the character-creation map: the bot
            // chases a partner off the map, and map 2's EV001 is an autorun
            // (35 commands, no switch) that leaves the bot stuck. A map the
            // game does not have still counts as "left", and the transfer
            // stays shut (fixes.js).
            const gone = 9999;
            let mode = BOT.mode;
            for (let i = 0; i < 25 && mode === 'wait'; i++) {
                ann.m = gone;
                await new Promise((r) => setTimeout(r, 200));
                mode = BOT.mode;
            }
            BOT.errand = null;
            ann.m = m;
            return mode;
        });
        check('a wait ends when it is hurt or the one who said it leaves the map, and the line is in the host log', noted && hurt && left === 'follow', 'noted ' + noted + ' hurt ' + hurt + ' mode ' + left);
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
        const followed = await bot.evaluate(async () => {
            const ann = Coop.others().find((p) => !p.bot);
            Coop.peers.set(4242, { id: 4242, name: 'Enki', st: 'map', m: $gameMap.mapId(), x: $gamePlayer.x, y: $gamePlayer.y, bot: 0, hp: 100, mhp: 100, an: 'Enki' });
            Coop.emit('heard', { from: 4242, name: 'Enki', text: 'Claude, follow me' });
            for (let i = 0; i < 20 && BOT.with !== 4242; i++) await new Promise((r) => setTimeout(r, 100));
            const afterFollow = BOT.said;
            const withId = BOT.with;
            Coop.emit('heard', { from: 4242, name: 'Enki', text: 'Claude, join my party' });
            for (let i = 0; i < 20 && Coop.partyLeader !== 4242; i++) await new Promise((r) => setTimeout(r, 100));
            const leader = Coop.partyLeader;
            Coop.leaveParty();
            Coop.peers.delete(4242);
            BOT.with = ann ? ann.id : 0;
            BOT.mode = 'follow';
            BOT.waitFor = null;
            return { afterFollow, withId, leader };
        });
        check('follow and party orders stick to the one who said them', followed.withId === 4242 && /Enki/.test(followed.afterFollow) && followed.leader === 4242, JSON.stringify(followed));

        // A wind-up anywhere in the round just played means guard, even with a partner's own guard shown after it;
        // one from an earlier round does not.
        const guardPicks = await bot.evaluate(() => {
            const base = { allies: [{ i: 0, hp: 100, mhp: 100, how: 'unhurt' }], items: [], tell: false, enemies: [{ i: 0, name: 'Guard [torso]', how: 'unhurt', hit: 95, strikes: true, blows: 2 }] };
            const windup = 'The monster takes a step closer...';
            return [BOT.plainPick(Object.assign({}, base, { log: [windup, 'Guard'], round: [windup, 'Guard'] })).do,
                BOT.plainPick(Object.assign({}, base, { log: [windup, 'Guard'], round: [] })).do];
        });
        check('it guards on a wind-up in the round just played, and only then', guardPicks.join() === 'guard,attack', guardPicks.join());
        // Priests, from the data: torso is the kill; the lantern wave does nothing guard
        // must answer; one "Priest chants something..." means the next turn is the lethal chant.
        const priests = await bot.evaluate(() => {
            const enemies = [
                { i: 0, name: 'Priest [torso]', how: 'unhurt', states: [], hit: 95, strikes: false, ends: true, blows: 8 },
                { i: 1, name: 'Priest [right arm]', how: 'unhurt', states: [], hit: 95, strikes: true, blows: 1 },
                { i: 2, name: 'Priest [head]', how: 'unhurt', states: [], hit: 80, strikes: false, blows: 1 },
            ];
            const base = { turn: 1, you: "D'arce", attack: { weapon: 'Sword' }, skills: [], items: [], allies: [{ i: 0, name: 'Ann', how: 'unhurt', hp: 100, mhp: 100, states: [] }], enemies };
            BOT.fightOrder = null;
            BOT.chantSaid = false;
            const torso = BOT.plainPick(Object.assign({ tell: false, round: [], log: [] }, base));
            const wave = BOT.plainPick(Object.assign({ tell: true, round: ['Priest waves his lantern...'], log: ['Priest waves his lantern...'] }, base));
            const chantBrief = Object.assign({ tell: false, round: [], log: ['Priest chants something...'] }, base);
            const before = BOT.lines.length;
            const text = BOT.briefText(chantBrief);
            const chant = BOT.plainPick(chantBrief);
            BOT.plainPick(chantBrief);
            const said = BOT.lines.slice(before);
            const chat = [...document.querySelectorAll('#coop-chat .line')].filter((l) => /Guard now, the chant!/.test(l.textContent)).length;
            return { torso, wave, chant, said, chat, line: (text.match(/Everyone must guard this turn or the chant can kill the whole party\./) || [''])[0] };
        });
        check('vs a priest, with no order, it goes for the torso', priests.torso.do === 'attack' && priests.torso.target === 0, JSON.stringify(priests.torso));
        check('a lantern wave is not a wind-up', priests.wave.do !== 'guard', JSON.stringify(priests.wave));
        check('after one chant it guards, the brief says everyone must, and it says so in chat once',
            priests.chant.do === 'guard' && priests.line.length > 0 && priests.said.length === 1 && /Guard now, the chant!/.test(priests.said[0]) && priests.chat === 1,
            JSON.stringify({ chant: priests.chant, said: priests.said, chat: priests.chat, line: priests.line }));
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
        const ordered = await bot.evaluate(async () => {
            const ann = Coop.others().find((p) => !p.bot);
            const was = Coop.battle;
            Coop.battle = { role: 'guest' };
            BOT.fightOrder = null;
            try {
                Coop.emit('heard', { from: ann.id, name: 'Ann', text: 'take the head' });
                for (let i = 0; i < 20 && !(BOT.fightOrder && BOT.fightOrder.kind === 'attack'); i++) await new Promise((r) => setTimeout(r, 100));
                const brief = { turn: 1, you: 'D\'arce', attack: { weapon: 'Sword' }, skills: [], tell: false, round: [], log: [], allies: [{ i: 0, name: 'Ann', how: 'hurt', hp: 80, mhp: 100, states: [] }], items: [],
                    enemies: [{ i: 0, name: 'Guard [left arm]', how: 'unhurt', states: [], hit: 90, strikes: true, blows: 1 }, { i: 1, name: 'Guard [head]', how: 'unhurt', states: [], hit: 40, strikes: false, blows: 4 }] };
                const head = { pick: BOT.plainPick(brief), text: BOT.briefText ? BOT.briefText(brief) : '' };
                Coop.emit('heard', { from: ann.id, name: 'Ann', text: 'guard' });
                for (let i = 0; i < 20 && !(BOT.fightOrder && BOT.fightOrder.kind === 'guard'); i++) await new Promise((r) => setTimeout(r, 100));
                const guard = BOT.plainPick({ tell: false, round: [], log: [], allies: [{ i: 0, hp: 100, mhp: 100, how: 'unhurt' }], items: [], enemies: [{ i: 0, name: 'Rat', how: 'unhurt', strikes: true, blows: 1 }] });
                return { head, guard };
            } finally {
                Coop.battle = was;
                BOT.fightOrder = null;
            }
        });
        check('a fight order from chat is kept, said in the brief, and the fallback obeys it',
            ordered.head.pick.do === 'attack' && ordered.head.pick.target === 1 && /told you:/.test(ordered.head.text) && /head/.test(ordered.head.text) && ordered.guard.do === 'guard',
            JSON.stringify({ pick: ordered.head.pick, guard: ordered.guard, line: (ordered.head.text.match(/told you:[^\n]*/ ) || [''])[0] }));

        // A fight order sticks only while this body is in the fight. An item or a skill is one turn.
        const spent = await bot.evaluate(async () => {
            const ann = Coop.others().find((p) => !p.bot);
            const was = Coop.battle;
            const brain = window.fhBrain;
            const ms = BOT.fightMs.slice();
            const settle = async (pred) => { for (let i = 0; i < 20 && !pred(); i++) await new Promise((r) => setTimeout(r, 100)); };
            const rat = {
                turn: 1, you: "D'arce", attack: { weapon: 'Sword' }, skills: [],
                items: [{ id: 132, name: 'Red herb', count: 1 }],
                tell: false, round: [], log: [],
                allies: [{ i: 0, name: 'Ann', how: 'unhurt', hp: 100, mhp: 100, states: [] }],
                enemies: [{ i: 0, name: 'Rat', how: 'unhurt', states: [], hit: 95, strikes: true, ends: false, blows: 1 }],
            };
            const headBrief = {
                turn: 1, you: "D'arce", attack: { weapon: 'Sword' }, skills: [], items: [],
                tell: false, round: [], log: [],
                allies: [{ i: 0, name: 'Ann', how: 'unhurt', hp: 100, mhp: 100, states: [] }],
                enemies: [
                    { i: 0, name: 'Guard [left arm]', how: 'unhurt', states: [], hit: 90, strikes: true, blows: 1 },
                    { i: 1, name: 'Guard [head]', how: 'unhurt', states: [], hit: 40, strikes: false, blows: 4 },
                ],
            };
            Coop.battle = null;
            BOT.fightOrder = null;
            BOT.fightMs = [];
            try {
                Coop.emit('heard', { from: ann.id, name: 'Ann', text: 'use red herb' });
                await settle(() => BOT.fightOrder && BOT.fightOrder.kind === 'item');
                const mapHerb = BOT.fightOrder && BOT.fightOrder.kind;
                Coop.emit('heard', { from: ann.id, name: 'Ann', text: 'guard' });
                await settle(() => BOT.fightOrder && BOT.fightOrder.kind === 'guard');
                const mapGuard = BOT.fightOrder && BOT.fightOrder.kind;
                const mapPick = BOT.plainPick(rat);
                Coop.battle = { role: 'guest' };
                BOT.fightOrder = null;
                Coop.emit('heard', { from: ann.id, name: 'Ann', text: 'take the head' });
                await settle(() => BOT.fightOrder && BOT.fightOrder.kind === 'attack');
                const head1 = BOT.plainPick(headBrief);
                const head2 = BOT.plainPick(headBrief);
                const headKept = BOT.fightOrder && BOT.fightOrder.kind;
                Coop.emit('heard', { from: ann.id, name: 'Ann', text: 'guard' });
                await settle(() => BOT.fightOrder && BOT.fightOrder.kind === 'guard');
                const guard1 = BOT.plainPick(rat);
                const guard2 = BOT.plainPick(rat);
                const guardKept = BOT.fightOrder && BOT.fightOrder.kind;
                Coop.emit('heard', { from: ann.id, name: 'Ann', text: 'use red herb' });
                await settle(() => BOT.fightOrder && BOT.fightOrder.kind === 'item');
                const herb1 = BOT.plainPick(rat);
                const herbLeft = BOT.fightOrder && BOT.fightOrder.kind;
                const herbText = BOT.briefText(rat);
                const herb2 = BOT.plainPick(rat);
                BOT.fightOrder = { kind: 'skill', what: 'fast attack', by: 'Ann' };
                const skillBrief = Object.assign({}, rat, { items: [], skills: [{ id: 66, name: 'Fast attack', usable: true }] });
                const skill1 = BOT.plainPick(skillBrief);
                const skillLeft = BOT.fightOrder && BOT.fightOrder.kind;
                const skill2 = BOT.plainPick(skillBrief);
                BOT.fightOrder = { kind: 'item', what: 'red herb', by: 'Ann' };
                window.fhBrain = async () => ({ do: 'item', id: 132, target: 0 });
                const model1 = await BOT.decide(rat);
                const model1FromModel = !!(BOT.picks[BOT.picks.length - 1] && BOT.picks[BOT.picks.length - 1].model);
                const modelLeft = BOT.fightOrder && BOT.fightOrder.kind;
                window.fhBrain = async () => null;
                const model2 = await BOT.decide(rat);
                return { mapHerb, mapGuard, mapPick, head1, head2, headKept, guard1, guard2, guardKept, herb1, herbLeft, herbTold: /told you:/.test(herbText), herb2, skill1, skillLeft, skill2, model1, model1FromModel, modelLeft, model2 };
            } finally {
                window.fhBrain = brain;
                Coop.battle = was;
                BOT.fightOrder = null;
                BOT.fightMs = ms;
            }
        });
        check('a fight order from the map is forgotten; an item or skill is used once; a guard or a part lasts the fight',
            !spent.mapHerb && !spent.mapGuard && spent.mapPick.do === 'attack' && spent.mapPick.target === 0
            && spent.head1.target === 1 && spent.head2.target === 1 && spent.headKept === 'attack'
            && spent.guard1.do === 'guard' && spent.guard2.do === 'guard' && spent.guardKept === 'guard'
            && spent.herb1.do === 'item' && spent.herb1.id === 132 && spent.herb1.target === 0 && !spent.herbLeft && !spent.herbTold && spent.herb2.do === 'attack'
            && spent.skill1.do === 'skill' && spent.skill1.id === 66 && spent.skill1.target === 0 && !spent.skillLeft && spent.skill2.do === 'attack'
            && spent.model1FromModel && spent.model1.do === 'item' && spent.model1.id === 132 && !spent.modelLeft && spent.model2.do === 'attack',
            JSON.stringify(spent));

        const named = await bot.evaluate(async () => {
            const ann = Coop.others().find((p) => !p.bot);
            const prev = { mode: BOT.mode, with: BOT.with, addressed: BOT.addressed, spokeTo: BOT.spokeTo, waitFor: BOT.waitFor, quiet: BOT.quiet };
            const settle = async (pred) => { for (let i = 0; i < 20 && !pred(); i++) await new Promise((r) => setTimeout(r, 100)); };
            Coop.peers.set(4242, { id: 4242, name: 'Enki', an: 'Enki', st: 'map', m: $gameMap.mapId(), x: 2, y: 2, bot: 0, hp: 100, mhp: 100 });
            try {
                BOT.addressed = null;
                BOT.mode = 'wait';
                BOT.with = 0;
                BOT.waitFor = null;
                BOT.aside.splice(0);
                Coop.emit('heard', { from: ann.id, name: 'Ann', text: "D'arce, follow me" });
                await settle(() => BOT.mode === 'follow');
                const darce = { mode: BOT.mode, with: BOT.with };
                BOT.mode = 'follow';
                BOT.addressed = { id: ann.id, until: Date.now() + 5000 };
                Coop.emit('heard', { from: ann.id, name: 'Ann', text: 'Okay, wait here' });
                await settle(() => BOT.mode === 'wait');
                const okay = BOT.mode;
                BOT.mode = 'follow';
                BOT.addressed = null;
                Coop.emit('heard', { from: ann.id, name: 'Ann', text: 'Claude can you wait' });
                await settle(() => BOT.mode === 'wait');
                const can = BOT.mode;
                BOT.mode = 'wait';
                BOT.addressed = null;
                const asideAt = BOT.aside.length;
                Coop.emit('heard', { from: ann.id, name: 'Ann', text: 'Claude is slow' });
                await settle(() => BOT.aside.length > asideAt);
                const about = { mode: BOT.mode, aside: BOT.aside.slice(asideAt).join(' | ') };
                return { darce, okay, can, about, who: BOT.character, ann: ann && ann.id };
            } finally {
                Coop.peers.delete(4242);
                BOT.mode = 'follow';
                BOT.with = ann ? ann.id : prev.with;
                BOT.addressed = null;
                BOT.spokeTo = 0;
                BOT.waitFor = null;
                BOT.quiet = prev.quiet;
                BOT.aside.splice(0);
            }
        });
        check('D\'arce, a comma that is not a name, and "can you" reach it; a line about it does not',
            named.darce.mode === 'follow' && named.darce.with === named.ann && named.okay === 'wait' && named.can === 'wait'
            && named.about.mode === 'wait' && /Claude is slow/.test(named.about.aside),
            JSON.stringify(named));

        const quietBrief = await bot.evaluate(() => {
            const ann = Coop.others().find((p) => !p.bot);
            const prev = { quiet: BOT.quiet, chantSaid: BOT.chantSaid, addressed: BOT.addressed, spokeTo: BOT.spokeTo };
            BOT.quiet = true;
            BOT.chantSaid = false;
            BOT.addressed = null;
            BOT.spokeTo = ann ? ann.id : 1;
            const chantBrief = {
                turn: 1, you: "D'arce", attack: { weapon: 'Sword' }, skills: [], items: [],
                allies: [{ i: 0, name: 'Ann', how: 'unhurt', hp: 100, mhp: 100, states: [] }],
                enemies: [{ i: 0, name: 'Priest [torso]', how: 'unhurt', states: [], hit: 95, strikes: false, ends: true, blows: 8 }],
                log: ['Priest chants something...'], round: [], tell: false,
            };
            const before = BOT.lines.length;
            const text = BOT.briefText(chantBrief);
            const said = BOT.lines.slice(before);
            const addressed = BOT.addressed;
            BOT.quiet = prev.quiet;
            BOT.chantSaid = prev.chantSaid;
            BOT.addressed = prev.addressed;
            BOT.spokeTo = prev.spokeTo;
            return { said, addressed: addressed && addressed.id, line: /Everyone must guard this turn or the chant can kill the whole party\./.test(text) };
        });
        check('building a fight brief does not speak and does not mark the partner as just addressed',
            quietBrief.said.length === 0 && !quietBrief.addressed && quietBrief.line,
            JSON.stringify(quietBrief));

        // Two players, two standing orders. The newer one is taken, and both stay visible.
        const weighed = await bot.evaluate(async () => {
            const ann = Coop.others().find((p) => !p.bot);
            const prev = { mode: BOT.mode, with: BOT.with, waitFor: BOT.waitFor, quiet: BOT.quiet, addressed: BOT.addressed, spokeTo: BOT.spokeTo };
            const settle = async (pred) => { for (let i = 0; i < 20 && !pred(); i++) await new Promise((r) => setTimeout(r, 100)); };
            const here = { st: 'map', m: $gameMap.mapId(), x: 2, y: 2, bot: 0, hp: 100, mhp: 100 };
            if (Coop.leaveParty) Coop.leaveParty();
            Coop.peers.set(4243, Object.assign({ id: 4243, name: 'Pho', an: 'Pho' }, here));
            Coop.peers.set(4242, Object.assign({ id: 4242, name: 'Enki', an: 'Enki' }, here));
            BOT.orders = {};
            BOT.orderFrom = 0;
            BOT.mode = 'follow';
            BOT.with = ann ? ann.id : 0;
            BOT.waitFor = null;
            const before = BOT.lines.length;
            try {
                Coop.emit('heard', { from: 4243, name: 'Pho', text: 'Claude, wait here' });
                await settle(() => BOT.mode === 'wait' && BOT.orders && BOT.orders['4243']);
                const sitWait = BOT.situationText();
                // A fight order in between does not replace the wait on record.
                Coop.emit('heard', { from: 4243, name: 'Pho', text: 'Claude, guard' });
                await new Promise((r) => setTimeout(r, 600));
                Coop.emit('heard', { from: 4242, name: 'Enki', text: 'Claude, follow me' });
                await settle(() => BOT.mode === 'follow' && BOT.with === 4242);
                const lines = BOT.lines.slice(before);
                const sit = BOT.situationText();
                const had = !!(BOT.orders && BOT.orders['4243']);
                Coop._dropPeer(4243);
                const still = !!(BOT.orders && BOT.orders['4243']);
                const after = BOT.situationText();
                return { mode: BOT.mode, with: BOT.with, lines, sit, sitWait, had, still, after };
            } finally {
                Coop.peers.delete(4242);
                Coop.peers.delete(4243);
                BOT.orders = {};
                BOT.orderFrom = 0;
                BOT.mode = 'follow';
                BOT.with = ann ? ann.id : prev.with;
                BOT.waitFor = null;
                BOT.addressed = null;
                BOT.spokeTo = 0;
                BOT.quiet = prev.quiet;
                if (BOT.aside) BOT.aside.splice(0);
            }
        });
        const weighedLines = (weighed.lines || []).join(' | ');
        check('pho says wait (then guard), Enki says follow, and both orders stay in view',
            weighed.mode === 'follow' && weighed.with === 4242
            && /Pho, waiting here\./.test(weighedLines) && (weighed.lines || []).filter((l) => /Following Enki\. Pho, I'm off\./.test(l)).length === 1
            && /Orders:/.test(weighed.sit) && /Pho \([^)]+\): wait here/.test(weighed.sit) && /Enki \([^)]+\): follow me/.test(weighed.sit)
            && /You are following Enki\./.test(weighed.sit) && /you follow Enki/.test(weighed.sit)
            && /you wait where Pho told you/.test(weighed.sitWait) && /You wait where Pho told you\./.test(weighed.sitWait),
            JSON.stringify({ mode: weighed.mode, with: weighed.with, lines: weighedLines.slice(0, 300), sit: String(weighed.sit || '').slice(0, 400), wait: String(weighed.sitWait || '').slice(0, 300) }));
        check('a player leaving clears their order',
            weighed.had && !weighed.still && /Enki \([^)]+\): follow me/.test(weighed.after) && !/Pho \([^)]+\):/.test(weighed.after),
            JSON.stringify({ had: weighed.had, still: weighed.still, after: String(weighed.after || '').slice(0, 400) }));

        //--- needs, said out loud -------------------------------------------------
        // Anything already on the map counts as searched, or a crate in reach would be eaten instead of asked for.
        await bot.evaluate(() => {
            for (const ev of $gameMap.events()) BOT.visited.add($gameMap.mapId() + ':' + ev.eventId());
            for (const it of $gameParty.items()) $gameParty.loseItem(it, 99);
            $gameParty.leader().changeExp(85, false);
            BOT.forage = null;
            BOT.mode = 'follow';
        });
        let asked = '';
        for (let i = 0; i < 40 && !asked; i++) { await sleep(500); asked = await bot.evaluate(() => BOT.lines.find((l) => /out of food/.test(l)) || ''); }
        // Said on the bot's side first; on a bad line it reaches Ann a moment later.
        let heard = false;
        for (let i = 0; i < 20 && asked && !heard; i++) { heard = await said(a, /Claude: I'm out of food./); if (!heard) await sleep(500); }
        check('hungry with nothing to eat, it asks for food', heard, asked);

        // A crate a few tiles off the line. Hungry, following: take it and eat, rather than ask again.
        const planted = await bot.evaluate(() => {
            const me = $gameParty.leader();
            for (const it of $gameParty.items()) $gameParty.loseItem(it, 99);
            me.changeExp(85, false);
            BOT.mode = 'follow';
            BOT.forage = null;
            BOT.errand = null;
            const who = Coop.others().find((p) => !p.bot);
            const px = $gamePlayer.x, py = $gamePlayer.y;
            const step = (x, y, nx, ny) => {
                const dx = nx - x, dy = ny - y;
                if (Math.abs(dx) + Math.abs(dy) !== 1) return false;
                const d = dx === 1 ? 6 : dx === -1 ? 4 : dy === 1 ? 2 : 8;
                return $gameMap.isValid(nx, ny) && $gameMap.isPassable(x, y, d) && $gameMap.isPassable(nx, ny, 10 - d);
            };
            const blocked = (x, y) => $gameMap.eventsXyNt(x, y).some((ev) => !ev._erased && ev.isNormalPriority())
                || $gameMap.eventsXy(x, y).some((ev) => /beartrap|spike_trap/i.test((ev.page() && ev.page().image && ev.page().image.characterName) || ''));
            let spot = null;
            for (const dist of [3, 2, 4]) {
                if (spot) break;
                for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const x = px + dx * dist, y = py + dy * dist;
                    if (!$gameMap.isValid(x, y) || blocked(x, y)) continue;
                    if (who && who.x === x && who.y === y) continue;
                    const armed = (x, y) => $gameMap.eventsXy(x, y).some((ev) => {
                        const page = ev.page();
                        if (!page || ev._erased) return false;
                        if (!/beartrap|spike_trap/i.test((page.image && page.image.characterName) || '')) return false;
                        const c = page.conditions || {};
                        if (c.selfSwitchValid && c.selfSwitchCh === 'A') return false;
                        return (page.list || []).some((cmd) => cmd && cmd.code);
                    });
                    let open = true;
                    for (let i = 0; i < dist; i++) if (!step(px + dx * i, py + dy * i, px + dx * (i + 1), py + dy * (i + 1))) open = false;
                    for (let i = 0; i <= dist; i++) if (armed(px + dx * i, py + dy * i)) open = false;
                    if (!open) continue;
                    spot = { x, y };
                    break;
                }
            }
            if (!spot) return { why: 'no open tile within 4 of the bot' };
            const blank = (list, selfSwitch) => ({
                conditions: { actorId: 1, actorValid: false, itemId: 1, itemValid: false, selfSwitchCh: 'A', selfSwitchValid: !!selfSwitch, switch1Id: 1, switch1Valid: false, switch2Id: 1, switch2Valid: false, variableId: 1, variableValid: false, variableValue: 0 },
                directionFix: false, image: { tileId: 0, characterName: '', direction: 2, pattern: 1, characterIndex: 0 }, list,
                moveFrequency: 3, moveRoute: { list: [{ code: 0, parameters: [] }], repeat: true, skippable: false, wait: false },
                moveSpeed: 3, moveType: 0, priorityType: 1, stepAnime: false, through: false, trigger: 0, walkAnime: true,
            });
            const id = $dataMap.events.length;
            $dataMap.events[id] = {
                id, name: 'forageCrate', note: '', x: spot.x, y: spot.y,
                pages: [
                    blank([{ code: 126, indent: 0, parameters: [15, 0, 0, 1] }, { code: 123, indent: 0, parameters: ['A', 0] }, { code: 0, indent: 0, parameters: [] }], false),
                    blank([{ code: 0, indent: 0, parameters: [] }], true),
                ],
            };
            $gameMap._events[id] = new Game_Event($gameMap.mapId(), id);
            return { id, x: spot.x, y: spot.y, from: [px, py], exp: me.currentExp() };
        });
        let ate = null;
        for (let i = 0; i < 40 && !(ate && ate.exp > 85 && ate.eggs === 0); i++) {
            await sleep(500);
            ate = await bot.evaluate(() => ({ exp: $gameParty.leader().currentExp(), eggs: $gameParty.numItems($dataItems[15]), x: $gamePlayer.x, y: $gamePlayer.y }));
        }
        check('hungry and following, it detours to food nearby and eats it', !!(planted && !planted.why && ate && ate.exp > 85 && ate.eggs === 0), JSON.stringify({ planted, ate }));
        await bot.evaluate((id) => {
            if (id && $gameMap._events[id]) $gameMap._events[id] = null;
            if ($gameMap._interpreter) $gameMap._interpreter.clear();
            if ($gameMessage) $gameMessage.clear();
            if ($gameTemp) $gameTemp.clearCommonEvent();
            $gameParty.leader().changeExp(140, false);
            BOT.forage = null;
            BOT.mode = 'follow';
        }, planted && planted.id);

        // A bear trap laid on the partner's way (the item lays one where the player stands, so
        // Map001's three wait out of reach until then): following, it never steps on the armed
        // trap; once sprung, the trap is floor again.
        const trapIds = await bot.evaluate(() => $gameMap.events().filter((ev) => /^bearTrap/i.test(ev.event().name)).map((ev) => ev.eventId()));
        for (const pg of [a, bot]) await pg.evaluate((ids) => { $gameMap.event(ids[0]).locate(27, 66); }, trapIds);
        await a.evaluate(holdTraps, trapIds);
        const held = await bot.evaluate(holdTraps, trapIds);
        await a.evaluate(() => { $gamePlayer.locate(27, 61); T.settle(); });
        await bot.evaluate(() => {
            for (const ev of $gameMap.events()) BOT.visited.add($gameMap.mapId() + ':' + ev.eventId());
            $gameMap._interpreter.clear(); $gameMessage.clear(); $gameTemp.clearCommonEvent();
            $gamePlayer.locate(27, 67);
            BOT.mode = 'follow'; BOT.forage = null; BOT.trail = null; BOT.errand = null;
            window.__xy = [];
            window.__xyTimer = setInterval(() => { window.__xy.push($gamePlayer.x + ',' + $gamePlayer.y); }, 30);
        });
        await sleep(7000);
        const walked = await bot.evaluate(() => { clearInterval(window.__xyTimer); return { trail: window.__xy, at: [$gamePlayer.x, $gamePlayer.y], trap: Coop.trapAt(27, 66) }; });
        await bot.evaluate((id) => { $gameSelfSwitches.setValue([$gameMap.mapId(), id, 'A'], true); $gameMap.event(id).refresh(); }, trapIds[0]);
        const sprung = await bot.evaluate(() => Coop.trapAt(27, 66));
        const moved = walked.trail.some((s) => s !== '27,67');
        check('following past an armed bear trap, it never stands on the trap, and once sprung it may',
            held.armed && walked.trap && moved && !walked.trail.includes('27,66') && !sprung,
            JSON.stringify({ held, at: walked.at, onTrap: walked.trail.includes('27,66'), moved, armedTrap: walked.trap, sprungTrap: sprung }));
        // Every kind of trap is read from what its event does, not from its look: the nail board by
        // the stairs (Map001 rusty_nail, touch: bleeding + leg infection) and an arrow trap (the
        // real Map003 page, which watches a plate event's tile) are hazards; plain floor is not.
        const kinds = await bot.evaluate(async () => {
            const nail = $gameMap.events().find((ev) => ev.event().name === 'rusty_nail');
            const m3 = await (await fetch('data/Map003.json')).json();
            const arrow = m3.events.find((e) => e && e.name === 'arrow_check');
            const plate = $gameMap.event(4);
            const id = $dataMap.events.length;
            const page = JSON.parse(JSON.stringify(arrow.pages[0]));
            for (const c of page.list) if (c.code === 122 && c.parameters[3] === 3 && c.parameters[5] > 0) c.parameters[5] = 4;
            $dataMap.events[id] = { id, name: 'arrow_check', note: '', x: 0, y: 0, pages: [page] };
            $gameMap._events[id] = new Game_Event($gameMap.mapId(), id);
            $gameMap._events[id]._trapHeld = true; // watched only: its own run would fire the arrow
            await new Promise((r) => setTimeout(r, 350));
            const r = { nail: Coop.hazardAt(nail.x, nail.y), nailNext: Coop.hazardAt(nail.x + 1, nail.y), plate: Coop.hazardAt(plate.x, plate.y), floor: Coop.hazardAt(27, 63) };
            $gameMap._events[id].erase();
            return r;
        });
        check('a nail board and an arrow trap are hazards, the floor beside them is not', kinds.nail && kinds.plate && !kinds.nailNext && !kinds.floor, JSON.stringify(kinds));
        // ...and following, it steps around the nail board as it does a bear trap.
        await bot.evaluate(() => { if (window.__xyTimer) clearInterval(window.__xyTimer); });
        const nailId = await bot.evaluate(() => $gameMap.events().find((ev) => ev.event().name === 'rusty_nail').eventId());
        for (const pg of [a, bot]) await pg.evaluate((id) => { $gameMap.event(id).locate(27, 66); }, nailId);
        await a.evaluate(() => { $gamePlayer.locate(27, 61); T.settle(); });
        await bot.evaluate(() => {
            $gameMap._interpreter.clear(); $gameMessage.clear(); $gameTemp.clearCommonEvent();
            for (const ev of $gameMap.events()) if (/^bearTrap/i.test(ev.event().name)) ev.locate(13, 22);
            $gamePlayer.locate(27, 67);
            BOT.mode = 'follow'; BOT.forage = null; BOT.trail = null; BOT.errand = null; BOT.goal = null;
            window.__xy = [];
            window.__xyTimer = setInterval(() => { window.__xy.push($gamePlayer.x + ',' + $gamePlayer.y); }, 30);
        });
        await sleep(7000);
        const nailWalk = await bot.evaluate(() => { clearInterval(window.__xyTimer); return { trail: window.__xy, at: [$gamePlayer.x, $gamePlayer.y], bleeding: $gameParty.leader().isStateAffected(5) }; });
        check('following past the nail board, it never steps on it', nailWalk.trail.some((s) => s !== '27,67') && !nailWalk.trail.includes('27,66') && !nailWalk.bleeding, JSON.stringify({ at: nailWalk.at, onNail: nailWalk.trail.includes('27,66'), bleeding: nailWalk.bleeding }));
        await bot.evaluate((id) => { $gameMap.event(id).locate(44, 42); }, nailId);
        await a.evaluate((id) => { $gameMap.event(id).locate(44, 42); }, nailId);
        await bot.evaluate(() => {
            if (window.__xyTimer) clearInterval(window.__xyTimer);
            if ($gameMap._interpreter) $gameMap._interpreter.clear();
            if ($gameMessage) $gameMessage.clear();
            $gamePlayer.locate(27, 61);
            BOT.mode = 'follow';
            BOT.forage = null;
            BOT.trail = null;
            BOT.errand = null;
            BOT.stuck = 0;
            $gameParty.leader().changeExp(140, false);
        });
        await a.evaluate(() => { $gamePlayer.locate(27, 62); T.settle(); });
        await sleep(400);

        // No model: the brief still names what is in reach. Nothing walks off to a circle on its own.
        const around = await bot.evaluate(() => {
            try {
            const px = $gamePlayer.x, py = $gamePlayer.y;
            const step = (x, y, nx, ny) => {
                const dx = nx - x, dy = ny - y;
                if (Math.abs(dx) + Math.abs(dy) !== 1) return false;
                const d = dx === 1 ? 6 : dx === -1 ? 4 : dy === 1 ? 2 : 8;
                return $gameMap.isValid(nx, ny) && $gameMap.isPassable(x, y, d) && $gameMap.isPassable(nx, ny, 10 - d);
            };
            const armed = (x, y) => $gameMap.eventsXy(x, y).some((ev) => {
                const page = ev.page();
                if (!page || ev._erased) return false;
                return /beartrap|spike_trap/i.test((page.image && page.image.characterName) || '');
            });
            const blocked = (x, y) => $gameMap.eventsXyNt(x, y).some((ev) => !ev._erased && ev.isNormalPriority()) || armed(x, y);
            const find = (dists, taken) => {
                for (const dist of dists) {
                    for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
                        const x = px + dx * dist, y = py + dy * dist;
                        if (!$gameMap.isValid(x, y) || blocked(x, y)) continue;
                        if (taken.some((t) => t.x === x && t.y === y)) continue;
                        let open = true;
                        for (let i = 0; i < dist; i++) if (!step(px + dx * i, py + dy * i, px + dx * (i + 1), py + dy * (i + 1)) || armed(px + dx * i, py + dy * i)) open = false;
                        if (open) return { x, y };
                    }
                }
                return null;
            };
            const circleAt = find([2, 3, 1], []);
            const bodyAt = find([2, 1, 3, 4], circleAt ? [circleAt] : []);
            if (!bodyAt || !circleAt) return { why: 'no open tiles', bodyAt, circleAt };
            const blank = (list, selfSwitch, through) => ({
                conditions: { actorId: 1, actorValid: false, itemId: 1, itemValid: false, selfSwitchCh: 'A', selfSwitchValid: !!selfSwitch, switch1Id: 1, switch1Valid: false, switch2Id: 1, switch2Valid: false, variableId: 1, variableValid: false, variableValue: 0 },
                directionFix: false, image: { tileId: 0, characterName: '', direction: 2, pattern: 1, characterIndex: 0 }, list,
                moveFrequency: 3, moveRoute: { list: [{ code: 0, parameters: [] }], repeat: true, skippable: false, wait: false },
                moveSpeed: 3, moveType: 0, priorityType: through ? 0 : 1, stepAnime: false, through: !!through, trigger: 0, walkAnime: true,
            });
            const add = (name, spot, pages) => {
                const id = $dataMap.events.length;
                $dataMap.events[id] = { id, name, note: '', x: spot.x, y: spot.y, pages };
                $gameMap._events[id] = new Game_Event($gameMap.mapId(), id);
                return id;
            };
            const body = add('body', bodyAt, [blank([{ code: 126, indent: 0, parameters: [37, 0, 0, 1] }, { code: 123, indent: 0, parameters: ['A', 0] }, { code: 0, indent: 0, parameters: [] }], false, false)]);
            const circle = add('circle1', circleAt, [blank([{ code: 121, indent: 0, parameters: [2445, 2445, 0] }, { code: 0, indent: 0, parameters: [] }], false, true)]);
            const sit = BOT.situationText();
            const goal = BOT.goal && BOT.goal.id;
            for (const id of [body, circle]) if ($gameMap._events[id]) $gameMap._events[id] = null;
            return { body, circle, sit, goal };
            } catch (e) { return { why: String(e && e.stack || e).slice(0, 400) }; }
        });
        const aroundLine = around && around.sit ? (around.sit.split('Around you:')[1] || '') : '';
        check('the situation lists a nearby body and a circle with ids',
            !!(around && !around.why && aroundLine.includes('b' + around.body) && aroundLine.includes('c' + around.circle) && /ritual circle (?:un)?spent/.test(aroundLine) && !around.goal),
            JSON.stringify(around && around.why ? around : { body: around && around.body, circle: around && around.circle, goal: around && around.goal, around: aroundLine.slice(0, 240) }));

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
        await a.evaluate(() => { BattleManager.setup(90, true, true); SceneManager.push(Scene_Battle); });
        let joinedBars = false;
        for (let i = 0; i < 8; i++) {
            if (await bot.evaluate(() => SceneManager._scene instanceof Scene_CoopSpectate || (Coop.battle && Coop.battle.role === 'guest'))) joinedBars = true;
            await sleep(500);
        }
        check('an iron-bars fight has nothing to fight, so the partner stays out', !joinedBars);
        await a.evaluate(() => { if (Coop.battle) BattleManager.abort(); });
        await waitFor(a, () => SceneManager._scene instanceof Scene_Map && !Coop.battle, 15000, 'Ann leaves the iron bars');
        await waitFor(bot, () => SceneManager._scene instanceof Scene_Map && !Coop.battle, 15000, 'the bot was not in the iron bars');
        await waitFor(a, () => !SceneManager.isSceneChanging() && SceneManager._scene._gabWindow, 15000, "Ann's map is up again");
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
            console.log('no pick from the bot; owner state:', await a.evaluate(() => { const b = Coop.battle; return JSON.stringify({ scene: SceneManager._scene.constructor.name, phase: BattleManager._phase, inputting: BattleManager.isInputting(), actor: BattleManager.actor() && BattleManager.actor().actorId(), idx: BattleManager._actionInputIndex, msg: $gameMessage.isBusy() && $gameMessage.allText().slice(0, 80), b: b && { role: b.role, turnSeq: b.turnSeq, turnKey: b.turnKey, ctl: b.ctl, ctlAge: Date.now() - b.ctlAt, guests: b.guests && [...b.guests].map(([id, g]) => ({ id, actors: g.actors, quit: g.quit, touchedAge: Date.now() - (g.touchedAt || 0) })) }, troop: $gameTroop.aliveMembers().map((m) => m.name() + ' ' + m.hp + '/' + m.mhp), sw: [16, 17, 1281].map((i) => $gameSwitches.value(i)), v19: $gameVariables.value(19), banner: (document.getElementById('coop-turn') || {}).textContent, interp: $gameTroop._interpreter.isRunning() }); }));
            console.log('bot state:', await bot.evaluate(() => JSON.stringify({ scene: SceneManager._scene.constructor.name, battle: Coop.battle && Coop.battle.role, thinking: BOT.thinking, last: BOT.lastBrief && BOT.lastBrief.turn, picks: (BOT.picks || []).slice(-3) })));
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
