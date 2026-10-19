//=============================================================================
// fh-coop: where everyone is. Sends this player's position and draws the
// other players as characters on the map.
//=============================================================================
(function () {
    //--- what state am I in -------------------------------------------------

    Coop.myState = function () {
        const scene = SceneManager._scene;
        if (!scene || !window.$gameMap || !Coop.world.live) return 'title';
        if (Coop.dead || scene instanceof Scene_Gameover) return 'dead';
        // A fight goes on with the window hidden (fixes.js keeps the game running).
        if (scene instanceof Scene_Battle) return 'battle';
        if (Coop.battle && Coop.battle.role === 'guest') return 'battle';
        // Otherwise a hidden window means nobody is looking; say so, so nobody waits on them.
        if (document.hidden && !navigator.webdriver) return 'away';
        if (scene instanceof Scene_Map) return $gameMap.isEventRunning() ? 'event' : 'map';
        return 'menu';
    };

    // INITIAL_MERCENARY / KNIGHT / DARKPRIEST / OUTLANDER: which protagonist
    // this player started as. The game hides that character's wandering
    // double from the player; here it must be hidden from everyone.
    const STARTED_AS = [661, 662, 663, 664];

    Coop.takenCharacters = function () {
        const taken = [];
        if (!Coop.world.live) return taken;
        for (const peer of Coop.others()) {
            if (peer.st && peer.st !== 'title' && peer.ini) for (const id of peer.ini) if (taken.indexOf(id) < 0) taken.push(id);
        }
        return taken;
    };

    // Only the choice of which page an event shows sees the other players'
    // characters as taken; the game's own "who am I" branches do not.
    const _meetsConditions = Game_Event.prototype.meetsConditions;
    Game_Event.prototype.meetsConditions = function (page) {
        const taken = Coop.takenCharacters();
        if (!taken.length) return _meetsConditions.call(this, page);
        const data = $gameSwitches._data;
        const before = taken.map((id) => data[id]);
        for (const id of taken) data[id] = true;
        try { return _meetsConditions.call(this, page); } finally {
            taken.forEach((id, i) => { data[id] = before[i]; });
        }
    };

    // The companions walking behind this player, as the others should see them.
    function followersNow() {
        const f = $gamePlayer.followers();
        if (!f.isVisible() || $gamePlayer.isTransparent()) return undefined;
        const out = f.visibleFollowers().filter((c) => c.characterName()).map((c) => [c.characterName(), c.characterIndex(), c.x, c.y, c.direction()]);
        return out.length ? out : undefined;
    }

    function snapshot() {
        const state = Coop.myState();
        if (state === 'title') return Coop.isBot ? { st: 'title', m: 0, bot: 1 } : { st: 'title', m: 0 };
        const leader = $gameParty.leader();
        const light = Coop.myLight ? Coop.myLight() : { lr: 0, lc: '' };
        return {
            lr: light.lr,
            lc: light.lc,
            st: state,
            m: $gameMap.mapId(),
            x: $gamePlayer.x,
            y: $gamePlayer.y,
            d: $gamePlayer.direction(),
            cn: $gamePlayer.characterName(),
            ci: $gamePlayer.characterIndex(),
            sp: $gamePlayer.realMoveSpeed(),
            tr: $gamePlayer.isTransparent() ? 1 : 0,
            hp: leader ? leader.hp : 0,
            mhp: leader ? leader.mhp : 0,
            an: leader ? leader.name() : '',
            ai: leader ? leader.actorId() : 0,
            ini: STARTED_AS.filter((id) => $gameSwitches.value(id)),
            ps: $gameParty.size(),
            br: Coop.battle ? (Coop.battle.role === 'guest' ? 'g' : 'o') : '',
            bot: Coop.isBot ? 1 : 0,
            act: Coop.isBot && Coop.botActivity ? String(Coop.botActivity()).slice(0, 40) : undefined,
            fl: followersNow() || 0, // 0, not left out: a field left out keeps its old value on the other side
        };
    }

    let lastSent = '';
    let lastTime = 0;
    let lastMapKey = '';
    Coop.reportPresence = function (force) {
        if (!Coop.connected) return;
        const snap = snapshot();
        const text = JSON.stringify(snap);
        const now = Date.now();
        if (!force && text === lastSent && now - lastTime < 2000) return;
        if (!force && now - lastTime < 40) return;
        lastSent = text;
        lastTime = now;
        snap.t = 'p';
        Coop.send(snap);
        // The relay tracks which map each player is on and who can simulate it.
        // A player reading dialogue has their map half-frozen, so only a
        // player walking around is asked to run the map for the others.
        const canOwn = snap.st === 'map';
        const mapKey = snap.m + ':' + canOwn;
        if (mapKey !== lastMapKey) {
            lastMapKey = mapKey;
            Coop.send({ t: 'map', mapId: snap.m, canOwn });
        }
    };

    Coop.on('online', function () { lastSent = ''; lastMapKey = ''; });
    // The frame loop stops in a hidden tab, so this one report is sent by hand.
    document.addEventListener('visibilitychange', function () { Coop.reportPresence(true); });
    Coop.on('join', function () { lastSent = ''; });

    const _updateMain = SceneManager.updateMain;
    SceneManager.updateMain = function () {
        _updateMain.call(this);
        Coop.reportPresence(false);
    };

    //--- the other players as map characters --------------------------------

    function Game_CoopAvatar() {
        this.initialize.apply(this, arguments);
    }
    Game_CoopAvatar.prototype = Object.create(Game_Character.prototype);
    Game_CoopAvatar.prototype.constructor = Game_CoopAvatar;
    window.Game_CoopAvatar = Game_CoopAvatar;

    Game_CoopAvatar.prototype.initialize = function (peerId) {
        Game_Character.prototype.initialize.call(this);
        this._peerId = peerId;
        this._placed = false;
        this._mapId = 0;
    };

    Game_CoopAvatar.prototype.peer = function () {
        return Coop.peers.get(this._peerId);
    };

    Game_CoopAvatar.prototype.sync = function (p) {
        if (this.characterName() !== p.cn || this.characterIndex() !== p.ci) this.setImage(p.cn || '', p.ci || 0);
        this.setMoveSpeed(p.sp || 4);
        this.setTransparent(!!p.tr);
        const far = Math.abs(p.x - this._x) + Math.abs(p.y - this._y) > 2;
        if (!this._placed || this._mapId !== p.m || far) {
            this.locate(p.x, p.y);
            this._placed = true;
            this._mapId = p.m;
        } else {
            this._x = p.x;
            this._y = p.y;
        }
        this.setDirection(p.d || 2);
        // Whoever walks behind them: placed the same way, a step behind.
        const fl = Array.isArray(p.fl) ? p.fl : [];
        this._trail = this._trail || [];
        this._trail.length = Math.min(this._trail.length, fl.length);
        fl.forEach((row, i) => {
            const t = this._trail[i] || (this._trail[i] = new Game_CoopAvatar(this._peerId));
            t.sync({ cn: row[0], ci: row[1], x: row[2], y: row[3], d: row[4], m: p.m, sp: p.sp, tr: p.tr });
        });
    };

    Game_CoopAvatar.prototype.trail = function () { return this._trail || []; };

    // Avatars never block and are never blocked; each player's own machine
    // decides where that player can walk.
    Game_CoopAvatar.prototype.isCollidedWithCharacters = function () { return false; };
    Game_CoopAvatar.prototype.isMapPassable = function () { return true; };

    Coop.avatars = new Map();

    Coop.avatarFor = function (id) {
        let a = Coop.avatars.get(id);
        if (!a) { a = new Game_CoopAvatar(id); Coop.avatars.set(id, a); }
        return a;
    };

    // Players standing on the map this machine is showing.
    // Asked many times a frame (once per map event), so the answer is kept
    // for the frame.
    let hereFrame = -1;
    let hereList = [];
    Coop.peersHere = function () {
        if (!window.$gameMap || !Coop.world.live) return [];
        if (hereFrame === Graphics.frameCount) return hereList;
        const mapId = $gameMap.mapId();
        hereList = Coop.others().filter((p) => p.m === mapId && p.st && p.st !== 'title' && p.st !== 'dead');
        hereFrame = Graphics.frameCount;
        return hereList;
    };
    function forgetHere() { hereFrame = -1; }

    Coop.on('p', function (msg) {
        const peer = Coop.peers.get(msg.from);
        if (!peer) return;
        const wasMap = peer.m;
        const was = { m: peer.m, x: peer.x, y: peer.y };
        const wasTaken = String(peer.ini) + peer.st;
        Object.assign(peer, msg);
        forgetHere();
        if (wasTaken !== String(peer.ini) + peer.st && window.$gameMap && Coop.world.live) {
            $gameMap.requestRefresh();
            if (msg.ini && msg.ini.length && $gameSwitches && msg.ini.some((id) => $gameSwitches.value(id)) && !peer._sameWarned) {
                peer._sameWarned = true;
                if (Coop.toast) Coop.toast(peer.name + ' is playing the same character as you. Fighting side by side needs two different characters.', 9000);
            }
        }
        peer._moved = true;
        if (msg.st === 'title') peer.m = 0;
        if (wasMap !== peer.m) {
            offerFollow(peer, was);
            Coop.emit('peermap', peer);
        }
    });

    Coop.on('leave', function (peer) {
        Coop.avatars.delete(peer.id);
        forgetHere();
        if (window.$gameMap && Coop.world.live) $gameMap.requestRefresh();
    });
    Coop.on('entered', forgetHere);

    //--- following a partner who just left ----------------------------------
    // Nobody is dragged anywhere: a trap, a hole in the floor or a teleport
    // takes only the player who stepped on it. But when a partner standing
    // close by vanishes to another map, the one left behind is offered a way
    // after them for a few seconds.

    const FOLLOW_RANGE = 8; // tiles
    const FOLLOW_FOR = 9000; // ms the offer stands
    let followOffer = null; // { id, until }

    const followBox = document.createElement('div');
    followBox.id = 'coop-follow';
    followBox.style.cssText = 'position:fixed;left:50%;bottom:16%;transform:translateX(-50%);z-index:57;pointer-events:none;display:none;'
        + 'font:17px Georgia,"Times New Roman",serif;padding:6px 16px;border:1px solid #b08a3c;background:rgba(14,9,8,0.85);color:#f2d28a;white-space:nowrap;';
    (document.body ? Promise.resolve() : new Promise((r) => window.addEventListener('DOMContentLoaded', r))).then(() => document.body.appendChild(followBox));

    function freeToFollow() {
        const scene = SceneManager._scene;
        return Coop.world.live && !Coop.dead && !Coop.battle && scene instanceof Scene_Map && scene.isActive() && !SceneManager.isSceneChanging()
            && !$gamePlayer.isTransferring() && !$gameMap.isEventRunning() && !$gameMessage.isBusy();
    }

    function followTarget() {
        if (!followOffer || Date.now() > followOffer.until) return null;
        const peer = Coop.peers.get(followOffer.id);
        if (!peer || !peer.m || peer.m === $gameMap.mapId() || (peer.st !== 'map' && peer.st !== 'event')) return null;
        return peer;
    }

    function offerFollow(peer, was) {
        if (!window.$gameMap || !Coop.world.live || Coop.dead) return;
        if (was.m !== $gameMap.mapId() || !peer.m || peer.m === was.m) return;
        if (Math.abs(was.x - $gamePlayer.x) + Math.abs(was.y - $gamePlayer.y) > FOLLOW_RANGE) return;
        followOffer = { id: peer.id, until: Date.now() + FOLLOW_FOR };
    }

    Coop.follow = function () {
        const peer = followTarget();
        if (!peer || !freeToFollow()) return false;
        followOffer = null;
        $gamePlayer.reserveTransfer(peer.m, peer.x, peer.y, peer.d || 2, 0);
        if (Coop.toast) Coop.toast('You go after ' + peer.name + '.', 2500);
        return true;
    };

    setInterval(function () {
        const peer = window.$gameMap && Coop.world.live ? followTarget() : null;
        if (!peer) { followOffer = followOffer && Date.now() <= followOffer.until && Coop.peers.has(followOffer.id) ? followOffer : null; followBox.style.display = 'none'; return; }
        const scale = Math.max(1, Math.min(2.4, (Graphics._realScale || 1) * 0.75));
        followBox.style.fontSize = Math.round(17 * scale) + 'px';
        followBox.textContent = peer.name + ' has gone on. Press F to follow (' + Math.ceil((followOffer.until - Date.now()) / 1000) + ')';
        followBox.style.display = freeToFollow() ? '' : 'none';
    }, 200);

    document.addEventListener('keydown', function (e) {
        if (e.code !== 'KeyF' || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
        if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
        if (followTarget()) Coop.follow();
    });

    // Say which kind of world this player has walked into: a save from
    // character creation carries no world of its own, so it joins whatever
    // run is under way.
    Coop.on('entered', function (msg) {
        if (!Coop.toast) return;
        if (Coop.world._resumeNote) {
            Coop.toast(Coop.world._resumeNote, 7000);
            Coop.world._resumeNote = '';
            return;
        }
        if (msg.mode === 'again') return; // a reconnect, not an arrival
        const names = Coop.others().filter((p) => p.st && p.st !== 'title').map((p) => p.name);
        const when = Coop.world.when;
        if (msg.founded && msg.newer) {
            const slot = Coop.world.slotsOf(msg.runId)[msg.newer];
            Coop.toast('The world is as it was at the save of ' + when(msg.stamp) + '.\nThis run was saved again after that, on ' + when(msg.newer)
                + (slot ? ' (your slot ' + slot + '). If that is the one you meant, go back to the title and load it now, before anyone joins you.'
                    : ', and you have no save from then. If a partner played on without you, let them load first.'), 16000);
        } else if (msg.founded && msg.stamp) Coop.toast('The world is as it was at the save of ' + when(msg.stamp) + '.', 5000);
        else if (msg.founded) Coop.toast('A new world begins.', 3500);
        else if (msg.behind) Coop.toast(msg.by + ' has carried this run on from a later save than any of yours (' + when(msg.stamp) + ').\nYou join as you were when you last saved; what happened since has happened.', 12000);
        else Coop.toast('You have joined a world already in progress' + (names.length ? ' with ' + names.join(' and ') : '') + '.\nWhat happened there before you arrived has happened.', 8000);
    });

    const _mapUpdate = Game_Map.prototype.update;
    Game_Map.prototype.update = function (sceneActive) {
        _mapUpdate.call(this, sceneActive);
        for (const peer of Coop.peersHere()) {
            const avatar = Coop.avatarFor(peer.id);
            if (peer._moved) { avatar.sync(peer); peer._moved = false; }
            avatar.update();
            for (const t of avatar.trail()) t.update();
        }
    };

    //--- drawing ------------------------------------------------------------

    function makeLabel(text) {
        const bitmap = new Bitmap(160, 22);
        bitmap.fontSize = 14;
        bitmap.outlineWidth = 3;
        bitmap.outlineColor = 'rgba(0, 0, 0, 0.9)';
        bitmap.textColor = '#d8c9a8';
        bitmap.drawText(text, 0, 0, 160, 22, 'center');
        const sprite = new Sprite(bitmap);
        sprite.anchor.x = 0.5;
        sprite.anchor.y = 1;
        return sprite;
    }

    const _createCharacters = Spriteset_Map.prototype.createCharacters;
    Spriteset_Map.prototype.createCharacters = function () {
        _createCharacters.call(this);
        this._coopSprites = new Map(); // peer id -> { sprite, label, text }
    };

    Spriteset_Map.prototype.updateCoopAvatars = function () {
        const here = new Map(Coop.peersHere().map((p) => [p.id, p]));
        for (const [id, entry] of this._coopSprites) {
            if (!here.has(id)) {
                this._tilemap.removeChild(entry.sprite);
                this._coopSprites.delete(id);
            }
        }
        this.updateCoopTrails(here);
        for (const [id, peer] of here) {
            let entry = this._coopSprites.get(id);
            if (!entry) {
                const sprite = new Sprite_Character(Coop.avatarFor(id));
                this._tilemap.addChild(sprite);
                entry = { sprite, label: null, text: '' };
                this._coopSprites.set(id, entry);
            }
            const text = peer.name + (peer.st === 'battle' ? ' (fighting)' : '');
            if (entry.text !== text) {
                if (entry.label) entry.sprite.removeChild(entry.label);
                entry.label = makeLabel(text);
                entry.sprite.addChild(entry.label);
                entry.text = text;
            }
            entry.label.y = -(entry.sprite.bitmap ? entry.sprite.patternHeight() || 48 : 48) - 2;
            entry.label.visible = !Coop.avatarFor(id).isTransparent();
        }
    };

    // Sprites for the companions behind each other player, added and dropped as they come and go.
    Spriteset_Map.prototype.updateCoopTrails = function (here) {
        this._coopTrail = this._coopTrail || new Map(); // character -> sprite
        const want = new Set();
        for (const id of here.keys()) for (const t of Coop.avatarFor(id).trail()) want.add(t);
        for (const [t, sprite] of this._coopTrail) {
            if (!want.has(t)) { this._tilemap.removeChild(sprite); this._coopTrail.delete(t); }
        }
        for (const t of want) {
            if (this._coopTrail.has(t)) continue;
            const sprite = new Sprite_Character(t);
            this._tilemap.addChild(sprite);
            this._coopTrail.set(t, sprite);
        }
    };

    const _spritesetUpdate = Spriteset_Map.prototype.update;
    Spriteset_Map.prototype.update = function () {
        _spritesetUpdate.call(this);
        if (this._coopSprites) this.updateCoopAvatars();
    };

    //--- helpers used by other modules --------------------------------------

    // The other player standing on, or directly in front of, this player.
    Coop.peerInReach = function () {
        const x = $gamePlayer.x, y = $gamePlayer.y, d = $gamePlayer.direction();
        const fx = $gameMap.roundXWithDirection(x, d), fy = $gameMap.roundYWithDirection(y, d);
        return Coop.peersHere().find((p) => (p.x === x && p.y === y) || (p.x === fx && p.y === fy)) || null;
    };

    Coop.distanceTo = function (peer) {
        return Math.abs(peer.x - $gamePlayer.x) + Math.abs(peer.y - $gamePlayer.y);
    };
})();
