//=============================================================================
// fh-coop: the shared world. Switches, variables and self switches marked
// "world" in the census are mirrored between players; the rest stay local.
//=============================================================================
(function () {
    const census = JSON.parse(Coop.fetchSync('GET', 'coop/census.json').text);
    const worldSw = new Set(census.sw);
    const worldVa = new Set(census.va);
    const privateSs = new Set(census.ssPrivate);
    const START = census.start;

    const World = Coop.world = {
        live: false, // true once this player is in the dungeon and synced
        cut: false, // was live when the line dropped, and not back in yet
        runId: '',
        demoted: new Set(), // keys that turned out to flap; kept local from then on
        _out: [],
        _remote: false,
        _flap: new Map(),
        _entering: false,
        census,
    };

    // Each data file's hash, this copy's and every partner's. On a map whose
    // file differs between two players, its events are different events: the
    // enemies there are not shared with that player (events.js), nor are its
    // self switches. The rest of the world is.
    let myFiles = {};
    try { myFiles = JSON.parse(Coop.fetchSync('GET', 'coop/files.json').text) || {}; } catch (e) { /* an older server: nothing to compare */ }
    const mapFile = (mapId) => 'Map' + String(mapId).padStart(3, '0') + '.json';
    Coop.mapDiffersWith = function (peer, mapId) {
        if (!peer || !peer.files) return false;
        const name = mapFile(mapId);
        return peer.files[name] !== myFiles[name];
    };
    Coop.mapDiffers = function (mapId) {
        return Coop.others().some((p) => Coop.mapDiffersWith(p, mapId));
    };
    function sendFiles(to) { if (Object.keys(myFiles).length) Coop.sendTo(to, 'files', { h: myFiles }); }
    Coop.on('online', function () { for (const id of Coop.peers.keys()) sendFiles(id); });
    Coop.on('join', function (peer) { if (peer && peer.id) sendFiles(peer.id); });
    Coop.on('to:files', function (msg) {
        const peer = Coop.peers.get(msg.from);
        if (!peer || !msg.h || typeof msg.h !== 'object') return;
        peer.files = msg.h;
        const differ = Object.keys(Object.assign({}, msg.h, myFiles)).filter((n) => msg.h[n] !== myFiles[n]);
        if (!differ.length) return;
        Coop.note('game files differ from ' + peer.name + ' in ' + differ.length + ': ' + differ.slice(0, 12).join(', '));
        const maps = differ.filter((n) => /^Map\d+\.json$/.test(n)).length;
        if (maps && Coop.toast) Coop.toast('Your game files differ from ' + peer.name + '\'s on ' + maps + ' map' + (maps > 1 ? 's' : '') + '. On those, each of you meets your own enemies.', 9000);
    });

    // Joining a host whose game files differ from this copy's (a mod, a
    // changed install): the host's census decides what is shared, so both
    // sides mirror exactly the same switches.
    Coop.on('census', function (msg) {
        const c = msg.census;
        if (!c || !Array.isArray(c.sw) || !Array.isArray(c.va)) return;
        worldSw.clear(); for (const id of c.sw) worldSw.add(id);
        worldVa.clear(); for (const id of c.va) worldVa.add(id);
        privateSs.clear(); for (const k of c.ssPrivate || []) privateSs.add(k);
        World.census = c;
        Coop.note('the host\'s game files differ from this copy\'s; sharing by the host\'s census');
        if (World._toldDiffers) return;
        World._toldDiffers = true;
        if (Coop.toast) Coop.toast('Your game files differ from the host\'s (a mod, or a changed install). You can play. If something looks wrong, verify the game files in Steam.', 12000);
    });

    World.isShared = function (kind, key) {
        if (World.demoted.has(kind + key)) return false;
        if (kind === 'sw') return worldSw.has(key);
        if (kind === 'va') return worldVa.has(key);
        return !privateSs.has(key) && !Coop.mapDiffers(Number(String(key).split(',')[0]));
    };

    // A world key that changes many times in a few seconds is some script's
    // scratch flag the census missed. Stop sharing it and say so.
    function flapping(kind, key) {
        const now = Date.now();
        const k = kind + key;
        let f = World._flap.get(k);
        if (!f || now - f.since > 5000) { f = { since: now, n: 0 }; World._flap.set(k, f); }
        if (++f.n <= 10) return false;
        World.demoted.add(k);
        Coop.note('stopped sharing ' + k + ' (it changes too often)');
        Coop.send({ t: 'demote', key: k });
        return true;
    }

    function queue(kind, key, value) {
        if (!World.live || World._remote) return;
        if (!World.isShared(kind, key)) return;
        if (flapping(kind, key)) return;
        World._out.push([kind, key, value]);
    }

    World.flush = function () {
        if (!World._out.length) return;
        Coop.send({ t: 'w', w: World._out });
        World._out = [];
    };

    //--- outgoing: watch every write ----------------------------------------

    const _swSet = Game_Switches.prototype.setValue;
    Game_Switches.prototype.setValue = function (id, value) {
        const before = !!this._data[id];
        _swSet.call(this, id, value);
        const after = !!this._data[id];
        if (before !== after) {
            if (after) World.mine.add('sw' + id); else World.mine.delete('sw' + id);
            queue('sw', id, after ? 1 : 0);
            if (id === START && after && !World._remote) World.enter();
        }
    };

    const _vaSet = Game_Variables.prototype.setValue;
    Game_Variables.prototype.setValue = function (id, value) {
        const before = this._data[id] || 0;
        _vaSet.call(this, id, value);
        const after = this._data[id] || 0;
        if (before !== after && (typeof after === 'number' || typeof after === 'string')) queue('va', id, after);
    };

    const _ssSet = Game_SelfSwitches.prototype.setValue;
    Game_SelfSwitches.prototype.setValue = function (key, value) {
        const k = String(key);
        const before = !!this._data[k];
        _ssSet.call(this, key, value);
        if (before !== !!value) {
            if (value) World.mine.add('ss' + k); else World.mine.delete('ss' + k);
            queue('ss', k, value ? 1 : 0);
        }
    };

    //--- incoming -----------------------------------------------------------

    function apply(kind, key, value) {
        if (kind === 'sw') {
            if (!worldSw.has(key) || World.demoted.has('sw' + key)) return false;
            if (!!$gameSwitches._data[key] === !!value) return false;
            $gameSwitches._data[key] = !!value;
        } else if (kind === 'va') {
            if (!worldVa.has(key) || World.demoted.has('va' + key)) return false;
            if (($gameVariables._data[key] || 0) === value) return false;
            $gameVariables._data[key] = value;
        } else {
            if (privateSs.has(key) || World.demoted.has('ss' + key)) return false;
            key = String(key);
            if (Coop.mapDiffers(Number(key.split(',')[0]))) return false;
            if (!!$gameSelfSwitches._data[key] === !!value) return false;
            if (value) $gameSelfSwitches._data[key] = true; else delete $gameSelfSwitches._data[key];
        }
        return true;
    }

    Coop.on('w', function (msg) {
        if (!World.live || !window.$gameSwitches) return;
        let changed = false;
        for (const [kind, key, value] of msg.w) {
            // Only a write that changed it makes it theirs: both pulling the lever at once, both ride.
            if (apply(kind, key, value)) { changed = true; World.mine.delete(kind + key); }
        }
        if (changed) $gameMap.requestRefresh();
    });

    Coop.on('demote', function (msg) {
        World.demoted.add(msg.key);
    });

    //--- whose scene --------------------------------------------------------
    // A scene that starts by itself (autorun, parallel) because of a world
    // flag someone else turned on, and that acts on the player (moves them,
    // starts a fight, changes the party or their body, ends the game), is
    // theirs: it plays on their machine, and what it changes reaches
    // everyone from there. Played here as well, the elevator took a partner
    // anywhere on the map along, and Trortur's table killed whoever else was
    // there, then anyone who walked in later.
    World.mine = new Set(); // 'sw12', 'ss1,5,A': world flags this machine turned on itself
    const ACTS = new Set([201, 353, 301, 129, 311, 312, 313, 314, 315, 321, 322, 126, 127, 128]);
    // The same done from a script line.
    const ACTS_SCRIPT = /reserveTransfer|Scene_Gameover|addActor|removeActor|gainItem|loseItem|BattleManager\.setup|setHp|addState|changeEquip|\$gamePlayer\.(locate|setPosition|moveStraight|moveDiagonally|jump|forceMoveRoute)/;
    const actsMemo = new WeakMap();
    function actsOnPlayer(list, seen) {
        if (!list) return false;
        if (actsMemo.has(list)) return actsMemo.get(list);
        const top = !seen;
        seen = seen || new Set();
        if (seen.has(list)) return false; // a common event calling itself: answered where it began
        seen.add(list);
        let yes = false;
        for (const c of list) {
            if (ACTS.has(c.code) || ((c.code === 355 || c.code === 655) && ACTS_SCRIPT.test(String(c.parameters[0])))) { yes = true; break; }
            // A move route on the player walks them (the lift's arrival walks its rider
            // out: played here too, it walked the partner, and its own copy of the ride
            // mixed with the rider's reports and left the cage hanging a tile up, 10/21).
            if (c.code === 205 && c.parameters[0] === -1) { yes = true; break; }
            const ce = c.code === 117 && $dataCommonEvents[c.parameters[0]];
            if (ce && actsOnPlayer(ce.list, seen)) { yes = true; break; }
        }
        if (yes || top) actsMemo.set(list, yes); // a "no" is final only when worked out from the top
        return yes;
    }
    // Not only while in the world: a save being loaded is out of it until it is back in.
    World.othersScene = function (ev) {
        const page = ev.page();
        if (!page || (page.trigger !== 3 && page.trigger !== 4)) return false;
        const c = page.conditions;
        const flags = [];
        if (c.switch1Valid) flags.push(['sw', c.switch1Id]);
        if (c.switch2Valid) flags.push(['sw', c.switch2Id]);
        if (c.selfSwitchValid) flags.push(['ss', [ev._mapId, ev._eventId, c.selfSwitchCh].join(',')]);
        // The shared flags say whose scene it is (a private one is only this machine's state).
        const shared = flags.filter(([kind, key]) => World.isShared(kind, key));
        if (!shared.length || shared.some(([kind, key]) => World.mine.has(kind + key))) return false;
        return actsOnPlayer(page.list);
    };
    const _checkAuto = Game_Event.prototype.checkEventTriggerAuto;
    Game_Event.prototype.checkEventTriggerAuto = function () {
        if (this._trigger === 3 && World.othersScene(this)) return;
        _checkAuto.call(this);
    };
    const _updateParallel = Game_Event.prototype.updateParallel;
    Game_Event.prototype.updateParallel = function () {
        if (this._interpreter && !this._interpreter.isRunning() && World.othersScene(this)) return;
        _updateParallel.call(this);
    };

    //--- entering the world -------------------------------------------------
    // Until the game's own START switch turns on, the player is in the title
    // screen or the intro and nothing is shared. At that moment this machine
    // either founds the world (first one in) or adopts the one already there.

    // The game keeps a character's body, hunger and death in flags named
    // after the character. Two players as the same protagonist would be
    // writing over each other, so the second one stays out of the shared world.
    const STARTED_AS = [661, 662, 663, 664];
    function sameCharacterAs() {
        const mine = STARTED_AS.filter((id) => $gameSwitches.value(id));
        if (!mine.length) return '';
        for (const peer of Coop.others()) {
            // A player under this one's own name is this tab's old line, which the host has
            // not yet noticed is dead (back within seconds of a drop); this name replaces it.
            if (Coop.name && String(peer.name).toLowerCase() === Coop.name.toLowerCase()) continue;
            if (peer.st && peer.st !== 'title' && peer.ini && peer.ini.some((id) => mine.indexOf(id) >= 0)) return peer.name;
        }
        return '';
    }

    // How this player comes to the world, which decides what the server allows:
    //   new   a new game (or a save from before the dungeon)
    //   load  a save file
    //   park  carrying on after a dropped connection
    //   again the same session reconnecting
    World._how = 'new';

    // This player's save slots from one run, by the moment each was saved.
    World.slotsOf = function (runId) {
        const out = {};
        if (!runId) return out;
        const all = DataManager.loadGlobalInfo() || [];
        let learned = false;
        all.forEach(function (info, slot) {
            if (!info || info.coopRun !== runId) return;
            if (info.coopStamp === undefined) {
                // Saved before slots were labelled with their moment; the file itself knows.
                let json = '';
                try { json = StorageManager.load(slot) || ''; } catch (e) { /* unreadable: leave it out */ }
                const m = /"coop":\{[^{}]*"stamp":(\d+)/.exec(json);
                info.coopStamp = m ? Number(m[1]) : 0;
                learned = true;
            }
            if (info.coopStamp) out[info.coopStamp] = slot;
        });
        if (learned) DataManager.saveGlobalInfo(all);
        return out;
    };

    World.when = function (stamp) {
        return new Date(stamp).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    };

    // The run someone else is playing right now, while this player is still at the title.
    World.on = null;
    Coop.on('online', function () { World.on = null; });
    if (typeof Coop.decides !== 'boolean') Coop.decides = false; // set from nameok, which can beat this file
    Coop.on('nameok', function (msg) {
        World.on = msg.run || null;
        Coop.decides = !!msg.decides;
        // Their saved Balance changes is the run's, from here on. A joiner's tick is not.
        if (Coop.decides && window.ConfigManager && Coop.setBalance) {
            const on = ConfigManager.coopBalance !== false;
            Coop.setBalance(on);
            Coop.send({ t: 'balance', on: on });
        }
    });
    Coop.on('run', function (msg) { World.on = msg.run || null; });

    World.enter = function () {
        if (World.live || World._entering) return;
        const clash = sameCharacterAs();
        World.sameAs = clash;
        if (clash) {
            Coop.note('not joining the shared world: same character as ' + clash);
            if (Coop.toast) Coop.toast(clash + ' is already playing this character, so you are on your own in this game. Start again as someone else to play together.', 14000);
            return;
        }
        World._entering = true;
        Coop.send({
            t: 'world?', runId: World.runId, stamp: World.loadedStamp || 0, how: World._how,
            ini: STARTED_AS.filter((id) => $gameSwitches.value(id)),
            have: World._how === 'load' ? Object.keys(World.slotsOf(World.runId)).map(Number) : [],
            dead: !!Coop.deadFromSave,
            balance: window.ConfigManager ? ConfigManager.coopBalance !== false : true,
        });
        if (!Coop.connected) World._entering = false; // offline: play alone, sync on reconnect
    };

    function localShared() {
        const out = [];
        const sw = $gameSwitches._data, va = $gameVariables._data, ss = $gameSelfSwitches._data;
        for (const id of worldSw) if (sw[id]) out.push(['sw', id, 1]);
        for (const id of worldVa) if (va[id]) out.push(['va', id, va[id]]);
        for (const k in ss) if (ss[k] && World.isShared('ss', k)) out.push(['ss', k, 1]);
        return out;
    }

    Coop.on('worldbusy', function () {
        World._entering = false;
        World.otherRun = true;
        if (Coop.toast) Coop.toast('The others are in a different run, so you are playing this save alone. Load the save you share with them, or start a new game, to join.', 12000);
    });

    // The server took someone else as this protagonist a moment earlier.
    Coop.on('worldclash', function (msg) {
        World._entering = false;
        World.sameAs = msg.name;
        if (Coop.toast) Coop.toast(msg.name + ' is already playing this character, so you are on your own in this game. Start again as someone else to play together.', 14000);
    });

    // Loading a save into a run this player has already been part of would
    // bring back a body from the past: alive again, holding things they have
    // since handed over. The run has to end, or they come back as someone new.
    Coop.on('worldstale', function (msg) {
        World._entering = false;
        const others = (msg.others || []).join(' and ') || 'the others';
        if (Coop.toast) Coop.toast('That save is from earlier in a run ' + others + ' still ' + ((msg.others || []).length === 1 ? 'is' : 'are') + ' playing, so it cannot be loaded into it. Start a new character to rejoin them, or load it together once everyone has stopped.', 16000);
        World._bounce = true; // back to the title, once the scene now loading has settled
    });

    // Loaded dead, with nobody alive in the run yet: ask again until someone is.
    Coop.on('worldwait', function () {
        World._entering = false;
        World.waiting = true;
        clearTimeout(World._waitTimer);
        World._waitTimer = setTimeout(function () {
            if (World.waiting && !World.live && Coop.deadFromSave && Coop.connected) World.enter();
        }, 2500);
    });

    // In before the host: their game decides which run this is. Asked again
    // until they have started or continued one.
    World.hostWait = '';
    Coop.on('worldhost', function (msg) {
        World._entering = false;
        if (World.hostWait !== msg.by && Coop.toast) Coop.toast('Waiting for ' + msg.by + ' to start or continue a game. You join their run once they do.', 9000);
        World.hostWait = msg.by;
        clearTimeout(World._hostTimer);
        World._hostTimer = setTimeout(function () {
            if (World.hostWait && !World.live && Coop.connected) World.enter();
        }, 2500);
    });
    Coop.on('run', function () { if (World.hostWait && !World.live && Coop.connected) World.enter(); });

    // The others carried this run on from a different save than the one just
    // loaded. If this player has theirs from that same moment it is loaded
    // in its place; if all they have is from later, they cannot come in.
    Coop.on('worldwhen', function (msg) {
        World._entering = false;
        const slot = msg.swap && !World._swapped ? World.slotsOf(msg.runId)[msg.stamp] : 0;
        if (slot) {
            World._swapped = true;
            World._reload = slot;
            // Said now, and again once the right save is in, so it is not talked over.
            World._resumeNote = msg.by + ' has carried this run on from the save of ' + World.when(msg.stamp) + '.\nYou are on yours from that same moment (slot ' + slot + ').';
            if (Coop.toast) Coop.toast(World._resumeNote, 9000);
            return;
        }
        if (Coop.toast) Coop.toast(msg.by + ' has carried this run on from an earlier save (' + World.when(msg.stamp) + ') than yours, and you have none from then.\nAsk them to load the later one, or start a new character to join.', 16000);
        World._bounce = true;
    });

    // The run the others were in has ended; a player who was shut out of it tries again.
    Coop.on('runover', function () {
        World.on = null;
        if (World.otherRun && window.$gameSwitches && $gameSwitches.value(START)) {
            World.otherRun = false;
            World.enter();
        }
    });

    // The room's word on Balance changes, except on the host's own machine: a restarted server
    // forgets, and says "on" until told again. The host's saved choice stands and is sent back.
    function roomBalance(on) {
        if (typeof on !== 'boolean' || !Coop.setBalance) return;
        if (Coop.decides && window.ConfigManager) {
            const mine = ConfigManager.coopBalance !== false;
            Coop.setBalance(mine);
            if (mine !== on) Coop.send({ t: 'balance', on: mine });
        } else Coop.setBalance(on);
    }
    Coop.on('balance', function (msg) { roomBalance(msg.on); });

    Coop.on('world', function (msg) {
        roomBalance(msg.balance);
        World._entering = false;
        World.otherRun = false;
        if (!window.$gameSwitches) return;
        World.runId = msg.runId;
        World._how = 'again';
        World.loadedStamp = 0; // from here on the world is the live one, not a save's
        World.waiting = false;
        World.hostWait = '';
        World._swapped = false;
        World.on = null; // in it now; nothing to be pointed at
        const server = msg.world;
        let changed = false;
        for (const kind of ['sw', 'va', 'ss']) {
            const table = server[kind] || {};
            for (const key in table) {
                const k = kind === 'ss' ? key : Number(key);
                if (apply(kind, k, table[key])) { changed = true; World.mine.delete(kind + k); }
            }
        }
        let mine = [];
        if (msg.mode === 'join') {
            // Arriving in someone else's world: it is exactly what the server
            // says it is. Anything this machine believed beyond that is dropped.
            for (const [kind, key] of localShared()) {
                if (server[kind] && key in server[kind]) continue;
                if (apply(kind, key, 0)) { changed = true; World.mine.delete(kind + key); }
            }
        } else {
            // Founding it, or back after a dropped line: what this machine
            // knows and the server does not is contributed.
            mine = localShared().filter(([kind, key]) => !(server[kind] && key in server[kind]));
            if (mine.length) Coop.send({ t: 'w', w: mine });
        }
        World.live = true;
        World.cut = false;
        if (changed) $gameMap.requestRefresh();
        Coop.note((msg.founded ? 'founded the world' : 'joined the world') + ' (' + mine.length + ' facts contributed)');
        Coop.emit('entered', msg);
    });

    Coop.on('online', function (msg) {
        if (msg) roomBalance(msg.balance);
        // Reconnected mid-game: resync from the server's copy.
        if (window.$gameSwitches && $gameSwitches.value(START) && !World.otherRun) {
            World.live = false;
            World._entering = false;
            World.enter();
        }
    });

    // Back, but not into this world: fights from here on are this player's own.
    for (const t of ['worldbusy', 'worldclash', 'worldstale', 'worldwait', 'worldwhen', 'worldhost']) Coop.on(t, function () { World.cut = false; if (t !== 'worldhost') World.hostWait = ''; });

    Coop.on('offline', function () {
        World.cut = World.live || !!World.cut;
        World.live = false;
    });

    World.leave = function () {
        World.cut = false;
        World.hostWait = '';
        World.otherRun = false;
        World.sameAs = '';
        if (World.live) Coop.send({ t: 'leftworld' });
        World.live = false;
        World.waiting = false;
        World._entering = false;
        World._out = [];
    };

    // A fresh game or a loaded one starts unsynced.
    const _setupNewGame = DataManager.setupNewGame;
    DataManager.setupNewGame = function () {
        World.leave();
        World.runId = '';
        World.mine.clear();
        World._how = 'new';
        World._swapped = false;
        _setupNewGame.call(this);
    };

    const _makeSaveContents = DataManager.makeSaveContents;
    DataManager.makeSaveContents = function () {
        const contents = _makeSaveContents.call(this);
        contents.coop = { runId: World.runId, stamp: World.saveStamp || 0, name: Coop.name, dead: !!Coop.dead, mine: Array.from(World.mine) };
        return contents;
    };

    const _extractSaveContents = DataManager.extractSaveContents;
    DataManager.extractSaveContents = function (contents) {
        World.leave();
        _extractSaveContents.call(this, contents);
        World.runId = contents.coop ? contents.coop.runId : '';
        // An older save does not say whose flags were whose: all of them its player's, as they were then.
        World.mine = new Set(contents.coop && contents.coop.mine ? contents.coop.mine
            : $gameSwitches._data.map((on, id) => (on ? 'sw' + id : '')).filter(Boolean).concat(Object.keys($gameSelfSwitches._data).map((k) => 'ss' + k)));
        World.loadedStamp = contents.coop ? contents.coop.stamp : 0;
        World._how = World._nextHow || 'load';
        World._nextHow = '';
        if ($gameSwitches.value(START)) World.enter();
    };

    const _sceneUpdate = SceneManager.updateScene;
    SceneManager.updateScene = function () {
        _sceneUpdate.call(this);
        World.flush();
        if (World._bounce && this.isCurrentSceneStarted() && !this.isSceneChanging()) {
            World._bounce = false;
            if (!(this._scene instanceof Scene_Title)) this.goto(Scene_Title);
        }
        if (World._reload && this.isCurrentSceneStarted() && !this.isSceneChanging()) {
            const slot = World._reload;
            World._reload = 0;
            if (DataManager.loadGame(slot)) {
                this.goto(Scene_Map);
                $gameSystem.onAfterLoad();
            } else {
                this.goto(Scene_Title);
            }
        }
    };

    // Used by the tests and the desync check: a short fingerprint of the
    // shared state as this machine sees it.
    World.fingerprint = function () {
        const parts = [];
        for (const id of worldSw) if ($gameSwitches._data[id] && !World.demoted.has('sw' + id)) parts.push('s' + id);
        for (const id of worldVa) if ($gameVariables._data[id] && !World.demoted.has('va' + id)) parts.push('v' + id + '=' + $gameVariables._data[id]);
        for (const k of Object.keys($gameSelfSwitches._data).sort()) if (!privateSs.has(k) && !World.demoted.has('ss' + k)) parts.push('x' + k);
        return parts.join(';');
    };
})();
