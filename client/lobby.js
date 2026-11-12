//=============================================================================
// fh-coop: the lobby. With two or more people at the title, the host's game
// says what this night is (a new run, or one of their saves), everyone else
// says ready, and the host's Start calls everybody in at once. Who is here
// and what each will load is the corner list; every action is a line of the
// game's own title menu. Nothing here decides anything: room.js does
// (lobbySay, lobbyStart), and this page shows it and asks.
//=============================================================================
(function () {
    const World = Coop.world;
    // The character switches the opening sets (client/state.js STARTED_AS), the picker's number
    // for each (map 10, variable 9) and the switch the picker leaves on for the one chosen.
    const CHARS = [
        { id: 661, name: 'Cahara', picker: 1, chosen: 246 },
        { id: 662, name: "D'arce", picker: 2, chosen: 242 },
        { id: 663, name: 'Enki', picker: 3, chosen: 243 },
        { id: 664, name: 'Ragnvaldr', picker: 4, chosen: 244 },
    ];
    const charOfId = (id) => CHARS.find((c) => c.id === id) || null;
    const charName = (id) => (charOfId(id) || { name: '' }).name;

    const L = Coop.lobby = {
        on: false, // two or more people here, and a host or a run to join
        run: null, // what the host chose, or the run under way as this player may join it
        host: 0, // the host's player number
        founded: false,
        line: [], // player numbers called in and not in yet
        held: [], // characters kept for someone called whose line dropped
        rows: {}, // player number -> { ready, pick, has, away }
        going: false, // called in: this game is starting
        locked: 0, // the character this game's opening is held to
        mode: 'main', // which list the title menu shows: main | pick
        mine: null, // this player's own save of the run: { slot, char, map }
        awayAfter: 300000,
    };

    let mapNames = {};
    fetch('coop/mapnames.json').then((r) => (r.ok ? r.json() : {})).then((names) => { mapNames = names || {}; }).catch(() => {});

    const myRow = () => L.rows[Coop.id] || {};
    const isHost = () => L.host === Coop.id;
    const onTitle = () => SceneManager._scene instanceof Scene_Title;
    // What a row's player would come in as: their pick, else their own save of the run.
    const charOf = (row) => (row && (row.pick || (L.run && L.run.kind === 'save' ? row.has : 0))) || 0;
    const say = (what, more) => Coop.send(Object.assign({ t: 'lobby', do: what }, more || {}));

    //--- what a save file is ---------------------------------------------------
    function readSave(slot) {
        try {
            const c = JsonEx.parse(StorageManager.load(slot));
            const sw = c.switches._data;
            const char = CHARS.find((ch) => sw[ch.id]);
            return { slot, char: char ? char.id : 0, map: c.map._mapId, runId: (c.coop && c.coop.runId) || '', stamp: (c.coop && c.coop.stamp) || 0 };
        } catch (e) { return null; }
    }

    // This player's save of the host's run: from the same moment, else their latest earlier one
    // (room.js 'world?' lets someone "behind" come in as they last were).
    function saveOf(run) {
        if (!run || run.kind !== 'save' || !run.runId || !Coop.name) return null;
        const slots = World.slotsOf(run.runId);
        let stamp = slots[run.stamp] ? run.stamp : 0;
        if (!stamp) for (const s of Object.keys(slots).map(Number)) if (s < run.stamp && s > stamp) stamp = s;
        return stamp ? readSave(slots[stamp]) : null;
    }

    //--- the room's word ---------------------------------------------------------
    let runKey = '';
    Coop.on('lobby', function (msg) {
        L.on = !!msg.on;
        L.run = msg.run || null;
        L.host = msg.host || 0;
        L.founded = !!msg.founded;
        L.line = msg.line || [];
        L.held = msg.held || [];
        L.rows = msg.rows || {};
        // Which save of mine this run means, worked out once per run and told to the room.
        const key = L.run ? [L.run.kind, L.run.runId, L.run.stamp, Coop.name].join('|') : '';
        if (key !== runKey) {
            runKey = key;
            if (!(isHost() && L.run && L.run.kind === 'save' && L.mine && L.mine.runId === L.run.runId && L.mine.stamp === L.run.stamp)) L.mine = saveOf(L.run);
            if (L.mode === 'pick' && !L.run && !isHost()) L.mode = 'main';
        }
        const has = L.mine && L.run && L.run.kind === 'save' ? L.mine.char : 0;
        if (L.on && L.rows[Coop.id] && (L.rows[Coop.id].has || 0) !== has) say('has', { has });
        // Called in, then the start was called off (the host's game dropped): back to the title.
        if (L.going && !World.live && !L.founded && !L.line.length) {
            L.going = false;
            L.locked = 0;
            L.goNow = false;
            World.hostWait = '';
            clearTimeout(World._hostTimer);
            // (The title screen may already be on its way out: a scene only changes on the next frame.)
            if (!onTitle() || SceneManager.isSceneChanging()) { World._bounce = true; if (Coop.toast) Coop.toast('The start was called off. Back to the title.', 6000); }
        }
        if (!L.on) L.mode = 'main';
    });
    Coop.on('offline', function () { L.on = false; L.rows = {}; L.line = []; L.held = []; runKey = ''; });
    Coop.on('entered', function () { L.going = false; });
    // Refused on the way in (another run, a taken character): no longer on the way.
    for (const t of ['worldbusy', 'worldclash', 'worldstale', 'worldwhen']) Coop.on(t, function () { L.going = false; });

    // Called in: this game starts as soon as the title can take it.
    Coop.on('go', function () { L.going = true; L.goNow = true; });

    //--- starting the game the lobby settled on ------------------------------------
    function begin(scene) {
        const row = myRow();
        if (Coop.together && Coop.together.isOpen()) Coop.together.close();
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        if (row.pick) {
            L.locked = row.pick;
            scene.commandNewGame();
            return;
        }
        if (L.mine && DataManager.isThisGameFile(L.mine.slot)) {
            L.autoLoad = L.mine.slot;
            scene.commandContinue();
            return;
        }
        // Nothing to come in as after all (the save is gone): said, and not on the way.
        L.going = false;
        say('leave');
        if (Coop.toast) Coop.toast('Your save of this run could not be found. Pick a character to come in as.', 8000);
    }

    // The save screen, opened by the lobby, loads the save without a key: the same steps
    // (and the same plugins' steps) as a player pressing Continue and choosing it.
    const _loadStart = Scene_Load.prototype.start;
    Scene_Load.prototype.start = function () {
        _loadStart.call(this);
        if (!L.autoLoad) return;
        const slot = L.autoLoad;
        L.autoLoad = 0;
        this._listWindow.select(slot - 1);
        this.onSavefileOk();
    };

    // The host choosing which save this night carries on: the save screen says which, and
    // nothing loads until Start.
    const _loadOk = Scene_Load.prototype.onSavefileOk;
    Scene_Load.prototype.onSavefileOk = function () {
        if (!L.choosing) return _loadOk.call(this);
        const slot = this.savefileId();
        const save = DataManager.isThisGameFile(slot) ? readSave(slot) : null;
        if (!save || !save.char) { SoundManager.playBuzzer(); this.activateListWindow(); return; }
        L.choosing = false;
        L.mine = save;
        SoundManager.playOk();
        say('run', { run: { kind: 'save', runId: save.runId, stamp: save.stamp, map: save.map }, has: save.char });
        this.popScene();
    };
    const _loadTerminate = Scene_Load.prototype.terminate;
    Scene_Load.prototype.terminate = function () {
        _loadTerminate.call(this);
        L.choosing = false;
    };

    //--- the opening, held to the character picked in the lobby --------------------
    // The picker (map 10) reads left, right and the action key; variable 9 is who is shown.
    function picking() {
        return L.locked && window.$gameMap && $gameMap.mapId() === 10 && $gameSwitches.value(296) && !$gameSwitches.value(214)
            && SceneManager._scene instanceof Scene_Map;
    }
    for (const fn of ['isPressed', 'isTriggered', 'isRepeated']) {
        const orig = Input[fn];
        Input[fn] = function (name) {
            if (picking()) {
                const shown = $gameVariables.value(9) === charOfId(L.locked).picker;
                if (name === 'left') return false;
                if (name === 'right') return !shown; // walks to the one picked, and stays
                if (name === 'ok' && !shown) return false;
            }
            return orig.call(this, name);
        };
    }
    // Whatever was on screen when the choice was confirmed, the one chosen is the one picked.
    const _setSwitch = Game_Switches.prototype.setValue;
    Game_Switches.prototype.setValue = function (id, value) {
        if (id === 214 && value && L.locked && window.$gameMap && $gameMap.mapId() === 10) {
            for (const c of CHARS) this._data[c.chosen] = c.id === L.locked;
        }
        _setSwitch.call(this, id, value);
        if (L.locked && value && charOfId(id)) L.locked = 0; // the opening has made them that character
    };

    //--- the title menu -----------------------------------------------------------
    // Characters nobody else here, and nobody in the run, has.
    function taken(id) {
        if (L.held.indexOf(id) >= 0) return true;
        for (const key in L.rows) if (Number(key) !== Coop.id && charOf(L.rows[key]) === id) return true;
        for (const p of Coop.others()) if (p.st && p.st !== 'title' && p.ini && p.ini.indexOf(id) >= 0) return true;
        return false;
    }
    function clashName() {
        const mine = charOf(myRow());
        if (!mine) return '';
        if (L.held.indexOf(mine) >= 0) return charName(mine);
        for (const key in L.rows) {
            const row = L.rows[key];
            if (Number(key) !== Coop.id && charOf(row) === mine && (row.ready || Number(key) === L.host || L.line.indexOf(Number(key)) >= 0)) return charName(mine);
        }
        for (const p of Coop.others()) if (p.st && p.st !== 'title' && p.ini && p.ini.indexOf(mine) >= 0) return charName(mine);
        return '';
    }
    // Everyone here at the title and not away is ready (room.js lobbyStart checks again).
    function everyoneReady() {
        for (const p of Coop.others()) {
            const row = L.rows[p.id];
            if (!row || p.id === L.host) continue; // a partner has no row
            if ((p.st || 'title') !== 'title' || p.up || row.away) continue; // in the run, or their game is starting
            if (!row.ready) return false;
        }
        return true;
    }

    // The lines of the title menu while the lobby is on; null leaves the game's own.
    L.menu = function () {
        if (!L.on) return null;
        if (L.going || L.line.indexOf(Coop.id) >= 0) return [];
        const me = myRow();
        if (L.mode === 'pick') {
            const list = CHARS.map((c) => ({ name: c.name, act: 'pick:' + c.id, enabled: !taken(c.id) }));
            if (!isHost() && L.mine && L.mine.char && L.run && L.run.kind === 'save') list.push({ name: 'My save: ' + charName(L.mine.char), act: 'pick:0' });
            list.push({ name: 'Back', act: 'back' });
            return list;
        }
        if (L.founded) {
            return [{ name: 'Join', act: 'join', enabled: !!charOf(me) && !clashName() },
                { name: 'Come in as...', act: 'pickmode' }, { name: 'Together', symbol: 'together' }];
        }
        if (isHost()) {
            if (!L.run) return [{ name: 'New run', act: 'newrun' }, { name: 'Continue', act: 'chooserun', enabled: DataManager.isAnySavefileExists() }, { name: 'Together', symbol: 'together' }];
            return [{ name: 'Start', act: 'start', enabled: !!charOf(me) && everyoneReady() }, { name: 'Change run', act: 'changerun' }, { name: 'Together', symbol: 'together' }];
        }
        if (!L.run) return [{ name: 'Together', symbol: 'together' }];
        return [{ name: me.ready ? 'Not ready' : 'Ready', act: 'ready', enabled: me.ready || (!!charOf(me) && !clashName()) },
            { name: 'Come in as...', act: 'pickmode', enabled: !me.ready }, { name: 'Together', symbol: 'together' }];
    };

    function act(scene, what) {
        const w = scene._commandWindow;
        if (what === 'newrun') { L.mode = 'pick'; L.pickFor = 'run'; }
        else if (what === 'pickmode') { L.mode = 'pick'; L.pickFor = 'me'; }
        else if (what === 'back') L.mode = 'main';
        else if (what === 'chooserun') { L.choosing = true; scene.commandContinue(); return; }
        else if (what === 'changerun') say('run', { run: null });
        else if (what === 'start') say('start');
        else if (what === 'join') say('join');
        else if (what === 'ready') say('ready', { on: !myRow().ready });
        else if (/^pick:/.test(what)) {
            const id = Number(what.slice(5));
            if (L.pickFor === 'run') say('run', { run: { kind: 'new' }, pick: id });
            else say('pick', { pick: id });
            L.mode = 'main';
        }
        menuKey = '';
        w.activate();
    }

    const _makeList = Window_TitleCommand.prototype.makeCommandList;
    Window_TitleCommand.prototype.makeCommandList = function () {
        const items = L.menu();
        if (!items) return _makeList.call(this);
        for (const it of items) this.addCommand(it.name, it.symbol || 'lobby', it.enabled !== false, it.act || null);
    };
    const _createCommand = Scene_Title.prototype.createCommandWindow;
    Scene_Title.prototype.createCommandWindow = function () {
        _createCommand.call(this);
        const scene = this;
        this._commandWindow.setHandler('lobby', function () { act(scene, scene._commandWindow.currentExt()); });
        menuKey = '';
    };
    // Wide enough for its longest line, tall enough for all of them.
    const _windowWidth = Window_TitleCommand.prototype.windowWidth;
    Window_TitleCommand.prototype.windowWidth = function () {
        const base = _windowWidth.call(this);
        // Asked first while the window is being made, before it has anything to measure text with.
        if (!this._list || !this._windowContentsSprite || !this.contents || !L.menu()) return base;
        let widest = 0;
        for (const item of this._list) widest = Math.max(widest, this.textWidth(item.name));
        return Math.max(base, widest + (this.standardPadding() + this.textPadding()) * 2 + 8);
    };

    // The menu follows the room: rebuilt when what it would show has changed.
    let menuKey = '';
    function fitMenu(scene) {
        const w = scene._commandWindow;
        if (!w || !scene.isActive() || SceneManager.isSceneChanging()) return;
        const items = L.menu();
        const key = items ? items.map((it) => it.name + (it.enabled === false ? '~' : '')).join('|') + '#' + L.mode : 'own';
        if (key === menuKey) return;
        const first = menuKey === '';
        const names = (w._list || []).map((c) => c.name).join('|');
        menuKey = key;
        const index = w.index();
        w.clearCommandList();
        w.makeCommandList();
        const same = names === w._list.map((c) => c.name).join('|');
        w.width = w.windowWidth();
        w.height = w.fittingHeight(Math.max(1, w._list.length));
        w.updatePlacement();
        w.createContents();
        w.refresh();
        w.visible = w._list.length > 0;
        if (!w._list.length) { w.deactivate(); return; }
        // The same lines, one of them now allowed or not: the cursor stays. Other lines: the top one.
        w.select(same && !first ? Math.min(Math.max(index, 0), w._list.length - 1) : 0);
        const panelOpen = Coop.together && Coop.together.isOpen();
        if (!panelOpen && w.isOpen() && !w.active) w.activate();
    }

    //--- away ------------------------------------------------------------------
    let lastInput = Date.now();
    let toldAway = false;
    const touched = function () { lastInput = Date.now(); };
    for (const type of ['keydown', 'mousedown', 'touchstart']) document.addEventListener(type, touched, true);

    function tick() {
        const scene = SceneManager._scene;
        if (!(scene instanceof Scene_Title)) { menuKey = ''; return; }
        if (!SceneManager.isCurrentSceneStarted() || SceneManager.isSceneChanging()) return;
        if (L.goNow && Coop.name) { L.goNow = false; begin(scene); return; }
        // Back at the title and no longer called (given up on, or the line is down): not on the way.
        if (L.going && !World.live && L.line.indexOf(Coop.id) < 0) L.going = false;
        fitMenu(scene);
        // A controller counts as being here too.
        if (Input._latestButton) touched();
        const me = myRow();
        const idle = L.on && !isHost() && !me.ready && Date.now() - lastInput > L.awayAfter;
        if (idle !== toldAway && L.on && L.rows[Coop.id]) { toldAway = idle; say('away', { on: idle }); }
        if (!L.on) toldAway = false;
    }
    setInterval(tick, 100);

    //--- the corner list ----------------------------------------------------------
    function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

    // Rows for client/ui.js while the lobby is on; null leaves its own list.
    Coop.lobbyRows = function () {
        if (!L.on) return null;
        const out = [];
        // Where: the save's floor, or the floor someone in the run stands on now.
        const inRun = L.founded ? Coop.others().find((p) => p.st && p.st !== 'title' && mapNames[p.m]) : null;
        const map = inRun ? inRun.m : (!L.founded && L.run && L.run.map) || 0;
        const place = mapNames[map] ? ' · ' + mapNames[map] : '';
        if (L.founded) out.push('<div class="row">Under way' + esc(place) + '</div>');
        else if (L.run) out.push('<div class="row">' + (L.run.kind === 'new' ? 'New run' : 'Continue' + esc(place)) + '</div>');
        const people = [{ id: Coop.id, name: Coop.name || 'You', st: 'title', me: true }].concat(Coop.others());
        // The host first, then by player number: the same order on every screen.
        people.sort((a, b) => (b.id === L.host) - (a.id === L.host) || a.id - b.id);
        for (const p of people) {
            const row = L.rows[p.id];
            const st = p.me ? 'title' : (p.st || 'title');
            let word = '', kind = '';
            if (!row) { // an AI partner
                if (!p.bot) continue;
                word = st !== 'title' && st ? 'in' : 'AI';
            } else if (st !== 'title') word = 'in';
            else if (L.line.indexOf(p.id) >= 0 || (!p.me && p.up)) word = 'loading';
            else if (row.away) { word = 'away'; kind = 'dim'; }
            else {
                const char = charOf(row);
                const mine = p.me ? clashName() : '';
                if (mine) { word = mine + ' is taken'; kind = 'bad'; }
                else if (L.founded) { word = 'not in'; kind = 'dim'; }
                else if (!L.run) word = '';
                else if (p.id === L.host || row.ready) word = L.run.kind === 'new' || row.pick ? charName(char) : 'ready';
                else { word = row.pick ? charName(char) : 'not ready'; kind = 'dim'; }
            }
            out.push('<div class="row' + (kind === 'dim' ? ' dim' : '') + '">' + esc(p.name)
                + (word ? ' <span class="' + (kind === 'bad' ? 'bad' : 'dim') + '">' + esc(word) + '</span>' : '') + '</div>');
        }
        return out;
    };
})();
