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

// A fight against a troop with a grab, A owning it and B its guest, both too tough to die or be confused (a
// confused character takes no orders) and too weak to end it (no damage, and their weapons' bleeding and
// poison left off: those alone brought a 5000-HP torso down by turn 5). B guards whenever its brief names a
// grab coming that no player has chosen to guard against yet; A, choosing first, guards the grabs from the
// `aGuardsFrom`-th on (from 0), else attacks the torso, or, at full strength, part `hit` once `hitAfter` grabs
// have come, until it stops grabbing (`hitTurn`: the last turn A aimed at it). Each grab is the turn switch `sw` came on, with its
// outcome line (GabText matching `gab`). Ends once `until` grabs have shown their outcome and `after` turns
// past the hit have been chosen.
async function grabFight(a, o) {
    await a.evaluate((o) => {
        const gx = window._grabs = { turns: [], grabs: [], coins: 0, coinUp: false };
        const set = Game_Switches.prototype.setValue;
        gx.undo = [() => { Game_Switches.prototype.setValue = set; }];
        Game_Switches.prototype.setValue = function (id, v) {
            if (id === o.sw && v && !this.value(o.sw)) gx.grabs.push({ turn: $gameTroop.turnCount(), text: '' });
            return set.apply(this, arguments);
        };
        const add = Game_Battler.prototype.addState;
        gx.undo.push(() => { Game_Battler.prototype.addState = add; });
        Game_Battler.prototype.addState = function (id) { if (!(this.isActor() && id === 16)) add.apply(this, arguments); };
        const attackStates = Game_Actor.prototype.attackStates;
        gx.undo.push(() => { Game_Actor.prototype.attackStates = attackStates; });
        Game_Actor.prototype.attackStates = function () { return []; };
        const plugin = Game_Interpreter.prototype.pluginCommand;
        gx.undo.push(() => { Game_Interpreter.prototype.pluginCommand = plugin; });
        Game_Interpreter.prototype.pluginCommand = function (c, args) {
            const text = (args || []).join(' ');
            if (c === 'GabText' && new RegExp(o.gab).test(text) && gx.grabs.length) gx.grabs[gx.grabs.length - 1].text = text;
            return plugin.apply(this, arguments);
        };
        const timer = setInterval(() => {
            if (!(SceneManager._scene instanceof Scene_Battle)) return;
            const coin = $gameMessage.isChoice() && $gameMessage.choices().indexOf('HEADS') >= 0;
            if (coin && !gx.coinUp) gx.coins++;
            gx.coinUp = coin;
            if ($gameMessage.isBusy()) { Input._currentState.ok = !Input._currentState.ok; return; }
            const actor = BattleManager.actor(), act = BattleManager.inputtingAction();
            if (!BattleManager.isInputting() || !actor || !act || gx.last === act) return;
            gx.last = act;
            $gameParty.members().forEach((m) => m.recoverAll());
            const brief = Coop.battleBrief(actor);
            if (actor.actorId() === 3) {
                const part = brief.enemies.find((e) => e.i === o.hit);
                const guard = !!brief.grab && !brief.guarded;
                gx.turns.push({ turn: $gameTroop.turnCount() + 1, grab: brief.grab, guarded: brief.guarded, guard, pull: !!(part && part.pullsBack) });
                Coop.applyPick(actor, guard ? { do: 'guard' } : { do: 'attack', target: 0 });
            } else if (brief.grab && gx.grabs.length >= o.aGuardsFrom) {
                Coop.applyPick(actor, { do: 'guard' });
            } else {
                const part = brief.enemies.find((e) => e.i === o.hit);
                if (gx.hitTurn && !gx.pulled && !(part && part.pullsBack)) { gx.pulled = true; actor.addParam(2, -999); }
                const aim = gx.grabs.length >= o.hitAfter && !gx.pulled;
                if (aim && !gx.hitTurn) actor.addParam(2, 999);
                if (aim) gx.hitTurn = $gameTroop.turnCount() + 1;
                Coop.applyPick(actor, { do: 'attack', target: aim ? o.hit : 0 });
            }
        }, 50);
        gx.undo.push(() => clearInterval(timer));
        for (const k of ['processVictory', 'processAbort', 'processEscape', 'processDefeat']) {
            const f = BattleManager[k];
            gx.undo.push(() => { BattleManager[k] = f; });
            BattleManager[k] = function () { gx.end = gx.end || k + ' in turn ' + $gameTroop.turnCount(); return f.apply(this, arguments); };
        }
        BattleManager.setup(o.troop, true, true); SceneManager.push(Scene_Battle);
    }, o);
    await waitFor(a, (o) => {
        const gx = window._grabs, shown = gx.grabs.filter((g) => g.text);
        const past = gx.pulled ? gx.turns.filter((t) => t.turn > gx.hitTurn).length : 0;
        return shown.length >= o.until && past >= o.after || !(SceneManager._scene instanceof Scene_Battle) && gx.turns.length > 0;
    }, 150000, 'the grabs of troop ' + o.troop, o);
    const out = await a.evaluate(() => {
        const gx = window._grabs;
        gx.undo.forEach((f) => f());
        if (SceneManager._scene instanceof Scene_Battle) BattleManager.abort();
        return { turns: gx.turns, grabs: gx.grabs, hitTurn: gx.hitTurn || 0, coins: gx.coins, end: gx.end || '', sw: { 337: $gameSwitches.value(337) } };
    });
    await waitFor(a, () => SceneManager._scene instanceof Scene_Map, 15000, 'A back from troop ' + o.troop);
    return out;
}

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
        // A forced action whose skill is gone by its turn (marathon 10/28: Lord of flies' forced "Arm of the beast
        // twitches", the enemy's actions made anew meanwhile) is skipped, as the engine skips one on a normal turn.
        const forced = await a.evaluate(() => {
            const e = $gameTroop.aliveMembers()[0];
            e.forceAction(1, -1);
            BattleManager.forceAction(e);
            e._actions = [new Game_Action(e)];
            try { BattleManager.processForcedAction(); } catch (err) { return { error: String(err) }; }
            return { error: '', phase: BattleManager._phase, stopped: SceneManager._stopped || false };
        });
        check('a forced action with no skill left is skipped, not a crash', !forced.error && forced.phase === 'input', JSON.stringify(forced));
        // The guard's charge comes at the end of the turn its counter (variable 19) steps from 1 to 2: the brief
        // names it in that turn, from the troop's own pages run ahead on copies, which the real ones never see.
        const charge = await a.evaluate(() => {
            const was = $gameVariables.value(19);
            const sw = Game_Switches.prototype.setValue, va = Game_Variables.prototype.setValue;
            let writes = 0;
            Game_Switches.prototype.setValue = function () { writes++; return sw.apply(this, arguments); };
            Game_Variables.prototype.setValue = function () { writes++; return va.apply(this, arguments); };
            const grab = {};
            const brief = () => Coop.battleBrief(BattleManager.actor() || $gameParty.members()[0]).grab;
            try {
                for (const v of [0, 1, 2, 3]) {
                    $gameVariables._data[19] = v;
                    grab[v] = brief();
                }
                // Its cleaver arm cut, the forced move falls on a dead part and the charge never comes.
                const arm = $gameTroop.members().find((e) => /right arm/.test(e.name()));
                arm.addState(arm.deathStateId());
                $gameVariables._data[19] = 1;
                grab.armless = brief();
            } finally {
                $gameVariables._data[19] = was;
                Game_Switches.prototype.setValue = sw;
                Game_Variables.prototype.setValue = va;
            }
            return { grab, sw16: $gameSwitches.value(16), v19: $gameVariables.value(19) === was, writes };
        });
        check('the brief names the guard\'s charge in the turn it comes, and only then (not with its cleaver arm off); the run ahead writes nothing real',
            charge.grab[1] === 'The monster takes a step closer...' && !charge.grab[0] && !charge.grab[2] && !charge.grab[3] && charge.grab.armless === '' && !charge.sw16 && charge.v19 && charge.writes === 0,
            JSON.stringify(charge));
        await a.evaluate(() => BattleManager.abort());
        await waitFor(a, () => SceneManager._scene instanceof Scene_Map, 15000, 'A back from the second fight');
        // Cavegnomes (his 10/28 report: the partner guarded them while they ate its limbs): the brief says what their
        // Gnaw gives through a guard; a guard's own blows give nothing a guard lets through.
        await sleep(1000);
        await a.evaluate(() => { BattleManager.setup(15, true, true); SceneManager.push(Scene_Battle); });
        await waitFor(a, () => BattleManager._phase === 'input' && BattleManager.actor(), 20000, 'A in a gnome fight');
        const gnaw = await a.evaluate(() => Coop.battleBrief(BattleManager.actor()).enemies.map((e) => e.inflicts.join('+')));
        check('a cavegnome\'s blows are named as giving bleeding and infection through a guard',
            gnaw.length > 1 && gnaw.every((x) => /Bleeding/.test(x) && /Infection arm/.test(x) && /Infection leg/.test(x)), JSON.stringify(gnaw));
        await a.evaluate(() => BattleManager.abort());
        await waitFor(a, () => SceneManager._scene instanceof Scene_Map, 15000, 'A back from the gnome fight');
        // The night lurch leaps at the END of the turn its "lowers it's stance..." shows, every third turn while
        // both legs are on; only a guard in that very turn makes it miss (a lost coin ends the fight in its
        // scene). The brief names the leap in that turn, and B's guard counts as A's would: the game asks only
        // whether its protagonist guarded, and by the turn's end every guard is down (his 10/28 report on the
        // partner's dumb moves; a guest's guard never counted against any grab).
        await sleep(1000);
        for (const p of [a, b]) await p.evaluate(() => { for (const id of [1, 3]) { const x = $gameActors.actor(id); x.addParam(0, 9000); x.addParam(2, -999); x.recoverAll(); } });
        const lurch = await grabFight(a, { troop: 25, sw: 340, gab: 'leap', hit: 0, hitAfter: 99, aGuardsFrom: 1, until: 2, after: 0 });
        const leapTurns = lurch.grabs.map((l) => l.turn);
        const seen = lurch.turns.filter((t) => t.turn <= Math.max(0, ...leapTurns));
        check('the brief names the night lurch\'s leap in the turn it comes, and only then',
            leapTurns.length >= 2 && seen.every((t) => !!t.grab === leapTurns.includes(t.turn)) && leapTurns.every((n) => seen.some((t) => t.turn === n)),
            JSON.stringify(lurch));
        const leapTurn = (n) => lurch.turns.find((t) => t.turn === leapTurns[n]) || {};
        check('B guarding in that turn makes the leap miss, with no coin', lurch.grabs.length >= 2 && leapTurn(0).guard && !leapTurn(0).guarded && lurch.grabs.every((l) => /evade/.test(l.text)) && lurch.coins === 0 && !lurch.sw[337], JSON.stringify(lurch));
        check('with A already guarding that turn, B\'s brief names A and B attacks; the leap still misses', leapTurn(1).guarded === 'Ann' && leapTurn(1).guard === false && /evade/.test((lurch.grabs[1] || {}).text), JSON.stringify(lurch));
        // The salmonsnake's tongue comes out at the end of turn 3 and, out, snatches on its own turn, every turn
        // until it is hurt at all (a lost coin: eaten whole). A guard acts first in a turn, so one in that turn
        // makes it miss; the brief names it then, and says hurting the tongue pulls it back.
        await sleep(1000);
        const snake = await grabFight(a, { troop: 50, sw: 648, gab: 'snatch', hit: 4, hitAfter: 2, aGuardsFrom: 99, until: 2, after: 3 });
        // The turns whose end was seen, but the one A hit the tongue in: that hit may land before or after its snatch.
        const snatchTurns = snake.grabs.map((l) => l.turn), lastTurn = Math.max(0, ...snake.turns.map((t) => t.turn));
        const known = snake.turns.filter((t) => t.turn < lastTurn && t.turn !== snake.hitTurn);
        check('the brief names the salmonsnake\'s snatch in the turns it comes, and only then',
            snake.hitTurn > 0 && snatchTurns.filter((n) => n < snake.hitTurn).length >= 2 && known.every((t) => (t.grab === 'Snatch') === snatchTurns.includes(t.turn)),
            JSON.stringify(snake));
        check('B guarding in those turns makes it miss, with no coin', snake.grabs.length >= 2 && snake.grabs.every((l) => /misses/.test(l.text)) && snake.coins === 0, JSON.stringify(snake));
        check('the tongue is marked as pulling back while out; hit, it pulls back',
            known.every((t) => t.pull === (t.grab === 'Snatch')) && known.some((t) => t.turn === snake.hitTurn + 1 && !t.grab),
            JSON.stringify(snake));
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
