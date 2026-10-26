//=============================================================================
// fh-coop: where your partners are. A partner on this map but off the screen
// gets an arrow at the edge of the screen, pointing their way, with their
// name. On another map they are in the corner list instead.
//=============================================================================
(function () {
    const style = document.createElement('style');
    style.textContent = [
        '.coop-pointer { position: fixed; left: 0; top: 0; z-index: 48; pointer-events: none; display: none; opacity: 0.55; }',
        '.coop-pointer .tip { position: absolute; left: -7px; top: -5px; width: 0; height: 0;',
        '  border-left: 14px solid #e8dcc0; border-top: 5px solid transparent; border-bottom: 5px solid transparent;',
        '  filter: drop-shadow(0 0 1px #000); }',
        '.coop-pointer .name { position: absolute; transform: translate(-50%, 9px); white-space: nowrap;',
        '  font: 11px Georgia, "Times New Roman", serif; color: #e8dcc0; text-shadow: 0 0 2px #000; }',
    ].join('\n');
    document.head.appendChild(style);

    const pointers = new Map(); // peer id -> { el, tip, name }
    function pointerFor(peer) {
        let p = pointers.get(peer.id);
        if (!p) {
            const el = document.createElement('div');
            el.className = 'coop-pointer';
            const tip = document.createElement('div');
            tip.className = 'tip';
            const name = document.createElement('div');
            name.className = 'name';
            el.appendChild(tip);
            el.appendChild(name);
            document.body.appendChild(el);
            p = { el, tip, name };
            pointers.set(peer.id, p);
        }
        if (p.name.textContent !== peer.name) p.name.textContent = peer.name;
        return p;
    }
    Coop.on('leave', function (peer) {
        const p = pointers.get(peer.id);
        if (p) { p.el.remove(); pointers.delete(peer.id); }
    });

    // "Partner Arrows" in the game's Options, under General: on unless turned
    // off, and kept with the game's other options on this PC.
    // "Balance changes" is the same kind of option. It is this PC's preference
    // for when this PC's player is the one whose game sets the run. The row is
    // hidden otherwise (a joiner's tick must not look like it does anything).
    ConfigManager.coopPointer = true;
    let balanceChoice = true;
    Object.defineProperty(ConfigManager, 'coopBalance', {
        configurable: true,
        get: function () { return balanceChoice; },
        set: function (v) {
            const on = !!v;
            if (on === balanceChoice) return;
            balanceChoice = on;
            if (!(window.Coop && Coop.decides)) return;
            if (Coop.setBalance) Coop.setBalance(on);
            if (Coop.connected) Coop.send({ t: 'balance', on: on });
        },
    });
    const _makeData = ConfigManager.makeData;
    ConfigManager.makeData = function () {
        const config = _makeData.call(this);
        config.coopPointer = this.coopPointer;
        config.coopBalance = this.coopBalance;
        return config;
    };
    const _applyData = ConfigManager.applyData;
    ConfigManager.applyData = function (config) {
        _applyData.call(this, config);
        this.coopPointer = config.coopPointer !== false;
        this.coopBalance = config.coopBalance !== false;
    };
    // The game's options list (YEP_OptionsCore) loads after this file, so the
    // option joins it once the game boots. It copies an ON/OFF option's code.
    const _bootStart = Scene_Boot.prototype.start;
    Scene_Boot.prototype.start = function () {
        _bootStart.call(this);
        const cats = window.Yanfly && Yanfly.Param && Yanfly.Param.OptionsCategories;
        if (!Array.isArray(cats) || !cats.length) return;
        const cat = cats.find((c) => c.Name === 'General') || cats[0];
        const list = cat.OptionsList;
        const like = list.find((o) => o.Symbol === 'commandRemember');
        if (!like) return;
        const put = (extra) => {
            if (list.some((o) => o.Symbol === extra.Symbol)) return;
            const at = list.findIndex((o) => o.Symbol === 'none');
            list.splice(at < 0 ? list.length : at, 0, Object.assign({}, like, extra));
        };
        put({ Name: 'Partner Arrows', Symbol: 'coopPointer', HelpDesc: JSON.stringify('Arrows at the edge of the screen point to partners off it.') });
        put({
            Name: 'Balance changes', Symbol: 'coopBalance',
            HelpDesc: JSON.stringify('Weapons do what their text says; two soul stones can call a partner back. Set by the host for everyone.'),
            ShowHide: JSON.stringify('show = !!(window.Coop && Coop.decides);'),
        });
        // nameok can have landed already. The saved choice becomes the run's then.
        if (window.Coop && Coop.decides && Coop.setBalance && Coop.connected) {
            const on = ConfigManager.coopBalance !== false;
            Coop.setBalance(on);
            Coop.send({ t: 'balance', on: on });
        }
    };

    const MARGIN = 20; // game pixels from the edge of the screen

    function update() {
        requestAnimationFrame(update);
        const scene = window.SceneManager && SceneManager._scene;
        // Not while a map loads: its data is not there yet to place anyone by.
        const live = ConfigManager.coopPointer && window.$gameMap &&window.$dataMap && Coop.world && Coop.world.live && scene instanceof Scene_Map && scene.isActive()
            && !SceneManager.isSceneChanging() && !$gamePlayer.isTransferring() && Graphics._canvas;
        const shown = new Set();
        if (live) {
            const W = Graphics.width, H = Graphics.height;
            const rect = Graphics._canvas.getBoundingClientRect();
            for (const peer of Coop.peersHere()) {
                if (peer.tr) continue; // hidden by a scene of the game's own
                const av = Coop.avatarFor(peer.id);
                const sx = av.screenX(), sy = av.screenY() - 24;
                if (sx >= 0 && sx <= W && sy >= 0 && sy <= H) continue; // on screen: the character itself shows
                const cx = W / 2, cy = H / 2, dx = sx - cx, dy = sy - cy;
                const t = Math.min((cx - MARGIN) / Math.max(Math.abs(dx), 1e-6), (cy - MARGIN) / Math.max(Math.abs(dy), 1e-6));
                const ex = cx + dx * t, ey = cy + dy * t;
                const p = pointerFor(peer);
                p.el.style.transform = 'translate(' + (rect.left + ex * rect.width / W) + 'px,' + (rect.top + ey * rect.height / H) + 'px)';
                p.tip.style.transform = 'rotate(' + Math.atan2(dy, dx) + 'rad)';
                p.el.style.display = 'block';
                p.el.dataset.angle = String(Math.round(Math.atan2(dy, dx) * 180 / Math.PI));
                shown.add(peer.id);
            }
        }
        for (const [id, p] of pointers) if (!shown.has(id)) p.el.style.display = 'none';
    }
    requestAnimationFrame(update);
})();
