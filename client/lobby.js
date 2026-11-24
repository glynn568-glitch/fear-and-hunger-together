//=============================================================================
// fh-coop: the lobby. With two or more people at the title, the host's game
// says what this night is (a new run, or one of their saves), everyone else
// chooses who they come in as (a new character, their save of the run, or a
// save of another run brought into this one), and the host's Start calls
// everybody in at once. The title menu's lines say how things stand (Run:,
// As:, Start (waiting on ...)); the corner list says who is here. Nothing here
// decides anything: room.js does (lobbySay), and this page shows it and asks.
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
        own: null, // this player's own save of the run: { slot, char, map, runId, stamp, level }
        mine: null, // the save this player would load: their own of the run, or one of another run they chose
        confirm: null, // a save of another run, waiting for "Bring ... in"
        awayAfter: 300000,
    };

    let mapNames = {};
    fetch('coop/mapnames.json').then((r) => (r.ok ? r.json() : {})).then((names) => { mapNames = names || {}; }).catch(() => {});

    const myRow = () => L.rows[Coop.id] || {};
    const isHost = () => L.host === Coop.id;
    const onTitle = () => SceneManager._scene instanceof Scene_Title;
    // What a row's player would come in as: their pick, else their own save of the run.
    const charOf = (row) => (row && (row.pick || row.has)) || 0;
    const nameOf = (id) => (id === Coop.id ? Coop.name : ((Coop.peers.get(id) || {}).name || 'someone'));
    const say = (what, more) => Coop.send(Object.assign({ t: 'lobby', do: what }, more || {}));

    //--- what a save file is ---------------------------------------------------
    function readSave(slot) {
        try {
            const c = JsonEx.parse(StorageManager.load(slot));
            const sw = c.switches._data;
            const char = CHARS.find((ch) => sw[ch.id]);
            const lead = c.party && c.party._actors && c.actors && c.actors._data ? c.actors._data[c.party._actors[0]] : null;
            return { slot, char: char ? char.id : 0, map: c.map._mapId, runId: (c.coop && c.coop.runId) || '', stamp: (c.coop && c.coop.stamp) || 0, level: (lead && lead._level) || 0, dead: !!(c.coop && c.coop.dead) };
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

    // This player's saves of other runs, the latest of each character. Any of them can be brought into
    // this run (his ruling 11/21: the host's run takes priority, nobody's save is blocked). Read once per
    // run and set of saves: each is a whole save file.
    let othersKey = '', othersList = [];
    function otherSaves() {
        const runId = (L.run && L.run.runId) || '';
        const info = DataManager.loadGlobalInfo() || [];
        const key = runId + '|' + Coop.name + '|' + info.map((i) => (i ? i.timestamp || 1 : 0)).join(',');
        if (key === othersKey) return othersList;
        othersKey = key;
        const best = {};
        info.forEach((i, slot) => {
            if (!i || !slot || (runId && i.coopRun === runId)) return;
            const save = readSave(slot);
            // Saved dead (alongside someone else's save): not a character to bring anywhere.
            if (!save || !save.char || save.dead) return;
            const at = i.timestamp || 0;
            if (!best[save.char] || at > best[save.char].at) best[save.char] = Object.assign(save, { other: true, at });
        });
        othersList = CHARS.map((c) => best[c.id]).filter(Boolean);
        return othersList;
    }

    //--- the room's word ---------------------------------------------------------
    let runKey = '';
    let heardKey = '';
    function heard(msg) {
        const said = JSON.stringify([msg.on, msg.run, msg.host, msg.founded, msg.line, msg.held, msg.rows]);
        if (said !== heardKey) {
            heardKey = said;
            const rows = Object.keys(msg.rows || {}).map((id) => {
                const r = msg.rows[id];
                return id + ':' + [r.pick && 'pick ' + charName(r.pick), r.has && 'has ' + charName(r.has), r.ready && 'ready', r.away && 'away'].filter(Boolean).join(' ');
            }).join(', ');
            Coop.note('lobby: ' + (msg.on ? 'on' : 'off') + ', host ' + (msg.host || 0) + ', run ' + (msg.run ? msg.run.kind + (msg.run.runId ? ' ' + msg.run.runId : '') : 'none')
                + (msg.founded ? ', under way' : '') + (msg.line && msg.line.length ? ', called ' + msg.line.join('/') : '')
                + (msg.held && msg.held.length ? ', held ' + msg.held.map(charName).join('/') : '') + '; rows ' + rows);
        }
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
            L.own = L.mine;
            // The list a joiner had open was for another run: its lines mean something else now.
            if (!isHost() && (L.mode === 'pick' || L.mode === 'confirm')) { L.mode = 'main'; L.confirm = null; }
        }
        const has = L.mine ? L.mine.char : 0;
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
    }
    Coop.on('lobby', heard);
    // The room did not take a word of this page's: why, on screen and in the log.
    Coop.on('lobbyno', function (msg) {
        Coop.note('lobby: ' + msg.do + ' refused: ' + msg.why);
        if (Coop.toast) Coop.toast(String(msg.why || ''), 7000);
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
        if (!save || !save.char) {
            // Said, not only buzzed: the lobby never refuses in silence (11/21 item 2; 11/24 review found this one).
            const why = save ? 'That save has no character in it yet. Pick another.' : 'That save could not be read. Pick another.';
            SoundManager.playBuzzer();
            Coop.note('lobby: save ' + slot + ' refused: ' + why);
            if (Coop.toast) Coop.toast(why, 6000);
            this.activateListWindow();
            return;
        }
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
    // The picker (map 10) reads left, right and the action key; variable 9 is who is shown. The choice was made in
    // the lobby, so the picker walks to it and takes it by itself. It reads only buttons, which a mouse or a touch
    // never presses, and on 11/21 a friend on a Deck sat on it ("stuck on enki nothing i do works").
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
                if (name === 'ok') return shown;
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
    // Who else has a character: someone here who would come in as it, someone in the run, or a call held for
    // someone whose line dropped. A greyed line says so (his 11/21 ask: the menu was not clear enough).
    function takenBy(id) {
        for (const key in L.rows) if (Number(key) !== Coop.id && charOf(L.rows[key]) === id) return nameOf(Number(key));
        for (const p of Coop.others()) if (p.st && p.st !== 'title' && p.ini && p.ini.indexOf(id) >= 0) return p.name;
        if (L.held.indexOf(id) >= 0) return 'on the way in';
        return '';
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
    // Who Start waits on: everyone here at the title and not away who has not chosen (room.js 'start' checks again).
    function waitingOn() {
        const out = [];
        for (const p of Coop.others()) {
            const row = L.rows[p.id];
            if (!row || p.id === L.host) continue; // a partner has no row
            if ((p.st || 'title') !== 'title' || p.up || row.away) continue; // in the run, or their game is starting
            if (!row.ready) out.push(p.name);
        }
        return out;
    }

    // A save as a line: "Enki, my save, Lv 2", "Cahara, other run, Lv 5", "D'arce, solo save" (made outside any run:
    // alone, or in an opening before the world was joined).
    const saveWords = (save) => charName(save.char) + ', ' + (!save.other ? 'my save' : save.runId ? 'other run' : 'solo save') + (save.level ? ', Lv ' + save.level : '');
    // What a row comes in as, as the As: line says it.
    function asWords(row) {
        if (row.pick) return charName(row.pick) + ', new';
        if (L.mine && row.has === L.mine.char) return saveWords(L.mine);
        return charName(row.has);
    }
    const place = (map) => (mapNames[map] ? ' · ' + mapNames[map] : '');
    const runWords = () => (!L.run ? 'choose...' : L.run.kind === 'new' ? 'New' : 'Continue' + place(L.run.map));

    // Characters to come in as: new ones, this player's save of the run, and their saves of other runs.
    // Greyed lines say whose they are.
    function pickList(me) {
        const forHost = L.pickFor === 'run' || L.pickFor === 'host';
        const list = CHARS.map((c) => {
            const by = takenBy(c.id);
            return { name: c.name + (by ? ' (' + by + ')' : ''), act: 'pick:' + c.id, enabled: !by, at: forHost ? charOf(me) === c.id : me.pick === c.id };
        });
        if (!forHost) {
            const saves = (L.own ? [L.own] : []).concat(otherSaves().filter((o) => !L.own || o.char !== L.own.char));
            for (const save of saves) {
                const by = takenBy(save.char);
                list.push({ name: saveWords(save) + (by ? ' (' + by + ')' : ''), act: 'save:' + save.slot, enabled: !by, at: !me.pick && !!L.mine && L.mine.slot === save.slot });
            }
        }
        list.push({ name: 'Back', act: 'back' });
        return list;
    }

    // The lines of the title menu while the lobby is on; null leaves the game's own. They say how things
    // stand (his OK 11/22 of the 11/21 proposal): Run: and As: for the host, Start (waiting on ...); As: for
    // everyone else, and choosing who you come in as is being ready.
    L.menu = function () {
        if (!L.on) return null;
        if (L.going || L.line.indexOf(Coop.id) >= 0) return [];
        const me = myRow();
        if (L.mode === 'runs') return [{ name: 'New run', act: 'newrun' }, { name: 'Continue', act: 'chooserun', enabled: DataManager.isAnySavefileExists() }, { name: 'Back', act: 'back' }];
        if (L.mode === 'confirm' && L.confirm) {
            return [{ name: 'Bring ' + charName(L.confirm.char) + (L.confirm.level ? ' (Lv ' + L.confirm.level + ')' : '') + ' into this run', act: 'bring' }, { name: 'Back', act: 'back' }];
        }
        if (L.mode === 'pick') return pickList(me);
        if (L.founded) return [{ name: 'Join', act: 'join' }, { name: 'Together', symbol: 'together' }];
        if (isHost()) {
            const fresh = !!L.run && L.run.kind === 'new';
            const wait = L.run ? waitingOn() : [];
            return [
                { name: 'Run: ' + runWords(), act: 'runs' },
                { name: 'As: ' + (!L.run ? '-' : (charName(charOf(me)) || 'choose...') + (fresh ? '' : ' (the save)')), act: 'hostpick', enabled: fresh },
                { name: 'Start' + (wait.length ? ' (waiting on ' + wait.join(', ') + ')' : ''), act: 'start', enabled: !!L.run && !!charOf(me) && !wait.length },
                { name: 'Together', symbol: 'together' },
            ];
        }
        // Before the host has chosen the run the line shows and waits (his playtest 11/14: a lone Together was disorienting).
        if (!L.run) return [{ name: 'As: (' + nameOf(L.host) + ' is choosing the run)', act: 'as', enabled: false }, { name: 'Together', symbol: 'together' }];
        return [{ name: 'As: ' + (me.ready ? asWords(me) : 'choose...'), act: 'as' }, { name: 'Together', symbol: 'together' }];
    };

    // Coming in as someone is being ready, or the Join with a run under way. A change of mind takes the
    // ready back first (the room keeps a ready player's character); the pick goes with the ready or join,
    // and one the room drops takes them along (asPicked).
    function comeAs(pick, save) {
        const me = myRow();
        if (me.ready) say('ready', { on: false });
        if (save) { L.mine = save; say('has', { has: save.char }); }
        say('pick', { pick });
        if (L.pickFor === 'join') say('join', { pick });
        else say('ready', { on: true, pick });
    }

    function act(scene, what) {
        const w = scene._commandWindow;
        if (what === 'runs') L.mode = 'runs';
        else if (what === 'newrun') { L.mode = 'pick'; L.pickFor = 'run'; }
        else if (what === 'hostpick') { L.mode = 'pick'; L.pickFor = 'host'; }
        else if (what === 'back') { L.mode = 'main'; L.confirm = null; }
        else if (what === 'chooserun') { L.mode = 'main'; L.choosing = true; scene.commandContinue(); return; }
        else if (what === 'start') say('start');
        // The host back at the title of their run comes in as who they were (room.js refuses them a pick then).
        else if (what === 'join' && isHost() && charOf(myRow())) say('join');
        else if (what === 'join' || what === 'as') { L.mode = 'pick'; L.pickFor = what; }
        else if (/^pick:/.test(what)) {
            const id = Number(what.slice(5));
            L.mode = 'main';
            if (L.pickFor === 'run') say('run', { run: { kind: 'new' }, pick: id });
            else if (L.pickFor === 'host') say('pick', { pick: id });
            else comeAs(id, null);
        } else if (/^save:/.test(what)) {
            const slot = Number(what.slice(5));
            const save = L.own && L.own.slot === slot ? L.own : otherSaves().find((o) => o.slot === slot);
            // Another run's: said what that means before it is chosen (his 11/22: "we should be clear").
            if (save && save.other) {
                L.mode = 'confirm';
                L.confirm = save;
                if (Coop.toast) Coop.toast(charName(save.char) + ' comes in as that save has them: level, gear, items and wounds. The world and story are this run\'s, so that run\'s progress stays behind.', 12000);
            } else {
                L.mode = 'main';
                if (save) comeAs(0, save);
            }
        } else if (what === 'bring') {
            const save = L.confirm;
            L.mode = 'main';
            L.confirm = null;
            if (save) comeAs(0, save);
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
        if (items) Coop.note('lobby menu: ' + key);
        const acts = (w._list || []).map((c) => c.symbol + ':' + c.ext).join('|');
        menuKey = key;
        const index = w.index();
        w.clearCommandList();
        w.makeCommandList();
        const same = acts === w._list.map((c) => c.symbol + ':' + c.ext).join('|');
        w.width = w.windowWidth();
        w.height = w.fittingHeight(Math.max(1, w._list.length));
        w.updatePlacement();
        w.createContents();
        w.refresh();
        w.visible = w._list.length > 0;
        if (!w._list.length) { w.deactivate(); return; }
        // The same lines (by what they do), one now worded or allowed otherwise: the cursor stays. Other lines: the marked one, else the top.
        w.select(same && !first ? Math.min(Math.max(index, 0), w._list.length - 1) : Math.max(0, (items || []).findIndex((it) => it.at)));
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

    // Rows for client/ui.js while the lobby is on; null leaves its own list. People only (the run is on the
    // host's row): who is here and who each comes in as.
    Coop.lobbyRows = function () {
        if (!L.on) return null;
        const out = [];
        const people = [{ id: Coop.id, name: Coop.name || 'You', st: 'title', me: true }].concat(Coop.others());
        // The host first, then by player number: the same order on every screen.
        people.sort((a, b) => (b.id === L.host) - (a.id === L.host) || a.id - b.id);
        for (const p of people) {
            const row = L.rows[p.id];
            const st = p.me ? 'title' : (p.st || 'title');
            let word = '', kind = '';
            if (!row) { // an AI partner
                if (!p.bot) continue;
                word = st !== 'title' && st ? 'in' + place(p.m) : 'AI';
            } else if (st !== 'title') word = 'in' + place(p.m);
            else if (L.line.indexOf(p.id) >= 0 || (!p.me && p.up)) word = 'loading';
            else if (row.away) { word = 'away'; kind = 'dim'; }
            else {
                const char = charOf(row);
                const mine = p.me ? clashName() : '';
                if (mine) { word = mine + ' is taken'; kind = 'bad'; }
                else if (L.founded) { word = 'not in'; kind = 'dim'; }
                else if (p.id === L.host) word = !L.run ? 'choosing the run' : (L.run.kind === 'new' ? 'new run' : 'continuing' + place(L.run.map)) + (char ? ', ' + charName(char) : '');
                else if (!L.run) word = '';
                else if (row.ready) word = charName(char);
                else { word = 'choosing'; kind = 'dim'; }
            }
            out.push('<div class="row' + (kind === 'dim' ? ' dim' : '') + '">' + esc(p.name)
                + (word ? ' <span class="' + (kind === 'bad' ? 'bad' : 'dim') + '">' + esc(word) + '</span>' : '') + '</div>');
        }
        return out;
    };

    // The room's word from before this file came in (net.js keeps it).
    if (Coop.lastLobby) heard(Coop.lastLobby);
})();
