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
})();
