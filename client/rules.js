//=============================================================================
// fh-coop: rules that keep the game's balance with more than one player.
//
// The game is built around one party of at most four. Food, fights and the
// limb system are all tuned for that. So the limit stays four, counted across
// every player in the world: two players alone leave room for two recruits
// between them, whoever takes them.
//=============================================================================
(function () {
    const PARTY_SIZE = 34; // the game's own head count, refreshed before each recruit
    const FULL = 4;

    // Everyone else's party members, living or dead players alike.
    Coop.othersPartySize = function () {
        let n = 0;
        for (const peer of Coop.others()) if (peer.st && peer.st !== 'title') n += peer.ps || 0;
        return n;
    };

    // The game asks "is the party full?" by comparing that count with 4 (or 5)
    // right before adding someone. Only those questions see the whole world's
    // count. Its "are you alone?" checks, and everything inside a battle, keep
    // seeing this player's own party.
    const _command111 = Game_Interpreter.prototype.command111;
    Game_Interpreter.prototype.command111 = function () {
        const p = this._params;
        if (p[0] !== 1 || p[1] !== PARTY_SIZE || p[2] !== 0 || p[3] < FULL || !Coop.world.live || $gameParty.inBattle()) {
            return _command111.call(this);
        }
        const others = Coop.othersPartySize();
        if (!others) return _command111.call(this);
        const data = $gameVariables._data;
        const own = data[PARTY_SIZE] || 0;
        data[PARTY_SIZE] = own + others;
        try { return _command111.call(this); } finally { data[PARTY_SIZE] = own; }
    };

    // Hunger. The game keeps it as experience points and drains it in one
    // parallel event per character (HUNGER_of_*, common events 124-137):
    // wait 800 frames (400 with parasites), take a point, then set the hunger
    // stage. Co-op has no pause: the clock runs while people wait for each
    // other or chat. So while two or more people are in the world, that wait
    // counts down slower. Only the wait:
    // each pass still takes exactly one point, so the stage messages come
    // once each, and eating is the game's own.
    const TOGETHER_HUNGER_RATE = 0.8; // of the base game's drain: slightly slower, his call 10/20
    let drains = null;
    function isHungerDrain(list) {
        if (!drains) {
            if (!window.$dataCommonEvents) return false;
            drains = new Set($dataCommonEvents.filter((e) => e && /^HUNGER_of_/.test(e.name)).map((e) => e.list));
        }
        return drains.has(list);
    }
    // People, not AI partners: alone with one the game runs at its own pace,
    // and the partner keeps the pace of the people it plays with.
    Coop.playingTogether = function () {
        if (!Coop.world.live) return false;
        let people = Coop.isBot ? 0 : 1;
        for (const peer of Coop.peers.values()) if (!peer.bot && peer.st && peer.st !== 'title') people++;
        return people >= 2;
    };
    const _updateWaitCount = Game_Interpreter.prototype.updateWaitCount;
    Game_Interpreter.prototype.updateWaitCount = function () {
        if (this._waitCount > 0 && isHungerDrain(this._list) && Coop.playingTogether()) {
            this._waitCount -= TOGETHER_HUNGER_RATE;
            return true;
        }
        return _updateWaitCount.call(this);
    };

    // Tiles that hurt whoever stands on them, read from the events themselves, so a walk the
    // game does for someone (a party line, the AI partner) steps around them:
    //   - stepped on: an event that starts on touch and itself wounds or takes real health
    //     (the nail boards);
    //   - watched: a parallel event that compares the player's tile with a character's and hurts
    //     on a match (the arrow traps watch a plate event; bear and spike traps watch their own).
    // Enemies walk and are fought; only standing things count.
    // A nibble (a few health a step, as the swarming floor on level 7) is crossed when the way
    // leads over it; a wound (a state: bleeding, infection) or a real blow never is.
    function hurts(list) {
        return list.some((c) => (c.code === 313 && c.parameters[2] === 0)
            || (c.code === 311 && c.parameters[2] === 1 && !(c.parameters[3] === 0 && c.parameters[4] <= 5)));
    }
    function standing(ev, page) {
        const name = page.image.characterName || '';
        return page.moveType === 0 && (!name || /^[!$]/.test(name) || page.image.tileId > 0);
    }
    // Floor traps (laid bear traps, spike traps) are parallel events drawn underfoot that hurt
    // through switches, so they are known by their look. A sprung one has self switch A, or a
    // page with nothing on it.
    function armedTrap(ev, page) {
        const graphic = (page.image && page.image.characterName) || ev.characterName() || '';
        if (!/beartrap|spike_trap/i.test(graphic)) return false;
        const cond = page.conditions || {};
        if (cond.selfSwitchValid && cond.selfSwitchCh === 'A') return false;
        return (page.list || []).some((c) => c && c.code);
    }
    let hazards = null, hazardsAt = 0, hazardsMap = 0;
    function hazardTiles() {
        if (hazards && hazardsMap === $gameMap.mapId() && performance.now() - hazardsAt < 300) return hazards;
        hazards = new Set(); hazardsAt = performance.now(); hazardsMap = $gameMap.mapId();
        for (const ev of $gameMap.events()) {
            const page = !ev._erased && ev.page();
            if (page && armedTrap(ev, page)) { hazards.add(ev.x + ',' + ev.y); continue; }
            if (!page || !page.list || !hurts(page.list)) continue;
            if ((page.trigger === 1 || page.trigger === 2) && standing(ev, page)) { hazards.add(ev.x + ',' + ev.y); continue; }
            if (page.trigger !== 4) continue;
            for (const c of page.list) {
                const p = c.parameters;
                // Control variables <- a character's map X/Y (game data, type 5); -1 is the player.
                if (c.code !== 122 || p[3] !== 3 || p[4] !== 5 || p[5] < 0) continue;
                const who = p[5] === 0 ? ev : $gameMap.event(p[5]);
                if (who) hazards.add(who.x + ',' + who.y);
            }
        }
        return hazards;
    }
    // Laying a bear trap moves its event; a page turning changes what an event does.
    const _locate = Game_Event.prototype.locate;
    Game_Event.prototype.locate = function () { hazards = null; return _locate.apply(this, arguments); };
    const _refresh = Game_Event.prototype.refresh;
    Game_Event.prototype.refresh = function () { hazards = null; return _refresh.apply(this, arguments); };
    Coop.hazardAt = function (x, y) {
        return !!(window.$gameMap && $dataMap && hazardTiles().has(x + ',' + y));
    };
    if (!Coop.trapAt) Coop.trapAt = Coop.hazardAt;
})();
