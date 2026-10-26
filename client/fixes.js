//=============================================================================
// fh-coop: fixes for the base game and for running it in a browser tab.
//=============================================================================
(function () {
    // The freeze. The engine skips drawing while its skip counter is not
    // exactly zero, and sets that counter from a wall-clock difference. When
    // the clock steps backwards the counter goes negative, never returns to
    // zero, and the picture stops for good while the game runs on underneath.
    Graphics.render = function (stage) {
        if (this._skipCount <= 0) {
            const startTime = Date.now();
            if (stage) {
                this._renderer.render(stage);
                if (this._renderer.gl && this._renderer.gl.flush) this._renderer.gl.flush();
            }
            const elapsed = Date.now() - startTime;
            this._skipCount = Math.max(0, Math.min(Math.floor(elapsed / 15), this._maxSkip));
            this._rendered = true;
        } else {
            this._skipCount--;
            this._rendered = false;
        }
        this.frameCount++;
    };

    // When it starts, the engine pushes every element already on the page
    // behind its canvas. The co-op panels belong in front of it.
    const _modifyExisting = Graphics._modifyExistingElements;
    Graphics._modifyExistingElements = function () {
        const ours = Array.prototype.map.call(document.querySelectorAll('[id^="coop-"]'), (el) => [el, el.style.zIndex]);
        _modifyExisting.call(this);
        for (const [el, z] of ours) el.style.zIndex = z;
    };

    // A lost WebGL context (driver hiccup, GPU reset, long sleep) otherwise
    // leaves a dead canvas. Reloading the page is the only real recovery, and
    // the co-op save on the host makes that cheap, so say so instead of
    // hanging silently.
    window.addEventListener('load', function () {
        const canvas = Graphics._canvas;
        if (!canvas) return;
        canvas.addEventListener('webglcontextlost', function (e) {
            e.preventDefault();
            Graphics.printError('The graphics driver reset', 'Reload this page to carry on from your last save.');
            AudioManager.stopAll();
            SceneManager.stop();
        });
    });

    // The game steps its logic 60 times a second but redraws on every
    // screen refresh. On a 240 Hz monitor that is the same picture drawn
    // four times over. Draw only when something has actually been stepped.
    let stepped = 0;
    let drawn = -1;
    const _updateScene = SceneManager.updateScene;
    SceneManager.updateScene = function () {
        stepped++;
        _updateScene.call(this);
    };
    const _renderScene = SceneManager.renderScene;
    SceneManager.renderScene = function () {
        if (stepped === drawn) return;
        drawn = stepped;
        _renderScene.call(this);
    };

    // A sound that will not load (one map's background loop is simply
    // missing from the game, and any link can hiccup) is not worth stopping
    // the game for. It is skipped and noted in the console.
    AudioManager.checkWebAudioError = function (webAudio) {
        if (webAudio && webAudio.isError() && !webAudio._coopWarned) {
            webAudio._coopWarned = true;
            console.warn('[coop] sound did not load, carrying on without it: ' + webAudio.url);
        }
    };
    // Files now come over a network, so a failed load is retried for longer
    // before the engine puts up its "Retry" screen.
    ResourceHandler._defaultRetryInterval = [500, 1000, 2000, 3000, 5000, 8000];

    // In a browser tab the engine leaves the picture at its native 816x624.
    // Fill the window instead, as the desktop build does.
    Graphics._defaultStretchMode = function () { return true; };

    // Closing or reloading the tab mid-run asks first.
    window.addEventListener('beforeunload', function (e) {
        if (window.Coop && Coop.world && Coop.world.live && !navigator.webdriver) {
            e.preventDefault();
            e.returnValue = '';
        }
    });

    // The game has scripts that can leave the player locked in place with
    // nothing running that will ever release them. Ctrl+Shift+U drops
    // whatever script is holding the map and hands control back.
    document.addEventListener('keydown', function (e) {
        if (!(e.ctrlKey && e.shiftKey && e.code === 'KeyU')) return;
        e.preventDefault();
        if (!(SceneManager._scene instanceof Scene_Map) || !window.$gameMap) return;
        $gameMap._interpreter.clear();
        $gameMessage.clear();
        $gameTemp.clearCommonEvent();
        for (const ev of $gameMap.events()) { ev._starting = false; if (ev._locked) ev.unlock(); }
        $gamePlayer.setThrough(false);
        $gamePlayer._moveRouteForcing = false;
        $gamePlayer._waitCount = 0;
        const scene = SceneManager._scene;
        if (scene._messageWindow) { scene._messageWindow.terminateMessage(); scene._messageWindow.close(); }
        if ($gameScreen.brightness() < 255) $gameScreen.startFadeIn(30);
        if (window.Coop && Coop.toast) Coop.toast('Unstuck: the running script was dropped.');
    });

    // The engine's error line is an empty strip across the middle of the
    // screen, above everything, even with no error in it: it ate the clicks
    // meant for any box beneath it (the link box in Together). Only what is
    // printed in it (a Retry button) takes the mouse now.
    const strip = document.createElement('style');
    strip.textContent = '#ErrorPrinter { pointer-events: none; } #ErrorPrinter * { pointer-events: auto; }';
    document.head.appendChild(strip);

    // The engine turns off the right-click menu on every element on the page,
    // the mod's text boxes too, so a link could not be pasted with the mouse.
    // A box being typed in gets its menu back.
    const RIGHT_CLICK = function (e) {
        const el = e.target;
        if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) el.oncontextmenu = null;
    };
    document.addEventListener('focusin', RIGHT_CLICK, true);
    document.addEventListener('mousedown', RIGHT_CLICK, true);

    // The game is played on the keyboard; its own plugin turns off mouse
    // clicks, but the battle plugin still picks a target wherever the mouse
    // rests, and the keyboard cannot move off it. The mouse is off here too.
    TouchInput._onMouseMove = function () {};
    TouchInput._onWheel = function () {};

    // The hut village (map 22) has doors that lead to map 41, which the game
    // does not have; stepping on one would hang on a file that never loads.
    // A door to a map that does not exist stays shut.
    const _reserveTransfer = Game_Player.prototype.reserveTransfer;
    Game_Player.prototype.reserveTransfer = function (mapId, x, y, d, fadeType) {
        if (window.$dataMapInfos && mapId > 0 && !$dataMapInfos[mapId]) {
            console.warn('fh-coop: a door to map ' + mapId + ', which the game does not have, stays shut');
            return;
        }
        _reserveTransfer.call(this, mapId, x, y, d, fadeType);
    };

    // The Salmonsnake's second page on two of the Mines' three layouts (maps
    // 39 and 184) moves the player to the first layout's map 11, a copy of
    // the floor: the game's own slip. In co-op it took him away from his
    // partner into a fight they could not see or join (10/20). It stays on
    // the map it is on.
    const SNAKE_SLIP = { '39:263': 11, '184:263': 11 };
    const _command201 = Game_Interpreter.prototype.command201;
    Game_Interpreter.prototype.command201 = function () {
        const p = this._params;
        if (p[0] === 0 && SNAKE_SLIP[this._mapId + ':' + this._eventId] === p[1] && this._mapId === $gameMap.mapId()) {
            this._params = [0, this._mapId].concat(p.slice(2));
        }
        return _command201.call(this);
    };

    // A bear trap compares its tile with variables a parallel event fills with
    // each watched character's tile. On the prisons (maps 6, 37) and map 172 the
    // crossbow's own parallel writes its tile into the elite guard's (or the
    // skeleton's) pair every frame, after the copier, so the trap only ever sees
    // the crossbow and the elite guard walks over it (his report, 10/25). Any
    // other parallel page that fills a trap's pair from another character gets
    // spare variables of its own (past the game's list, so nothing else reads them).
    function trapOwners(map) {
        const owner = {};
        for (const ev of map.events) {
            if (!ev || !/^bearTrap/.test(ev.name)) continue;
            for (const page of ev.pages) {
                let vars = [];
                for (const c of page.list) {
                    const p = c.parameters;
                    if (c.code === 111 && p[0] === 1 && p[2] === 1) vars.push(p[3]);
                    if (c.code === 212 && p[0] > 0) { for (const v of vars) owner[v] = p[0]; vars = []; }
                    if (c.code === 412 && c.indent === 0) vars = [];
                }
            }
        }
        return owner;
    }
    // Variable <- a character's map X/Y (type 5) in a parallel page.
    function tileCopies(page, fn) {
        if (page.trigger !== 4) return;
        for (const c of page.list) {
            const p = c.parameters;
            if (c.code === 122 && p[0] === p[1] && p[3] === 3 && p[4] === 5 && p[5] > 0) fn(p[0], p[5]);
        }
    }
    function untangleTrapVars(map) {
        const owner = trapOwners(map);
        // Only a real tangle: two events fill the same pair from two characters.
        const writers = {};
        for (const ev of map.events) {
            if (!ev || /^bearTrap/.test(ev.name)) continue;
            for (const page of ev.pages) tileCopies(page, (v, ch) => { (writers[v] = writers[v] || new Set()).add(ev.id + ':' + ch); });
        }
        const tangled = (v) => {
            const all = [...(writers[v] || [])].map((k) => k.split(':').map(Number));
            return all.some(([e, ch]) => ch === owner[v] && all.some(([e2, ch2]) => e2 !== e && ch2 !== ch));
        };
        // A plugin (Olivia_MetaControls) reads every variable's name, so the spares get blank ones.
        const names = $dataSystem.variables;
        let spare = names.length;
        const take = () => { names[spare] = names[spare] || ''; return spare++; };
        for (const ev of map.events) {
            if (!ev || /^bearTrap/.test(ev.name)) continue;
            for (const page of ev.pages) {
                const mine = {};
                tileCopies(page, (v, ch) => { if (owner[v] && ch !== owner[v] && tangled(v)) mine[v] = mine[v] || take(); });
                if (!Object.keys(mine).length) continue;
                page.list = page.list.map((c) => {
                    const p = c.parameters.slice();
                    if (c.code === 122) {
                        if (p[0] === p[1] && mine[p[0]]) p[0] = p[1] = mine[p[0]];
                        if (p[3] === 1 && mine[p[4]]) p[4] = mine[p[4]];
                    } else if (c.code === 111 && p[0] === 1) {
                        if (mine[p[1]]) p[1] = mine[p[1]];
                        if (p[2] === 1 && mine[p[3]]) p[3] = mine[p[3]];
                    } else return c;
                    return Object.assign({}, c, { parameters: p });
                });
            }
        }
    }

    // A name box's text is compared letter for letter: the empty scroll's
    // prayer works only as "O LORD", "TEACH", "BLACK ORB". But every Enter
    // (A on a pad) also adds the letter under the box's cursor, and once the
    // cursor has been on its space, finishing with Enter left "O LORD " and
    // no prayer (a Steam Deck player, 10/20; Windows players hit it too). A
    // space at either end is never meant, so it is left off; one made only
    // of spaces counts as empty, as the game already handles.
    Window_NameEdit.prototype.name = function () {
        return this._name.trim();
    };

    // Typing into a name box (the game's keyboard plugin) fought its grid of
    // letters. Space, Z and X type a letter and are also the grid's OK and
    // Cancel: "O LORD" typed with the space bar came out "O ALORD" (the
    // grid's letter went in too), or the box finished if its cursor was on
    // OK, and X rubbed a letter out. And Enter after a typed word added the
    // letter under the grid's cursor. Now a key that typed something does
    // nothing else while it is held, and while the player is typing, OK puts
    // in no grid letter (on the grid's OK it still finishes). Moving the
    // cursor is using the grid again: OK puts its letter in, as before.
    if (window.NameInputManager) {
        Window_NameInput.prototype.processHandling = function () {
            if (!this.isOpen() || !this.active) return;
            if (this._coopAt !== undefined && this._index !== this._coopAt) this._coopTyping = false;
            this._coopAt = this._index;
            const held = this._coopHeld = this._coopHeld || {};
            for (const b of Object.keys(held)) if (!Input.isPressed(b)) delete held[b];
            if (NameInputManager.checkInputText()) {
                this._coopTyping = true;
                for (const b of ['ok', 'cancel']) if (Input.isTriggered(b)) held[b] = true;
                if (this._editWindow.add(NameInputManager.getInputText())) SoundManager.playOk();
                else SoundManager.playBuzzer();
            }
            if (Input.isRepeated('backspace')) this.processBack();
            if (Input.isRepeated('cancel') && !held.cancel) this.processBack();
            if (Input.isRepeated('ok') && !held.ok) {
                if (this._coopTyping && this.character()) SoundManager.playBuzzer();
                else this.processOk();
            }
        };
    }

    // The scroll's verses (common event 84 asks for them as the names of
    // actors 25, 26 and 27) were compared capitals and all: "o lord teach
    // black orb" taught nothing. Case no longer counts for those three. They
    // are kept as typed, not put in capitals: one of the game's own verses
    // is "Brown vial".
    const VERSES = [25, 26, 27];
    const _command111 = Game_Interpreter.prototype.command111;
    Game_Interpreter.prototype.command111 = function () {
        const p = this._params;
        const actor = p[0] === 4 && p[2] === 1 && VERSES.includes(p[1]) && $gameActors.actor(p[1]);
        if (!actor) return _command111.call(this);
        this._branch[this._indent] = actor.name().toUpperCase() === String(p[3]).toUpperCase();
        if (this._branch[this._indent] === false) this.skipBranch();
        return true;
    };

    // The game's speed check (common event 40, always running) sets the
    // player's speed with a one-command move route every seven frames or so,
    // and a forced route holds the player for that frame: about one press of
    // the action key in eight did nothing, in the game alone too. A route
    // that only changes settings (speed, frequency, see-through, image,
    // opacity, blend) no longer holds them.
    const _canMove = Game_Player.prototype.canMove;
    Game_Player.prototype.canMove = function () {
        if (_canMove.call(this)) return true;
        const route = this._moveRoute;
        if (!this._moveRouteForcing || !route || route.repeat || !route.list.every((c) => c.code === 0 || (c.code >= 29 && c.code <= 43))) return false;
        this._moveRouteForcing = false;
        try { return _canMove.call(this); } finally { this._moveRouteForcing = true; }
    };

    // A minimised window (or one the system counts as hidden) gets no
    // animation frames, and the game stops. Alone that is a pause; with others
    // in the world it would freeze a fight they are in, so a timer runs the
    // game instead. Each request supersedes the last, so a frame asked for
    // before the window hid never runs as a second loop when it shows again.
    let ticket = 0;
    const othersHere = () => window.Coop && Coop.world && Coop.world.live && Coop.peers.size > 0;
    // The beat comes from a worker: a hidden page's own timers are slowed to
    // one a second (one a minute after five) unless the browser was started
    // with the launcher's flags; a worker's are not.
    let beat = null, onBeat = null;
    function nextBeat(fn) {
        if (beat === null) {
            try {
                beat = new Worker(URL.createObjectURL(new Blob(['onmessage = function () { setTimeout(function () { postMessage(0); }, 16); };'], { type: 'text/javascript' })));
                beat.onmessage = function () { const f = onBeat; onBeat = null; if (f) f(); };
            } catch (e) { beat = false; }
        }
        if (!beat) { setTimeout(fn, 1000 / 60); return; }
        onBeat = fn;
        beat.postMessage(0);
    }
    SceneManager.requestUpdate = function () {
        if (this._stopped) return;
        const mine = ++ticket;
        const go = () => { if (mine === ticket) this.update(); };
        if (document.hidden && othersHere()) nextBeat(go); else requestAnimationFrame(go);
    };
    // Shown or hidden, or others arriving while hidden: the loop is asked for again,
    // on whichever clock now applies.
    const again = function () { if (!SceneManager._stopped && SceneManager._scene) SceneManager.requestUpdate(); };
    document.addEventListener('visibilitychange', again);
    for (const t of ['join', 'online', 'entered']) Coop.on(t, function () { if (document.hidden) again(); });

    // The engine drops every picture not drawn in the last frame from the card at each check
    // (maxIdle 1), and the game caches 10 M pixels. So each fight decoded and uploaded every
    // 2074x1382 battler sheet again, and the map its tiles after: 290+ ms frames on a Steam Deck.
    ImageCache.limit = Math.max(ImageCache.limit, 40e6);
    const _createRenderer = Graphics._createRenderer;
    Graphics._createRenderer = function () {
        _createRenderer.apply(this, arguments);
        if (this._renderer && this._renderer.textureGC) this._renderer.textureGC.maxIdle = 5 * 60 * 60;
    };

    // Every window paints its back pixel by pixel (adjustTone), twice as it opens: most of what a
    // fight start still cost after the pictures stayed on the card. The same skin, size and tone
    // always give the same back, so each is painted once and copied after.
    const backs = new Map();
    const _refreshBack = Window.prototype._refreshBack;
    Window.prototype._refreshBack = function () {
        const m = this._margin, w = this._width - m * 2, h = this._height - m * 2, skin = this._windowskin;
        if (!(w > 0 && h > 0 && skin && skin.isReady() && skin._url)) return _refreshBack.call(this);
        const key = skin._url + '|' + w + 'x' + h + '|' + this._colorTone.join(',');
        let done = backs.get(key);
        if (!done) {
            _refreshBack.call(this);
            done = this._windowBackSprite.bitmap.canvas;
            if (backs.size >= 64) backs.clear();
            backs.set(key, done);
            return;
        }
        const bitmap = new Bitmap(w, h);
        bitmap.context.drawImage(done, 0, 0);
        bitmap._setDirty();
        this._windowBackSprite.bitmap = bitmap;
        this._windowBackSprite.setFrame(0, 0, w, h);
        this._windowBackSprite.move(m, m);
    };

    // Weapons that say they stun, bleed or poison set it as the WIELDER's chance to suffer it
    // (state rate), so they did nothing. They now do it to what they hit, at modest rates. The
    // enemy bleed was never used by anything; it was 10% of max HP a turn for the whole fight
    // (a boss killer), now 5% for four turns. Both follow the host's balance switch. The load
    // cannot be undone, so the original and the patched form are both kept and the one
    // $dataWeapons / $dataStates hold is swapped when that choice arrives or changes.
    const ON_HIT = { 3: { 28: 0.2 }, 15: { 28: 0.2 }, 38: { 28: 0.12, 29: 0.35 }, 39: { 28: 0.12, 29: 0.35 },
        32: { 29: 0.45 }, 33: { 29: 0.45 }, 44: { 29: 0.25 }, 46: { 29: 0.25 }, 40: { 17: 0.2 }, 41: { 17: 0.25 } };
    Coop.weaponOnHit = ON_HIT;
    const weaponOn = {}, weaponOff = {};
    let bleedOn = null, bleedOff = null;
    let balanceOn = true;
    Coop.balance = true;
    function applyBalance() {
        if (typeof $dataWeapons !== 'undefined' && $dataWeapons) {
            const table = balanceOn ? weaponOn : weaponOff;
            for (const id in table) $dataWeapons[id] = table[id];
        }
        if (bleedOn && typeof $dataStates !== 'undefined' && $dataStates) $dataStates[29] = balanceOn ? bleedOn : bleedOff;
    }
    Coop.setBalance = function (on) {
        balanceOn = !!on;
        Coop.balance = balanceOn;
        applyBalance();
    };
    const _onLoad = DataManager.onLoad;
    DataManager.onLoad = function (object) {
        _onLoad.apply(this, arguments);
        if (object === $dataMap && Array.isArray(object.events) && window.$dataSystem) untangleTrapVars(object);
        if (object === $dataWeapons) {
            for (const id in ON_HIT) {
                if (weaponOff[id]) continue;
                const w = $dataWeapons[id];
                // Only the weapon the table means: it still carries the mistaken rate.
                if (!w || !w.traits.some((t) => t.code === 13 && ON_HIT[id][t.dataId])) continue;
                weaponOff[id] = JSON.parse(JSON.stringify(w));
                for (const sid in ON_HIT[id]) {
                    if (!w.traits.some((t) => t.code === 32 && t.dataId === +sid)) w.traits.push({ code: 32, dataId: +sid, value: ON_HIT[id][sid] });
                }
                weaponOn[id] = w;
            }
            applyBalance();
        }
        if (object === $dataStates && !bleedOff && $dataStates[29] && /bleed/i.test($dataStates[29].name)) {
            const s = $dataStates[29];
            bleedOff = JSON.parse(JSON.stringify(s));
            s.traits = s.traits.map((t) => (t.code === 22 && t.dataId === 7 ? { code: 22, dataId: 7, value: -0.05 } : t));
            s.autoRemovalTiming = 2; s.minTurns = 4; s.maxTurns = 4;
            bleedOn = s;
            applyBalance();
        }
    };

    // Silver coins stopped at 99 like any item, and a long run finds more. Coins only, up to 999
    // (the shops read the count into a variable, which has no cap).
    const COIN = 59;
    const _maxItems = Game_Party.prototype.maxItems;
    Game_Party.prototype.maxItems = function (item) {
        return item && DataManager.isItem(item) && item.id === COIN ? 999 : _maxItems.call(this, item);
    };
    const _drawItemNumber = Window_ItemList.prototype.drawItemNumber;
    Window_ItemList.prototype.drawItemNumber = function (item, x, y, width) {
        if (!(this.needsNumber() && $gameParty.numItems(item) > 99)) return _drawItemNumber.call(this, item, x, y, width);
        this.drawText(':', x, y, width - this.textWidth('000'), 'right');
        this.drawText($gameParty.numItems(item), x, y, width, 'right');
    };

    // A few sound files are mastered far hotter than the rest (measured: punch1 is ~14 dB over
    // the median, and every mace or morning star swing plays it). Levels set by ear.
    const SE_GAIN = { punch1: 0.09, 'Dark_orb1_245883__sarithule__roper1911-heavy-beam-weapon-de-clicked_01': 0.12 };
    Coop.seGain = SE_GAIN;
    for (const name of ['playSe', 'playStaticSe']) {
        const orig = AudioManager[name];
        AudioManager[name] = function (se) {
            const g = se && SE_GAIN[se.name];
            return orig.call(this, g ? Object.assign({}, se, { volume: se.volume * g }) : se);
        };
    }
})();
