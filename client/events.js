//=============================================================================
// fh-coop: wandering events (enemies, NPCs). One player on each map lets them
// roam; everyone else shows them where that player says they are.
//=============================================================================
(function () {
    const Ev = Coop.events = {
        owners: {}, // mapId -> player id simulating that map
        holds: new Map(), // 'mapId:eventId' -> { by, k: 'talk' | 'battle' }
        _known: new Map(), // eventId -> 'x,y,d' last sent or received on this map
        _mapId: 0,
        _touch: new Set(), // puppet events that moved and may have reached the player
        _swapped: false,
        _remote: false,
    };

    Coop.on('owner', function (msg) {
        Ev.owners[msg.mapId] = msg.id;
    });

    Ev.sharedMap = function () {
        // A partner whose copy of this map differs has other events on it: not shared with them.
        return Coop.world.live && Coop.peersHere().length > 0 && !Coop.peersHere().some((p) => Coop.mapDiffersWith(p, $gameMap.mapId()));
    };

    // True when this machine decides where the map's events wander.
    Ev.amOwner = function () {
        if (!Ev.sharedMap()) return true;
        const owner = Ev.owners[$gameMap.mapId()];
        return !owner || owner === Coop.id || !Coop.peers.has(owner);
    };

    Ev.holdOf = function (eventId) {
        return Ev.holds.get($gameMap.mapId() + ':' + eventId) || null;
    };

    //--- who the event goes after -------------------------------------------

    function eligible(peer) {
        return peer.st === 'map' || peer.st === 'event';
    }

    // The nearest other player if they are closer than the local one.
    function remoteTarget(ev) {
        let best = null;
        let bestDist = Math.abs(ev.x - $gamePlayer.x) + Math.abs(ev.y - $gamePlayer.y);
        for (const peer of Coop.peersHere()) {
            if (!eligible(peer)) continue;
            const d = Math.abs(ev.x - peer.x) + Math.abs(ev.y - peer.y);
            if (d < bestDist) { best = peer; bestDist = d; }
        }
        return best;
    }

    // Run fn with the player's tile swapped for the target's, so the chase
    // plugin and the engine's "toward player" moves aim at them instead.
    function aimedAt(peer, fn) {
        const px = $gamePlayer._x, py = $gamePlayer._y;
        $gamePlayer._x = peer.x;
        $gamePlayer._y = peer.y;
        Ev._swapped = true;
        try { return fn(); } finally {
            $gamePlayer._x = px;
            $gamePlayer._y = py;
            Ev._swapped = false;
        }
    }

    const _checkEventTriggerTouch = Game_Event.prototype.checkEventTriggerTouch;
    const _updateSelfMovement = Game_Event.prototype.updateSelfMovement;
    Game_Event.prototype.updateSelfMovement = function () {
        if (!Coop.world.live) return _updateSelfMovement.call(this);
        if (Ev.holdOf(this._eventId)) return;
        if (!Ev.amOwner()) return;
        const target = Ev.sharedMap() ? remoteTarget(this) : null;
        if (!target) { _updateSelfMovement.call(this); return; }
        aimedAt(target, () => _updateSelfMovement.call(this));
        // On its way to them it may have walked into this player instead.
        if (this._trigger === 2 && !this.isMoving()) {
            const fx = $gameMap.roundXWithDirection(this.x, this.direction());
            const fy = $gameMap.roundYWithDirection(this.y, this.direction());
            if ($gamePlayer.pos(this.x, this.y) || $gamePlayer.pos(fx, fy)) _checkEventTriggerTouch.call(this, $gamePlayer.x, $gamePlayer.y);
        }
    };

    // The engine only moves events near the local camera. The owner has to
    // keep events near the other players moving too.
    const _isNearTheScreen = Game_Event.prototype.isNearTheScreen;
    Game_Event.prototype.isNearTheScreen = function () {
        if (_isNearTheScreen.call(this)) return true;
        if (!Coop.world.live) return false;
        for (const peer of Coop.peersHere()) {
            if (Math.abs(this.x - peer.x) <= 13 && Math.abs(this.y - peer.y) <= 10) return true;
        }
        return false;
    };

    Game_Event.prototype.checkEventTriggerTouch = function (x, y) {
        if (Ev._swapped) return; // it reached the other player, not this one
        _checkEventTriggerTouch.call(this, x, y);
    };

    //--- holds: an event someone is talking to or fighting ------------------

    function sendHold(eventId, kind) {
        if (!Coop.world.live) return;
        Coop.send({ t: 'evh', m: $gameMap.mapId(), e: eventId, k: kind });
    }
    Ev.sendHold = sendHold;

    const _lock = Game_Event.prototype.lock;
    Game_Event.prototype.lock = function () {
        const was = this._locked;
        _lock.call(this);
        if (!was && this._locked) sendHold(this._eventId, 'talk');
    };

    const _unlock = Game_Event.prototype.unlock;
    Game_Event.prototype.unlock = function () {
        const was = this._locked;
        _unlock.call(this);
        if (was && !this._locked) sendHold(this._eventId, null);
    };

    Coop.on('evh', function (msg) {
        if (Coop.mapDiffersWith(Coop.peers.get(msg.from), msg.m)) return;
        const key = msg.m + ':' + msg.e;
        if (msg.k === 'battle') Coop.note((Coop.peers.get(msg.from) || {}).name + ' is fighting event ' + msg.e + ' on map ' + msg.m);
        if (msg.k) Ev.holds.set(key, { by: msg.from, k: msg.k });
        else if (Ev.holds.has(key) && Ev.holds.get(key).by === msg.from) Ev.holds.delete(key);
    });

    function dropHoldsOf(peerId) {
        for (const [key, hold] of Ev.holds) if (hold.by === peerId) Ev.holds.delete(key);
    }
    Coop.on('leave', function (peer) { dropHoldsOf(peer.id); });
    Coop.on('peermap', function (peer) { dropHoldsOf(peer.id); });

    // An enemy another player is already fighting cannot start a second,
    // separate fight. Touching it asks to join theirs.
    const _start = Game_Event.prototype.start;
    Game_Event.prototype.start = function () {
        const hold = Coop.world.live ? Ev.holdOf(this._eventId) : null;
        if (hold && hold.k === 'battle' && Coop.peers.has(hold.by)) {
            if (Coop.askToJoinBattle) Coop.askToJoinBattle(hold.by);
            return;
        }
        _start.call(this);
    };

    //--- positions ----------------------------------------------------------

    function stamp(ev) {
        return ev._x + ',' + ev._y + ',' + ev._direction;
    }

    function resetKnown() {
        Ev._known.clear();
        Ev._touch.clear();
        Ev._mapId = $gameMap.mapId();
        for (const ev of $gameMap.events()) Ev._known.set(ev._eventId, stamp(ev));
        const arrival = Ev._arrival;
        Ev._arrival = null;
        if (arrival && arrival.m === Ev._mapId) for (const row of arrival.e) applyMove(row, true);
    }

    // Someone arrived: the owner tells them where everything stands.
    Coop.on('peermap', function (peer) {
        if (!window.$gameMap || !Coop.world.live || peer.m !== $gameMap.mapId()) return;
        if (!Ev.amOwner()) return;
        const all = $gameMap.events().map((ev) => [ev._eventId, ev._x, ev._y, ev._direction, ev._moveSpeed, ev._erased ? 1 : 0]);
        Coop.sendTo(peer.id, 'evall', { m: $gameMap.mapId(), e: all });
    });

    function applyMove(row, snap) {
        const ev = $gameMap.event(row[0]);
        if (!ev) return;
        const [, x, y, d, speed, erased] = row;
        if (ev._locked || ev._starting) { // this player is using it; catch up after
            return;
        }
        if (erased && !ev._erased) { ev._erased = true; ev.refresh(); }
        const far = Math.abs(x - ev._x) + Math.abs(y - ev._y) > 2;
        if (snap || far) {
            if (ev._x !== x || ev._y !== y) { ev.setPosition(x, y); ev.refreshBushDepth(); }
        } else {
            ev._x = x;
            ev._y = y;
        }
        if (speed) ev._moveSpeed = speed;
        if (d && !ev.isDirectionFixed()) ev._direction = d;
        Ev._known.set(ev._eventId, stamp(ev));
        if (ev._trigger === 2) Ev._touch.add(ev._eventId);
    }

    Coop.on('ev', function (msg) {
        if (!window.$gameMap || !Coop.world.live || msg.m !== $gameMap.mapId() || msg.m !== Ev._mapId) return;
        if (Coop.mapDiffersWith(Coop.peers.get(msg.from), msg.m)) return;
        for (const row of msg.e) applyMove(row, false);
    });

    // The owner's full picture can land before this machine has run the new
    // map for a single frame; it is kept and applied on that first frame.
    Coop.on('to:evall', function (msg) {
        if (!window.$gameMap || Coop.mapDiffersWith(Coop.peers.get(msg.from), msg.m)) return;
        if (msg.m === Ev._mapId && msg.m === $gameMap.mapId()) for (const row of msg.e) applyMove(row, true);
        else Ev._arrival = msg;
    });

    Coop.on('eve', function (msg) {
        if (!window.$gameMap || !Coop.world.live || msg.m !== $gameMap.mapId()) return;
        if (Coop.mapDiffersWith(Coop.peers.get(msg.from), msg.m)) return;
        const ev = $gameMap.event(msg.e);
        if (ev && !ev._erased) { ev._erased = true; ev.refresh(); }
    });

    const _erase = Game_Event.prototype.erase;
    Game_Event.prototype.erase = function () {
        const was = this._erased;
        _erase.call(this);
        if (!was && Coop.world.live) Coop.send({ t: 'eve', m: $gameMap.mapId(), e: this._eventId });
    };

    // A followed event that ends up on, or facing, this player touches them
    // exactly as it would have if this machine had moved it.
    function checkTouches() {
        if ($gameMap.isEventRunning() || $gamePlayer.isTransferring()) return;
        for (const id of Ev._touch) {
            const ev = $gameMap.event(id);
            if (!ev || ev._erased || ev._trigger !== 2 || ev.isMoving()) continue;
            Ev._touch.delete(id);
            const fx = $gameMap.roundXWithDirection(ev.x, ev.direction());
            const fy = $gameMap.roundYWithDirection(ev.y, ev.direction());
            if ($gamePlayer.pos(ev.x, ev.y) || $gamePlayer.pos(fx, fy)) {
                _checkEventTriggerTouch.call(ev, $gamePlayer.x, $gamePlayer.y);
                if (ev.isStarting()) return;
            }
        }
    }

    function broadcastMoves() {
        const owner = Ev.amOwner();
        const out = [];
        for (const ev of $gameMap.events()) {
            const now = stamp(ev);
            const before = Ev._known.get(ev._eventId);
            if (now === before) continue;
            Ev._known.set(ev._eventId, now);
            // Followers only report real moves (a cutscene walked the event);
            // which way it faces is the owner's call.
            if (!owner && before && before.slice(0, before.lastIndexOf(',')) === now.slice(0, now.lastIndexOf(','))) continue;
            out.push([ev._eventId, ev._x, ev._y, ev._direction, ev._moveSpeed, ev._erased ? 1 : 0]);
        }
        if (out.length) Coop.send({ t: 'ev', m: $gameMap.mapId(), e: out });
    }

    const _mapUpdate = Game_Map.prototype.update;
    Game_Map.prototype.update = function (sceneActive) {
        _mapUpdate.call(this, sceneActive);
        if (!Coop.world.live) return;
        if (Ev._mapId !== this.mapId()) resetKnown();
        if (!Ev.sharedMap()) {
            // Alone here: just keep the record current so nothing is "new" later.
            if (Graphics.frameCount % 30 === 0) for (const ev of this.events()) Ev._known.set(ev._eventId, stamp(ev));
            return;
        }
        broadcastMoves();
        if (sceneActive && !Ev.amOwner()) checkTouches();
    };

    const _setup = Game_Map.prototype.setup;
    Game_Map.prototype.setup = function (mapId) {
        _setup.call(this, mapId);
        Ev._mapId = 0; // forces a fresh record on the first update
        Ev._touch.clear();
    };
})();
