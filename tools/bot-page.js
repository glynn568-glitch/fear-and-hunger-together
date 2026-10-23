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
        if (Coop.partyLeader) return 'walking in line';
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
        const t0 = Date.now();
        const ask = window.fhBrain(kind, text).then((r) => { if (r && kind !== 'battle' && BOT.talked) BOT.talked(Date.now() - t0); return r || null; }, () => null);
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

    // The people it plays with. A test run's host (options.lead) plays with
    // everyone; a partner told whom to follow counts that one as a person.
    function humans() {
        return Coop.others().filter((p) => !p.bot || options.lead || (options.follow && p.name.toLowerCase() === options.follow.toLowerCase()));
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
        if (me && window.$gameMap) rows.push('You: ' + me.name() + ', ' + me.hp + '/' + me.mhp + ' HP, Mind ' + me.mp + '/' + me.mmp + (me.mp < me.mmp * 0.35 ? ' (your mind is going)' : '') + ', ' + hunger(me) + ', in ' + placeName($gameMap.mapId()) + (BOT.mode === 'wait' ? ', waiting where told' : '') + (BOT.errand && BOT.errand.kind === 'circle' ? ', on your way to a ritual circle' : '') + (BOT.mode === 'explore' ? ', exploring on your own' : '') + (Coop.partyLeader && Coop.peers.has(Coop.partyLeader) ? ', walking in ' + Coop.peers.get(Coop.partyLeader).name + "'s party" : '') + (BOT.quiet ? ', keeping quiet' : '') + '.');
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
        think('note', text).then((r) => {
            // A need is said even soon after another line; only "quiet" holds it.
            if (!r) { const need = plainNote(text); if (need && !BOT.quiet) speak(need, true); return; }
            if (r.say) speak(r.say, false);
            if (r.use) obey({ use: r.use }, null);
        });
    }, 1000);

    //--- who to stay with -----------------------------------------------------

    // The player to stick to: a named one if asked for, else a person in the world.
    function leader() {
        if (options.lead) return null; // the host follows nobody
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

    // The way a person comes in (options.lead, options.intro): New Game and
    // the game's own opening, as a character nobody has taken.
    BOT.start = function () {
        const scene = SceneManager._scene;
        const name = freeCharacter();
        if (!(scene instanceof Scene_Title) || !name) return false;
        BOT.character = name;
        BOT.joinedAt = Date.now();
        BOT.intro = true;
        log('New Game, to play the ' + name);
        if (window.fhBrainCharacter) window.fhBrainCharacter(name);
        scene.commandNewGame();
        return true;
    };

    // The opening, played through: the character picker (map 10, EV004 reads
    // left/right/ok into variable 9), the name screen, then questions and text.
    const PICKER = { mercenary: 1, knight: 2, priest: 3, outlander: 4 };
    function introStep(scene) {
        if (scene instanceof Scene_Name) {
            const w = scene._inputWindow;
            if (w && w.active) { w.select(89); press('ok'); } // the name screen's OK
            return true;
        }
        if (!(scene instanceof Scene_Map) || !window.$gameMap) return false;
        // While the picker is up the action key picks whoever is shown, so it
        // is only pressed once the wanted one is.
        if ($gameMap.mapId() === 10 && $gameSwitches.value(296) && !$gameSwitches.value(214)) {
            const want = PICKER[BOT.character];
            press($gameVariables.value(9) === want ? 'ok' : 'right');
            return true;
        }
        if ($gameMessage.isChoice()) { chooseInDialogue(scene); return true; }
        if ($gameMessage.isBusy()) {
            BOT.msgSince = BOT.msgSince || Date.now();
            if (Date.now() - BOT.msgSince > 400) { press('ok'); BOT.msgSince = 0; }
            return true;
        }
        // Between texts the opening waits for the action key now and then.
        press('ok');
        return true;
    }

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
    // This is put in once the title is up, so the title's own question may already have been answered.
    if (Coop.connected && Coop.name) Coop.send({ t: 'park?' });
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
        rows.push('Enemies: ' + brief.enemies.map((e) => e.i + ' ' + e.name + ' ' + e.how + (e.states.length ? ' [' + e.states.join(', ') + ']' : '') + (e.strikes ? ' (attacks)' : '') + (e.ends ? ' (bring it down and the enemy falls)' : '') + ' ' + e.hit + '% to hit, about ' + Math.max(1, Math.round(e.blows)) + ' blows').join('; '));
        if (brief.log.length) rows.push('Lately: ' + brief.log.join(' / '));
        const opts = ['attack with ' + brief.attack.weapon + ' (target an enemy number)', 'guard'];
        for (const k of brief.skills) if (k.usable) opts.push('skill ' + k.id + ' ' + k.name + (k.about ? ': ' + k.about : ''));
        for (const it of brief.items) opts.push('item ' + it.id + ' ' + it.name + ' x' + it.count + (it.about ? ': ' + it.about : ''));
        rows.push('Options: ' + opts.join(' | '));
        rows.push('Target numbers: enemy number for attacks, your-side number for help. Reply {"do","id","target","say"}.');
        return rows.join('\n');
    }

    // Rules of thumb when there is no answer, the way players fight: heal
    // whoever on our side is about to die, finish a part that is nearly off,
    // take the head only when it is easy to hit (a guard's is, once both legs
    // are off), else the parts that strike, then the body. On a guard that is
    // the cleaver arm, the stinger, then the torso, as players fight it.
    function fallbackPick(brief) {
        // A wind-up (the guard's step closer before its charge): guard this turn.
        if (brief.tell || brief.round.some((l) => /takes a step closer|prepares for|readies|raises (his|her|its) arms/i.test(l))) return { do: 'guard' };
        const heal = HEALS.map((id) => brief.items.find((it) => it.id === id)).find(Boolean);
        const dying = brief.allies.filter((a) => a.how !== 'down' && a.hp < a.mhp * 0.25).sort((a, b) => a.hp / a.mhp - b.hp / b.mhp)[0];
        if (heal && dying) return { do: 'item', id: heal.id, target: dying.i };
        const alive = brief.enemies.filter((e) => e.how !== 'gone');
        // Worth a blow: a part that strikes, or one whose loss ends the enemy (head, torso, a
        // body with no parts). Of those, the one that takes fewest blows, a striker on a tie.
        const kills = (e) => e.ends || /head|torso/i.test(e.name) || !/\[/.test(e.name);
        const worth = alive.filter((e) => e.strikes || kills(e));
        const target = (worth.length ? worth : alive).sort((a, b) => a.blows - b.blows || b.strikes - a.strikes)[0];
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

    // A model that keeps a fight waiting (Grok Build: 9-25 s a turn) hands its
    // fight turns to the rules of thumb, which play the same parts and guard on
    // the same tells, and keeps the talking. Two quick answers to talk in a row
    // (under 3 s) give it its fights back.
    const SLOW = 8000; // ms: slow when the middle of the last three turns (of two, the quicker) is slower than this
    BOT.fightMs = [];
    BOT.talkMs = [];
    BOT.slowFights = function () {
        const last = BOT.fightMs.slice(-3).sort((x, y) => x - y);
        return last.length >= 2 && last[Math.floor((last.length - 1) / 2)] > SLOW;
    };
    BOT.talked = function (ms) {
        BOT.talkMs = BOT.talkMs.concat([ms]).slice(-2);
        if (BOT.talkMs.length === 2 && BOT.talkMs.every((t) => t < 3000)) BOT.fightMs = [];
    };
    function decide(brief, err) {
        const t0 = Date.now();
        const timed = (p) => p.then((r) => { BOT.fightMs.push(r ? Date.now() - t0 : THINK_LIMIT); if (BOT.fightMs.length > 6) BOT.fightMs.shift(); return r; });
        if (!err && BOT.slowFights()) {
            const pick = fallbackPick(brief);
            BOT.picks.push({ ms: Date.now() - t0, pick, model: false, slow: true });
            return Promise.resolve(pick);
        }
        // A second refusal goes straight to the rules of thumb.
        const asked = err ? Promise.resolve(null) : timed(think('battle', briefText(brief, err), THINK_LIMIT));
        return asked.then(function (r) {
            const pick = validPick(brief, r) || fallbackPick(brief);
            BOT.picks.push({ ms: Date.now() - t0, pick, model: !!validPick(brief, r) });
            // A word in a fight now and then, not every turn.
            if (r && r.say && Date.now() - BOT.lastSpokeAt > 25000) speak(r.say, true);
            return pick;
        });
    }
    BOT.decide = decide;

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
        // Its own character and any companion it recruited; a partner's turn is theirs.
        const lent = new Set();
        if (Coop.battle && Coop.battle.guests) for (const g of Coop.battle.guests.values()) for (const id of g.actors) lent.add(id);
        const mine = actor && !lent.has(actor.actorId());
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
            r = r || plainReply(msg.text);
            if (!r) return;
            obey(r, peer);
            speak(r.say, true);
        });
    });

    // Without a model (or when it fails): the orders a partner gives, read from
    // their words, with a word back so they know it was taken.
    function bagFind(words, kinds) {
        const me = $gameParty.leader();
        const all = $gameParty.allItems().concat(me ? me.equips().filter(Boolean) : []).filter((it) => it && it.name);
        if (/\b(food|eat|something to eat|meat)\b/.test(words)) {
            const food = all.filter(isFood).filter((f) => !spoils(f)).sort((a, b) => filling(a) - filling(b));
            if (food.length) return food[0];
        }
        if (/\b(heal|healing|herb|medicine|potion)\b/.test(words)) {
            const id = HEALS.find((h) => $gameParty.hasItem($dataItems[h]));
            if (id) return $dataItems[id];
        }
        if (/\b(bandage|cloth)\b/.test(words) && $gameParty.hasItem($dataItems[8])) return $dataItems[8];
        // By name: the whole name, else any long word of it ("the sword" for Long sword).
        const kinded = all.filter((it) => kinds.indexOf(kindOf(it)) >= 0);
        const part = (it) => it.name.toLowerCase().split(/\W+/).some((w) => w.length >= 4 && new RegExp('\\b' + w + 's?\\b').test(words));
        return kinded.find((it) => words.includes(it.name.toLowerCase())) || kinded.find(part) || null;
    }
    function plainReply(text) {
        const t = ' ' + String(text || '').toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
        const has = (re) => re.test(t);
        if (!window.$gameParty) return null;
        // "Don't wait", "never mind": better no answer than the opposite order. "I'll use a herb
        // on you" is the speaker's own plan, not an order.
        if (has(/\b(don't|dont|do not|never|no need|can't|cant|cannot)\b|^ i\b|\b(i'll|i will|i'm going to|let me)\b/)) return null;
        // Leaving cannot be undone: only the plain order, the whole line.
        if (/^ (go home|you can go home|you're dismissed|dismissed) $/.test(t)) return { order: 'leave', say: 'Farewell.' };
        if (Coop.dead && has(/\blet (it )?go\b/)) return { order: 'let go', say: 'Take my things.' };
        if (has(/\b(join (my |the )?party|fall in|get in line|join me)\b/)) return { order: 'party', say: 'In line.' };
        if (has(/\b(give|hand|pass|toss) (it |that |them |those )?(over )?(to )?me\b|\bcan i (have|get|borrow|take)\b/)) {
            const it = bagFind(t, ['item', 'weapon', 'armor']);
            if (it) return { give: { kind: kindOf(it), id: it.id }, say: 'Here, ' + it.name + '.' };
            // "Give me a second" names nothing to give.
            return /\b(food|meat|heal|herb|medicine|potion|bandage|cloth)\b/.test(t) ? { say: 'I have none.' } : null;
        }
        if (has(/\b(eat|drink|use (your|the|a|an|some|that)|heal yourself|bandage yourself|patch yourself)\b/)) {
            const it = bagFind(t, ['item']);
            return it ? { use: it.id, say: '' } : { say: 'I have nothing for that.' };
        }
        if (has(/\b(shut up|be quiet|quiet down|shush|hush|shh+)\b/)) return { order: 'quiet', say: '' };
        if (has(/\b(you can talk|talk again|you can speak)\b/)) return { order: 'talk', say: 'Fine.' };
        // "Stay close" and "search with me" are following, so following is read first.
        if (has(/\b(follow|come (here|with me|along|back)|^ come $|stay close|stay behind|stay with me|regroup|back to me|this way|over here)\b/)) return { order: 'follow', say: 'Coming.' };
        if (has(/\b(explore|look around|go scout|split up|go (look|search|loot)|search (around|alone|on your own))\b/)) return { order: 'explore', say: 'I will look around.' };
        if (has(/\b(wait|stay (here|put|there|back)|hold (on|up|here|position)|freeze)\b|^ stop\b/)) return { order: 'wait', say: 'Waiting here.' };
        if (has(/\b(how are you|you ok|you okay|status|are you hurt|your health)\b/)) {
            const me = $gameParty.leader();
            const ails = conditionsOf(me);
            return { say: me.hp + ' of ' + me.mhp + ', ' + hunger(me) + (ails.length ? ', ' + ails.slice(0, 2).join(', ') : '') + '.' };
        }
        if (has(/\b(what do you have|what have you got|inventory|your bag|carrying)\b/)) {
            const names = $gameParty.items().map((it) => it.name).slice(0, 5);
            return { say: names.length ? names.join(', ') + '.' : 'Nothing.' };
        }
        return null;
    }
    BOT.plainReply = plainReply;
    BOT.plainPick = fallbackPick;

    // What it would have asked a model to put in words: its needs, said plainly.
    function plainNote(text) {
        const needs = [];
        if (/You have no food/.test(text)) needs.push("I'm out of food.");
        for (const m of text.matchAll(/Ask your partner for (.+?), plainly/g)) if (m[1] !== 'some') needs.push('I need ' + m[1] + '.');
        if (/close to death .* nothing to heal with/.test(text)) needs.push('Nearly dead. Nothing to heal with.');
        return needs.join(' ');
    }

    // What a reply asks this partner to do, beyond talking.
    function obey(r, peer) {
        const order = String(r.order || '').toLowerCase();
        if ((order === 'wait' || order === 'explore') && Coop.partyLeader) Coop.leaveParty();
        if (order === 'party' && Coop.joinParty && Coop.joinParty(peer.id)) { BOT.mode = 'follow'; BOT.explore = null; BOT.errand = null; log('joined ' + peer.name + "'s party"); }
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
        // The same question again and again (a shop, a lever): the way out, the last choice.
        const asked = said + '|' + choices.join('|');
        BOT.asked = BOT.asked && BOT.asked.key === asked && Date.now() - BOT.asked.at < 60000 ? { key: asked, n: BOT.asked.n + 1, at: Date.now() } : { key: asked, n: 1, at: Date.now() };
        if (BOT.asked.n >= 4) {
            for (let i = choices.length - 1; i >= 0; i--) { win.select(i); if (win.isCurrentItemEnabled()) { win.processOk(); BOT.asked.n = 0; log('asked the same again: took "' + choices[i] + '"'); return; } }
        }
        // A test run's set answer (options.prefer: the difficulty, say), when it is offered.
        const set = (options.prefer || []).map((t) => choices.indexOf(t)).find((i) => i >= 0);
        if (set !== undefined) {
            win.select(set);
            if (win.isCurrentItemEnabled()) { win.processOk(); return; }
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
    // The commands of a page this run can reach. A door whose way depends on
    // a variable (the floor rolled at the start: inner hall 3, 31 or 53) only
    // goes where this run's numbers send it; switch conditions (a door not
    // opened yet) are left as possible.
    function reachable(list) {
        const out = [];
        const branch = []; // branch[k]: contents at indent k are on (true), off (false) or either (null)
        const last = []; // the condition at indent k, for its else
        for (const c of list) {
            const i = c.indent;
            branch.length = i + 1;
            if (branch.some((b) => b === false)) continue;
            out.push(c);
            if (c.code === 111) branch[i + 1] = last[i] = c.parameters[0] === 1 ? variableHolds(c.parameters) : null;
            else if (c.code === 411) branch[i + 1] = last[i] === null ? null : !last[i];
            else branch[i + 1] = null;
        }
        return out;
    }
    function variableHolds(p) {
        const v = $gameVariables.value(p[1]);
        const n = p[2] === 0 ? p[3] : $gameVariables.value(p[3]);
        return [v === n, v >= n, v <= n, v > n, v < n, v !== n][p[4]];
    }

    Nav.exits = function (data, mapId) {
        const out = [];
        if (!data || !data.events) return out;
        for (const ev of data.events) {
            if (!ev) continue;
            const seen = new Set();
            for (const page of ev.pages) for (const c of reachable(page.list)) {
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

    // A shut door: solid, opened with the action key, drawn as a door, and its
    // page only swings it open (a move route, no text and no question: a cell
    // door asking to use a lockpick or a key is not opened for anyone). One
    // that would not open lately counts as a wall for a while.
    function shutDoor(ev) {
        const page = ev.page();
        return !!page && ev.isNormalPriority() && ev.isTriggerIn([0]) && /door|gate/i.test(ev.characterName())
            && page.list.some((c) => c.code === 205) && !page.list.some((c) => c.code === 101 || c.code === 102)
            && !((Nav.banned.get('door' + $gameMap.mapId() + ':' + ev.eventId()) || 0) > Date.now());
    }

    // Anything standing there; when careful, also floor tiles that do something
    // when stepped on (traps, doors, scenes). A shut door is not in the way:
    // it gets opened on the way through.
    function blockedByEvent(x, y, except, careful) {
        if (!window.$dataMap) return true; // between maps: stand still
        return $gameMap.eventsXyNt(x, y).some((ev) => ev.eventId() !== except && ((ev.isNormalPriority() && !shutDoor(ev)) || (ev.page() && ev.isTriggerIn([1, 2]) && (careful || takesAway(ev)))));
    }
    // A tile that sends whoever steps on it to another map is never on the way.
    function takesAway(ev) {
        return ev.page().list.some((c) => c.code === 201);
    }

    // A step was blocked: if a shut door is what stands there, face it and
    // press the action key, as a player would. True while that is under way.
    // A door that stays shut after a few tries (locked) is left for a while.
    function openDoorAhead(player, dir) {
        if (!dir || !window.$dataMap) return false;
        const x = $gameMap.roundXWithDirection(player.x, dir), y = $gameMap.roundYWithDirection(player.y, dir);
        const door = $gameMap.eventsXyNt(x, y).find(shutDoor);
        if (!door) return false;
        const key = 'door' + $gameMap.mapId() + ':' + door.eventId();
        const now = Date.now();
        const d = BOT.door && BOT.door.key === key ? BOT.door : (BOT.door = { key, tries: 0, at: 0 });
        if (now - d.at < 1500) return true; // its swing takes a moment
        if (++d.tries > 3) {
            Nav.banned.set(key, now + 60000);
            BOT.door = null;
            log('a door here will not open for me');
            return false;
        }
        player.setDirection(dir);
        press('ok');
        d.at = now;
        return true;
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

    // Off this tile, any way that is open.
    function stepAside(player) {
        const free = [2, 4, 6, 8].filter((d) => player.canPass(player.x, player.y, d));
        if (free.length) player.executeMove(free[Math.randomInt(free.length)]);
    }

    function dirTo(x, y) {
        const dx = x - $gamePlayer.x, dy = y - $gamePlayer.y;
        if (Math.abs(dx) >= Math.abs(dy) && dx) return dx > 0 ? 6 : 4;
        return dy > 0 ? 2 : dy < 0 ? 8 : 0;
    }

    // Trips on foot, through the doors, with whatever lives between:
    //   circle  a partner lies dead; walk to a circle that can call them back
    //   follow  a partner went through a door; go after them
    async function startErrand(dead) {
        // A circle errand goes its own way: out of anyone's line first (party.js would pull it back).
        if (Coop.partyLeader) Coop.leaveParty();
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
        // On foot only (options.walkOnly, for test runs): no jumping; look for a way out instead.
        if (options.walkOnly) {
            if (BOT.mode !== 'explore') log('no way on foot to ' + (who ? who.name : 'them') + '; looking for a way out');
            BOT.mode = 'explore';
            BOT.lost = Date.now();
            return;
        }
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
            // Back on a map it already left on this trip: the way bounced it.
            const back = (e.been = e.been || []).indexOf($gameMap.mapId()) >= 0;
            if (e.been.indexOf(e.map) < 0) e.been.push(e.map);
            if (back) e.bounces = (e.bounces || 0) + 1;
            e.map = $gameMap.mapId();
            e.steps = null;
            e.tries = 0;
            if (e.bounces > 4) {
                log('going round in circles; giving this trip up');
                if (e.kind === 'follow') jumpTo(Coop.peers.get(e.for));
                else { BOT.errand = null; if (e.kind === 'circle') BOT.noWayUntil = Date.now() + 120000; }
                return;
            }
            if (!expected || back) { replan(); return; }
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
                log('the way at ' + t.x + ',' + t.y + ' did not take me; trying another');
                giveUpOn(t);
                e.tries = 0;
                replan();
            }
            return;
        }
        if (!e.steps || !e.steps.length) {
            e.steps = Nav.path(t.x, t.y, t.ev.eventId(), solid);
            if (!e.steps) {
                log('no path from ' + player.x + ',' + player.y + ' to ' + t.x + ',' + t.y + '; trying another way');
                giveUpOn(t);
                replan();
                return;
            }
        }
        if (!e.steps.length) { e.steps = null; stepAside(player); return; } // on the goal's own tile
        const next = e.steps[0];
        const x = player.x, y = player.y;
        player.executeMove(dirTo(next.x, next.y));
        if (player.x === next.x && player.y === next.y) { e.steps.shift(); BOT.stuck = 0; return; }
        if (player.x === x && player.y === y && openDoorAhead(player, dirTo(next.x, next.y))) { BOT.stuck = 0; return; }
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
        if (Coop.partyLeader && Coop.partyStep(this)) return;
        if (BOT.mode === 'wait') return;
        if (BOT.mode === 'explore') return exploreStep(this);
        const who = leader();
        if (!who || who.m !== $gameMap.mapId() || who.st === 'dead') return;
        const dist = Math.abs(who.x - this.x) + Math.abs(who.y - this.y);
        if (dist === 0) {
            // Standing on the same tile hides the bot behind the player; step off.
            stepAside(this);
            return;
        }
        if (dist <= 2) { BOT.stuck = 0; BOT.trail = null; return; }
        let dir;
        {
            // Round corners, through rooms and shut doors: a proper path,
            // worked out again whenever they have moved on. (The engine's own
            // short-range step treats a shut door as a wall.)
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
        if (this.x === x && this.y === y && openDoorAhead(this, dir)) { BOT.stuck = 0; return; }
        if (this.x === x && this.y === y) { BOT.stuck++; BOT.trail = null; } else BOT.stuck = 0;
    };
    //--- exploring alone --------------------------------------------------------

    // Told to explore, it searches what it has not searched (bodies, barrels,
    // chests: anything whose page gives items when you interact), then goes
    // through a door to somewhere it has not been. It says what it finds.
    BOT.visited = new Set(); // "map:event" searched already
    BOT.seenMaps = new Map(); // map id -> when last there

    // The developer's test tiles on the entrance (invisible; they hand over
    // the Passages, keys and companions): never touched.
    const CHEATS = new Set(['1:140', '1:323']);
    function lootHere() {
        if (!window.$dataMap) return [];
        const now = Date.now();
        return $gameMap.events().filter((ev) => {
            const key = $gameMap.mapId() + ':' + ev.eventId();
            if (ev._erased || CHEATS.has(key) || BOT.visited.has(key) || (Nav.banned.get('x' + key) || 0) > now) return false;
            const page = ev.page();
            if (!page || !ev.isTriggerIn([0])) return false;
            return page.list.some((c) => c.code === 125 || c.code === 126 || c.code === 127 || c.code === 128);
        });
    }

    // Everything else here that does something when used, not tried yet.
    function pokeHere() {
        const now = Date.now();
        return $gameMap.events().filter((ev) => {
            const key = $gameMap.mapId() + ':' + ev.eventId();
            if (ev._erased || CHEATS.has(key) || BOT.visited.has(key) || (Nav.banned.get('x' + key) || 0) > now) return false;
            const page = ev.page();
            return !!page && ev.isTriggerIn([0]) && page.list.length > 1;
        });
    }

    // The nearest door to a map it has not been on. A test run's host never
    // runs out: with all seen, the one it was on longest ago.
    function unseenDoor() {
        const here = $gameMap.mapId();
        const now = Date.now();
        const when = (x) => BOT.seenMaps.get(x.to) || 0;
        return Nav.exits($dataMap, here)
            .filter((x) => (options.lead || !BOT.seenMaps.has(x.to)) && !((Nav.banned.get('m' + x.to) || 0) > now) && !((Nav.banned.get(here + ':' + x.ev) || 0) > now))
            .sort((a, b) => when(a) - when(b) || $gameMap.distance($gamePlayer.x, $gamePlayer.y, a.x, a.y) - $gameMap.distance($gamePlayer.x, $gamePlayer.y, b.x, b.y))[0];
    }

    function exploreStep(player) {
        BOT.seenMaps.set($gameMap.mapId(), Date.now());
        let x = BOT.explore;
        if (!x || x.map !== $gameMap.mapId()) x = BOT.explore = { map: $gameMap.mapId(), target: 0, steps: null, tries: 0 };
        let ev = x.target ? $gameMap.event(x.target) : null;
        if (!ev || BOT.visited.has(x.map + ':' + x.target)) {
            const byDistance = (a, b) => $gameMap.distance(player.x, player.y, a.x, a.y) - $gameMap.distance(player.x, player.y, b.x, b.y);
            let near = lootHere().sort(byDistance)[0];
            // Nothing left to search here: on to somewhere new.
            const door = near ? null : unseenDoor();
            // A test run's host with no way on tries what a curious player would: each lever, sign or door once.
            if (!near && !door && options.lead) near = pokeHere().sort(byDistance)[0];
            if (!near) {
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
        if (!x.steps.length) { x.steps = null; stepAside(player); return; } // on the goal's own tile
        const next = x.steps[0];
        const bx = player.x, by = player.y;
        player.executeMove(dirTo(next.x, next.y));
        if (player.x === next.x && player.y === next.y) { x.steps.shift(); BOT.stuck = 0; return; }
        if (player.x === bx && player.y === by && openDoorAhead(player, dirTo(next.x, next.y))) { BOT.stuck = 0; return; }
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
        // A weapon or armour better than what it wears goes on, as a player would.
        // Not for what its own change of clothes hands back (each piece taken off is a
        // gain: 10/21 that scheduled another change per piece, until the page froze).
        if (item && amount > 0 && (DataManager.isWeapon(item) || DataManager.isArmor(item)) && this === window.$gameParty && !this.inBattle() && Coop.world.live && !BOT.dressing) {
            const me = this.leader();
            if (me) BOT.dressing = setTimeout(function () {
                if ($gameParty.inBattle() || BOT.giving) { BOT.dressing = 0; return; }
                const before = me.equips().map((e) => e && e.name).join();
                try { me.optimizeEquipments(); } finally { BOT.dressing = 0; }
                if (me.equips().map((e) => e && e.name).join() !== before) log('now wearing ' + me.equips().filter(Boolean).map((e) => e.name).join(', '));
            }, 0);
        }
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
            // A test run that has ended stays ended (options.once).
            if (options.lead && options.once && BOT.played) { log('the run is over'); return; }
            if (options.lead) { if (!BOT.comeBack()) BOT.start(); return; }
            // By the opening, only once the leader's character is known, so as not to take the same one.
            if (leader() && leader().st !== 'dead' && (!options.intro || (leader().ini || []).length)) { if (!BOT.comeBack()) (options.intro ? BOT.start() : BOT.join()); }
            else log('waiting at the title for a player to be in the dungeon');
            return;
        }
        if (Coop.world.live) BOT.played = true;
        if (BOT.intro && Coop.world.live) { BOT.intro = false; becameCharacter(); }
        if (BOT.intro && !(window.$gameSwitches && $gameSwitches.value(79)) && introStep(scene)) return;
        // A name asked for later in the game (some events do): the one offered.
        if (scene instanceof Scene_Name) { introStep(scene); return; }
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
        if (circleTrip && (!dead || dead.id !== BOT.errand.for)) { BOT.errand = null; log('the errand is over'); return; }
        if (circleTrip) { log('on the way to a circle for ' + BOT.errand.name); return; }
        // A test run's host has nobody to follow: it goes on into the dungeon.
        if (options.lead) { if (BOT.mode !== 'explore') { BOT.mode = 'explore'; BOT.explore = null; } return; }
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
        // In someone's party the line itself takes this partner through doors (party.js).
        if (Coop.partyLeader) { BOT.errand = null; log('walking in ' + who.name + "'s party"); return; }
        // Cut off and looking for a way: back to following once together, or to try again in a while.
        if (BOT.lost && (who.m === $gameMap.mapId() || Date.now() - BOT.lost > 45000)) { BOT.lost = 0; BOT.mode = 'follow'; BOT.explore = null; BOT.errand = null; }
        if (BOT.mode === 'explore') { log('exploring alone'); return; }
        const sameMap = who.m === $gameMap.mapId();
        if (sameMap) BOT.lastSeen = { id: who.id, m: who.m, x: who.x, y: who.y };
        const chase = BOT.errand && BOT.errand.kind === 'follow' ? BOT.errand : null;
        // Close by when they went through: after them at once, the way a
        // person does with F. Walking is for when it was too far off for that.
        if (!sameMap && walkedOut(who) && Coop.follow && Coop.follow()) { BOT.errand = null; log('went after ' + who.name + ' through the door'); return; }
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

    // They left by a way out of this map (a door, stairs, an edge), not carried
    // off by a scene (captured, a fall, a death): only then straight after them.
    function walkedOut(who) {
        const seen = BOT.lastSeen;
        if (!seen || seen.id !== who.id || seen.m !== $gameMap.mapId() || !window.$dataMap) return false;
        return Nav.exits($dataMap, seen.m).some((x) => x.to === who.m && Math.abs(x.x - seen.x) + Math.abs(x.y - seen.y) <= 2);
    }

    let lastMap = 0, partyAskedAt = 0;
    setInterval(function () {
        try {
            BOT.tick();
            joinFightNearby();
            // A test run's partner (options.party) walks in its leader's party once they stand together.
            if (options.party && !Coop.partyLeader && !Coop.dead && Coop.world.live && Date.now() - partyAskedAt > 3000 && SceneManager._scene instanceof Scene_Map && Coop.joinParty) {
                const who = leader();
                if (who && who.st !== 'dead' && who.m === $gameMap.mapId() && Coop.distanceTo(who) <= 3) { partyAskedAt = Date.now(); if (Coop.joinParty(who.id)) log('joined ' + who.name + "'s party"); }
            }
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
