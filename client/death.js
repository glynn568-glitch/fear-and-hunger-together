//=============================================================================
// fh-coop: dying. While another player is still alive, death is not the end:
// the dead player watches them, and can be called back at a ritual circle.
// Calling someone back spends the circle. Nobody left alive ends the run.
//=============================================================================
(function () {
    // Each ritual circle and the switch the game turns on once it is used up.
    const EXHAUSTED = [409, 476, 486, 2046, 2445];

    // Per protagonist: the game's "killed" and "body lies here" switches.
    const KILLED_FLAGS = { 1: [274, 281], 3: [275, 282], 4: [276, 283], 5: [277, 284] };
    const HUNGRY_BUT_ALIVE = 100; // "weak from hunger" starts at 108, "ill" at 88

    Coop.dead = false;
    let realGameover = false;

    function living() {
        return Coop.others().filter((p) => p.st && p.st !== 'title' && p.st !== 'dead');
    }
    Coop.livingPeers = living;

    function deadPeers() {
        return Coop.others().filter((p) => p.st === 'dead');
    }

    //--- intercepting the game over -----------------------------------------

    const _goto = SceneManager.goto;
    SceneManager.goto = function (sceneClass) {
        if (sceneClass === Scene_Gameover && Coop.world.live && !realGameover && !Coop.dead && living().length > 0) {
            Coop.dead = true;
            Coop.reportPresence(true);
            _goto.call(this, Scene_CoopDead);
            return;
        }
        _goto.call(this, sceneClass);
    };

    // Dead when the game was saved: loading it brings them back dead, to
    // wait for whoever loads the same save alive.
    Coop.returnDead = function () {
        Coop.dead = true;
        Coop.reportPresence(true);
        _goto.call(SceneManager, Scene_CoopDead);
    };

    const _extract = DataManager.extractSaveContents;
    DataManager.extractSaveContents = function (contents) {
        // A loaded game is as dead or alive as it was saved, whatever came before it.
        Coop.dead = false;
        Coop.deadFromSave = !!(contents.coop && contents.coop.dead);
        Coop.afterSpectate = null;
        _extract.call(this, contents);
        if (!Coop.deadFromSave) return;
        // Whatever killed them was mid-script; none of it resumes.
        $gameMap._interpreter.clear();
        $gameTemp.clearCommonEvent();
        $gameMessage.clear();
        $gameScreen.clear();
        $gameTimer.stop();
        Coop.afterSpectate = Coop.returnDead;
    };

    function endTheRun() {
        realGameover = true;
        Coop.dead = false;
        SceneManager.goto(Scene_Gameover);
        realGameover = false;
    }

    //--- the scene the dead sit in ------------------------------------------

    function Scene_CoopDead() { this.initialize.apply(this, arguments); }
    Scene_CoopDead.prototype = Object.create(Scene_Base.prototype);
    Scene_CoopDead.prototype.constructor = Scene_CoopDead;
    window.Scene_CoopDead = Scene_CoopDead;

    Scene_CoopDead.prototype.create = function () {
        Scene_Base.prototype.create.call(this);
        this._watching = 0;
        this._alone = 0;
    };

    Scene_CoopDead.prototype.start = function () {
        Scene_Base.prototype.start.call(this);
        AudioManager.fadeOutBgm(2);
        AudioManager.fadeOutBgs(2);
        this.startFadeIn(60, false);
    };

    Scene_CoopDead.prototype.watch = function (peer) {
        if (this._watching === peer.id) return;
        if (this._watching) Coop.sendTo(this._watching, 'watch', { on: false });
        this._watching = peer.id;
        Coop.viewer.show(peer.id);
        Coop.sendTo(peer.id, 'watch', { on: true });
        banner.textContent = 'You are dead. ' + peer.name + ' can call you back at a ritual circle. Hold Esc to give this character up: what you carry passes to them, and you can start another.';
        banner.style.display = '';
    };

    Scene_CoopDead.prototype.update = function () {
        Scene_Base.prototype.update.call(this);
        if (!Coop.dead) return; // being revived; the scene is on its way out
        if (!Coop.connected) {
            // Cut off, not abandoned: wait for the line to come back.
            this._alone = 0;
            banner.textContent = 'You are dead. Reconnecting to the others...';
            banner.style.display = '';
            this._watching = 0;
            return;
        }
        // Giving this character up: back to the title, to start another.
        this._quit = Input.isPressed('cancel') || Input.isPressed('escape') ? (this._quit || 0) + 1 : 0;
        if (this._quit > 120) { Coop.letGo(); return; }
        const alive = Coop.deadFromSave && !Coop.world.live ? [] : living();
        if (!alive.length) {
            if (Coop.deadFromSave) {
                // Nobody to watch yet, and nobody whose death would end the run.
                if (this._watching) { Coop.viewer.hide(); this._watching = 0; }
                banner.textContent = 'You were dead when this was saved. Once a partner has loaded their save of this run, they can call you back at a ritual circle. Hold Esc to go back to the title.';
                banner.style.display = '';
                return;
            }
            // Give the other machines a moment to report before calling it.
            if (++this._alone > 240) endTheRun();
            return;
        }
        this._alone = 0;
        const current = alive.find((p) => p.id === this._watching);
        if (!current) this.watch(alive[0]);
        else if (alive.length > 1 && (Input.isTriggered('right') || Input.isTriggered('left'))) {
            this.watch(alive[(alive.indexOf(current) + 1) % alive.length]);
        }
    };

    // Giving a dead character up: what they carried passes to a living
    // partner, and this player goes back to the title to start another.
    Coop.letGo = function () {
        if (!Coop.dead) return;
        const heirs = Coop.world.live ? living() : [];
        const heir = heirs.find((p) => p.st !== 'away') || heirs[0];
        if (heir) Coop.sendTo(heir.id, 'inherit', Object.assign({ name: Coop.name }, belongings()));
        Coop.dead = false;
        Coop.toast(heir ? 'You let this character go. What they carried passes to ' + heir.name + '.' : Coop.deadFromSave ? 'Back to the title. Your save is as it was.' : 'You let this character go.', 5000);
        SceneManager.goto(Scene_Title);
    };

    Scene_CoopDead.prototype.terminate = function () {
        Scene_Base.prototype.terminate.call(this);
        if (this._watching) Coop.sendTo(this._watching, 'watch', { on: false });
        Coop.viewer.hide();
        banner.style.display = 'none';
    };

    const banner = document.createElement('div');
    banner.id = 'coop-dead';
    banner.style.cssText = 'position:fixed;left:0;right:0;bottom:7%;z-index:55;text-align:center;pointer-events:none;display:none;'
        + 'font:18px Georgia,"Times New Roman",serif;color:#c9b8a0;text-shadow:0 0 4px #000,0 0 4px #000,0 0 6px #000;';
    (document.body ? Promise.resolve() : new Promise((r) => window.addEventListener('DOMContentLoaded', r)))
        .then(() => document.body.appendChild(banner));

    // The living let the dead watch.
    Coop.on('to:watch', function (msg) {
        if (msg.on) Coop.stream.add(msg.from); else Coop.stream.remove(msg.from);
    });

    //--- calling someone back -----------------------------------------------

    // Between maps the old events are still listed but the map's data is not loaded.
    function circleSwitch(ev) {
        return window.$dataMap ? circleSwitchOf(ev.event()) : 0;
    }
    // From an event's data, so a partner can look for circles on maps it is not on.
    function circleSwitchOf(data) {
        if (!data || !/^circle\d/i.test(data.name)) return 0;
        for (const page of data.pages) {
            const c = page.conditions;
            if (c.switch1Valid && EXHAUSTED.indexOf(c.switch1Id) >= 0) return c.switch1Id;
            if (c.switch2Valid && EXHAUSTED.indexOf(c.switch2Id) >= 0) return c.switch2Id;
            for (const cmd of page.list) {
                if (cmd.code === 121 && EXHAUSTED.indexOf(cmd.parameters[0]) >= 0) return cmd.parameters[0];
            }
        }
        return 0;
    }

    Coop.circleSwitchOf = circleSwitchOf;

    function isCircle(ev) {
        return !!window.$dataMap && /^circle\d/i.test(ev.event().name);
    }

    // The circle is spent when the dead player's machine says they are up,
    // not when the call goes out: a call nobody answers costs nothing.
    let calling = null; // { peerId, switchId, name, timer }
    function revive(peer, ev, switchId) {
        if (calling) clearTimeout(calling.timer);
        calling = { peerId: peer.id, switchId, name: peer.name, timer: setTimeout(function () {
            if (calling) Coop.toast(calling.name + ' did not answer. The circle is untouched.', 5000);
            calling = null;
        }, 6000) };
        Coop.sendTo(peer.id, 'revive', { m: $gameMap.mapId(), x: $gamePlayer.x, y: $gamePlayer.y, by: Coop.name });
    }
    Coop.on('to:revived', function (msg) {
        if (!calling || calling.peerId !== msg.from) return;
        clearTimeout(calling.timer);
        $gameSwitches.setValue(calling.switchId, true);
        $gameScreen.startFlash([150, 20, 20, 200], 90);
        $gameScreen.startShake(4, 6, 60);
        Coop.toast('The circle goes dark. ' + calling.name + ' draws breath.', 5000);
        calling = null;
    });

    // Everything a party is carrying or wearing, as plain counts.
    function belongings() {
        const out = { items: Object.assign({}, $gameParty._items), weapons: Object.assign({}, $gameParty._weapons), armors: Object.assign({}, $gameParty._armors) };
        for (const actor of $gameParty.allMembers()) {
            for (const item of actor.equips()) {
                if (!item) continue;
                const table = DataManager.isWeapon(item) ? out.weapons : out.armors;
                table[item.id] = (table[item.id] || 0) + 1;
            }
        }
        return out;
    }

    // What someone who gave their character up was carrying passes to a
    // partner, taken in once that partner is free to receive it.
    const inherited = [];
    Coop.on('to:inherit', function (msg) { inherited.push(msg); });
    const _mapUpdateInherit = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function () {
        _mapUpdateInherit.call(this);
        if (!inherited.length || Coop.battle || Coop.dead || !Coop.world.live) return;
        const msg = inherited.shift();
        let n = 0;
        for (const [key, table] of [['items', $dataItems], ['weapons', $dataWeapons], ['armors', $dataArmors]]) {
            for (const id in msg[key] || {}) {
                const item = table[Number(id)];
                const count = Math.min(99, Number(msg[key][id]) || 0);
                if (item && item.name && count > 0) { $gameParty.gainItem(item, count); n += count; }
            }
        }
        if (n) {
            SoundManager.playUseItem();
            Coop.toast(msg.name + ' has let their character go. What they carried is yours now (' + n + ' thing' + (n === 1 ? '' : 's') + ').', 7000);
        }
    };

    // Using a live circle while a partner lies dead offers to spend it on
    // them. The offer runs as an ordinary event script so every message
    // plugin the game uses treats it like any other choice.
    let offer = null; // { peerId, eventId, switchId }
    let bypass = false;

    function offerList(name) {
        const choices = ['Call ' + name + ' back', 'Use the circle yourself', 'Step away'];
        const list = [
            { code: 101, indent: 0, parameters: ['', 0, 0, 2] },
            { code: 401, indent: 0, parameters: ['The circle could call ' + name + ' back from the dark.'] },
            { code: 401, indent: 0, parameters: ['It would be spent.'] },
            { code: 102, indent: 0, parameters: [choices, 2, 2, 2, 0] },
        ];
        choices.forEach(function (text, n) {
            list.push({ code: 402, indent: 0, parameters: [n, text] });
            if (n < 2) list.push({ code: 355, indent: 1, parameters: ['Coop.circleAnswer(' + n + ')'] });
            list.push({ code: 0, indent: 1, parameters: [] });
        });
        list.push({ code: 404, indent: 0, parameters: [] });
        list.push({ code: 0, indent: 0, parameters: [] });
        return list;
    }

    Coop.circleAnswer = function (n) {
        const o = offer;
        offer = null;
        if (!o) return;
        const ev = $gameMap.event(o.eventId);
        if (n === 0) {
            const peer = Coop.peers.get(o.peerId);
            if (peer && peer.st === 'dead' && !$gameSwitches.value(o.switchId)) revive(peer, ev, o.switchId);
        } else if (n === 1 && ev) {
            bypass = true;
            ev.start();
            bypass = false;
        }
    };

    const _start = Game_Event.prototype.start;
    Game_Event.prototype.start = function () {
        if (!bypass && Coop.world.live && this._trigger === 0 && isCircle(this) && !$gameMap.isEventRunning()) {
            const dead = deadPeers();
            const switchId = dead.length ? circleSwitch(this) : 0;
            if (switchId && !$gameSwitches.value(switchId)) {
                offer = { peerId: dead[0].id, eventId: this._eventId, switchId };
                $gameMap._interpreter.setup(offerList(dead[0].name), 0);
                return;
            }
        }
        _start.call(this);
    };

    Coop.on('to:revive', function (msg) {
        if (!Coop.dead) return;
        Coop.dead = false;
        Coop.deadFromSave = false;
        const leader = $gameParty.leader();
        if (leader) {
            leader.removeState(leader.deathStateId());
            leader.setHp(1);
            // The game keeps hunger as experience points and starves a
            // character below 58. Someone who starved comes back hungry and
            // weak, not about to starve again on the spot.
            if (leader.currentExp() < HUNGRY_BUT_ALIVE) leader.changeExp(HUNGRY_BUT_ALIVE, false);
            // The world may have this character down as killed, with a body
            // lying somewhere. They are neither any more.
            for (const id of KILLED_FLAGS[leader.actorId()] || []) $gameSwitches.setValue(id, false);
        }
        // Whatever killed this player was mid-script; none of it resumes.
        $gameMap._interpreter.clear();
        $gameTemp.clearCommonEvent();
        $gameMessage.clear();
        $gameScreen.clear();
        $gameTimer.stop();
        $gamePlayer.reserveTransfer(msg.m, msg.x, msg.y, 2, 0);
        $gamePlayer.refresh();
        SceneManager.goto(Scene_Map);
        Coop.sendTo(msg.from, 'revived', {});
        Coop.toast(msg.by + ' called you back. You have one breath of life left.', 6000);
        Coop.reportPresence(true);
    });

    //--- housekeeping -------------------------------------------------------

    // Back at the title screen, this player is out of the world.
    const _titleStart = Scene_Title.prototype.start;
    Scene_Title.prototype.start = function () {
        _titleStart.call(this);
        Coop.dead = false;
        Coop.deadFromSave = false;
        Coop.afterSpectate = null;
        Coop.battle = null;
        Coop.world.leave();
        Coop.viewer.hide();
        Coop.reportPresence(true);
    };
})();
