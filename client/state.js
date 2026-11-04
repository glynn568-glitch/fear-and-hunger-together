//=============================================================================
// fh-coop: the shared world. Switches, variables and self switches marked
// "world" in the census are mirrored between players, and so is a kept
// event location once a scene that writes a shared flag moves it. The rest
// stay local.
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
        el: {}, // 'map,event' -> [x, y, direction] of a kept event a shared scene moved
        census,
    };
    let shareMemo = new WeakMap();

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
        // Due scenes are private and decided by this copy's maps. An older host
        // census has no list; keep the one this client booted with.
        if (!Array.isArray(c.dueScenes)) c.dueScenes = World.census.dueScenes;
        World.census = c;
        shareMemo = new WeakMap();
        Coop.note('the host\'s game files differ from this copy\'s; sharing by the host\'s census');
        if (World._toldDiffers) return;
        World._toldDiffers = true;
        if (Coop.toast) Coop.toast('Your game files differ from the host\'s (a mod, or a changed install). You can play. If something looks wrong, verify the game files in Steam.', 12000);
    });

    World.isShared = function (kind, key) {
        if (World.demoted.has(kind + key)) return false;
        if (kind === 'sw') return worldSw.has(key);
        if (kind === 'va') return worldVa.has(key);
        if (kind === 'el') return !Coop.mapDiffers(Number(String(key).split(',')[0]));
        if (kind !== 'ss') return false;
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

    function sameEl(a, b) {
        return !!(a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]);
    }

    function queue(kind, key, value) {
        if (!World.live || World._remote) return;
        if (!World.isShared(kind, key)) return;
        if (kind === 'el') {
            if (!Array.isArray(value) || value.length !== 3) return;
            if (sameEl(World.el[key], value)) return;
            value = value.slice();
        }
        if (flapping(kind, key)) return;
        if (kind === 'el') World.el[key] = value.slice();
        World._out.push([kind, key, value]);
    }

    World.flush = function () {
        if (!World._out.length) return;
        Coop.send({ t: 'w', w: World._out });
        World._out = [];
    };

    // A command list writes a shared flag when it sets one, or calls a common
    // event that does. Remembered per list. Whether a self switch is shared
    // depends on the event running the list, so that part is checked later.
    function listFlags(list, seen) {
        if (!list) return { sw: false, letters: '' };
        if (shareMemo.has(list)) return shareMemo.get(list);
        const top = !seen;
        seen = seen || new Set();
        if (seen.has(list)) return { sw: false, letters: '' };
        seen.add(list);
        let sw = false;
        let letters = '';
        for (const c of list) {
            if (!c) continue;
            if (c.code === 121 && c.parameters) {
                for (let id = c.parameters[0]; id <= c.parameters[1]; id++) if (World.isShared('sw', id)) { sw = true; break; }
            } else if (c.code === 123 && c.parameters && letters.indexOf(c.parameters[0]) < 0) {
                letters += c.parameters[0];
            } else if (c.code === 117 && $dataCommonEvents) {
                const ce = $dataCommonEvents[c.parameters[0]];
                if (ce && ce.list) {
                    const sub = listFlags(ce.list, seen);
                    if (sub.sw) sw = true;
                    for (const ch of sub.letters) if (letters.indexOf(ch) < 0) letters += ch;
                }
            }
        }
        const out = { sw: sw, letters: letters };
        if (sw || top) shareMemo.set(list, out);
        return out;
    }

    function listShares(interp) {
        if (!interp || !interp._list) return false;
        if (interp._shareFromParent) return true;
        const flags = listFlags(interp._list);
        if (flags.sw) return true;
        if (!flags.letters || !interp._eventId) return false;
        for (const ch of flags.letters) {
            if (World.isShared('ss', interp._mapId + ',' + interp._eventId + ',' + ch)) return true;
        }
        return false;
    }

    function routeWalks(route) {
        const list = route && route.list;
        if (!list) return false;
        for (let i = 0; i < list.length; i++) {
            const code = list[i] && list[i].code;
            if (code >= 1 && code <= 14) return true;
        }
        return false;
    }

    // Events a shared scene has told to walk, waiting until the walk lands.
    const pending = new Map();

    function publishEl(mapId, eventId, x, y, d) {
        if (!mapId || !(eventId > 0) || Coop.mapDiffers(mapId)) return;
        if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(d)) return;
        const key = mapId + ',' + eventId;
        if (World.demoted.has('el' + key)) return;
        const value = [x, y, d];
        // Not in a run yet: keep it so the save can contribute it on the way in.
        if (!World.live || World._remote) {
            if (!sameEl(World.el[key], value)) World.el[key] = value.slice();
            return;
        }
        queue('el', key, value);
    }

    function publishSaved(key) {
        const saved = $gameSystem && $gameSystem._savedEventLocations;
        const loc = saved && saved[key];
        if (!loc) return;
        const parts = String(key).split(',');
        publishEl(Number(parts[0]), Number(parts[1]), loc[0], loc[1], loc[2]);
    }

    function noteMoved(interp, param) {
        if (param < 0 || !interp.isOnCurrentMap()) return; // the player is not a kept event
        const id = param > 0 ? param : interp._eventId;
        if (id <= 0) return;
        // Something that walks by itself (the Crow Mauler set down by his scene) is no fixture:
        // its old spot, reapplied at a reconnect, would drop it back there.
        const ev = $gameMap.event(id);
        const page = ev && ev.page();
        if (page && page.moveType !== 0) return;
        pending.set($gameMap.mapId() + ',' + id, 1);
    }

    // A page change clears the forced route while the last step is still
    // moving (the shelf's switch 132). Publish the tile it actually lands on.
    function flushPending(leaving) {
        if (!pending.size || !$gameMap) return;
        const here = $gameMap.mapId();
        for (const key of [...pending.keys()]) {
            const parts = key.split(',');
            const mapId = Number(parts[0]);
            const eventId = Number(parts[1]);
            if (leaving || here !== mapId) {
                publishSaved(key);
                pending.delete(key);
                continue;
            }
            const ev = $gameMap.event(eventId);
            if (!ev) {
                publishSaved(key);
                pending.delete(key);
                continue;
            }
            if (ev.isMoving() || ev.isMoveRouteForcing()) continue;
            publishEl(mapId, eventId, ev.x, ev.y, ev.direction());
            pending.delete(key);
        }
    }

    // Which map $dataMap holds. A loaded save restores $gameMap at once, but
    // its map file loads only after the fade: until then $dataMap is the
    // title's map (72) or the last one played, and an event's home or page
    // read from it belongs to another map. A world reply landing in that
    // window is owed to the map until its file is in.
    let dataMapId = 0;
    const _loadMapData = DataManager.loadMapData;
    DataManager.loadMapData = function (mapId) {
        dataMapId = mapId;
        _loadMapData.call(this, mapId);
    };
    function mapReady() {
        return !!(window.$gameMap && window.$dataMap && $dataMap.events && dataMapId === $gameMap.mapId());
    }
    const owedEl = new Set(); // event ids on map owedMap, to place once its file is in
    let owedMap = 0;
    let owedStop = false;

    function placeHere(eventId, pos) {
        if (mapReady()) return placeEl(eventId, pos);
        if (owedMap !== $gameMap.mapId()) owedEl.clear();
        owedMap = $gameMap.mapId();
        owedEl.add(eventId);
        return false;
    }

    function payOwed() {
        if (!mapReady()) return;
        const mapId = $gameMap.mapId();
        // A load given up before its map came in: those were another map's.
        if (owedMap !== mapId) owedEl.clear();
        for (const eventId of owedEl) {
            const pos = World.el[mapId + ',' + eventId];
            placeEl(eventId, pos || null);
            if (!pos && $gameSystem._savedEventLocations) delete $gameSystem._savedEventLocations[[mapId, eventId]];
        }
        owedEl.clear();
        if (owedStop) {
            owedStop = false;
            if (stopDueRunning()) $gameMap.requestRefresh();
        }
    }

    const _keptMapLoaded = Scene_Map.prototype.onMapLoaded;
    Scene_Map.prototype.onMapLoaded = function () {
        _keptMapLoaded.call(this);
        payOwed();
    };

    function placeEl(eventId, pos) {
        const ev = $gameMap.event(eventId);
        if (!ev || ev._locked || ev._starting) return false;
        let x, y, d;
        if (pos) {
            x = pos[0];
            y = pos[1];
            d = pos[2];
        } else {
            const data = ev.event();
            x = data.x;
            y = data.y;
            d = ev._originalDirection || ev.direction();
        }
        const known = Coop.events && Coop.events._known;
        if (ev.x === x && ev.y === y && (!d || ev.direction() === d)) {
            if (known) known.set(eventId, ev._x + ',' + ev._y + ',' + ev._direction);
            return false;
        }
        ev.setPosition(x, y);
        if (d) ev.setDirection(d);
        ev.refreshBushDepth();
        if (known) known.set(eventId, ev._x + ',' + ev._y + ',' + ev._direction);
        return true;
    }

    function applyEl(key, value) {
        const parts = String(key).split(',');
        const mapId = Number(parts[0]);
        const eventId = Number(parts[1]);
        if (!mapId || !eventId) return false;
        if (!value) {
            const had = !!World.el[key];
            delete World.el[key];
            // setDirection writes the spot back; drop that after the snap home.
            if ($gameMap && $gameMap.mapId() === mapId) placeHere(eventId, null);
            if ($gameSystem && $gameSystem._savedEventLocations) delete $gameSystem._savedEventLocations[[mapId, eventId]];
            return had;
        }
        if (World.demoted.has('el' + key) || Coop.mapDiffers(mapId)) return false;
        if (!Array.isArray(value) || value.length !== 3) return false;
        const x = value[0], y = value[1], d = value[2];
        if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(d)) return false;
        const same = sameEl(World.el[key], value);
        World.el[key] = [x, y, d];
        if ($gameSystem) {
            if ($gameSystem._savedEventLocations === undefined) $gameSystem._savedEventLocations = {};
            $gameSystem._savedEventLocations[[mapId, eventId]] = [x, y, d];
        }
        let moved = false;
        // The same spot again is a reconnect's full table, not a move: whatever walked it since stands.
        if (!same && $gameMap && $gameMap.mapId() === mapId) moved = placeHere(eventId, [x, y, d]);
        return moved || !same;
    }

    const _setupChild = Game_Interpreter.prototype.setupChild;
    Game_Interpreter.prototype.setupChild = function (list, eventId) {
        _setupChild.call(this, list, eventId);
        if (this._childInterpreter) this._childInterpreter._shareFromParent = listShares(this);
    };

    const _cmd205 = Game_Interpreter.prototype.command205;
    Game_Interpreter.prototype.command205 = function () {
        const param = this._params[0];
        const route = this._params[1];
        const share = listShares(this);
        const walks = routeWalks(route);
        const ok = _cmd205.call(this);
        if (share && walks) noteMoved(this, param);
        return ok;
    };

    const _cmd203 = Game_Interpreter.prototype.command203;
    Game_Interpreter.prototype.command203 = function () {
        const param = this._params[0];
        const type = this._params[1];
        const other = this._params[2];
        const share = listShares(this);
        const ok = _cmd203.call(this);
        if (share) {
            noteMoved(this, param);
            if (type === 2) noteMoved(this, other);
        }
        return ok;
    };

    const _keptMapUpdate = Game_Map.prototype.update;
    Game_Map.prototype.update = function (sceneActive) {
        _keptMapUpdate.call(this, sceneActive);
        flushPending(false);
    };

    const _keptMapSetup = Game_Map.prototype.setup;
    Game_Map.prototype.setup = function (mapId) {
        if (mapId !== this._mapId) flushPending(true);
        // Fresh events take their spots from the saved table, which already holds the owed ones,
        // and a scene stop owed to the old map is not the new one's to judge.
        owedEl.clear();
        owedStop = false;
        _keptMapSetup.call(this, mapId);
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
        } else if (kind === 'ss') {
            if (privateSs.has(key) || World.demoted.has('ss' + key)) return false;
            key = String(key);
            if (Coop.mapDiffers(Number(key.split(',')[0]))) return false;
            if (!!$gameSelfSwitches._data[key] === !!value) return false;
            if (value) $gameSelfSwitches._data[key] = true; else delete $gameSelfSwitches._data[key];
        } else if (kind === 'el') {
            return applyEl(key, value);
        } else return false;
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
    // A step of such a scene acts too, though it only waits and sets the next flag (the Beacon of the
    // Depths: run by a bystander too, its tint and light stayed on their screen for good, since the last
    // step, which acts, is not theirs to undo them; the Girl's question at the pit: whoever answered first
    // got the god's fight, and if they lost it the one she spoke to stood there with no way on).
    function setsOn(list, mapId, eventId) {
        const on = { sw: new Set(), letters: new Set() };
        const seen = new Set();
        (function walk(cmds) {
            if (!cmds || seen.has(cmds)) return;
            seen.add(cmds);
            for (const c of cmds) {
                if (c.code === 121 && c.parameters[2] === 0) { for (let id = c.parameters[0]; id <= c.parameters[1]; id++) if (World.isShared('sw', id)) on.sw.add(id); }
                else if (c.code === 123 && c.parameters[1] === 0 && World.isShared('ss', [mapId, eventId, c.parameters[0]].join(','))) on.letters.add(c.parameters[0]);
                else if (c.code === 117) { const ce = $dataCommonEvents[c.parameters[0]]; if (ce) walk(ce.list); }
            }
        })(list);
        return on;
    }
    let leadsMemo = new WeakMap();
    function leadsToActing(page, mapId, eventId, seen) {
        if (leadsMemo.has(page)) return leadsMemo.get(page);
        if (seen.has(page)) return false; // a loop of steps: answered where it began
        seen.add(page);
        const top = seen.size === 1;
        let yes = actsOnPlayer(page.list);
        if (!yes && window.$dataMap && $dataMap.events) {
            const on = setsOn(page.list, mapId, eventId);
            for (const data of $dataMap.events) {
                if (!data || yes) continue;
                for (const next of data.pages) {
                    if (next === page || (next.trigger !== 3 && next.trigger !== 4)) continue;
                    const c = next.conditions;
                    const opens = (c.switch1Valid && on.sw.has(c.switch1Id)) || (c.switch2Valid && on.sw.has(c.switch2Id))
                        || (data.id === eventId && c.selfSwitchValid && on.letters.has(c.selfSwitchCh));
                    if (opens && leadsToActing(next, mapId, data.id, seen)) { yes = true; break; }
                }
            }
        }
        if (yes || top) leadsMemo.set(page, yes); // a "no" is final only when worked out from the top
        return yes;
    }
    Coop.on('census', function () { leadsMemo = new WeakMap(); });
    // The last scenes of the end game belong to whoever stands there alone. Le'garde waits on the next plane
    // for whoever sits on the chair next (M140 EV4: else that player stands there unseen with no menu and the
    // chair is shut for good), the Void's arrival sets its visitor down, and the god's fight at the pit must
    // still be there when the one who started it fell or left.
    const WHOEVER_IS_THERE = new Set(['140,4', '140,18', '142,24', '142,26', '142,70', '125,320', '146,320', '160,483', '160,485', '185,483', '185,485']);
    // Not only while in the world: a save being loaded is out of it until it is back in.
    World.othersScene = function (ev) {
        const page = ev.page();
        if (!page || (page.trigger !== 3 && page.trigger !== 4)) return false;
        if (WHOEVER_IS_THERE.has(ev._mapId + ',' + ev._eventId) && !Coop.peersHere().length) return false;
        const c = page.conditions;
        const flags = [];
        if (c.switch1Valid) flags.push(['sw', c.switch1Id]);
        if (c.switch2Valid) flags.push(['sw', c.switch2Id]);
        if (c.selfSwitchValid) flags.push(['ss', [ev._mapId, ev._eventId, c.selfSwitchCh].join(',')]);
        // The shared flags say whose scene it is (a private one is only this machine's state).
        const shared = flags.filter(([kind, key]) => World.isShared(kind, key));
        if (!shared.length || shared.some(([kind, key]) => World.mine.has(kind + key))) return false;
        return leadsToActing(page, ev._mapId, ev._eventId, new Set());
    };
    // A latch that means "a fight just ended and a scene is due" (census.dueScenes).
    function duePage(ev) {
        // A save loading: the events stand there before their map's data does.
        const page = ev && mapReady() && ev.event() ? ev.page() : null;
        const ids = World.census && World.census.dueScenes;
        if (!page || !ids || !ids.length) return false;
        const c = page.conditions;
        return (c.switch1Valid && ids.indexOf(c.switch1Id) >= 0) || (c.switch2Valid && ids.indexOf(c.switch2Id) >= 0);
    }
    // From the moment a save is restored until the server says which run this is,
    // that scene must not start: the answer can be "someone else's run".
    function dueHeld(ev) {
        return !World.live && (World._entering || World._holdDue) && duePage(ev);
    }
    const _checkAuto = Game_Event.prototype.checkEventTriggerAuto;
    Game_Event.prototype.checkEventTriggerAuto = function () {
        if (this._trigger === 3 && (World.othersScene(this) || dueHeld(this))) return;
        _checkAuto.call(this);
    };
    const _updateParallel = Game_Event.prototype.updateParallel;
    Game_Event.prototype.updateParallel = function () {
        if (this._interpreter && !this._interpreter.isRunning() && (World.othersScene(this) || dueHeld(this))) return;
        _updateParallel.call(this);
    };
    // A save taken in the middle of one of these: joining must not finish it.
    function stopDueRunning() {
        // The world reply can land while the map file is still loading: the
        // pages are judged once it is in, before the first map update runs them.
        if (!mapReady()) { owedStop = true; return false; }
        let stopped = false;
        const halt = (interp, ev) => {
            if (!interp || !interp.isRunning() || !duePage(ev)) return;
            interp.clear();
            if (ev) ev._starting = false;
            stopped = true;
        };
        const map = $gameMap;
        if (map._interpreter) halt(map._interpreter, map.event(map._interpreter.eventId()));
        for (const ev of map.events()) halt(ev._interpreter, ev);
        return stopped;
    }

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
            // Someone in the credits of a finished run (the ending map, 86) plays nobody in this one.
            if (peer.m === 86) continue;
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
        // Already in, or a world? is already out. This sends nothing, so a due
        // scene must not stay held when that answer is not coming.
        if (World.live || World._entering) {
            if (World.live || !Coop.connected) {
                World._holdDue = false;
                if (!Coop.connected) World._entering = false;
            }
            return;
        }
        const clash = sameCharacterAs();
        World.sameAs = clash;
        if (clash) {
            World._holdDue = false;
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
        if (!Coop.connected) { World._entering = false; World._holdDue = false; } // offline: play alone, sync on reconnect
    };

    function localShared() {
        const out = [];
        const sw = $gameSwitches._data, va = $gameVariables._data, ss = $gameSelfSwitches._data;
        for (const id of worldSw) if (sw[id]) out.push(['sw', id, 1]);
        for (const id of worldVa) if (va[id]) out.push(['va', id, va[id]]);
        for (const k in ss) if (ss[k] && World.isShared('ss', k)) out.push(['ss', k, 1]);
        for (const k in World.el) if (World.isShared('el', k)) out.push(['el', k, World.el[k].slice()]);
        return out;
    }

    Coop.on('worldbusy', function () {
        World._entering = false;
        World._holdDue = false;
        World.otherRun = true;
        if (Coop.toast) Coop.toast('The others are in a different run, so you are playing this save alone. Load the save you share with them, or start a new game, to join.', 12000);
    });

    // The server took someone else as this protagonist a moment earlier.
    Coop.on('worldclash', function (msg) {
        World._entering = false;
        World._holdDue = false;
        World.sameAs = msg.name;
        if (Coop.toast) Coop.toast(msg.name + ' is already playing this character, so you are on your own in this game. Start again as someone else to play together.', 14000);
    });

    // Loading a save into a run this player has already been part of would
    // bring back a body from the past: alive again, holding things they have
    // since handed over. The run has to end, or they come back as someone new.
    Coop.on('worldstale', function (msg) {
        World._entering = false;
        World._holdDue = false;
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
        World._holdDue = false;
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

    function holdsRecruit(id) {
        const actor = (World.census.recruits || {})[id];
        if (!actor || !window.$gameParty || $gameParty._actors.indexOf(actor) < 0) return false;
        return actor !== $gameParty._actors[0];
    }

    Coop.on('world', function (msg) {
        roomBalance(msg.balance);
        World._entering = false;
        World._holdDue = false;
        World.otherRun = false;
        if (!window.$gameSwitches) return;
        const wasRun = World.runId;
        World.runId = msg.runId;
        World._how = 'again';
        World.loadedStamp = 0; // from here on the world is the live one, not a save's
        World.waiting = false;
        World.hostWait = '';
        World._swapped = false;
        World.on = null; // in it now; nothing to be pointed at
        const server = msg.world;
        let changed = false;
        // Whose flags they were was only a guess; what the run already has is the run's.
        if (World.mineGuessed && !msg.founded) for (const kind of ['sw', 'ss']) for (const key in server[kind] || {}) World.mine.delete(kind + key);
        World.mineGuessed = false;
        for (const kind of ['sw', 'va', 'ss', 'el']) {
            const table = server[kind] || {};
            for (const key in table) {
                const k = kind === 'ss' || kind === 'el' ? key : Number(key);
                if (apply(kind, k, table[key])) { changed = true; World.mine.delete(kind + k); }
            }
        }
        let mine = [];
        if (msg.mode === 'join') {
            // Arriving in someone else's world: it is exactly what the server
            // says it is. Anything this machine believed beyond that is dropped.
            for (const [kind, key, value] of localShared()) {
                if (server[kind] && key in server[kind]) continue;
                if (kind === 'el' && wasRun === msg.runId) { mine.push([kind, key, value]); continue; }
                if (kind === 'sw' && holdsRecruit(key)) { mine.push([kind, key, value]); continue; }
                if (apply(kind, key, 0)) { changed = true; World.mine.delete(kind + key); }
            }
            if (mine.length) Coop.send({ t: 'w', w: mine });
            // A carried "the scene is due" latch would autorun here and pay
            // everyone again. The founder's own, and a reconnect's, still is.
            if (stopDueRunning()) changed = true;
            for (const id of (World.census.dueScenes || [])) {
                World.mine.delete('sw' + id);
                if ($gameSwitches._data[id]) { $gameSwitches._data[id] = false; changed = true; }
            }
        } else {
            // Founding it, or back after a dropped line: what this machine
            // knows and the server does not is contributed.
            mine = localShared().filter(([kind, key]) => !(server[kind] && key in server[kind]));
            if (mine.length) Coop.send({ t: 'w', w: mine });
        }
        World.live = true;
        World.cut = false;
        if (changed && window.$gameMap) $gameMap.requestRefresh();
        Coop.note((msg.founded ? 'founded the world' : 'joined the world') + ' (' + mine.length + ' facts contributed)');
        Coop.emit('entered', msg);
    });

    Coop.on('online', function (msg) {
        if (msg) roomBalance(msg.balance);
        // Reconnected mid-game: resync from the server's copy.
        if (window.$gameSwitches && $gameSwitches.value(START) && !World.otherRun && !(SceneManager._scene instanceof Scene_Title)) {
            World.live = false;
            World._entering = false;
            World.enter();
        } else {
            // Not asking again. Whatever was in flight died with the old line.
            World._entering = false;
            World._holdDue = false;
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
        // A walk still in progress keeps the last tile it landed on, including
        // when this player leaves the run before the route finishes.
        if ($gameSystem) flushPending(true);
        if (World.live) World.flush();
        if (World.live) Coop.send({ t: 'leftworld' });
        World.live = false;
        World.waiting = false;
        World._entering = false;
        World._out = [];
    };

    // A fresh game or a loaded one starts unsynced.
    const _setupNewGame = DataManager.setupNewGame;
    DataManager.setupNewGame = function () {
        World.mineGuessed = false;
        World.leave();
        World.el = {};
        World.runId = '';
        World.mine.clear();
        World._how = 'new';
        World._swapped = false;
        _setupNewGame.call(this);
    };

    const _makeSaveContents = DataManager.makeSaveContents;
    DataManager.makeSaveContents = function () {
        const contents = _makeSaveContents.call(this);
        const el = {};
        for (const k in World.el) {
            const p = World.el[k];
            if (Array.isArray(p) && p.length === 3) el[k] = [p[0], p[1], p[2]];
        }
        contents.coop = { runId: World.runId, stamp: World.saveStamp || 0, name: Coop.name, dead: !!Coop.dead, mine: Array.from(World.mine), el: el };
        return contents;
    };

    const _extractSaveContents = DataManager.extractSaveContents;
    DataManager.extractSaveContents = function (contents) {
        World.leave();
        // Hold due-scene autoruns across the restore: the map can refresh
        // before the server has said whether this save is joining a run.
        World._holdDue = true;
        _extractSaveContents.call(this, contents);
        World.runId = contents.coop ? contents.coop.runId : '';
        // An older save does not say whose flags were whose: all of them its player's, as they were then.
        World.mineGuessed = !(contents.coop && contents.coop.mine);
        World.mine = new Set(contents.coop && contents.coop.mine ? contents.coop.mine
            : $gameSwitches._data.map((on, id) => (on ? 'sw' + id : '')).filter(Boolean).concat(Object.keys($gameSelfSwitches._data).map((k) => 'ss' + k)));
        World.loadedStamp = contents.coop ? contents.coop.stamp : 0;
        World._how = World._nextHow || 'load';
        World._nextHow = '';
        World.el = {};
        const kept = contents.coop && contents.coop.el;
        if (kept) for (const k in kept) {
            const p = kept[k];
            if (Array.isArray(p) && p.length === 3 && Number.isInteger(p[0]) && Number.isInteger(p[1]) && Number.isInteger(p[2])) World.el[k] = [p[0], p[1], p[2]];
        } else {
            // From before locations were shared: the plugin's table has them, among every wanderer.
            const home = World.census.kept || {};
            const saved = ($gameSystem && $gameSystem._savedEventLocations) || {};
            for (const k in home) {
                const p = saved[k];
                if (p && (p[0] !== home[k][0] || p[1] !== home[k][1])) World.el[k] = [p[0], p[1], p[2]];
            }
        }
        if ($gameSwitches.value(START)) World.enter();
        else World._holdDue = false;
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
        for (const k of Object.keys(World.el).sort()) {
            if (World.demoted.has('el' + k) || Coop.mapDiffers(Number(String(k).split(',')[0]))) continue;
            const p = World.el[k];
            if (p) parts.push('e' + k + '=' + p[0] + ':' + p[1] + ':' + p[2]);
        }
        return parts.join(';');
    };
})();
