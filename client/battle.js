//=============================================================================
// fh-coop: fighting together. Whoever touches the enemy runs the real battle.
// Players nearby lend their characters to that party for the fight, watch the
// owner's screen as a stream, and send their key presses back. Each player
// commands only their own characters.
//=============================================================================
(function () {
    const JOIN_RANGE = 6; // tiles; closer players are pulled into the fight
    const JOIN_WAIT = 3500; // ms the first turn waits for their answer
    const FRAME_GAP = 50; // ms between relayed stills (20 a second) when live video is not available
    const FRAME = 1; // binary message kind

    Coop.battle = null;

    //=========================================================================
    // Streaming this machine's screen to watchers (battle guests, the dead)
    //=========================================================================

    const Stream = Coop.stream = { watchers: new Set(), _busy: false, _last: 0, _canvas: null, _ctx: null, _audioDepth: 0 };

    Stream.add = function (id) {
        Stream.watchers.add(id);
        Coop.sendTo(id, 'baud', { f: 'sync', a: [AudioManager._currentBgm, AudioManager._currentBgs] });
    };
    Stream.remove = function (id) { Stream.watchers.delete(id); };
    Coop.on('leave', function (peer) { Stream.watchers.delete(peer.id); });

    Stream.capture = function () {
        if (!Stream.watchers.size || Stream._busy) return;
        // Watchers on live video (video.js) need no stills.
        const targets = Stream.onVideo && Stream.onVideo.size ? Array.from(Stream.watchers).filter((id) => !Stream.onVideo.has(id)) : Array.from(Stream.watchers);
        if (!targets.length) return;
        // A link that cannot keep up gets fewer, lighter frames rather
        // than a growing queue of stale ones.
        const backlog = Coop._ws ? Coop._ws.bufferedAmount : 0;
        const slow = backlog > 250000;
        const now = performance.now();
        // A watcher's key press is answered with a picture at once.
        if (!Stream._urgent && now - Stream._last < (slow ? FRAME_GAP * 2.5 : FRAME_GAP)) return;
        Stream._urgent = false;
        Stream._last = now;
        const quality = slow ? 0.4 : 0.55;
        // A battle guest's own canvas is hidden behind the picture they are
        // being sent; anyone watching them is shown that picture instead.
        const src = Viewer.active && Viewer.el ? (Viewer.pictureSource ? Viewer.pictureSource() : Viewer.el) : Graphics._canvas;
        if (!Stream._canvas) {
            Stream._canvas = document.createElement('canvas');
            Stream._ctx = Stream._canvas.getContext('2d', { alpha: false });
        }
        const c = Stream._canvas;
        if (c.width !== Graphics.width || c.height !== Graphics.height) { c.width = Graphics.width; c.height = Graphics.height; }
        Stream._ctx.drawImage(src, 0, 0, c.width, c.height);
        Stream._busy = true;
        const grabbedAt = Date.now();
        c.toBlob(function (blob) {
            if (!blob) { Stream._busy = false; return; }
            blob.arrayBuffer().then(function (jpeg) {
                Stream._busy = false;
                // The time the picture was taken rides behind the image data
                // (decoders ignore it); the lag meter and tests read it.
                const buf = new ArrayBuffer(jpeg.byteLength + 8);
                new Uint8Array(buf).set(new Uint8Array(jpeg));
                new DataView(buf).setFloat64(jpeg.byteLength, grabbedAt);
                for (const id of targets) if (Stream.watchers.has(id)) Coop.sendBinary(FRAME, id, buf);
            }, function () { Stream._busy = false; });
        }, 'image/jpeg', quality);
    };

    // Capture only on frames the engine actually drew; the WebGL buffer is
    // gone once the browser has presented it.
    const _render = Graphics.render;
    Graphics.render = function (stage) {
        _render.call(this, stage);
        if (this._rendered || Viewer.active) Stream.capture();
    };

    // Sound is not in the picture, so the calls that make it are replayed on
    // the watcher's machine from their own copy of the files.
    const AUDIO_CALLS = ['playBgm', 'stopBgm', 'fadeOutBgm', 'fadeInBgm', 'playBgs', 'stopBgs', 'fadeOutBgs', 'fadeInBgs',
        'playMe', 'stopMe', 'fadeOutMe', 'playSe', 'stopSe', 'playStaticSe'];
    for (const name of AUDIO_CALLS) {
        const orig = AudioManager[name];
        AudioManager[name] = function () {
            const top = Stream._audioDepth === 0;
            Stream._audioDepth++;
            try { return orig.apply(this, arguments); } finally {
                Stream._audioDepth--;
                if (top && Stream.watchers.size && !Viewer.active) {
                    const args = Array.prototype.slice.call(arguments);
                    for (const id of Stream.watchers) Coop.sendTo(id, 'baud', { f: name, a: args });
                }
            }
        };
    }

    //=========================================================================
    // Watching someone else's screen
    //=========================================================================

    const Viewer = Coop.viewer = { active: false, from: 0, el: null, ctx: null, _seq: 0, _drawn: 0, frames: 0, _savedBgm: null, _savedBgs: null };

    Viewer.show = function (fromId) {
        if (!Viewer.el) {
            const el = document.createElement('canvas');
            el.id = 'coop-view';
            el.style.zIndex = 5;
            el.style.background = '#000';
            document.body.appendChild(el);
            Viewer.el = el;
            Viewer.ctx = el.getContext('2d', { alpha: false });
        }
        Viewer.el.width = Graphics.width;
        Viewer.el.height = Graphics.height;
        Viewer.ctx.fillStyle = '#000';
        Viewer.ctx.fillRect(0, 0, Graphics.width, Graphics.height);
        Graphics._centerElement(Viewer.el);
        Viewer.el.style.display = '';
        if (!Viewer.active) {
            Viewer._savedBgm = AudioManager.saveBgm();
            Viewer._savedBgs = AudioManager.saveBgs();
        }
        Viewer.active = true;
        Viewer.from = fromId;
        Viewer.frames = 0;
        Viewer.lastFrameAt = Date.now();
    };

    Viewer.hide = function () {
        if (!Viewer.active) return;
        Viewer.active = false;
        Viewer.from = 0;
        if (Viewer.el) Viewer.el.style.display = 'none';
        AudioManager.stopMe();
        AudioManager.stopSe();
        if (Viewer._savedBgm) AudioManager.replayBgm(Viewer._savedBgm); else AudioManager.stopBgm();
        if (Viewer._savedBgs) AudioManager.replayBgs(Viewer._savedBgs); else AudioManager.stopBgs();
    };

    const _updateAllElements = Graphics._updateAllElements;
    Graphics._updateAllElements = function () {
        _updateAllElements.call(this);
        if (Viewer.el) Graphics._centerElement(Viewer.el);
    };

    Coop.onBinary(FRAME, function (fromId, buffer) {
        if (!Viewer.active || fromId !== Viewer.from) return;
        const seq = ++Viewer._seq;
        const grabbedAt = buffer.byteLength > 8 ? new DataView(buffer).getFloat64(buffer.byteLength - 8) : 0;
        createImageBitmap(new Blob([buffer], { type: 'image/jpeg' })).then(function (bmp) {
            if (seq > Viewer._drawn && Viewer.active) {
                Viewer._drawn = seq;
                Viewer.ctx.drawImage(bmp, 0, 0, Viewer.el.width, Viewer.el.height);
                Viewer.frames++;
                Viewer.lastFrameAt = Date.now();
                if (Viewer.ages && grabbedAt) Viewer.ages.push(Date.now() - grabbedAt);
            }
            bmp.close();
        }, function () { /* a broken frame; the next one replaces it */ });
    });

    Coop.on('to:baud', function (msg) {
        if (!Viewer.active || msg.from !== Viewer.from) return;
        for (const id of Stream.watchers) Coop.sendTo(id, 'baud', { f: msg.f, a: msg.a });
        if (msg.f === 'sync') {
            if (msg.a[0] && msg.a[0].name) AudioManager.playBgm(msg.a[0]); else AudioManager.stopBgm();
            if (msg.a[1] && msg.a[1].name) AudioManager.playBgs(msg.a[1]); else AudioManager.stopBgs();
        } else if (AUDIO_CALLS.indexOf(msg.f) >= 0) {
            AudioManager[msg.f].apply(AudioManager, msg.a);
        }
    });

    // The watcher's keys, sent whenever they change.
    let lastKeys = '';
    let lastKeysAt = 0;
    Viewer.sendKeys = function (kind) {
        const state = {};
        for (const name in Input._currentState) if (Input._currentState[name]) state[name] = 1;
        const text = JSON.stringify(state);
        const now = Date.now();
        if (text === lastKeys && now - lastKeysAt < 500) return;
        lastKeys = text;
        lastKeysAt = now;
        Coop.sendTo(Viewer.from, kind, { s: state });
    };

    //=========================================================================
    // The scene a battle guest sits in
    //=========================================================================

    function Scene_CoopSpectate() { this.initialize.apply(this, arguments); }
    Scene_CoopSpectate.prototype = Object.create(Scene_Base.prototype);
    Scene_CoopSpectate.prototype.constructor = Scene_CoopSpectate;
    window.Scene_CoopSpectate = Scene_CoopSpectate;

    Scene_CoopSpectate.prototype.start = function () {
        Scene_Base.prototype.start.call(this);
        const b = Coop.battle;
        if (b && b.role === 'guest') Viewer.show(b.owner);
    };

    Scene_CoopSpectate.prototype.update = function () {
        Scene_Base.prototype.update.call(this);
        const b = Coop.battle;
        if (!b || b.role !== 'guest') {
            if (!SceneManager.isSceneChanging()) this.popScene();
            return;
        }
        Viewer.sendKeys('bin');
        // No picture for a while (their tab is hidden, their machine hung):
        // offer a way out, back to how this player was before the fight.
        if (Date.now() - Viewer.lastFrameAt > 6000) {
            if (!b.warned || Date.now() - b.warned > 4000) {
                b.warned = Date.now();
                Coop.toast('No picture from ' + peerName(b.owner) + '. Hold Esc to step out of the fight.', 4000);
            }
            b.quitHeld = Input.isPressed('cancel') || Input.isPressed('escape') ? (b.quitHeld || 0) + 1 : 0;
            if (b.quitHeld > 60) {
                Coop.sendTo(b.owner, 'bquit', {});
                restoreParty(JSON.parse(b.backup));
                leaveSpectate();
            }
        } else {
            b.quitHeld = 0;
        }
    };

    Scene_CoopSpectate.prototype.terminate = function () {
        Scene_Base.prototype.terminate.call(this);
        Viewer.hide();
    };

    function peerName(id) {
        const p = Coop.peers.get(id);
        return p ? p.name : 'the other player';
    }

    // Whose turn it is, kept on screen for as long as it is true. A fight
    // waiting on a player who has not noticed looks exactly like a freeze.
    const turnBox = document.createElement('div');
    turnBox.id = 'coop-turn';
    turnBox.style.cssText = 'position:fixed;left:50%;top:1.5%;transform:translateX(-50%);z-index:57;pointer-events:none;display:none;'
        + 'font:17px Georgia,"Times New Roman",serif;padding:5px 16px;border:1px solid #6b5a45;background:rgba(14,9,8,0.82);color:#e8dcc0;white-space:nowrap;';
    (document.body ? Promise.resolve() : new Promise((r) => window.addEventListener('DOMContentLoaded', r))).then(() => document.body.appendChild(turnBox));
    function showTurn(text, mine) {
        if (!text) { turnBox.style.display = 'none'; return; }
        const scale = Math.max(1, Math.min(2.4, (Graphics._realScale || 1) * 0.75));
        turnBox.style.fontSize = Math.round(17 * scale) + 'px';
        turnBox.style.color = mine ? '#f2d28a' : '#b9ad98';
        turnBox.style.borderColor = mine ? '#b08a3c' : '#4a3c30';
        turnBox.textContent = text;
        turnBox.style.display = '';
    }

    //=========================================================================
    // Guest side: lending characters to someone else's fight
    //=========================================================================

    function partySnapshot() {
        return {
            actors: $gameParty._actors.map((id) => [id, JsonEx.stringify($gameActors.actor(id))]),
            inv: { items: $gameParty._items, weapons: $gameParty._weapons, armors: $gameParty._armors },
        };
    }

    // Empty when this player is free to step into someone's fight;
    // otherwise the reason they are not.
    function whyNotJoin() {
        if (!Coop.world.live) return 'not in the world yet';
        if (Coop.battle) return 'already in a fight';
        if (Coop.dead) return 'dead';
        const scene = SceneManager._scene;
        if (!(scene instanceof Scene_Map) || SceneManager.isSceneChanging() || !scene.isActive()) return 'not on the map';
        if (scene._fadeDuration > 0) return 'map still fading in';
        if ($gamePlayer.isTransferring()) return 'changing maps';
        if ($gameMessage.isBusy() || $gameMap.isEventRunning()) return 'busy with an event';
        const leader = $gameParty.leader();
        return leader && leader.isAlive() ? '' : 'no living character';
    }
    function canJoin() { return !whyNotJoin(); }

    // A player caught mid-step (walking through a door, a map still fading
    // in) is not refusing; they answer as soon as they are free. The owner
    // lets latecomers in at the start of the next turn.
    const PASSING = ['map still fading in', 'changing maps', 'not on the map'];

    function answerInvite(msg, triesLeft) {
        const why = whyNotJoin();
        if (why && PASSING.indexOf(why) >= 0 && triesLeft > 0 && Coop.peers.has(msg.from)) {
            setTimeout(function () { answerInvite(msg, triesLeft - 1); }, 150);
            return;
        }
        if (why) {
            Coop.note('stayed out of ' + peerName(msg.from) + "'s fight: " + why);
            Coop.sendTo(msg.from, 'bdecline', {});
            return;
        }
        const snap = partySnapshot();
        Coop.battle = { role: 'guest', owner: msg.from, backup: JSON.stringify(snap), since: Date.now(), mine: [] };
        Coop.sendTo(msg.from, 'bjoin', snap);
        SceneManager.push(Scene_CoopSpectate);
        Coop.reportPresence(true);
    }

    Coop.on('to:binvite', function (msg) {
        answerInvite(msg, 20);
    });

    Coop.on('to:bsync', function (msg) {
        const b = Coop.battle;
        if (b && b.role === 'guest' && b.owner === msg.from && Array.isArray(msg.actors)) b.backup = JSON.stringify({ actors: msg.actors, inv: msg.inv });
    });

    Coop.on('to:bwait', function (msg) {
        const b = Coop.battle;
        if (b && b.role === 'guest' && b.owner === msg.from) Coop.toast('You join the fight at the start of the next turn.', 4000);
    });

    Coop.on('to:bstart', function (msg) {
        const b = Coop.battle;
        if (b && b.role === 'guest' && b.owner === msg.from) b.mine = msg.actors;
    });

    Coop.on('to:bctl', function (msg) {
        const b = Coop.battle;
        if (!b || b.role !== 'guest' || b.owner !== msg.from) return;
        if (msg.who === Coop.id) showTurn('Your turn: choose for ' + msg.actor, true);
        else if (msg.who === -1) showTurn('Anyone may choose for ' + msg.actor, true);
        else if (msg.who) showTurn(peerName(msg.who) + ' is choosing for ' + msg.actor, false);
        else showTurn('', false);
    });

    function restoreParty(snap) {
        for (const [id, json] of snap.actors) $gameActors._data[id] = JsonEx.parse(json);
        $gameParty._items = snap.inv.items;
        $gameParty._weapons = snap.inv.weapons;
        $gameParty._armors = snap.inv.armors;
        $gamePlayer.refresh();
    }

    function leaveSpectate() {
        showTurn('', false);
        Coop.battle = null;
        Coop.reportPresence(true);
    }

    Coop.on('to:bend', function (msg) {
        const b = Coop.battle;
        if (!b || b.role !== 'guest' || b.owner !== msg.from) return;
        if (msg.aborted) {
            restoreParty(JSON.parse(b.backup));
            if (msg.reason) Coop.toast(msg.reason);
            leaveSpectate();
            return;
        }
        restoreParty(msg);
        leaveSpectate();
        if (msg.won) Coop.toast('The fight is won. Anything it dropped went to ' + msg.by + ', who started it.', 5000);
        const leader = $gameParty.leader();
        if (!leader || leader.isDead()) {
            // This player's own character fell in the fight. The game ends a
            // run on that from inside its battle scripts, which ran on the
            // owner's machine for the owner's character only.
            Coop.afterSpectate = function () { SceneManager.goto(Scene_Gameover); };
        }
    });

    // Runs once the guest is back on the map scene.
    const _mapStart = Scene_Map.prototype.start;
    Scene_Map.prototype.start = function () {
        _mapStart.call(this);
        if (Coop.afterSpectate) {
            const fn = Coop.afterSpectate;
            Coop.afterSpectate = null;
            fn();
        }
    };

    // A fight this player dropped out of (crashed tab, closed laptop) ended
    // without them; the host kept what became of their characters.
    let owed = null;
    Coop.on('owed', function (msg) { owed = msg; });
    Coop.settleOwed = function () {
        if (!owed || Coop.battle || Coop.dead || !(SceneManager._scene instanceof Scene_Map) || $gameMap.isEventRunning()) return;
        const msg = owed;
        owed = null;
        restoreParty(msg);
        Coop.toast('The fight you dropped out of ended without you. Your characters carry what happened to them there.', 7000);
        const leader = $gameParty.leader();
        if (!leader || leader.isDead()) SceneManager.goto(Scene_Gameover);
    };
    const _mapUpdateOwed = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function () {
        _mapUpdateOwed.call(this);
        if (owed) Coop.settleOwed();
    };

    Coop.on('leave', function (peer) {
        const b = Coop.battle;
        if (b && b.role === 'guest' && b.owner === peer.id) {
            restoreParty(JSON.parse(b.backup));
            Coop.toast(peer.name + ' dropped out of the fight.');
            leaveSpectate();
        }
    });

    //=========================================================================
    // Asking to join a fight already under way
    //=========================================================================

    let lastAsk = 0;
    Coop.askToJoinBattle = function (peerId) {
        if (!canJoin(false) || Date.now() - lastAsk < 1500) return;
        lastAsk = Date.now();
        Coop.sendTo(peerId, 'bask', {});
    };

    Coop.on('to:bask', function (msg) {
        const b = Coop.battle;
        if (b && b.role === 'owner') {
            if (!b.guests.has(msg.from) && !b.invited.has(msg.from)) {
                b.invited.set(msg.from, Date.now() + JOIN_WAIT);
                Coop.sendTo(msg.from, 'binvite', { auto: false });
            }
        } else if (b && b.role === 'guest') {
            Coop.sendTo(msg.from, 'bredirect', { to: b.owner });
        }
    });

    Coop.on('to:bredirect', function (msg) {
        if (Coop.peers.has(msg.to) && canJoin(false)) Coop.sendTo(msg.to, 'bask', {});
    });

    // Pressing the action key at another player: join their fight if they
    // are in one, otherwise hand them something. Anything the map itself
    // has to offer on that tile comes first.
    const _triggerButtonAction = Game_Player.prototype.triggerButtonAction;
    Game_Player.prototype.triggerButtonAction = function () {
        if (_triggerButtonAction.call(this)) return true;
        if (Input.isTriggered('ok') && Coop.world.live && !$gameMap.isEventRunning() && !$gameMap.isAnyEventStarting()) {
            const peer = Coop.peerInReach();
            if (peer && peer.st === 'battle') { Coop.askToJoinBattle(peer.id); return true; }
            if (peer && (peer.st === 'map' || peer.st === 'event') && Coop.offerGift) return Coop.offerGift(peer);
        }
        return false;
    };

    //=========================================================================
    // Owner side
    //=========================================================================

    const _setup = BattleManager.setup;
    BattleManager.setup = function (troopId, canEscape, canLose) {
        _setup.call(this, troopId, canEscape, canLose);
        if (!Coop.world.live || (Coop.battle && Coop.battle.role === 'guest')) return;
        const b = Coop.battle = {
            role: 'owner',
            guests: new Map(), // player id -> { actors: [ids], inv, input }
            invited: new Map(), // player id -> deadline
            pending: [],
            invOf: 0, // whose inventory $gameParty is holding right now (0 = mine)
            myInv: null,
            ctl: '',
            eventId: $gameMap._interpreter.eventId(),
            mapId: $gameMap.mapId(),
        };
        if (b.eventId) Coop.events.sendHold(b.eventId, 'battle');
        Coop.note('fight: troop ' + troopId + (b.eventId ? ' from event ' + b.eventId : '') + ' on map ' + b.mapId);
        for (const peer of Coop.peersHere()) {
            if ((peer.st === 'map' || peer.st === 'event') && Coop.distanceTo(peer) <= JOIN_RANGE) {
                b.invited.set(peer.id, Date.now() + JOIN_WAIT);
                Coop.sendTo(peer.id, 'binvite', { auto: true });
            }
        }
    };

    Coop.on('to:bjoin', function (msg) {
        const b = Coop.battle;
        if (!b || b.role !== 'owner' || !BattleManager._phase || BattleManager._phase === 'battleEnd') {
            Coop.sendTo(msg.from, 'bend', { aborted: true });
            return;
        }
        b.invited.delete(msg.from);
        b.pending.push(msg);
        Coop.note(peerName(msg.from) + ' asks into this fight' + (b.started ? ' (under way: in at the next turn)' : ''));
        // Someone who joins once the fight is under way comes in at the next
        // turn. They watch from now, not a black screen until then.
        if (b.started) {
            Stream.add(msg.from);
            Coop.sendTo(msg.from, 'bwait', {});
        }
    });

    // A guest gave up on a frozen picture. Their characters fight on under
    // the owner's hand; nothing from here on is sent back to them.
    Coop.on('to:bquit', function (msg) {
        const b = Coop.battle;
        const g = b && b.role === 'owner' ? b.guests.get(msg.from) : null;
        if (g) { g.quit = true; Stream.remove(msg.from); }
    });

    Coop.on('to:bdecline', function (msg) {
        const b = Coop.battle;
        if (b && b.role === 'owner') b.invited.delete(msg.from);
    });

    function ownerOf(actorId) {
        const b = Coop.battle;
        if (!b || b.role !== 'owner') return 0;
        for (const [id, g] of b.guests) if (!g.quit && g.actors.indexOf(actorId) >= 0 && Coop.peers.has(id)) return id;
        return 0;
    }

    // Leaders stand in front so every player's own character is on screen.
    function guestActorIds(b) {
        const ids = new Set();
        for (const g of b.guests.values()) for (const id of g.actors) ids.add(id);
        return ids;
    }

    function arrangeParty(b) {
        const lent = guestActorIds(b);
        const mine = $gameParty._actors.filter((id) => !lent.has(id));
        const lead = mine.slice(0, 1);
        const rest = mine.slice(1);
        for (const g of b.guests.values()) {
            lead.push(g.actors[0]);
            rest.push.apply(rest, g.actors.slice(1));
        }
        $gameParty._actors = lead.concat(rest);
    }

    function integrate(b) {
        if (!b.pending.length) return;
        for (const msg of b.pending.splice(0)) {
            if (!Coop.peers.has(msg.from)) continue;
            // A character both players hold cannot be lent; without the
            // guest's own character there is nothing to join with.
            const free = msg.actors.filter(([id]) => $gameParty._actors.indexOf(id) < 0);
            if (!free.length || free[0][0] !== msg.actors[0][0]) {
                Coop.sendTo(msg.from, 'bend', { aborted: true, reason: 'You cannot join: your character is already in that party.' });
                continue;
            }
            const taken = [];
            const prior = {}; // what this world had under those ids, put back afterwards
            for (const [id, json] of free) {
                prior[id] = $gameActors._data[id];
                $gameActors._data[id] = JsonEx.parse(json);
                taken.push(id);
            }
            b.guests.set(msg.from, { name: peerName(msg.from), actors: taken, prior, inv: msg.inv, input: {}, inputAt: Date.now() });
            arrangeParty(b);
            for (const id of taken) $gameActors.actor(id).onBattleStart();
            Coop.sendTo(msg.from, 'bstart', { actors: taken });
            Stream.add(msg.from);
            Coop.toast(peerName(msg.from) + ' joins the fight.', 2500);
        }
        const scene = SceneManager._scene;
        if (scene && scene._statusWindow) scene._statusWindow.refresh();
    }

    // What a guest's characters and bag look like right now, in the shape
    // the guest's machine takes them back in.
    function guestState(b, id, g) {
        const bag = b.invOf === id ? { items: $gameParty._items, weapons: $gameParty._weapons, armors: $gameParty._armors } : g.inv;
        return { actors: g.actors.map((aid) => [aid, JsonEx.stringify($gameActors.actor(aid))]), inv: bag };
    }

    // After every round each guest is sent their characters as they stand.
    // If the fight is cut short for them (their picture stalls, the owner
    // vanishes) they keep the wounds of the rounds already fought instead of
    // snapping back to how they walked in.
    const _endTurn = BattleManager.endTurn;
    BattleManager.endTurn = function () {
        _endTurn.call(this);
        const b = Coop.battle;
        if (!b || b.role !== 'owner') return;
        for (const [id, g] of b.guests) if (!g.quit && Coop.peers.has(id)) Coop.sendTo(id, 'bsync', guestState(b, id, g));
    };

    // Each turn starts by letting in whoever asked. The very first turn waits
    // a moment for the players standing next to the fight to answer.
    const _startInput = BattleManager.startInput;
    BattleManager.startInput = function () {
        const b = Coop.battle;
        if (b && b.role === 'owner') {
            const now = Date.now();
            for (const [id, deadline] of b.invited) if (now > deadline || !Coop.peers.has(id)) b.invited.delete(id);
            if (b.invited.size) return; // phase is unchanged, so this is asked again next frame
            integrate(b);
            b.started = true;
        }
        _startInput.call(this);
    };

    //--- whose keys count ---------------------------------------------------

    const IDLE_TURN = 25000; // ms a guest may sit on their turn before anyone can take it

    function controller(b) {
        if (BattleManager.isInputting() && BattleManager.actor()) {
            const who = ownerOf(BattleManager.actor().actorId()) || Coop.id;
            if (who !== Coop.id) {
                // A guest who has walked away from the keyboard does not hold
                // the fight hostage: after a while anyone may choose for them.
                const g = b.guests.get(who);
                const since = Math.max(b.ctlAt || 0, g ? g.touchedAt || 0 : 0);
                if (since && Date.now() - since > IDLE_TURN) return 0;
            }
            return who;
        }
        return 0; // messages, choices, the party command: anyone may press
    }

    Coop.on('to:bin', function (msg) {
        const b = Coop.battle;
        const g = b && b.role === 'owner' ? b.guests.get(msg.from) : null;
        if (g) {
            if (JSON.stringify(g.input) !== JSON.stringify(msg.s || {})) { Stream._urgent = true; g.touchedAt = Date.now(); }
            g.input = msg.s || {};
            g.inputAt = Date.now();
        }
    });

    const _inputUpdate = Input.update;
    Input.update = function () {
        const b = Coop.battle;
        if (!b || b.role !== 'owner' || !b.guests.size || !(SceneManager._scene instanceof Scene_Battle)) return _inputUpdate.call(this);
        const who = controller(b);
        const local = this._currentState;
        let state;
        const chooser = who && who !== Coop.id ? b.guests.get(who) : null;
        if (who === Coop.id) state = local;
        else {
            // Every key the engine has seen must be present, pressed or not,
            // or a key held when control changed hands would never register
            // as released.
            state = {};
            for (const k in this._previousState) state[k] = false;
            // A guest whose machine has gone silent does not get to stall the fight.
            if (chooser && Date.now() - chooser.inputAt < 5000) {
                for (const k in chooser.input) state[k] = !!chooser.input[k];
            } else {
                for (const k in local) state[k] = !!local[k];
                for (const g of b.guests.values()) for (const k in g.input) if (g.input[k]) state[k] = true;
            }
        }
        // The pad is read into the real state first; its press and release
        // edges would otherwise be lost in the stand-in object.
        const poll = this._pollGamepads;
        if (state !== local) {
            poll.call(this);
            this._pollGamepads = function () {};
        }
        this._currentState = state;
        try { _inputUpdate.call(this); } finally {
            this._currentState = local;
            this._pollGamepads = poll;
        }
    };

    //--- players who choose by message (the AI partner) ---------------------

    // What the fight looks like to someone choosing for `actor`, in words: a
    // model reads this. Wounds are described, never counted, as the game
    // itself never shows an enemy's numbers.
    function condition(b) {
        if (b.isDead() || b.hp <= 0) return b.isEnemy() ? 'gone' : 'down';
        const f = b.hp / Math.max(1, b.mhp);
        return f >= 0.99 ? 'unhurt' : f >= 0.75 ? 'scratched' : f >= 0.4 ? 'hurt' : f > 0.15 ? 'badly hurt' : 'near death';
    }
    // States the game uses as internal machinery are named in capitals.
    function stateNames(b) {
        return b.states().map((s) => s.name).filter((n) => n && n !== n.toUpperCase());
    }
    const battleLog = [];
    const _addText = Window_BattleLog.prototype.addText;
    Window_BattleLog.prototype.addText = function (text) {
        _addText.call(this, text);
        const line = Coop.plainText ? Coop.plainText(text).text : String(text);
        if (line && battleLog[battleLog.length - 1] !== line) battleLog.push(line);
        if (battleLog.length > 40) battleLog.shift();
    };
    const _battleStart = BattleManager.startBattle;
    BattleManager.startBattle = function () {
        battleLog.length = 0;
        _battleStart.call(this);
    };

    Coop.battleBrief = function (actor) {
        const b = Coop.battle;
        const whose = function (a) {
            const owner = b && b.role === 'owner' ? ownerOf(a.actorId()) : 0;
            return owner ? peerName(owner) : Coop.name;
        };
        const brief = {
            turn: $gameTroop.turnCount() + 1,
            you: actor.name(),
            enemies: $gameTroop.members().map((e, i) => ({ i, name: e.name(), how: condition(e), states: stateNames(e) })).filter((e) => e.how !== 'gone' || /\[/.test(e.name)),
            allies: $gameParty.battleMembers().map((a, i) => ({ i, name: a.name(), player: whose(a), hp: a.hp, mhp: a.mhp, how: condition(a), states: stateNames(a) })),
            attack: { weapon: (actor.weapons()[0] || { name: 'bare hands' }).name },
            skills: actor.skills().filter((k) => k.name).map((k) => ({ id: k.id, name: k.name, usable: actor.canUse(k), about: String(k.description || '').replace(/\s+/g, ' ').trim().slice(0, 140) })),
            items: [],
            log: battleLog.slice(-12),
        };
        const list = function () {
            return $gameParty.items().filter((it) => it.occasion === 0 || it.occasion === 1).filter((it) => actor.canUse(it))
                .map((it) => ({ id: it.id, name: it.name, count: $gameParty.numItems(it), about: String(it.description || '').replace(/\s+/g, ' ').trim().slice(0, 120) }));
        };
        brief.items = withBagOf(actor, list);
        return brief;
    };

    // Sets the move for the character choosing right now, on the machine
    // running the fight. Returns '' when done, or why it could not be.
    Coop.applyPick = function (actor, pick) {
        const scene = SceneManager._scene;
        if (!(scene instanceof Scene_Battle) || !BattleManager.isInputting() || BattleManager.actor() !== actor) return 'not their turn';
        const action = BattleManager.inputtingAction();
        if (!action || !pick) return 'nothing to set';
        const kind = pick.do;
        if (kind === 'guard') action.setGuard();
        else if (kind === 'skill') {
            const skill = $dataSkills[Number(pick.id)];
            if (!skill || actor.skills().indexOf(skill) < 0 || !actor.canUse(skill)) return 'cannot use that skill';
            action.setSkill(skill.id);
        } else if (kind === 'item') {
            const item = $dataItems[Number(pick.id)];
            const ok = withBagOf(actor, () => !!item && $gameParty.numItems(item) > 0 && actor.canUse(item));
            if (!ok) return 'cannot use that item';
            action.setItem(item.id);
        } else action.setAttack();
        if (action.needsSelection()) {
            const unit = action.isForOpponent() ? $gameTroop : $gameParty;
            const members = action.isForOpponent() ? unit.members() : unit.battleMembers();
            let index = Number(pick.target);
            const target = members[index];
            const fits = target && (action.isForDeadFriend() ? target.isDead() : target.isAlive());
            if (!fits) {
                if (action.isForOpponent()) {
                    // Missing or gone: the first part still standing.
                    index = members.findIndex((m) => m.isAlive());
                } else index = members.indexOf(actor);
                if (index < 0) return 'no one to target';
            }
            action.setTarget(index);
        }
        // A key press would have deactivated the command window on its way here;
        // the round does not run while any input window is still active.
        for (const w of [scene._actorCommandWindow, scene._partyCommandWindow]) if (w) w.deactivate();
        for (const w of [scene._skillWindow, scene._itemWindow, scene._enemyWindow, scene._actorWindow]) if (w) { w.deactivate(); w.hide(); }
        scene.selectNextCommand();
        return '';
    };

    Coop.on('to:bpick', function (msg) {
        const b = Coop.battle;
        const g = b && b.role === 'owner' ? b.guests.get(msg.from) : null;
        if (!g || g.quit || g.actors.indexOf(msg.actor) < 0) return;
        // An answer to a turn that has since passed (it took too long, someone chose for it) is dropped.
        if (msg.seq !== b.turnSeq) return;
        const actor = $gameActors.actor(msg.actor);
        const why = Coop.applyPick(actor, msg.pick);
        if (why) Coop.sendTo(msg.from, 'bturn', { actor: msg.actor, seq: b.turnSeq, brief: BattleManager.actor() === actor ? Coop.battleBrief(actor) : null, err: why });
        else g.touchedAt = Date.now();
    });

    //--- a well-timed guard ---------------------------------------------------

    // Guarding as an enemy winds up (the guard's charge, and many more) makes
    // the attack miss. The game decides that with switch 1281, set by its
    // "Just Guard" event, which only asks whether THE protagonist is guarding:
    // on the machine running the fight that is the owner's character alone.
    // In a shared fight every player's own character counts.
    const JUST_GUARD = 1281;
    const GUARD_STATE = 2;
    function playersGuarding() {
        const b = Coop.battle;
        if (!b || b.role !== 'owner' || !b.guests.size) return false;
        const leads = [$gameParty._actors.filter((id) => !guestActorIds(b).has(id))[0]];
        for (const g of b.guests.values()) if (!g.quit) leads.push(g.actors[0]);
        return leads.some((id) => { const a = id && $gameActors.actor(id); return !!a && a.isAlive() && a.isStateAffected(GUARD_STATE); });
    }
    const _command111 = Game_Interpreter.prototype.command111;
    Game_Interpreter.prototype.command111 = function () {
        const p = this._params;
        if (p[0] === 0 && p[1] === JUST_GUARD && $gameParty.inBattle() && !$gameSwitches.value(JUST_GUARD) && playersGuarding()) {
            $gameSwitches.setValue(JUST_GUARD, true);
        }
        return _command111.call(this);
    };
    Coop.playersGuarding = playersGuarding;

    //--- whose items are used -----------------------------------------------

    function holdInventory(b, who) {
        if (b.invOf === who) return;
        const current = { items: $gameParty._items, weapons: $gameParty._weapons, armors: $gameParty._armors };
        if (b.invOf === 0) b.myInv = current; else if (b.guests.has(b.invOf)) b.guests.get(b.invOf).inv = current;
        const next = who === 0 ? b.myInv : b.guests.get(who).inv;
        $gameParty._items = next.items;
        $gameParty._weapons = next.weapons;
        $gameParty._armors = next.armors;
        b.invOf = who;
    }

    function inventoryOwner(b) {
        if (b.over) return 0;
        if (BattleManager.isInputting() && BattleManager.actor()) return ownerOf(BattleManager.actor().actorId());
        const subject = BattleManager._subject;
        if (subject && subject.isActor()) return ownerOf(subject.actorId());
        return 0;
    }

    // Item checks and item use can happen in the same frame the acting
    // character changes, so they look in the right bag themselves.
    function withBagOf(battler, fn) {
        const b = Coop.battle;
        if (!b || b.role !== 'owner' || !b.guests.size) return fn();
        const before = b.invOf;
        holdInventory(b, battler.isActor() ? ownerOf(battler.actorId()) : 0);
        try { return fn(); } finally { holdInventory(b, before); }
    }
    const _meetsItemConditions = Game_BattlerBase.prototype.meetsItemConditions;
    Game_BattlerBase.prototype.meetsItemConditions = function (item) {
        return withBagOf(this, () => _meetsItemConditions.call(this, item));
    };
    const _consumeItem = Game_Battler.prototype.consumeItem;
    Game_Battler.prototype.consumeItem = function (item) {
        withBagOf(this, () => _consumeItem.call(this, item));
    };

    // Spoils and anything else handed out as the fight ends go in the bag
    // of the player who started it, not of whoever struck last.
    for (const name of ['processVictory', 'processEscape', 'processAbort', 'processDefeat']) {
        const orig = BattleManager[name];
        BattleManager[name] = function () {
            const b = Coop.battle;
            if (b && b.role === 'owner') {
                b.over = true;
                if (name === 'processVictory') b.won = true;
                // How it ended, for whoever was told only "it is over".
                if (!b.end) b.end = { processVictory: 'won', processEscape: 'fled', processAbort: 'broke off', processDefeat: 'lost' }[name];
                if (b.guests.size) holdInventory(b, 0);
            }
            return orig.apply(this, arguments);
        };
    }

    // Scene_Battle only runs BattleManager.update between inputs, so this
    // hangs off the scene, which updates every frame.
    const _sceneBattleUpdate = Scene_Battle.prototype.update;
    Scene_Battle.prototype.update = function () {
        const b = Coop.battle;
        if (b && b.role === 'owner' && b.guests.size) {
            holdInventory(b, inventoryOwner(b));
            const who = controller(b);
            const key = who + ':' + (BattleManager.actor() ? BattleManager.actor().actorId() : 0);
            // Which action is being chosen: a character with two actions a turn chooses twice.
            const turnKey = (BattleManager.isInputting() && BattleManager.actor() ? BattleManager.actor().actorId() + '.' + BattleManager.actor()._actionInputIndex : 0) + ':' + BattleManager.isInputting();
            if (turnKey !== b.turnKey) {
                b.turnKey = turnKey;
                b.turnSeq = (b.turnSeq || 0) + 1;
                b.ctlAt = Date.now();
                // A partner who chooses by message is told what they are choosing about.
                const peer = who && who !== Coop.id ? Coop.peers.get(who) : null;
                if (peer && peer.bot && BattleManager.actor()) Coop.sendTo(who, 'bturn', { actor: BattleManager.actor().actorId(), seq: b.turnSeq, brief: Coop.battleBrief(BattleManager.actor()) });
            }
            if (key !== b.ctl) {
                b.ctl = key;
                const actor = BattleManager.actor() ? BattleManager.actor().name() : '';
                const inputting = BattleManager.isInputting() && !!BattleManager.actor();
                for (const id of b.guests.keys()) Coop.sendTo(id, 'bctl', { who: inputting ? who || -1 : 0, actor });
                if (!inputting) showTurn('', false);
                else if (who === Coop.id) showTurn('Your turn: choose for ' + actor, true);
                else if (who) showTurn('Waiting for ' + peerName(who) + ' to choose for ' + actor, false);
                else showTurn('Anyone may choose for ' + actor, true);
            }
        }
        _sceneBattleUpdate.call(this);
    };

    //--- the end ------------------------------------------------------------

    // Runs after the engine has cleaned up the battle, so the characters go
    // home in the state the fight left them.
    const _terminate = Scene_Battle.prototype.terminate;
    Scene_Battle.prototype.terminate = function () {
        _terminate.call(this);
        const b = Coop.battle;
        if (!b || b.role !== 'owner') return;
        if (b.guests.size) holdInventory(b, 0);
        const foes = $gameTroop.members().map((e) => e.name().replace(/ \[.*\]$/, '')).filter((n, i, a) => a.indexOf(n) === i).slice(0, 4).join(', ');
        for (const [id, g] of b.guests) {
            if (g.quit) continue;
            const state = guestState(b, id, g);
            if (Coop.peers.has(id)) Coop.sendTo(id, 'bend', Object.assign({ won: !!b.won, end: b.end || '', foes, by: Coop.name }, state));
            else Coop.send(Object.assign({ t: 'owed', name: g.name }, state));
            Stream.remove(id);
        }
        const lent = guestActorIds(b);
        for (const g of b.guests.values()) {
            for (const aid of g.actors) {
                if (g.prior[aid] === undefined) delete $gameActors._data[aid]; else $gameActors._data[aid] = g.prior[aid];
            }
        }
        for (const id of b.invited.keys()) Coop.sendTo(id, 'bend', { aborted: true });
        for (const msg of b.pending) { Coop.sendTo(msg.from, 'bend', { aborted: true }); Stream.remove(msg.from); }
        if (lent.size) {
            $gameParty._actors = $gameParty._actors.filter((id) => !lent.has(id));
            $gamePlayer.refresh();
        }
        if (b.eventId && b.mapId === $gameMap.mapId()) {
            const ev = $gameMap.event(b.eventId);
            Coop.events.sendHold(b.eventId, ev && ev._locked ? 'talk' : null);
        }
        Coop.battle = null;
        showTurn('', false);
        Coop.reportPresence(true);
    };

    Coop.on('leave', function (peer) {
        const b = Coop.battle;
        if (b && b.role === 'owner') b.invited.delete(peer.id);
    });
})();
