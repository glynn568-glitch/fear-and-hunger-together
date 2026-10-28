//=============================================================================
// fh-coop: joining another player's party. Face them, press Enter, "Join
// their party": you fall in behind them, go where they go, and are in every
// fight they are in. Each player still steers only their own character's
// menu; nobody can touch another's gear. Hold a direction to step out of line.
//=============================================================================
(function () {
    const LEAVE_HOLD = 40; // frames a direction is held to step out of line
    const STUCK_SNAP = 45; // frames blocked before a member is put on their spot
    const FAR_SNAP = 12; // tiles behind before a member is put on their spot

    Coop.partyLeader = 0; // the player whose line this one walks in (0 = their own)

    function leaderPeer() {
        return Coop.partyLeader ? Coop.peers.get(Coop.partyLeader) : null;
    }

    function inWorld(peer) {
        return peer && peer.st && peer.st !== 'title' && peer.st !== 'dead';
    }

    // Who walks in this player's party, leader first, this player left out.
    Coop.partyMates = function () {
        const lead = Coop.partyLeader || Coop.id;
        const out = [];
        if (lead !== Coop.id && inWorld(Coop.peers.get(lead))) out.push(Coop.peers.get(lead));
        for (const p of Coop.others()) if (p.pl === lead && p.id !== lead && inWorld(p)) out.push(p);
        return out;
    };

    Coop.inMyParty = function (peerId) {
        return Coop.partyMates().some((p) => p.id === peerId);
    };

    // True on the leader when that party member's fight should wait for them.
    Coop.holdsPartyFight = function (peerId) {
        return !Coop.partyLeader && Coop.inMyParty(peerId);
    };

    function members(leadId) {
        return Coop.others().filter((p) => p.pl === leadId && inWorld(p)).map((p) => p.id).concat(Coop.partyLeader === leadId ? [Coop.id] : []).sort((a, b) => a - b);
    }

    function say(text, ms) { if (Coop.toast) Coop.toast(text, ms || 4000); }

    Coop.joinParty = function (peerId) {
        let peer = Coop.peers.get(peerId);
        // Joining someone who is in a line already joins that line.
        if (peer && peer.pl && Coop.peers.has(peer.pl)) peer = Coop.peers.get(peer.pl);
        if (!inWorld(peer) || peer.id === Coop.id || Coop.dead) return false;
        // Whoever walked behind this player now walks behind the new leader.
        for (const p of Coop.others()) if (p.pl === Coop.id) Coop.sendTo(p.id, 'partyto', { lead: peer.id });
        Coop.partyLeader = peer.id;
        resetTrail();
        Coop.reportPresence(true);
        say('You fall in behind ' + peer.name + '. Hold a direction to step out of line.', 6000);
        Coop.emit('party', { leader: peer.id });
        return true;
    };

    Coop.leaveParty = function (why) {
        if (!Coop.partyLeader) return;
        Coop.partyLeader = 0;
        held = 0;
        if (Coop.connected) Coop.reportPresence(true);
        if (why) say(why);
        Coop.emit('party', { leader: 0 });
    };

    Coop.sendOff = function (peerId) {
        Coop.sendTo(peerId, 'partyoff', {});
    };

    Coop.on('to:partyoff', function (msg) {
        if (Coop.partyLeader !== msg.from) return;
        const peer = Coop.peers.get(msg.from);
        Coop.leaveParty((peer ? peer.name : 'Your leader') + ' sends you off on your own.');
    });

    Coop.on('to:partyto', function (msg) {
        if (Coop.partyLeader !== msg.from) return;
        const lead = Coop.peers.get(msg.lead);
        if (lead && lead.id !== Coop.id) {
            Coop.partyLeader = lead.id;
            resetTrail();
            Coop.reportPresence(true);
            say('Your party now follows ' + lead.name + '.');
        } else Coop.leaveParty();
    });

    // A line has no leader once they are gone, dead or back at the title.
    function checkLeader() {
        if (!Coop.partyLeader) return;
        const peer = leaderPeer();
        if (!Coop.world.live || Coop.dead) Coop.leaveParty();
        else if (!peer) Coop.leaveParty('Your party leader is gone. You walk on your own.');
        else if (peer.st === 'dead') Coop.leaveParty(peer.name + ' has fallen. You walk on your own.');
        else if (peer.st === 'title') Coop.leaveParty(peer.name + ' has left the dungeon. You walk on your own.');
        else if (loops() && Coop.id === Math.min.apply(null, loops())) Coop.leaveParty(); // joined each other at once: one line, not none
    }
    // The ids around a loop of leaders this player is part of, or null.
    function loops() {
        const seen = [Coop.id];
        let at = Coop.partyLeader;
        while (at && seen.indexOf(at) < 0) {
            seen.push(at);
            const p = Coop.peers.get(at);
            at = p ? p.pl || 0 : 0;
        }
        return at === Coop.id ? seen : null;
    }
    setInterval(checkLeader, 250);
    // A new connection numbers everyone afresh.
    Coop.on('online', function () { Coop.partyLeader = 0; });

    // The leader hears who falls in and who leaves.
    Coop.on('p', function (msg) {
        const peer = Coop.peers.get(msg.from);
        if (!peer) return;
        const was = peer._plWas || 0;
        const now = peer.pl || 0;
        if (was === now) return;
        peer._plWas = now;
        if (now === Coop.id) say(peer.name + ' falls in behind you.');
        else if (was === Coop.id && peer.st !== 'dead' && peer.st !== 'title') say(peer.name + ' goes their own way.');
    });

    // Lines for the Enter menu facing a partner.
    Coop.partyChoices = function (peer) {
        const out = [];
        if (Coop.partyLeader && (peer.id === Coop.partyLeader || peer.pl === Coop.partyLeader)) out.push({ label: 'Leave the party', call: 'Coop.leaveParty("You step out of line.")' });
        else if (peer.pl === Coop.id) out.push({ label: 'Send them off', call: 'Coop.sendOff(' + peer.id + ')' });
        else if (!peer.bot) out.push({ label: 'Join their party', call: 'Coop.joinParty(' + peer.id + ')' });
        return out;
    };

    //--- walking in line ------------------------------------------------------
    // The leader's last tiles on this map, newest last. Each member heads for
    // the tile the leader stood on as many steps ago as their place in line.

    let trail = [];
    let trailMap = 0;
    let blocked = 0;
    let held = 0;
    let lastHop = 0;

    function resetTrail() { trail = []; trailMap = 0; blocked = 0; }

    Coop.on('p', function (msg) {
        if (!Coop.partyLeader || msg.from !== Coop.partyLeader) return;
        const peer = leaderPeer();
        if (!peer || !peer.m) return;
        if (peer.m !== trailMap) { trail = []; trailMap = peer.m; }
        const last = trail[trail.length - 1];
        if (last && last[0] === peer.x && last[1] === peer.y) return;
        // A jump of more than a step (a teleport on the same map) starts the line afresh.
        if (last && Math.abs(last[0] - peer.x) + Math.abs(last[1] - peer.y) > 2) trail = [];
        trail.push([peer.x, peer.y]);
        if (trail.length > 16) trail.shift();
    });

    function slotOf() {
        const i = members(Coop.partyLeader).indexOf(Coop.id);
        return i < 0 ? 1 : i + 1;
    }

    // client/rules.js Coop.hazardAt. A person's own walking is unchanged.
    function trapTile(x, y) {
        return typeof Coop.trapAt === 'function' && !!Coop.trapAt(x, y);
    }
    function aroundTrap(player, spot) {
        let best = null, bestD = 99;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const x = spot[0] + dx, y = spot[1] + dy;
            if (!window.$gameMap || !$gameMap.isValid(x, y) || trapTile(x, y)) continue;
            if (![2, 4, 6, 8].some((d) => $gameMap.isPassable(x, y, d))) continue;
            const dist = Math.abs(x - player.x) + Math.abs(y - player.y);
            if (dist < bestD) { bestD = dist; best = [x, y]; }
        }
        return best;
    }

    function freeToHop() {
        const scene = SceneManager._scene;
        return scene instanceof Scene_Map && scene.isActive() && !SceneManager.isSceneChanging() && !Coop.battle && !Coop.dead
            && !$gamePlayer.isTransferring() && !$gameMap.isEventRunning() && !$gameMessage.isBusy();
    }

    // The leader went to another map: so does the line, onto their tile.
    setInterval(function () {
        const peer = leaderPeer();
        if (!peer || !window.$gameMap || !Coop.world.live || !peer.m || peer.m === $gameMap.mapId()) return;
        if ((peer.st !== 'map' && peer.st !== 'event') || !freeToHop() || Date.now() - lastHop < 1500) return;
        lastHop = Date.now();
        resetTrail();
        Coop.transferTo(peer);
    }, 200);

    const _moveByInput = Game_Player.prototype.moveByInput;
    // One frame of walking in line; false when this player is not in a line
    // on the leader's map, and steers themselves. AI partners call it too.
    Coop.partyStep = function (player) {
        const peer = leaderPeer();
        if (!peer || peer.m !== $gameMap.mapId()) { held = 0; return false; }
        if (!player.canMove()) { held = 0; return true; }
        // Holding a direction steps out of line, there and then.
        if (Input.dir4 > 0 && !Coop.isBot) {
            if (++held >= LEAVE_HOLD) { Coop.leaveParty('You step out of line.'); return false; }
        } else held = 0;
        if (player.isMoving()) return true;
        const slot = slotOf();
        const gap = Math.abs(peer.x - player.x) + Math.abs(peer.y - player.y);
        if (gap <= slot) { blocked = 0; return true; }
        let spot = trail.length > slot ? trail[trail.length - 1 - slot] : [peer.x, peer.y];
        // The leader's trail runs through a trap. Step onto a tile beside it.
        // If the only way is the trap itself, wait (the partner says so, once).
        if (trapTile(spot[0], spot[1])) {
            const alt = aroundTrap(player, spot);
            if (!alt) { if (Coop.onTrap) Coop.onTrap(); return true; }
            spot = alt;
        }
        if (gap > FAR_SNAP || blocked > STUCK_SNAP) {
            if (trapTile(spot[0], spot[1])) { if (Coop.onTrap) Coop.onTrap(); return true; }
            player.locate(spot[0], spot[1]);
            blocked = 0;
            return true;
        }
        let d = player.findDirectionTo(spot[0], spot[1]);
        if (d > 0 && trapTile($gameMap.roundXWithDirection(player.x, d), $gameMap.roundYWithDirection(player.y, d))) {
            const cur = Math.abs(spot[0] - player.x) + Math.abs(spot[1] - player.y);
            d = [2, 4, 6, 8].find((dir) => {
                if (!player.canPass(player.x, player.y, dir)) return false;
                const nx = $gameMap.roundXWithDirection(player.x, dir), ny = $gameMap.roundYWithDirection(player.y, dir);
                return !trapTile(nx, ny) && Math.abs(spot[0] - nx) + Math.abs(spot[1] - ny) < cur;
            }) || 0;
            if (!d && Coop.onTrap) Coop.onTrap();
        }
        if (d > 0) player.executeMove(d);
        if (d <= 0 || !player.isMovementSucceeded()) blocked++; else blocked = 0;
        return true;
    };

    Game_Player.prototype.moveByInput = function () {
        if (!Coop.partyStep(this)) _moveByInput.call(this);
    };

    // In line, a member keeps the leader's pace.
    const _realMoveSpeed = Game_Player.prototype.realMoveSpeed;
    Game_Player.prototype.realMoveSpeed = function () {
        const peer = leaderPeer();
        if (peer && peer.m === $gameMap.mapId() && peer.sp) return Math.max(peer.sp, this._moveSpeed);
        return _realMoveSpeed.call(this);
    };

    //--- party mates in the menu lineup --------------------------------------
    // Drawn after this player's own characters, from what their machines
    // report. Equip opens on them to look, with every command shut: their
    // gear is theirs to change.

    const mates = new Map(); // player id -> [Game_Actor]

    function ghosts() {
        const out = [];
        for (const p of Coop.partyMates()) for (const a of mates.get(p.id) || []) out.push(a);
        return out.slice(0, Math.max(0, 4 - $gameParty.size()));
    }

    Coop.on('to:pactors?', function (msg) {
        if (!window.$gameParty || !Coop.world.live || !Coop.inMyParty(msg.from) || (Coop.battle && Coop.battle.role === 'guest')) return;
        Coop.sendTo(msg.from, 'pactors', { list: $gameParty.members().map((a) => JsonEx.stringify(a)) });
    });
    Coop.on('to:pactors', function (msg) {
        if (!Array.isArray(msg.list)) return;
        try { mates.set(msg.from, msg.list.map((j) => JsonEx.parse(j)).filter((a) => a instanceof Game_Actor)); } catch (e) { return; }
        refreshLineup();
    });
    function refreshLineup() {
        const scene = SceneManager._scene;
        if (!(scene instanceof Scene_Menu) || !scene._statusWindow) return;
        const w = scene._statusWindow;
        if (w.index() >= w.maxItems()) w.select(Math.max(0, w.maxItems() - 1));
        w.refresh();
    }
    Coop.on('party', refreshLineup);
    // A mate leaving the line (gone, dead, at the title) takes their row with them.
    let shown = -1;
    Coop.on('p', function () {
        if (!(SceneManager._scene instanceof Scene_Menu)) { shown = -1; return; }
        const n = ghosts().length;
        if (shown >= 0 && n !== shown) refreshLineup();
        shown = n;
    });
    Coop.on('leave', function (peer) { mates.delete(peer.id); });

    const _menuCreate = Scene_Menu.prototype.create;
    Scene_Menu.prototype.create = function () {
        _menuCreate.call(this);
        for (const p of Coop.partyMates()) Coop.sendTo(p.id, 'pactors?', {});
    };

    // The menu lineup lists party mates. The item menu's "who?" list does too,
    // so food, herbs, cloth and vials can be used on them. Skills, and a window
    // built on its own, stay this player's own party.
    function itemAim(win) { return win.constructor === Window_MenuActor && SceneManager._scene instanceof Scene_Item; }
    function lineup(win) { return win.constructor === Window_MenuStatus || itemAim(win); }
    function ghostAt(win, index) {
        if (!lineup(win) || index < $gameParty.size()) return null;
        return ghosts()[index - $gameParty.size()] || null;
    }

    const _maxItems = Window_MenuStatus.prototype.maxItems;
    Window_MenuStatus.prototype.maxItems = function () {
        return _maxItems.call(this) + (lineup(this) ? ghosts().length : 0);
    };

    // The drawing calls read $gameParty.members()[index]; for a party mate's
    // slot they are shown that character instead, for the length of the call.
    function withMembers(win, index, fn) {
        const ghost = ghostAt(win, index);
        if (!ghost) return fn();
        const list = $gameParty.members().slice();
        list[index] = ghost;
        const own = Object.getOwnPropertyDescriptor($gameParty, 'members');
        $gameParty.members = function () { return list; };
        try { return fn(); } finally {
            if (own) Object.defineProperty($gameParty, 'members', own); else delete $gameParty.members;
        }
    }
    for (const name of ['drawItemImage', 'drawItemStatus']) {
        const orig = Window_MenuStatus.prototype[name];
        Window_MenuStatus.prototype[name] = function (index) {
            return withMembers(this, index, () => orig.call(this, index));
        };
    }
    // A party mate's portrait was never preloaded; draw again once it is in.
    const _drawItemImage = Window_MenuStatus.prototype.drawItemImage;
    Window_MenuStatus.prototype.drawItemImage = function (index) {
        const ghost = ghostAt(this, index);
        if (ghost) {
            const bust = ImageManager.loadPicture(ghost.faceName() + '_' + (ghost.faceIndex() + 1));
            if (!bust.isReady()) bust.addLoadListener(() => { if (this.contents) this.refresh(); });
        }
        return _drawItemImage.call(this, index);
    };

    function personalSymbol() {
        const scene = SceneManager._scene;
        return scene instanceof Scene_Menu && scene._commandWindow ? scene._commandWindow.currentSymbol() : '';
    }

    const _isCurrentItemEnabled = Window_MenuStatus.prototype.isCurrentItemEnabled;
    Window_MenuStatus.prototype.isCurrentItemEnabled = function () {
        const ghost = ghostAt(this, this.index());
        if (ghost) {
            if (itemAim(this)) {
                const scene = SceneManager._scene;
                const item = scene.item && scene.item();
                const user = scene.user && scene.user();
                return !!(item && user && user.canUse(item));
            }
            return !this._formationMode && personalSymbol() === 'equip';
        }
        return _isCurrentItemEnabled.call(this);
    };

    function peerOf(actor) {
        for (const [id, list] of mates) if (list.indexOf(actor) >= 0) return id;
        return 0;
    }
    // Item -> a party mate. One use leaves this bag; the effect is worked out on their machine.
    function feedMate(scene, ghost) {
        const item = scene.item();
        const user = scene.user();
        const peerId = peerOf(ghost), peer = Coop.peers.get(peerId);
        // Only where their machine takes it (not in a fight, not dead), and on someone it can help.
        const action = user && item ? new Game_Action(user) : null;
        if (action) action.setItemObject(item);
        const takes = peer && ['map', 'event', 'menu'].includes(peer.st) && ghost.isAlive() && action && action.testApply(ghost);
        if (!takes || !user.canUse(item) || !Coop.castItem) { SoundManager.playBuzzer(); return; }
        user.useItem(item);
        Coop.castItem(peerId, item, user, ghost.actorId());
        scene.hideSubWindow(scene._actorWindow);
        if (scene._itemWindow) scene._itemWindow.redrawCurrentItem();
        scene.activateItemWindow();
    }
    const _onActorOk = Scene_ItemBase.prototype.onActorOk;
    Scene_ItemBase.prototype.onActorOk = function () {
        if (this instanceof Scene_Item && this._actorWindow) {
            const ghost = ghostAt(this._actorWindow, this._actorWindow.index());
            if (ghost) return feedMate(this, ghost);
        }
        _onActorOk.call(this);
    };
    // The engine's OK would aim the item at members()[index], which is nobody.
    const _actorProcessOk = Window_MenuActor.prototype.processOk;
    Window_MenuActor.prototype.processOk = function () {
        if (itemAim(this) && ghostAt(this, this.index())) return Window_Selectable.prototype.processOk.call(this);
        _actorProcessOk.call(this);
    };

    let viewing = null; // the party mate whose gear is being looked at
    const _processOk = Window_MenuStatus.prototype.processOk;
    Window_MenuStatus.prototype.processOk = function () {
        const ghost = ghostAt(this, this.index());
        if (!ghost && lineup(this) && this.index() >= $gameParty.size()) { this.select(Math.max(0, $gameParty.size() - 1)); this.refresh(); return; }
        if (!ghost) return _processOk.call(this);
        if (!this.isCurrentItemEnabled()) { this.playBuzzerSound(); return; }
        this.playOkSound();
        this.updateInputData();
        this.deactivate();
        viewing = ghost;
        SceneManager.push(Scene_Equip);
    };

    const _menuActor = Game_Party.prototype.menuActor;
    Game_Party.prototype.menuActor = function () {
        if (viewing && SceneManager._scene instanceof Scene_Equip) return viewing;
        return _menuActor.call(this);
    };
    const _equipTerminate = Scene_Equip.prototype.terminate;
    Scene_Equip.prototype.terminate = function () {
        _equipTerminate.call(this);
        viewing = null;
    };
    // Looking only: Equip, Optimize and Clear are all shut. Esc goes back.
    // Grey is isCommandEnabled. OK reads isCurrentItemEnabled, which still
    // says yes, and changeEquip then trades the viewer's bag onto a copy.
    function looking() { return !!(viewing && SceneManager._scene instanceof Scene_Equip); }
    const _isCommandEnabled = Window_EquipCommand.prototype.isCommandEnabled;
    Window_EquipCommand.prototype.isCommandEnabled = function (index) {
        if (looking()) return false;
        return _isCommandEnabled.call(this, index);
    };
    const _cmdOk = Window_EquipCommand.prototype.isCurrentItemEnabled;
    Window_EquipCommand.prototype.isCurrentItemEnabled = function () {
        if (looking()) return false;
        return _cmdOk.call(this);
    };
    const _slotOk = Window_EquipSlot.prototype.isCurrentItemEnabled;
    Window_EquipSlot.prototype.isCurrentItemEnabled = function () {
        if (looking()) return false;
        return _slotOk.call(this);
    };
    const _itemOk = Window_EquipItem.prototype.isCurrentItemEnabled;
    Window_EquipItem.prototype.isCurrentItemEnabled = function () {
        if (looking()) return false;
        return _itemOk.call(this);
    };
    // Optimize, Clear and a chosen item all go through changeEquip. The copy
    // is not this player's actor; trading would spend their bag on nobody.
    const _changeEquip = Game_Actor.prototype.changeEquip;
    Game_Actor.prototype.changeEquip = function (slotId, item) {
        if (this === viewing) return;
        _changeEquip.call(this, slotId, item);
    };
})();
