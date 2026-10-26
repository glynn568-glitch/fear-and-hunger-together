//=============================================================================
// fh-coop: handing something to the player standing next to you. Face them,
// press the action key, pick it from your bag. Items, keys, weapons and
// armour can all change hands; each player otherwise keeps their own bag.
//=============================================================================
(function () {
    // The engine's item picker reports its answer through a variable. This
    // one is never used by the game's own scripts; its value is put back.
    const PICK_VAR = 10;
    let pending = null; // { peerId, saved, picked }

    function giftable(item) {
        if (!item) return false;
        if (DataManager.isItem(item)) return item.itypeId === 1 || item.itypeId === 2;
        return DataManager.isWeapon(item) || DataManager.isArmor(item);
    }

    function kindOf(item) {
        return DataManager.isWeapon(item) ? 'weapon' : DataManager.isArmor(item) ? 'armor' : 'item';
    }

    function tableOf(kind) {
        return kind === 'weapon' ? $dataWeapons : kind === 'armor' ? $dataArmors : $dataItems;
    }

    // While a hand-over is open the picker lists the whole bag, not just the
    // one category the engine's "select item" command normally shows.
    const _includes = Window_EventItem.prototype.includes;
    Window_EventItem.prototype.includes = function (item) {
        if (!pending) return _includes.call(this, item);
        return pending.use ? usableOnOther(item) : giftable(item);
    };
    const _onOk = Window_EventItem.prototype.onOk;
    Window_EventItem.prototype.onOk = function () {
        if (pending) pending.picked = this.item();
        _onOk.call(this);
    };

    //--- using things on a partner -----------------------------------------
    // Outside a fight a partner is not in your party, so the menu cannot
    // reach them. Facing them, Enter offers it instead: an item used on them
    // (a bandage, a potion, food) or a skill cast on them (a healing prayer).
    // You pay the cost; the effect lands on their character, worked out with
    // your caster as they really are.

    const ALLY_SCOPES = [7, 8];
    function onOther(obj) {
        if (!obj || ALLY_SCOPES.indexOf(obj.scope) < 0 || (obj.occasion !== 0 && obj.occasion !== 2)) return false;
        const effects = obj.effects.some((e) => [11, 12, 13, 21, 22].indexOf(e.code) >= 0);
        return effects || obj.damage.type === 3 || obj.damage.type === 4;
    }
    function usableOnOther(item) {
        return DataManager.isItem(item) && onOther(item) && $gameParty.canUse(item);
    }
    // Every party member's skills that can be cast on someone else, here and now.
    function castable() {
        const out = [];
        for (const actor of $gameParty.members()) {
            for (const skill of actor.skills()) if (onOther(skill) && actor.canUse(skill)) out.push({ actor, skill });
        }
        return out.slice(0, 6);
    }

    let casting = null; // { peerId, options }

    Coop.offerGift = function (peer) {
        const canHand = $gameParty.allItems().some(giftable);
        const canUse = $gameParty.items().some(usableOnOther);
        const spells = castable();
        const party = Coop.partyChoices ? Coop.partyChoices(peer) : [];
        if (!canUse && !spells.length && !party.length) return canHand && handOver(peer);
        if (!canHand && !canUse && !spells.length && !party.length) return false;
        const choices = [];
        const calls = [];
        if (canHand) { choices.push('Hand them something'); calls.push('Coop.partnerChoice(' + peer.id + ', "hand")'); }
        if (canUse) { choices.push('Use an item on them'); calls.push('Coop.partnerChoice(' + peer.id + ', "use")'); }
        if (spells.length) { choices.push('Cast on them'); calls.push('Coop.partnerChoice(' + peer.id + ', "cast")'); }
        for (const o of party) { choices.push(o.label); calls.push(o.call); }
        choices.push('Never mind');
        $gameMap._interpreter.setup(choiceList(peer.name + '.', choices, calls), 0);
        return true;
    };

    // A message with a choice, as an ordinary event script so the game's
    // message plugins treat it like any other.
    function choiceList(text, choices, calls) {
        const list = [
            { code: 101, indent: 0, parameters: ['', 0, 0, 2] },
            { code: 401, indent: 0, parameters: [text] },
            { code: 102, indent: 0, parameters: [choices, choices.length - 1, 0, 2, 0] },
        ];
        choices.forEach(function (c, n) {
            list.push({ code: 402, indent: 0, parameters: [n, c] });
            if (calls[n]) list.push({ code: 355, indent: 1, parameters: [calls[n]] });
            list.push({ code: 0, indent: 1, parameters: [] });
        });
        list.push({ code: 404, indent: 0, parameters: [] });
        list.push({ code: 0, indent: 0, parameters: [] });
        return list;
    }

    // Runs inside the choice's script, so the next window is queued, not opened over it.
    Coop.partnerChoice = function (peerId, what) {
        const peer = Coop.peers.get(peerId);
        if (!peer) return;
        const until = Date.now() + 3000;
        const wait = setInterval(function () {
            if ($gameMap.isEventRunning() || $gameMessage.isBusy()) { if (Date.now() > until) clearInterval(wait); return; }
            clearInterval(wait);
            if (what === 'hand') handOver(peer);
            else if (what === 'use') pickToUse(peer);
            else if (what === 'cast') pickSpell(peer);
        }, 50);
    };

    function pickToUse(peer) {
        pending = { peerId: peer.id, saved: $gameVariables._data[PICK_VAR] || 0, picked: null, use: true };
        $gameVariables._data[PICK_VAR] = 0;
        $gameMap._interpreter.setup([
            { code: 101, indent: 0, parameters: ['', 0, 0, 2] },
            { code: 401, indent: 0, parameters: ['Use what on ' + peer.name + '?'] },
            { code: 104, indent: 0, parameters: [PICK_VAR, 1] },
            { code: 355, indent: 0, parameters: ['Coop.useChosen()'] },
            { code: 0, indent: 0, parameters: [] },
        ], 0);
    }

    function pickSpell(peer) {
        const spells = castable();
        if (!spells.length) return;
        casting = { peerId: peer.id, options: spells };
        const choices = spells.map((o) => (($gameParty.size() > 1 ? o.actor.name() + ': ' : '') + o.skill.name + (o.skill.mpCost ? ' (' + o.actor.skillMpCost(o.skill) + ' mind)' : '')));
        const calls = spells.map((o, n) => 'Coop.castChosen(' + n + ')');
        choices.push('Never mind');
        $gameMap._interpreter.setup(choiceList('Cast what on ' + peer.name + '?', choices, calls), 0);
    }

    // Someone standing in their own menu is still standing there: things can be handed to them.
    const REACHABLE = ['map', 'event', 'menu'];
    function inReach(peer) {
        return peer && REACHABLE.indexOf(peer.st) >= 0 && peer.m === $gameMap.mapId() && Coop.distanceTo(peer) <= 1;
    }

    // The caster as they are right now, for the partner's machine to work the effect out with.
    function sendCast(peer, kind, obj, caster, on) {
        Coop.sendTo(peer.id, 'cast', { kind, id: obj.id, caster: caster.actorId(), json: JsonEx.stringify(caster), on: on || 0 });
        if (Coop.parkSoon) Coop.parkSoon();
    }

    // The item is already out of the bag. The mate's machine applies it; this one does not.
    // on: which of their characters (a party mate's companion, from the menu); their leader if 0.
    Coop.castItem = function (peerId, item, caster, on) {
        const peer = typeof peerId === 'object' ? peerId : Coop.peers.get(peerId);
        if (!peer || !item || !caster) return false;
        sendCast(peer, 'item', item, caster, on);
        Coop.toast('You use ' + item.name + ' on ' + peer.name + '.');
        return true;
    };

    Coop.useChosen = function () {
        const p = pending;
        pending = null;
        if (!p) return;
        $gameVariables._data[PICK_VAR] = p.saved;
        const item = p.picked;
        const peer = Coop.peers.get(p.peerId);
        if (!item || !$gameParty.hasItem(item)) return;
        if (!inReach(peer)) { Coop.toast((peer ? peer.name : 'They') + ' is out of reach.'); return; }
        const user = $gameParty.leader();
        $gameParty.consumeItem(item);
        Coop.castItem(peer, item, user);
    };

    Coop.castChosen = function (n) {
        const c = casting;
        casting = null;
        const o = c && c.options[n];
        const peer = c && Coop.peers.get(c.peerId);
        if (!o || !o.actor.canUse(o.skill)) return;
        if (!inReach(peer)) { Coop.toast((peer ? peer.name : 'They') + ' is out of reach.'); return; }
        o.actor.paySkillCost(o.skill);
        sendCast(peer, 'skill', o.skill, o.actor);
        Coop.toast(o.actor.name() + ' casts ' + o.skill.name + ' on ' + peer.name + '.');
    };

    // The receiving end: the effect lands on this player's own character.
    Coop.on('to:cast', function (msg) {
        const from = Coop.peers.get(msg.from);
        const target = window.$gameParty && (($gameParty.members().find((a) => a.actorId() === msg.on)) || $gameParty.leader());
        const obj = msg.kind === 'skill' ? $dataSkills[msg.id] : $dataItems[msg.id];
        if (!from || !obj) return;
        if (!target || !Coop.world.live || Coop.dead || Coop.battle || !target.isAlive()) {
            // Their fight or death beat the item here: it goes back to the one who used it.
            if (msg.kind === 'item') Coop.sendTo(msg.from, 'give', { kind: kindOf(obj), id: obj.id, returned: true });
            return;
        }
        // The caster stands in for a moment under their own id, as they are on their own machine.
        const id = Number(msg.caster);
        const mine = $gameParty._actors.indexOf(id) >= 0;
        const prior = $gameActors._data[id];
        if (!mine) $gameActors._data[id] = JsonEx.parse(msg.json);
        try {
            const action = new Game_Action($gameActors.actor(id));
            if (msg.kind === 'skill') action.setSkill(obj.id); else action.setItem(obj.id);
            const hp = target.hp, mp = target.mp;
            for (let i = 0; i < action.numRepeats(); i++) action.apply(target);
            action.applyGlobal();
            const healed = target.hp - hp, mind = target.mp - mp;
            Coop.toast(from.name + ' uses ' + obj.name + ' on you.' + (healed > 0 ? ' (+' + healed + ' health)' : '') + (mind > 0 ? ' (+' + mind + ' mind)' : ''), 5000);
            SoundManager.playRecovery();
        } finally {
            if (!mine) { if (prior === undefined) delete $gameActors._data[id]; else $gameActors._data[id] = prior; }
        }
        if (Coop.parkSoon) Coop.parkSoon();
        Coop.emit('castonme', { from: from.name, what: obj.name });
    });

    function handOver(peer) {
        if (!$gameParty.allItems().some(giftable)) return false;
        pending = { peerId: peer.id, saved: $gameVariables._data[PICK_VAR] || 0, picked: null };
        $gameVariables._data[PICK_VAR] = 0;
        $gameMap._interpreter.setup([
            { code: 101, indent: 0, parameters: ['', 0, 0, 2] },
            { code: 401, indent: 0, parameters: ['Hand what to ' + peer.name + '?'] },
            { code: 104, indent: 0, parameters: [PICK_VAR, 1] },
            { code: 355, indent: 0, parameters: ['Coop.giftChosen()'] },
            { code: 0, indent: 0, parameters: [] },
        ], 0);
        return true;
    }

    Coop.giftChosen = function () {
        const p = pending;
        pending = null;
        if (!p) return;
        $gameVariables._data[PICK_VAR] = p.saved;
        const item = p.picked;
        const peer = Coop.peers.get(p.peerId);
        if (!item || !$gameParty.hasItem(item)) return;
        // They may have walked off, or into a fight, while the list was open.
        if (!inReach(peer)) {
            Coop.toast((peer ? peer.name : 'They') + ' is out of reach.');
            return;
        }
        $gameParty.loseItem(item, 1);
        if (Coop.parkSoon) Coop.parkSoon();
        Coop.sendTo(peer.id, 'give', { kind: kindOf(item), id: item.id });
        Coop.toast('You hand ' + item.name + ' to ' + peer.name + '.');
    };

    Coop.on('to:give', function (msg) {
        if (!window.$dataItems) return;
        const table = tableOf(msg.kind);
        const item = table && table[msg.id];
        const peer = Coop.peers.get(msg.from);
        if (!item || !peer) return;
        if (!msg.returned && (!Coop.world.live || !(window.$gameParty && $gameParty.exists()) || Coop.dead || (Coop.battle && Coop.battle.role === 'guest'))) {
            // This bag is out of reach right now (lent to a fight, or its
            // owner is dead); the thing goes back to the giver.
            Coop.sendTo(msg.from, 'give', { kind: msg.kind, id: msg.id, returned: true });
            return;
        }
        if (!window.$gameParty) return;
        $gameParty.gainItem(item, 1);
        if (Coop.parkSoon) Coop.parkSoon();
        SoundManager.playUseItem();
        Coop.toast(msg.returned ? peer.name + ' could not take ' + item.name + ' just now.' : peer.name + ' hands you ' + item.name + '.');
    });
})();
