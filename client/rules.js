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
})();
