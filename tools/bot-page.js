// Runs inside the bot's browser tab. A partner that joins the world as one
// of the protagonists nobody has taken, keeps near a player, fights its own
// turns, talks, takes orders, and when its partner dies walks to a ritual
// circle to call them back.
//
// Decisions go to a language model through window.fhBrain(kind, text) (see
// tools/brain.js); with no model, or a slow one, it falls back on rules of thumb.
module.exports = function installBot(options) {
    const CHARACTERS = {
        knight: { actor: 3, select: 242, initial: 662, soul: 1181 },
        outlander: { actor: 5, select: 244, initial: 664, soul: 1183 },
        priest: { actor: 4, select: 243, initial: 663, soul: 1184 },
        mercenary: { actor: 1, select: 246, initial: 661, soul: 1182 },
    };
    const THINK_LIMIT = 20000; // ms a fight turn waits for the model before falling back
    const QUIET = 45000; // ms between unprompted remarks
    const NOTE_GAP = 9000; // ms between batches of things that happened

    const BOT = window.BOT = {
        said: '', wanted: options.character || '', joinedAt: 0, lastHop: 0, stuck: 0, lastPress: 0, character: '',
        mode: 'follow', errand: null, notes: [], lastNoteAt: 0, lastSpokeAt: 0, thinking: 0, picks: [], lines: [],
    };
    Coop.isBot = true;
    // Shown beside its name in everyone's corner list.
    Coop.botActivity = function () {
        if (BOT.thinking > 0) return 'thinking...';
        if (Coop.dead) return 'dead, waiting for a circle';
        if (BOT.errand && BOT.errand.kind === 'circle') return 'going to a ritual circle';
        if (BOT.errand && BOT.errand.kind === 'follow') return 'coming after you';
        if (BOT.mode === 'explore') return 'exploring';
        if (BOT.mode === 'wait') return 'waiting';
        if (BOT.giving) return 'handing something over';
        return 'following';
    };

    function log(text) {
        if (BOT.said !== text) { BOT.said = text; console.log('[bot] ' + text); }
    }

    //--- talking to the model ---------------------------------------------------

    function think(kind, text, limit) {
        if (typeof window.fhBrain !== 'function') return Promise.resolve(null);
        BOT.thinking++;
        const ask = window.fhBrain(kind, text).then((r) => r || null, () => null);
        const late = new Promise((r) => setTimeout(() => r(null), limit || 60000));
        return Promise.race([ask, late]).finally(() => { BOT.thinking--; });
    }

    function speak(text, prompted) {
        text = String(text || '').trim();
        if (!text) return;
        // Off on its own, what it finds is worth hearing sooner.
        const gap = BOT.mode === 'explore' ? 15000 : QUIET;
        if (!prompted && (BOT.quiet || Date.now() - BOT.lastSpokeAt < gap)) return;
        BOT.lastSpokeAt = Date.now();
        BOT.lines.push(text);
        console.log('[bot] says: ' + text);
        Coop.say(text);
    }

    function note(text) {
        BOT.notes.push(text);
    }

    function humans() {
        return Coop.others().filter((p) => !p.bot);
    }

    let mapNames = {};
    fetch('coop/mapnames.json').then((r) => (r.ok ? r.json() : {})).then((n) => { mapNames = n || {}; }).catch(() => {});
    function placeName(id) { return mapNames[id] || 'map ' + id; }

    //--- hunger and the bag ---------------------------------------------------

    // The game keeps hunger as experience points: 157 is full, below 58 starves.
    const HUNGER = ['full', 'fed', 'hungry', 'weak with hunger', 'starving'];
    function hunger(actor) {
        const e = actor ? actor.currentExp() : 157;
        return e >= 140 ? 'full' : e >= 108 ? 'fed' : e >= 88 ? 'hungry' : e >= 58 ? 'weak with hunger' : 'starving';
    }
    function isFood(item) {
        return !!item && DataManager.isItem(item) && item.effects.some((e) => e.code === 44 && $dataCommonEvents[e.dataId] && /^FOOD_/.test($dataCommonEvents[e.dataId].name));
    }
    // Food that also makes you ill: anything that adds a state besides the
    // game's own markers for eating a small, medium or large meal (51-53).
    function spoils(item) {
        return item.effects.some((e) => e.code === 21 && e.dataId > 0 && [51, 52, 53].indexOf(e.dataId) < 0);
    }
    // How much a piece of food fills, from the amount its common event adds.
    function filling(item) {
        for (const e of item.effects) {
            const ce = e.code === 44 && $dataCommonEvents[e.dataId];
            const set = ce && ce.list.find((c) => c.code === 122 && c.parameters[0] === 106);
            if (set) return set.parameters[4];
        }
        return 0;
    }
    function bagText() {
        const rows = [];
        for (const it of $gameParty.items()) rows.push('item ' + it.id + ' ' + it.name + ' x' + $gameParty.numItems(it) + (isFood(it) ? ' (food)' : ''));
        for (const w of $gameParty.weapons()) rows.push('weapon ' + w.id + ' ' + w.name);
        for (const a of $gameParty.armors()) rows.push('armor ' + a.id + ' ' + a.name);
        const me = $gameParty.leader();
        const worn = me ? me.equips().filter(Boolean).map((e) => e.name) : [];
        return (rows.length ? rows.join(', ') : 'nothing') + (worn.length ? '. Wearing: ' + worn.join(', ') : '');
    }

    // Using something on yourself the way the game's menu does: effects on
    // you, then whatever common event it runs (food is eaten that way).
    function useOnSelf(item) {
        const me = $gameParty.leader();
        // Food takes effect in a common event a frame later; one thing at a time.
        if (!me || !item || !$gameParty.hasItem(item) || !me.canUse(item) || $gameMap.isEventRunning() || $gameTemp.isCommonEventReserved() || $gamePlayer.isTransferring()) return false;
        const action = new Game_Action(me);
        action.setItemObject(item);
        me.useItem(item);
        action.apply(me);
        action.applyGlobal();
        log('used ' + item.name);
        return true;
    }

    // Eats when hungry: the smallest thing that does the job.
    let lastHunger = '';
    function keepFed() {
        const me = $gameParty.leader();
        if (!me || me.isDead()) return;
        const h = hunger(me);
        if (h !== lastHunger) {
            if (lastHunger && HUNGER.indexOf(h) > HUNGER.indexOf(lastHunger) && HUNGER.indexOf(h) >= 2) {
                const food = $gameParty.items().some(isFood);
                note('You are ' + h + '.' + (food ? '' : ' You have no food. Ask your partner for some, plainly.'));
                BOT.lastNoteAt = 0;
            }
            lastHunger = h;
        }
        if (me.currentExp() >= 100 || $gameMap.isEventRunning() || $gameMessage.isBusy()) return;
        const room = 157 - me.currentExp();
        const giving = BOT.giving && BOT.giving.item;
        const edible = $gameParty.items().filter((f) => isFood(f) && f !== giving && me.canUse(f));
        // Spoiled things (rotten meat, dirt) only once hunger is worse than they are.
        const desperate = me.currentExp() < 88;
        const clean = edible.filter((f) => !spoils(f));
        const foods = (clean.length || !desperate ? clean : edible).sort((a, b) => filling(a) - filling(b));
        const pick = foods.find((f) => filling(f) >= Math.min(room, 30)) || foods[foods.length - 1];
        if (pick && useOnSelf(pick)) note('You ate ' + pick.name + '.');
    }

    // Tends its own wounds the way a careful player would: binds bleeding,
    // treats infection and poison, and heals only when close to death, since
    // healing is scarce. With nothing to hand it says so, once, to its partner.
    const CURES = [
        { states: [5], items: [8], what: 'bleeding', ask: 'a cloth fragment to bind it' },
        { states: [55, 56], items: [94, 135], what: 'infected', ask: 'a green herb' },
        { states: [17, 90], items: [52, 135], what: 'poisoned', ask: 'a white vial' },
    ];
    const HEALS = [132, 95, 28, 67, 167]; // red herb, blue herb, blue vial, light blue vial, elixir of body
    const toldNeed = new Set();
    let wellAt = 0;
    function keepWell() {
        const me = $gameParty.leader();
        if (!me || me.isDead() || $gameParty.inBattle() || $gameMap.isEventRunning() || $gameMessage.isBusy()) return;
        // One thing at a time, with a moment to see whether it worked.
        if (Date.now() - wellAt < 2500) return;
        const used = (it) => { if (!useOnSelf(it)) return false; wellAt = Date.now(); return true; };
        const has = (id) => $gameParty.hasItem($dataItems[id]) && me.canUse($dataItems[id]);
        for (const c of CURES) {
            if (!c.states.some((s) => me.isStateAffected(s))) { toldNeed.delete(c.what); continue; }
            const id = c.items.find(has);
            if (id) { if (used($dataItems[id])) note('You were ' + c.what + ' and used ' + $dataItems[id].name + '.'); return; }
            if (!toldNeed.has(c.what)) { toldNeed.add(c.what); note('You are ' + c.what + ' and have nothing for it. Ask your partner for ' + c.ask + ', plainly.'); BOT.lastNoteAt = 0; }
        }
        if (me.hp > me.mhp * 0.25) { toldNeed.delete('hurt'); return; }
        const heals = HEALS.filter(has);
        if (heals.length) { const it = $dataItems[heals[0]]; if (used(it)) note('Near death, you used ' + it.name + '.'); return; }
        if (!toldNeed.has('hurt')) { toldNeed.add('hurt'); note('You are close to death (' + me.hp + '/' + me.mhp + ') and have nothing to heal with. Tell your partner.'); BOT.lastNoteAt = 0; }
    }

    // Handing something to a partner: steps beside them first.
    function kindOf(item) {
        return DataManager.isWeapon(item) ? 'weapon' : DataManager.isArmor(item) ? 'armor' : 'item';
    }
    // True while still walking over.
    function handOver() {
        const g = BOT.giving;
        if (!g) return false;
        const peer = Coop.peers.get(g.peer);
        if (!peer || Date.now() > g.until || peer.m !== $gameMap.mapId() || !$gameParty.hasItem(g.item, true)) {
            if (peer && Date.now() > g.until) note('You could not reach ' + peer.name + ' to hand over ' + g.item.name + '.');
            BOT.giving = null;
            return false;
        }
        if (Coop.distanceTo(peer) > 1) return true;
        // Something worn comes off first.
        const me = $gameParty.leader();
        if (!$gameParty.hasItem(g.item, false) && me) {
            const slot = me.equips().indexOf(g.item);
            if (slot >= 0) me.changeEquip(slot, null);
        }
        if ($gameParty.hasItem(g.item, false)) {
            $gameParty.loseItem(g.item, 1);
            Coop.sendTo(peer.id, 'give', { kind: kindOf(g.item), id: g.item.id });
            if (Coop.parkSoon) Coop.parkSoon();
            log('handed ' + g.item.name + ' to ' + peer.name);
        }
        BOT.giving = null;
        return false;
    }

    // What ails it right now (infected, bleeding, a limb gone...). The game's
    // internal machinery is named in capitals and left out.
    function conditionsOf(actor) {
        return actor.states().map((st) => st.name).filter((n) => n && n !== n.toUpperCase());
    }
    let lastConditions = null;
    function watchConditions() {
        const me = $gameParty.leader();
        if (!me) return;
        const now = conditionsOf(me);
        if (lastConditions) {
            const gained = now.filter((n) => lastConditions.indexOf(n) < 0);
            const lost = lastConditions.filter((n) => now.indexOf(n) < 0);
            if (gained.length) note('You are now: ' + gained.join(', ') + '.');
            if (lost.length) note('You are no longer: ' + lost.join(', ') + '.');
        }
        lastConditions = now;
    }

    // What roams near it: the game's chasing events (they start a fight on
    // touch), named as the map names them, with how far off they are.
    function enemiesInSight() {
        // Between maps the old events are still listed but the map's data is not loaded.
        if (!window.$gameMap || !window.$dataMap || !(SceneManager._scene instanceof Scene_Map)) return [];
        const out = [];
        for (const ev of $gameMap.events()) {
            if (ev._erased || ev._trigger !== 2 || !ev.characterName() || ev.isTransparent()) continue;
            const page = ev.page();
            if (!page || !page.list.some((c) => c.code === 301)) continue;
            const d = Math.abs(ev.x - $gamePlayer.x) + Math.abs(ev.y - $gamePlayer.y);
            if (d > 8) continue;
            const raw = String(ev.event().name || '');
            const name = /^ev\d*$/i.test(raw) ? 'something' : raw.replace(/[_\d]+$/, '').replace(/_/g, ' ').toLowerCase() || 'something';
            out.push({ d, text: name + ' ' + d + ' steps away' });
        }
        return out.sort((a, b) => a.d - b.d).slice(0, 4).map((o) => o.text);
    }

    function situation() {
        const me = window.$gameParty && $gameParty.leader();
        const rows = [];
        if (me && window.$gameMap) rows.push('You: ' + me.name() + ', ' + me.hp + '/' + me.mhp + ' HP, ' + hunger(me) + ', in ' + placeName($gameMap.mapId()) + (BOT.mode === 'wait' ? ', waiting where told' : '') + (BOT.errand && BOT.errand.kind === 'circle' ? ', on your way to a ritual circle' : '') + (BOT.mode === 'explore' ? ', exploring on your own' : '') + (BOT.quiet ? ', keeping quiet' : '') + '.');
        if (me && window.$gameMap) rows.push('Your condition: ' + (conditionsOf(me).join(', ') || 'nothing wrong') + '. Your bag: ' + bagText() + '.');
        for (const p of humans()) {
            if (!p.st || p.st === 'title') { rows.push(p.name + ' is not in the dungeon.'); continue; }
            const where = window.$gameMap && p.m === $gameMap.mapId() ? (Coop.distanceTo(p) <= 6 ? 'beside you' : 'nearby') : 'in ' + placeName(p.m);
            rows.push(p.name + (p.an ? ' (' + p.an + ')' : '') + ': ' + (p.st === 'dead' ? 'DEAD' : p.hp + '/' + p.mhp + ' HP') + (p.st === 'battle' ? ', IN A FIGHT' : '') + ', ' + where + '.');
        }
        const seen = enemiesInSight();
        rows.push(seen.length ? 'Enemies in sight: ' + seen.join(', ') + '.' : 'No enemy in sight.');
        return rows.join(' ');
    }

    BOT.situationText = situation;

    // Every so often, what happened goes to the model, which may remark on it.
    setInterval(function () {
        if (!BOT.notes.length || Date.now() - BOT.lastNoteAt < NOTE_GAP || !Coop.world.live) return;
        BOT.lastNoteAt = Date.now();
        const text = BOT.notes.splice(0).join('\n') + '\n' + situation() + '\nRemark only if it is worth it.';
        think('note', text).then((r) => { if (r && r.say) speak(r.say, false); if (r && r.use) obey({ use: r.use }, null); });
    }, 1000);

    //--- who to stay with -----------------------------------------------------

    // The player to stick to: a named one if asked for, else a person in the world.
    function leader() {
        const inWorld = Coop.others().filter((p) => p.st && p.st !== 'title');
        if (options.follow) return inWorld.find((p) => p.name.toLowerCase() === options.follow.toLowerCase()) || null;
        const people = inWorld.filter((p) => !p.bot);
        return people.find((p) => p.st !== 'dead') || people[0] || inWorld.find((p) => p.st !== 'dead') || null;
    }

    function freeCharacter() {
        const taken = new Set();
        for (const p of Coop.others()) for (const id of p.ini || []) taken.add(id);
        const order = [BOT.wanted, 'knight', 'outlander', 'priest', 'mercenary'].filter(Boolean);
        return order.find((name) => CHARACTERS[name] && !taken.has(CHARACTERS[name].initial) && !BOT.refused.has(name)) || null;
    }

    // Someone took this character a moment earlier (two partners called in
    // together, or a player who had not shown it yet). Left alone it would play
    // on in a world of its own; it goes back and comes in as somebody else.
    BOT.refused = new Set();
    Coop.on('worldclash', function (msg) {
        if (!BOT.character) return;
        BOT.refused.add(BOT.character);
        if (BOT.refused.size >= Object.keys(CHARACTERS).length) BOT.refused.clear(); // try them all again
        if (BOT.wanted === BOT.character) BOT.wanted = '';
        log(msg.name + ' already plays the ' + BOT.character + '; coming in as someone else');
        BOT.character = '';
        BOT.joinedAt = 0;
        SceneManager.goto(Scene_Title);
    });

    // Skips the intro: becomes the character, fed as the intro would have
    // left them, and appears beside the leader.
    BOT.join = function () {
        const who = leader();
        const name = freeCharacter();
        if (!who || !who.m || !name) return false;
        const c = CHARACTERS[name];
        BOT.character = name;
        DataManager.setupNewGame();
        for (const id of [c.select, c.initial, c.soul]) $gameSwitches._data[id] = true;
        $gameParty._actors = [c.actor];
        const actor = $gameActors.actor(c.actor);
        actor.changeExp(actor.currentExp() + 99, false);
        // What the intro would have handed over.
        $gameParty.gainItem($dataItems[5], 1); // Torch
        $gamePlayer.refresh();
        // A new game starts with the player invisible; the intro this bot
        // skips is what normally reveals them.
        $gamePlayer.setTransparent(false);
        $gamePlayer.reserveTransfer(who.m, who.x, who.y, 2, 0);
        SceneManager.goto(Scene_Map);
        BOT.joinedAt = Date.now();
        BOT.needStart = true;
        BOT.mode = 'follow';
        // No model behind it: say so once, plainly, so silence is not mistaken for a fault.
        if (options.brainless && !BOT.toldBrainless) {
            BOT.toldBrainless = true;
            setTimeout(() => Coop.say('(No AI model is connected, so I follow and fight but cannot talk. The README says how to connect one.)'), 4000);
        }
        log('joining ' + who.name + ' as the ' + name);
        if (window.fhBrainCharacter) window.fhBrainCharacter(name);
        note('You have just joined ' + who.name + ' in the dungeon, as the ' + name + '. Greet them in a few words.');
        BOT.lastNoteAt = 0;
        return true;
    };

    // Which protagonist the loaded party leads with.
    function characterOf(actorId) {
        return Object.keys(CHARACTERS).find((k) => CHARACTERS[k].actor === actorId) || '';
    }
    function becameCharacter() {
        const name = characterOf($gameParty._actors[0]);
        if (!name) return;
        BOT.character = name;
        if (window.fhBrainCharacter) window.fhBrainCharacter(name);
    }

    // Coming back to a run rather than starting over, the way a person would:
    //   dropped out a moment ago   carry on from there (the R at the title)
    //   the run goes on another day   Continue, on its own save from that run
    // Only with neither does it turn up as somebody new.
    Coop.on('parked', function (msg) { BOT.parked = !!msg.has; BOT.parkKnown = true; });
    BOT.comeBack = function () {
        if (BOT.parked) {
            BOT.parked = false;
            BOT.joinedAt = Date.now();
            BOT.cameBack = 'park';
            Coop.send({ t: 'park!' });
            log('carrying on from where I dropped out');
            return true;
        }
        const on = Coop.world.on;
        if (!on) return false;
        const slots = Coop.world.slotsOf(on.runId);
        const stamps = Object.keys(slots).map(Number).sort((a, b) => b - a);
        const stamp = slots[on.stamp] ? on.stamp : stamps[0];
        const key = on.runId + ':' + stamp;
        if (!stamp || BOT.triedSave === key) return false;
        BOT.triedSave = key;
        BOT.joinedAt = Date.now();
        if (!DataManager.loadGame(slots[stamp])) return false;
        BOT.cameBack = 'save';
        SceneManager.goto(Scene_Map);
        $gameSystem.onAfterLoad();
        log('carrying on our run from my save (slot ' + slots[stamp] + ')');
        return true;
    };

    function press(name) {
        if (Date.now() - BOT.lastPress < 320) return;
        BOT.lastPress = Date.now();
        Input._currentState[name] = true;
        setTimeout(function () { Input._currentState[name] = false; }, 110);
    }

    //--- fights -----------------------------------------------------------------

    function briefText(brief, err) {
        const rows = [];
        rows.push('Turn ' + brief.turn + '. You choose for ' + brief.you + '.' + (err ? ' Your last choice could not be used (' + err + '); choose again.' : ''));
        rows.push('Your side: ' + brief.allies.map((a) => a.i + ' ' + a.name + (a.player ? ' (' + a.player + ')' : '') + ' ' + a.how + ' ' + a.hp + '/' + a.mhp + (a.states.length ? ' [' + a.states.join(', ') + ']' : '')).join('; '));
        rows.push('Enemies: ' + brief.enemies.map((e) => e.i + ' ' + e.name + ' ' + e.how + (e.states.length ? ' [' + e.states.join(', ') + ']' : '')).join('; '));
        if (brief.log.length) rows.push('Lately: ' + brief.log.join(' / '));
        const opts = ['attack with ' + brief.attack.weapon + ' (target an enemy number)', 'guard'];
        for (const k of brief.skills) if (k.usable) opts.push('skill ' + k.id + ' ' + k.name + (k.about ? ': ' + k.about : ''));
        for (const it of brief.items) opts.push('item ' + it.id + ' ' + it.name + ' x' + it.count + (it.about ? ': ' + it.about : ''));
        rows.push('Options: ' + opts.join(' | '));
        rows.push('Target numbers: enemy number for attacks, your-side number for help. Reply {"do","id","target","say"}.');
        return rows.join('\n');
    }

    // Rules of thumb when there is no answer: an arm first, then the head,
    // then whatever still stands.
    function fallbackPick(brief) {
        const alive = brief.enemies.filter((e) => e.how !== 'gone');
        const by = (re) => alive.find((e) => re.test(e.name));
        const target = by(/arm/i) || by(/head/i) || alive.find((e) => !/torso/i.test(e.name)) || alive[0];
        return { do: 'attack', target: target ? target.i : 0 };
    }

    function validPick(brief, r) {
        if (!r || typeof r !== 'object') return null;
        const pick = { do: String(r.do || 'attack').toLowerCase(), id: Number(r.id), target: Number(r.target) };
        if (pick.do === 'skill' && !brief.skills.some((k) => k.id === pick.id && k.usable)) return null;
        if (pick.do === 'item' && !brief.items.some((it) => it.id === pick.id)) return null;
        if (['attack', 'skill', 'item', 'guard'].indexOf(pick.do) < 0) return null;
        if (!Number.isFinite(pick.target)) pick.target = -1;
        return pick;
    }

    function decide(brief, err) {
        const t0 = Date.now();
        // A second refusal goes straight to the rules of thumb.
        const asked = err ? Promise.resolve(null) : think('battle', briefText(brief, err), THINK_LIMIT);
        return asked.then(function (r) {
            const pick = validPick(brief, r) || fallbackPick(brief);
            BOT.picks.push({ ms: Date.now() - t0, pick, model: !!validPick(brief, r) });
            // A word in a fight now and then, not every turn.
            if (r && r.say && Date.now() - BOT.lastSpokeAt > 25000) speak(r.say, true);
            return pick;
        });
    }

    // A guest's turn in someone else's fight arrives as a message.
    Coop.on('to:bturn', function (msg) {
        const b = Coop.battle;
        if (!b || b.role !== 'guest' || b.owner !== msg.from || !msg.brief) return;
        // Refused twice for the same turn: guard, which always fits.
        const refusedAgain = msg.err && b.refused === msg.seq;
        if (msg.err) b.refused = msg.seq;
        const choose = refusedAgain ? Promise.resolve({ do: 'guard' }) : decide(msg.brief, msg.err);
        choose.then(function (pick) {
            Coop.sendTo(msg.from, 'bpick', { actor: msg.actor, seq: msg.seq, pick });
        });
    });

    // A turn in this bot's own fight.
    let ownTurn = null; // the action being decided; each turn, extra turns included, makes new ones
    function ownFight(scene) {
        const actor = BattleManager.actor();
        const mine = actor && actor.actorId() === (CHARACTERS[BOT.character] || {}).actor;
        if (BattleManager.isInputting() && mine) {
            const action = BattleManager.inputtingAction();
            if (!action || ownTurn === action) return;
            ownTurn = action;
            decide(Coop.battleBrief(actor)).then(function (pick) {
                if (BattleManager.inputtingAction() !== action) return; // the turn moved on without us
                if (!Coop.applyPick(actor, pick)) return;
                if (!Coop.applyPick(actor, fallbackPick(Coop.battleBrief(actor)))) return;
                Coop.applyPick(actor, { do: 'guard' });
            });
            return;
        }
        // Text in the fight: a partner watching gets time to read it.
        const watchers = Coop.battle && Coop.battle.guests ? Coop.battle.guests.size : 0;
        if ($gameMessage.isBusy()) {
            BOT.msgSince = BOT.msgSince || Date.now();
            if (Date.now() - BOT.msgSince > (watchers ? 6000 : 1500)) { press('ok'); BOT.msgSince = 0; }
        } else BOT.msgSince = 0;
        // Back at "fight or flee": fight, after giving a partner the chance to choose.
        if (scene._partyCommandWindow && scene._partyCommandWindow.active) {
            BOT.partySince = BOT.partySince || Date.now();
            if (Date.now() - BOT.partySince > 3000) { press('ok'); BOT.partySince = 0; }
        } else BOT.partySince = 0;
    }

    let fightNoted = false;
    let foes = '';
    const _battleStart = BattleManager.startBattle;
    BattleManager.startBattle = function () {
        _battleStart.call(this);
        fightNoted = true;
        foes = $gameTroop.members().map((e) => e.name().replace(/ \[.*\]$/, '')).filter((n, i, a) => a.indexOf(n) === i).slice(0, 4).join(', ');
        note('A fight starts: ' + foes + '.');
    };
    // Said plainly, so the model never takes a fight that merely ended for a kill.
    function outcome(end, won, names) {
        const them = names || foes || 'the enemy';
        if (won || end === 'won') return 'won: ' + them + ' is dead.';
        if (end === 'fled') return 'nobody won: your side ran, and ' + them + ' is still alive and may follow.';
        if (end === 'lost') return 'lost.';
        return 'nobody won: it broke off, and ' + them + ' is still alive.';
    }
    Coop.on('to:bend', function (msg) {
        if (msg.aborted) return;
        note('The fight is over, ' + outcome(msg.end, msg.won, msg.foes));
    });
    const _terminate = Scene_Battle.prototype.terminate;
    Scene_Battle.prototype.terminate = function () {
        const b = Coop.battle;
        const won = !!(b && b.won), end = (b && b.end) || '';
        _terminate.call(this);
        if (fightNoted) { fightNoted = false; note('Your own fight is over, ' + outcome(end, won)); }
    };

    // A partner fighting close by: go and help. Invitations only reach those
    // standing near when a fight starts; anyone else has to ask.
    let toldFighting = '';
    function joinFightNearby() {
        if (!window.$gameMap || !Coop.world.live || Coop.battle || Coop.dead || BOT.leaving) return;
        if (!(SceneManager._scene instanceof Scene_Map) || $gameMap.isEventRunning() || $gameMessage.isBusy() || $gamePlayer.isTransferring()) return;
        const me = $gameParty.leader();
        if (!me || me.hp <= 0) return;
        // The same reach as the game's own pull into a fight that starts.
        const peer = Coop.peersHere().find((p) => p.st === 'battle' && p.br === 'o' && Coop.distanceTo(p) <= 6);
        if (!peer) { toldFighting = ''; return; }
        if (toldFighting !== peer.id) { toldFighting = peer.id; note(peer.name + ' is in a fight right beside you. You are joining it.'); }
        Coop.askToJoinBattle(peer.id);
    }

    //--- what it overhears and is told ------------------------------------------

    Coop.on('to:say', function (msg) {
        const peer = Coop.peers.get(msg.from);
        if (!peer) return;
        if (msg.choice) note(peer.name + ' answered: ' + msg.choice);
        else note('You overhear, near ' + peer.name + ': ' + (msg.speaker ? msg.speaker + ': ' : '') + String(msg.text).slice(0, 400));
    });

    Coop.on('heard', function (msg) {
        const peer = Coop.peers.get(msg.from);
        if (!peer || peer.bot) return;
        // With several people here, only lines meant for this partner get an answer.
        const people = humans().filter((p) => p.st && p.st !== 'title');
        const me = window.$gameParty && $gameParty.leader();
        const names = [Coop.name, BOT.character, me ? me.name() : ''].filter(Boolean).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const named = new RegExp('\\b(' + names.join('|') + ')\\b', 'i');
        if (people.length > 1 && !named.test(msg.text)) { note(msg.name + ' says to the others: "' + msg.text + '"'); return; }
        const pending = BOT.notes.splice(0);
        const text = (pending.length ? 'Recently: ' + pending.join(' / ') + '\n' : '') + situation() + '\n' + msg.name + ' says to you: "' + msg.text + '"';
        think('chat', text).then(function (r) {
            if (!r) return;
            obey(r, peer);
            speak(r.say, true);
        });
    });

    // What a reply asks this partner to do, beyond talking.
    function obey(r, peer) {
        const order = String(r.order || '').toLowerCase();
        if (order === 'wait' && BOT.mode !== 'wait') { BOT.mode = 'wait'; log('waiting where told'); }
        if (order === 'follow' && BOT.mode !== 'follow') { BOT.mode = 'follow'; BOT.explore = null; if (BOT.errand && BOT.errand.kind === 'explore') BOT.errand = null; log('following again'); }
        if (order === 'explore' && BOT.mode !== 'explore') { BOT.mode = 'explore'; BOT.explore = null; log('exploring alone'); }
        if (order === 'quiet') { BOT.quiet = true; log('keeping quiet'); }
        if (order === 'talk') { BOT.quiet = false; log('talking again'); }
        if (order === 'let go' && Coop.dead && Coop.letGo) { log('letting this character go'); Coop.letGo(); return; }
        if (order === 'leave' && window.fhLeave) { log('going home'); BOT.leaving = true; window.fhLeave(); return; }
        if (!window.$gameParty || Coop.dead) return;
        const find = (kind, id) => {
            const table = kind === 'weapon' ? $dataWeapons : kind === 'armor' ? $dataArmors : $dataItems;
            const it = table[Number(id)];
            return it && $gameParty.hasItem(it, true) ? it : null;
        };
        if (r.give) {
            const g = typeof r.give === 'object' ? r.give : { kind: 'item', id: r.give };
            const it = find(g.kind || 'item', g.id);
            if (it && peer) BOT.giving = { peer: peer.id, item: it, until: Date.now() + 15000 };
        }
        if (r.use) {
            const it = find('item', r.use);
            if (it && !useOnSelf(it)) note('You could not use ' + it.name + ' just now.');
        }
    }

    // Things a partner used on this one (a bandage, a healing prayer, food).
    Coop.on('castonme', function (m) { note(m.from + ' used ' + m.what + ' on you.'); BOT.lastNoteAt = 0; });

    // Things handed to this partner.
    Coop.on('to:give', function (msg) {
        const peer = Coop.peers.get(msg.from);
        const table = msg.kind === 'weapon' ? $dataWeapons : msg.kind === 'armor' ? $dataArmors : $dataItems;
        const it = table && table[msg.id];
        if (peer && it && !msg.returned) { note(peer.name + ' hands you ' + it.name + '.'); BOT.lastNoteAt = 0; }
    });

    // Partners dying and coming back.
    const lastState = new Map();
    setInterval(function () {
        for (const p of humans()) {
            const was = lastState.get(p.id);
            if (was && was !== 'dead' && p.st === 'dead') { note(p.name + ' has just died. They are watching through your eyes now. A ritual circle can call them back.'); BOT.lastNoteAt = 0; }
            if (was === 'dead' && p.st && p.st !== 'dead' && p.st !== 'title') note(p.name + ' is alive again.');
            lastState.set(p.id, p.st);
        }
    }, 500);

    // Dialogue choices this bot runs into on its own.
    function chooseInDialogue(scene) {
        const win = scene._messageWindow && scene._messageWindow._choiceWindow;
        if (!win || !win.active || BOT.choosing) return;
        const choices = $gameMessage.choices().map((c) => Coop.plainText(c).text);
        const said = Coop.plainText($gameMessage.allText()).text;
        // The circle's own offer: call the partner back, which is why we came.
        const call = choices.findIndex((c) => /^Call .* back$/.test(c));
        if (call >= 0) {
            win.select(call);
            win.processOk();
            // Their machine answers and the circle goes dark in a moment; no second trip meanwhile.
            BOT.errand = null;
            BOT.calledAt = Date.now();
            return;
        }
        BOT.choosing = true;
        think('choice', 'You are reading: "' + said + '"\nChoices: ' + choices.map((c, i) => i + ' ' + c).join(' | ') + '\nPick one: {"pick":n,"say":"..."}', 30000).then(function (r) {
            BOT.choosing = false;
            if (!win.active) return;
            const n = r && Number.isInteger(Number(r.pick)) && Number(r.pick) >= 0 && Number(r.pick) < choices.length ? Number(r.pick) : Math.max(0, $gameMessage.choiceDefaultType());
            // A choice the game has greyed out does not take; the next one that does.
            for (const i of [n].concat(choices.map((c, k) => k))) {
                if (!win.active) break;
                win.select(Math.min(i, choices.length - 1));
                if (win.isCurrentItemEnabled()) win.processOk();
            }
            if (win.active) win.processCancel();
            if (r && r.say) speak(r.say, false);
        });
    }

    //--- walking ----------------------------------------------------------------

    const Nav = BOT.nav = { maps: new Map(), banned: new Map() };

    Nav.load = function (id) {
        if (Nav.maps.has(id)) return Nav.maps.get(id);
        const p = fetch('data/Map' + String(id).padStart(3, '0') + '.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
        Nav.maps.set(id, p);
        return p;
    };

    // Doors out of a map, from its data: event -> where the transfer goes.
    Nav.exits = function (data, mapId) {
        const out = [];
        if (!data || !data.events) return out;
        for (const ev of data.events) {
            if (!ev) continue;
            const seen = new Set();
            for (const page of ev.pages) for (const c of page.list) {
                if (c.code !== 201 || c.parameters[0] !== 0 || c.parameters[1] === mapId) continue;
                const key = c.parameters[1];
                if (seen.has(key)) continue;
                seen.add(key);
                out.push({ ev: ev.id, x: ev.x, y: ev.y, to: c.parameters[1], tx: c.parameters[2], ty: c.parameters[3] });
            }
        }
        return out;
    };

    // Circles not yet spent, minus any this bot has failed to reach lately.
    Nav.liveCircles = function (data, mapId) {
        const out = [];
        if (!data || !data.events) return out;
        const now = Date.now();
        for (const ev of data.events) {
            const sw = ev && Coop.circleSwitchOf(ev);
            if (sw && !$gameSwitches.value(sw) && !((Nav.banned.get('c' + mapId + ':' + ev.id) || 0) > now)) out.push({ ev: ev.id, x: ev.x, y: ev.y });
        }
        return out;
    };

    // Fewest doors from here to a map that `isGoal` accepts.
    Nav.plan = async function (isGoal) {
        const start = $gameMap.mapId();
        const prev = new Map([[start, null]]);
        let frontier = [start];
        for (let depth = 0; depth < 14 && frontier.length; depth++) {
            const next = [];
            for (const id of frontier) {
                const data = id === start ? $dataMap : await Nav.load(id);
                if (isGoal(id, data)) {
                    const hops = [];
                    for (let at = id; prev.get(at); at = prev.get(at).from) hops.unshift(prev.get(at).exit);
                    return { goal: id, hops };
                }
                for (const exit of Nav.exits(data, id)) {
                    if (prev.has(exit.to) || Nav.banned.get(id + ':' + exit.ev) > Date.now()) continue;
                    prev.set(exit.to, { from: id, exit: Object.assign({ map: id }, exit) });
                    next.push(exit.to);
                }
            }
            frontier = next;
        }
        return null;
    };

    // Anything standing there; when careful, also floor tiles that do something
    // when stepped on (traps, doors, scenes).
    function blockedByEvent(x, y, except, careful) {
        if (!window.$dataMap) return true; // between maps: stand still
        return $gameMap.eventsXyNt(x, y).some((ev) => ev.eventId() !== except && (ev.isNormalPriority() || (careful && ev.page() && ev.isTriggerIn([1, 2]))));
    }

    // Tile by tile on this map, around walls and anything standing in the way.
    // Around anything that triggers underfoot too, unless there is no other way.
    Nav.path = function (goalX, goalY, eventId, adjacentOk) {
        return Nav.search(goalX, goalY, eventId, adjacentOk, true) || Nav.search(goalX, goalY, eventId, adjacentOk, false);
    };
    Nav.search = function (goalX, goalY, eventId, adjacentOk, careful) {
        const w = $dataMap.width, h = $dataMap.height;
        const sx = $gamePlayer.x, sy = $gamePlayer.y;
        const prev = new Int32Array(w * h).fill(-1);
        const goal = (x, y) => (x === goalX && y === goalY) || (adjacentOk && Math.abs(x - goalX) + Math.abs(y - goalY) === 1);
        const queue = [sy * w + sx];
        prev[sy * w + sx] = sy * w + sx;
        const now = Date.now();
        while (queue.length) {
            const cur = queue.shift();
            const x = cur % w, y = (cur / w) | 0;
            if (goal(x, y)) {
                const steps = [];
                for (let at = cur; at !== sy * w + sx; at = prev[at]) steps.unshift(at);
                return steps.map((i) => ({ x: i % w, y: (i / w) | 0 }));
            }
            for (const d of [2, 4, 6, 8]) {
                const nx = $gameMap.roundXWithDirection(x, d), ny = $gameMap.roundYWithDirection(y, d);
                if (!$gameMap.isValid(nx, ny) || prev[ny * w + nx] >= 0) continue;
                if (!$gameMap.isPassable(x, y, d) || !$gameMap.isPassable(nx, ny, 10 - d)) continue;
                const isGoal = nx === goalX && ny === goalY;
                if (!isGoal && blockedByEvent(nx, ny, eventId, careful)) continue;
                if ((Nav.banned.get(nx + ',' + ny) || 0) > now) continue;
                prev[ny * w + nx] = cur;
                queue.push(ny * w + nx);
            }
        }
        return null;
    };

    function dirTo(x, y) {
        const dx = x - $gamePlayer.x, dy = y - $gamePlayer.y;
        if (Math.abs(dx) >= Math.abs(dy) && dx) return dx > 0 ? 6 : 4;
        return dy > 0 ? 2 : dy < 0 ? 8 : 0;
    }

    // Trips on foot, through the doors, with whatever lives between:
    //   circle  a partner lies dead; walk to a circle that can call them back
    //   follow  a partner went through a door; go after them
    async function startErrand(dead) {
        BOT.errand = { kind: 'circle', for: dead.id, name: dead.name, since: Date.now(), plan: null, planning: true, map: 0, steps: null, tries: 0, replans: 0 };
        log('walking to a ritual circle for ' + dead.name);
        await replan();
    }

    async function startChase(who) {
        BOT.errand = { kind: 'follow', for: who.id, name: who.name, goalMap: who.m, since: Date.now(), plan: null, planning: true, map: 0, steps: null, tries: 0, replans: 0 };
        log('going after ' + who.name + ' to ' + placeName(who.m));
        await replan();
    }

    // No way through on foot: catch up with them the quick way.
    function jumpTo(who) {
        BOT.errand = null;
        BOT.lastHop = Date.now();
        BOT.stuck = 0;
        if (who && who.m && !$gamePlayer.isTransferring()) {
            $gamePlayer.reserveTransfer(who.m, who.x, who.y, 2, 0);
            log('no way on foot; catching up with ' + who.name + ' on ' + placeName(who.m));
        }
    }

    async function replan() {
        const e = BOT.errand;
        if (!e) return;
        e.planning = true;
        e.steps = null;
        const isGoal = e.kind === 'circle' ? (id, data) => Nav.liveCircles(data, id).length > 0 : (id) => id === e.goalMap;
        // Going round in circles: give it up rather than burn the night on it.
        const plan = ++e.replans > 20 ? null : await Nav.plan(isGoal);
        if (BOT.errand !== e) return;
        e.planning = false;
        e.plan = plan;
        e.map = $gameMap.mapId();
        if (!plan) {
            if (e.kind === 'follow') { jumpTo(Coop.peers.get(e.for)); return; }
            if (e.kind === 'explore') { Nav.banned.set('m' + e.goalMap, Date.now() + 600000); BOT.errand = null; return; }
            // Said plainly, model or not: the dead partner needs to know to let go.
            Coop.say('I cannot find a ritual circle I can reach from here. If none turns up, hold Esc to let go.');
            log('no way to a working circle');
            BOT.errand = null;
            BOT.noWayUntil = Date.now() + 120000;
            return;
        }
        log((e.kind === 'circle' ? 'circle on ' : 'after them to ') + placeName(plan.goal) + ', ' + plan.hops.length + ' door(s) away');
    }

    // Where the errand wants to stand next on this map, and the event there.
    function errandTarget() {
        const e = BOT.errand;
        if (!e || !e.plan || !window.$dataMap) return null;
        const here = $gameMap.mapId();
        if (here === e.plan.goal && e.kind !== 'circle') return { arrived: true };
        if (here === e.plan.goal) {
            const live = Nav.liveCircles($dataMap, here);
            const c = live
                .map((c) => ({ c, ev: $gameMap.event(c.ev) }))
                .filter((o) => o.ev && o.ev.page() && o.ev.isTriggerIn([0]))
                .sort((a, b) => $gameMap.distance($gamePlayer.x, $gamePlayer.y, a.c.x, a.c.y) - $gameMap.distance($gamePlayer.x, $gamePlayer.y, b.c.x, b.c.y))[0];
            // Unspent but not usable right now: look elsewhere for a while.
            if (!c) for (const l of live) banCircle(here, l.ev);
            return c ? { x: c.ev.x, y: c.ev.y, ev: c.ev, circle: here } : null;
        }
        const hop = e.plan.hops.find((h) => h.map === here);
        if (!hop) return null;
        const ev = $gameMap.event(hop.ev);
        return ev ? { x: ev.x, y: ev.y, ev, hop } : null;
    }

    function banCircle(mapId, eventId) {
        Nav.banned.set('c' + mapId + ':' + eventId, Date.now() + 180000);
    }

    // Where this step failed for good: that door or that circle is off the plan for a while.
    function giveUpOn(t) {
        if (t.hop) Nav.banned.set(t.hop.map + ':' + t.hop.ev, Date.now() + 180000);
        if (t.circle) banCircle(t.circle, t.ev.eventId());
    }

    function errandStep(player) {
        const e = BOT.errand;
        if (!e || e.planning) return;
        if ($gameMap.mapId() !== e.map) {
            // Through a door. Still on the plan, or somewhere it did not expect.
            const expected = e.plan && (e.plan.goal === $gameMap.mapId() || e.plan.hops.some((h) => h.map === $gameMap.mapId()));
            e.map = $gameMap.mapId();
            e.steps = null;
            e.tries = 0;
            if (!expected) { replan(); return; }
        }
        const t = errandTarget();
        if (t && t.arrived) { BOT.errand = null; log('caught up on ' + placeName($gameMap.mapId())); return; }
        if (!t) { replan(); return; }
        const solid = t.ev.isNormalPriority();
        const atGoal = solid ? Math.abs(t.x - player.x) + Math.abs(t.y - player.y) === 1 : t.x === player.x && t.y === player.y;
        if (atGoal) {
            if (solid) player.setDirection(dirTo(t.x, t.y));
            if (t.ev.isTriggerIn([0])) press('ok');
            else if (solid) player.executeMove(dirTo(t.x, t.y)); // bump to set off a touch door
            else { player.executeMove(10 - player.direction()); } // off and on again
            if (++e.tries > 12) {
                // This will not open for us. Another way, for a while.
                giveUpOn(t);
                e.tries = 0;
                replan();
            }
            return;
        }
        if (!e.steps || !e.steps.length) {
            e.steps = Nav.path(t.x, t.y, t.ev.eventId(), solid);
            if (!e.steps) {
                giveUpOn(t);
                replan();
                return;
            }
        }
        const next = e.steps[0];
        const x = player.x, y = player.y;
        player.executeMove(dirTo(next.x, next.y));
        if (player.x === next.x && player.y === next.y) { e.steps.shift(); BOT.stuck = 0; return; }
        if (player.x === x && player.y === y && ++BOT.stuck > 6) {
            // Something is standing there. Around it.
            Nav.banned.set(next.x + ',' + next.y, Date.now() + 4000);
            e.steps = null;
            BOT.stuck = 0;
        }
    }

    // Every time the engine asks the player for input, this decides the step.
    Game_Player.prototype.moveByInput = function () {
        if (!Coop.world.live || this.isMoving() || !this.canMove()) return;
        if (BOT.errand) return errandStep(this);
        if (BOT.giving && handOver()) {
            const peer = Coop.peers.get(BOT.giving.peer);
            const dir = peer ? this.findDirectionTo(peer.x, peer.y) : 0;
            if (dir > 0) this.executeMove(dir);
            return;
        }
        if (BOT.mode === 'wait') return;
        if (BOT.mode === 'explore') return exploreStep(this);
        const who = leader();
        if (!who || who.m !== $gameMap.mapId() || who.st === 'dead') return;
        const dist = Math.abs(who.x - this.x) + Math.abs(who.y - this.y);
        if (dist === 0) {
            // Standing on the same tile hides the bot behind the player; step off.
            const free = [2, 4, 6, 8].filter((d) => this.canPass(this.x, this.y, d));
            if (free.length) this.executeMove(free[Math.randomInt(free.length)]);
            return;
        }
        if (dist <= 2) { BOT.stuck = 0; BOT.trail = null; return; }
        let dir;
        if (dist <= 6) dir = this.findDirectionTo(who.x, who.y);
        else {
            // Further off, round corners and through rooms: a proper path,
            // worked out again whenever they have moved on.
            const t = BOT.trail;
            if (!t || t.x !== who.x || t.y !== who.y || !t.steps.length) {
                const steps = Nav.path(who.x, who.y, 0, true);
                BOT.trail = steps ? { x: who.x, y: who.y, steps } : null;
            }
            const next = BOT.trail && BOT.trail.steps[0];
            dir = next ? dirTo(next.x, next.y) : this.findDirectionTo(who.x, who.y);
        }
        const x = this.x, y = this.y;
        if (dir > 0) this.executeMove(dir);
        if (BOT.trail && BOT.trail.steps.length && this.x === BOT.trail.steps[0].x && this.y === BOT.trail.steps[0].y) BOT.trail.steps.shift();
        if (this.x === x && this.y === y) { BOT.stuck++; BOT.trail = null; } else BOT.stuck = 0;
    };
    //--- exploring alone --------------------------------------------------------

    // Told to explore, it searches what it has not searched (bodies, barrels,
    // chests: anything whose page gives items when you interact), then goes
    // through a door to somewhere it has not been. It says what it finds.
    BOT.visited = new Set(); // "map:event" searched already
    BOT.seenMaps = new Set();

    function lootHere() {
        if (!window.$dataMap) return [];
        const now = Date.now();
        return $gameMap.events().filter((ev) => {
            const key = $gameMap.mapId() + ':' + ev.eventId();
            if (ev._erased || BOT.visited.has(key) || (Nav.banned.get('x' + key) || 0) > now) return false;
            const page = ev.page();
            if (!page || !ev.isTriggerIn([0])) return false;
            return page.list.some((c) => c.code === 125 || c.code === 126 || c.code === 127 || c.code === 128);
        });
    }

    // The nearest door to a map it has not been on.
    function unseenDoor() {
        const here = $gameMap.mapId();
        const now = Date.now();
        return Nav.exits($dataMap, here)
            .filter((x) => !BOT.seenMaps.has(x.to) && !((Nav.banned.get('m' + x.to) || 0) > now) && !((Nav.banned.get(here + ':' + x.ev) || 0) > now))
            .sort((a, b) => $gameMap.distance($gamePlayer.x, $gamePlayer.y, a.x, a.y) - $gameMap.distance($gamePlayer.x, $gamePlayer.y, b.x, b.y))[0];
    }

    function exploreStep(player) {
        BOT.seenMaps.add($gameMap.mapId());
        let x = BOT.explore;
        if (!x || x.map !== $gameMap.mapId()) x = BOT.explore = { map: $gameMap.mapId(), target: 0, steps: null, tries: 0 };
        let ev = x.target ? $gameMap.event(x.target) : null;
        if (!ev || BOT.visited.has(x.map + ':' + x.target)) {
            const near = lootHere().sort((a, b) => $gameMap.distance(player.x, player.y, a.x, a.y) - $gameMap.distance(player.x, player.y, b.x, b.y))[0];
            if (!near) {
                // Nothing left to search here: on to somewhere new.
                const door = unseenDoor();
                if (door) {
                    BOT.errand = { kind: 'explore', for: 0, name: '', goalMap: door.to, since: Date.now(), plan: { goal: door.to, hops: [Object.assign({ map: $gameMap.mapId() }, door)] }, planning: false, map: $gameMap.mapId(), steps: null, tries: 0, replans: 0 };
                    log('exploring on into ' + placeName(door.to));
                } else if (!x.done) {
                    x.done = true;
                    note('You have searched everything you can reach from here. Tell your partner, and wait for them.');
                    BOT.lastNoteAt = 0;
                    BOT.mode = 'wait';
                }
                return;
            }
            x.target = near.eventId();
            x.steps = null;
            x.tries = 0;
            ev = near;
        }
        const solid = ev.isNormalPriority();
        const at = solid ? Math.abs(ev.x - player.x) + Math.abs(ev.y - player.y) === 1 : ev.x === player.x && ev.y === player.y;
        if (at) {
            if (solid) player.setDirection(dirTo(ev.x, ev.y));
            press('ok');
            // Searched once it has been tried; the event itself says what was there.
            if (++x.tries > 3) BOT.visited.add(x.map + ':' + x.target);
            return;
        }
        if (!x.steps || !x.steps.length) {
            x.steps = Nav.path(ev.x, ev.y, ev.eventId(), solid);
            if (!x.steps) { Nav.banned.set('x' + x.map + ':' + x.target, Date.now() + 300000); x.target = 0; return; }
        }
        const next = x.steps[0];
        const bx = player.x, by = player.y;
        player.executeMove(dirTo(next.x, next.y));
        if (player.x === next.x && player.y === next.y) { x.steps.shift(); BOT.stuck = 0; return; }
        if (player.x === bx && player.y === by && ++BOT.stuck > 6) {
            Nav.banned.set(next.x + ',' + next.y, Date.now() + 4000);
            x.steps = null;
            BOT.stuck = 0;
        }
    }

    // What it picks up while out on its own.
    const _gainItem = Game_Party.prototype.gainItem;
    Game_Party.prototype.gainItem = function (item, amount, includeEquip) {
        _gainItem.call(this, item, amount, includeEquip);
        if (item && amount > 0 && BOT.mode === 'explore' && this === window.$gameParty && !this.inBattle() && Coop.world.live) note('You found ' + item.name + (amount > 1 ? ' x' + amount : '') + '.');
    };

    Game_Player.prototype.updateDashing = function () {
        if (BOT.errand) { this._dashing = !$gameMap.isDashDisabled(); return; }
        const who = leader();
        this._dashing = !!who && who.m === $gameMap.mapId() && Coop.distanceTo(who) > 5 && !$gameMap.isDashDisabled();
    };

    //--- the loop ---------------------------------------------------------------

    BOT.tick = function () {
        const scene = SceneManager._scene;
        if (!scene || !Coop.connected || BOT.leaving) return;
        if (scene instanceof Scene_Title || scene instanceof Scene_Gameover) {
            BOT.errand = null;
            if (scene instanceof Scene_Gameover) { press('ok'); return; }
            if (Date.now() - BOT.joinedAt < 5000) return; // on its way in
            BOT.cameBack = ''; // whatever it was, it did not get it onto the map
            // The host says whether it kept a dropped session; wait a moment for that.
            BOT.titleAt = BOT.titleAt || Date.now();
            if (!BOT.parkKnown && Date.now() - BOT.titleAt < 4000) return;
            if (leader() && leader().st !== 'dead') { if (!BOT.comeBack()) BOT.join(); }
            else log('waiting at the title for a player to be in the dungeon');
            return;
        }
        BOT.titleAt = 0;
        BOT.parkKnown = false;
        if (BOT.cameBack && scene instanceof Scene_Map && scene.isActive()) {
            BOT.cameBack = '';
            becameCharacter();
            note('You are back with your partner in a run you have played before, as the ' + BOT.character + '. Say so in a few words.');
            BOT.lastNoteAt = 0;
        }
        if (BOT.needStart && scene instanceof Scene_Map && scene.isActive() && !$gamePlayer.isTransferring()) {
            BOT.needStart = false;
            $gameSwitches.setValue(79, true); // the game's own "the run has begun"
        }
        if (Coop.dead) { BOT.errand = null; log('dead; a ritual circle can bring me back'); return; }
        const who = leader();
        if (scene instanceof Scene_CoopSpectate) { log('fighting beside ' + (who ? who.name : 'someone')); return; }
        if (scene instanceof Scene_Battle) { log('in a fight of my own'); ownFight(scene); return; }
        if (!(scene instanceof Scene_Map)) { press('cancel'); return; }
        if (!Coop.world.live) {
            const shut = Coop.world.otherRun || Coop.world.sameAs;
            BOT.outSince = shut ? BOT.outSince || Date.now() : 0;
            if (shut && Date.now() - BOT.outSince > 5000) {
                BOT.outSince = 0;
                BOT.parked = false;
                log('that was a different run from theirs; back to the title');
                SceneManager.goto(Scene_Title);
            }
            return;
        }
        BOT.outSince = 0;
        keepFed();
        keepWell();
        watchConditions();
        if ($gameMessage.isChoice()) { chooseInDialogue(scene); return; }
        if ($gameMessage.isBusy()) {
            // A partner watching through these eyes gets a moment to read.
            BOT.msgSince = BOT.msgSince || Date.now();
            if (Date.now() - BOT.msgSince > 2200) { press('ok'); BOT.msgSince = 0; }
            return;
        }
        BOT.msgSince = 0;
        if ($gameMap.isEventRunning()) return;
        // A partner lies dead: go and get them.
        const dead = humans().find((p) => p.st === 'dead');
        const circleTrip = BOT.errand && BOT.errand.kind === 'circle';
        if (dead && !circleTrip && !(BOT.noWayUntil > Date.now()) && !(Date.now() - (BOT.calledAt || 0) < 10000)) { startErrand(dead); return; }
        if (circleTrip && (!dead || dead.id !== BOT.errand.for)) { BOT.errand = null; log('the errand is over'); }
        if (circleTrip) { log('on the way to a circle for ' + BOT.errand.name); return; }
        if (!who) {
            // Nobody left to follow. A bot must not keep a world going on its
            // own: the next player to start would walk into whatever it did there.
            BOT.aloneSince = BOT.aloneSince || Date.now();
            if (Date.now() - BOT.aloneSince > 12000) {
                BOT.aloneSince = 0;
                BOT.joinedAt = Date.now();
                log('everyone has left; going back to the title to wait');
                SceneManager.goto(Scene_Title);
            } else log('nobody to follow');
            return;
        }
        BOT.aloneSince = 0;
        if (who.st === 'dead') { log(who.name + ' is dead; waiting'); return; }
        if (BOT.mode === 'wait') { BOT.errand = null; log('waiting where told'); return; }
        if (BOT.mode === 'explore') { log('exploring alone'); return; }
        const sameMap = who.m === $gameMap.mapId();
        const chase = BOT.errand && BOT.errand.kind === 'follow' ? BOT.errand : null;
        // Close by when they went through: after them at once, the way a
        // person does with F. Walking is for when it was too far off for that.
        if (!sameMap && Coop.follow && Coop.follow()) { BOT.errand = null; log('went after ' + who.name + ' through the door'); return; }
        if (!sameMap && who.m && !$gamePlayer.isTransferring()) {
            // They went through a door: after them, on foot. Somewhere new
            // since setting off, or too long on the way: think again, or jump.
            if (!chase || chase.for !== who.id) { startChase(who); return; }
            if (chase.goalMap !== who.m) { chase.goalMap = who.m; chase.since = Date.now(); replan(); return; }
            if (Date.now() - chase.since > 60000) { jumpTo(who); return; }
            log('going after ' + who.name);
            return;
        }
        if (chase && sameMap) BOT.errand = null;
        // Hopelessly cut off on the same map (half a minute without a step): the quick way.
        if (sameMap && BOT.stuck > 1800 && Date.now() - BOT.lastHop > 4000) { jumpTo(who); return; }
        if (sameMap) log('following ' + who.name);
    };

    let lastMap = 0;
    setInterval(function () {
        try {
            BOT.tick();
            joinFightNearby();
            if (window.$gameMap && Coop.world.live && SceneManager._scene instanceof Scene_Map && $gameMap.mapId() !== lastMap) {
                if (lastMap) note('You are now in ' + placeName($gameMap.mapId()) + '.');
                lastMap = $gameMap.mapId();
            }
        } catch (e) { console.error('[bot] ' + (e && e.stack || e)); }
    }, 150);
    Coop.reportPresence(true);

    BOT.status = function () {
        const scene = SceneManager._scene;
        const me = window.$gameParty && $gameParty.leader();
        return {
            said: BOT.said, scene: scene ? scene.constructor.name : '', live: Coop.world.live, connected: Coop.connected,
            map: window.$gameMap ? $gameMap.mapId() : 0, x: window.$gamePlayer ? $gamePlayer.x : 0, y: window.$gamePlayer ? $gamePlayer.y : 0,
            hp: me ? me.hp : 0, character: BOT.character, mode: BOT.mode, errand: BOT.errand ? { kind: BOT.errand.kind, name: BOT.errand.name, goal: BOT.errand.plan && BOT.errand.plan.goal } : null,
        };
    };
};
