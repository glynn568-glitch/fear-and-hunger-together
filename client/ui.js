//=============================================================================
// fh-coop: the small bits of interface: name entry on the title screen and
// the list of players in the corner.
//=============================================================================
(function () {
    const style = document.createElement('style');
    style.textContent = [
        // Top right: the game writes its own text (version, map names) in the top left.
        '#coop-corner { position: fixed; right: 10px; top: 8px; z-index: 50; pointer-events: none;',
        '  display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }',
        '#coop-corner > div { position: static !important; }',
        '#coop-hud { z-index: 50; pointer-events: none; text-align: right;',
        '  font: 14px/1.35 Georgia, "Times New Roman", serif; color: #d8c9a8; text-shadow: 0 0 3px #000, 0 0 3px #000; }',
        '#coop-hud .row { white-space: nowrap; }',
        '#coop-hud .dim { color: #8d8370; }',
        '#coop-hud .bad { color: #b0483a; }',
        '#coop-hud .bar { display: inline-block; width: 46px; height: 5px; margin-left: 6px; background: #2a1c18; vertical-align: middle; }',
        '#coop-hud .bar i { display: block; height: 100%; background: #8a2f25; }',
        '#coop-name { position: fixed; left: 10px; bottom: 10px; z-index: 50;',
        '  font: 15px Georgia, "Times New Roman", serif; color: #d8c9a8; text-shadow: 0 0 3px #000; }',
        '#coop-name input { font: inherit; color: #e8dcc0; background: rgba(20, 12, 10, 0.85); border: 1px solid #6b5a45;',
        '  padding: 3px 6px; width: 150px; outline: none; }',
        '#coop-name input.need { border-color: #b0483a; }',
        '#coop-toast { position: fixed; left: 50%; top: 14%; transform: translateX(-50%); z-index: 60; pointer-events: none;',
        '  font: 17px Georgia, "Times New Roman", serif; color: #e8dcc0; text-shadow: 0 0 4px #000, 0 0 4px #000;',
        '  opacity: 0; transition: opacity 0.4s; text-align: center; white-space: pre-line; }',
        // The panels along the top share one column, so none is drawn over another.
        '#coop-top { position: fixed; left: 0; right: 0; top: 1.5%; z-index: 60; pointer-events: none;',
        '  display: flex; flex-direction: column; align-items: center; gap: 6px; }',
        '#coop-top > div { position: static !important; transform: none !important; }',
    ].join('\n');
    document.head.appendChild(style);

    const hud = document.createElement('div');
    hud.id = 'coop-hud';
    const nameBox = document.createElement('div');
    nameBox.id = 'coop-name';
    nameBox.innerHTML = 'Your name <input maxlength="16" spellcheck="false" autocomplete="off">';
    const toast = document.createElement('div');
    toast.id = 'coop-toast';
    const nameInput = nameBox.querySelector('input');

    function mount() {
        const corner = document.createElement('div');
        corner.id = 'coop-corner';
        document.body.appendChild(corner);
        corner.appendChild(hud);
        document.body.appendChild(nameBox);
        document.body.appendChild(toast);
        const top = document.createElement('div');
        top.id = 'coop-top';
        document.body.appendChild(top);
        for (const id of ['coop-turn', 'coop-resume', 'coop-toast', 'coop-caption']) {
            const el = document.getElementById(id);
            if (el) top.appendChild(el);
        }
        nameInput.value = Coop.name || Coop.loadName();
        if (nameInput.value) Coop.setName(nameInput.value);
    }
    if (document.body) mount(); else window.addEventListener('DOMContentLoaded', mount);

    // Keys typed into the name box must not reach the game.
    // The key that closes the name box is still down when the game gets the
    // keyboard back; it is ignored until it has been let go.
    let closingKey = '';
    for (const type of ['keydown', 'keyup', 'keypress']) {
        nameInput.addEventListener(type, function (e) {
            e.stopPropagation();
            if (type === 'keydown' && (e.key === 'Enter' || e.key === 'Escape')) {
                closingKey = e.code;
                nameInput.blur();
            }
        });
    }
    window.addEventListener('keydown', function (e) {
        if (closingKey && e.code === closingKey) e.stopImmediatePropagation();
    }, true);
    window.addEventListener('keyup', function (e) {
        if (e.code === closingKey) closingKey = '';
    }, true);
    // Keys typed in the box never reach the game, including the release of
    // whatever was held when the box took over. Without this the game goes
    // on believing that key is held and repeats it forever.
    nameInput.addEventListener('focus', function () { Input.clear(); });
    nameInput.addEventListener('change', function () {
        Coop.setName(nameInput.value);
        nameInput.value = Coop.name;
        nameInput.classList.toggle('need', !Coop.name);
    });
    nameInput.addEventListener('blur', function () {
        Coop.setName(nameInput.value);
        nameInput.value = Coop.name;
    });

    Coop.on('nametaken', function (msg) {
        nameInput.value = '';
        nameInput.classList.add('need');
        Coop.toast('Someone here is already called ' + msg.name + '. Pick another name (bottom left).', 7000);
    });

    let toastTimer = 0, toastGone = 0;
    Coop.toast = function (text, ms) {
        toast.textContent = text;
        toast.style.display = '';
        toast.style.opacity = '1';
        clearTimeout(toastTimer);
        clearTimeout(toastGone);
        toastTimer = setTimeout(function () {
            toast.style.opacity = '0';
            // Out of the column once faded, so it holds no empty space above the next panel.
            toastGone = setTimeout(function () { toast.style.display = 'none'; }, 450);
        }, ms || 3500);
    };

    // Turned away for good (another version, a dead link): said until the page is closed.
    Coop.on('refused', function (msg) {
        Coop.toast(msg.text, 1e9);
    });
    Coop.on('hostdown', function () {
        Coop.toast('Cannot reach the host. Trying again...', 4000);
    });

    // Saves are filed under the player's name, so a game cannot start without one.
    const _commandNewGame = Scene_Title.prototype.commandNewGame;
    Scene_Title.prototype.commandNewGame = function () {
        if (!Coop.name) return needName(this);
        _commandNewGame.call(this);
    };
    const _commandContinue = Scene_Title.prototype.commandContinue;
    Scene_Title.prototype.commandContinue = function () {
        if (!Coop.name) return needName(this);
        _commandContinue.call(this);
    };
    function needName(scene) {
        SoundManager.playBuzzer();
        nameInput.classList.add('need');
        nameInput.focus();
        Coop.toast('Type a name first (bottom left).');
        scene._commandWindow.activate();
    }

    const STATE_TEXT = { title: 'at the title', map: '', event: '', menu: 'in a menu', battle: 'fighting', dead: 'dead', away: 'tabbed out' };
    let mapNames = {};
    fetch('coop/mapnames.json').then((r) => (r.ok ? r.json() : {})).then((names) => { mapNames = names || {}; }).catch(() => {});
    function mapName(id) {
        return mapNames[id] || '';
    }
    let enteredAt = 0;
    Coop.on('entered', function () { enteredAt = Date.now(); });
    function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

    // The interface text grows with the picture, so it stays readable when
    // the game fills a large monitor.
    let lastScale = 0;
    function fitText() {
        const scale = Math.max(1, Math.min(2.4, (Graphics._realScale || 1) * 0.75));
        if (scale === lastScale) return;
        lastScale = scale;
        hud.style.fontSize = Math.round(14 * scale) + 'px';
        nameBox.style.fontSize = Math.round(15 * scale) + 'px';
        toast.style.fontSize = Math.round(17 * scale) + 'px';
        const dead = document.getElementById('coop-dead');
        if (dead) dead.style.fontSize = Math.round(18 * scale) + 'px';
    }

    // What co-op adds, for a player nobody has briefed. F1 shows and hides it.
    const helpStyle = document.createElement('style');
    helpStyle.textContent = [
        '#coop-help { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 80; pointer-events: none;',
        '  box-sizing: border-box; padding: 1.5em 2em 1.2em; color: #cfc2a8; background: rgba(10, 7, 6, 0.97);',
        '  border: 1px solid #7a6650; box-shadow: 0 0 0 4px rgba(10, 7, 6, 0.97), 0 0 0 5px #3d3228, 0 0 40px 12px rgba(0, 0, 0, 0.7);',
        '  font: 17px/1.4 GameFont, Georgia, "Times New Roman", serif; }',
        '#coop-help h1 { margin: 0 0 0.9em; padding-bottom: 0.6em; border-bottom: 1px solid #3d3228; text-align: center;',
        '  font: inherit; font-size: 1.2em; letter-spacing: 0.22em; text-transform: uppercase; color: #f2d28a; }',
        '#coop-help dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.5em 1.3em; margin: 0; }',
        '#coop-help dt { text-align: right; color: #f2d28a; white-space: nowrap; }',
        '#coop-help dd { margin: 0; text-wrap: balance; }',
        '#coop-help footer { margin-top: 1em; padding-top: 0.7em; border-top: 1px solid #3d3228; text-align: center;',
        '  font-size: 0.86em; color: #8d8370; }',
        '#coop-help footer b { font-weight: normal; color: #b9ad98; }',
    ].join('\n');
    document.head.appendChild(helpStyle);
    const help = document.createElement('div');
    help.id = 'coop-help';
    help.style.display = 'none';
    const HELP = [
        ['Enter', 'Facing a partner: hand them something, use or cast something on them, or join their fight.'],
        ['F', 'Follow a partner who has just left the room.'],
        ['Y', 'Talk. AI partners take orders this way.'],
        ['F8', 'Host: call an AI partner in, or send it home.'],
        ['Fights', 'Whoever touches the enemy starts it and keeps what it drops. Anyone near joins. You command your own.'],
        ['Bags', 'Yours alone. An emptied chest stays empty.'],
        ['Party', 'Four characters between you.'],
        ['Death', 'You watch. A partner can call you back at a ritual circle. Hold Esc to let the character go.'],
        ['Beds', 'Sleeping saves everyone. Another day, all press Continue.'],
        ['Crash', 'Start it again and press R at the title.'],
    ];
    help.innerHTML = '<h1>Playing together</h1><dl>' + HELP.map((row) => '<dt>' + row[0] + '</dt><dd>' + row[1] + '</dd>').join('') + '</dl>'
        + '<footer><b>F9</b> lag meter &nbsp;&middot;&nbsp; <b>F4</b> full screen &nbsp;&middot;&nbsp; <b>Ctrl+Shift+U</b> unstuck &nbsp;&middot;&nbsp; <b>Ctrl+Shift+B</b> bug report &nbsp;&middot;&nbsp; <b>Tab</b> everyone&rsquo;s gear &nbsp;&middot;&nbsp; <b>F1</b> close</footer>';
    (document.body ? Promise.resolve() : new Promise((r) => window.addEventListener('DOMContentLoaded', r))).then(() => document.body.appendChild(help));
    document.addEventListener('keydown', function (e) {
        if (e.code !== 'F1' || e.repeat) return;
        e.preventDefault();
        const scale = Math.max(1, Math.min(2, (Graphics._realScale || 1) * 0.7));
        help.style.fontSize = Math.round(17 * scale) + 'px';
        help.style.width = Math.round(640 * scale) + 'px';
        help.style.maxWidth = '94vw';
        help.style.display = help.style.display === 'none' ? '' : 'none';
    });

    let lastHud = '';
    function drawHud() {
        fitText();
        const onTitle = SceneManager._scene instanceof Scene_Title;
        nameBox.style.display = onTitle ? '' : 'none';
        const rows = [];
        if (!Coop.connected) rows.push('<div class="row bad">co-op: reconnecting...</div>');
        if (Coop.world.sameAs) rows.push('<div class="row bad">playing alone: ' + esc(Coop.world.sameAs) + ' has this character</div>');
        if (Coop.world.otherRun) rows.push('<div class="row bad">playing alone: the others are in a different run</div>');
        for (const p of Coop.others()) {
            const here = window.$gameMap && Coop.world.live && p.m === $gameMap.mapId();
            let where = STATE_TEXT[p.st] || '';
            if (p.st && p.st !== 'title' && !here) {
                const place = mapName(p.m);
                where = (where ? where + ', ' : '') + (place ? 'in ' + esc(place) : 'elsewhere');
            }
            const bar = p.mhp ? '<span class="bar"><i style="width:' + Math.round(100 * p.hp / p.mhp) + '%"></i></span>' : '';
            rows.push('<div class="row">' + esc(p.name) + (p.an ? ' <span class="dim">' + esc(p.an) + '</span>' : '')
                + bar + (where ? ' <span class="dim">' + where + '</span>' : '')
                // What an AI partner is doing right now, so a stuck one shows as stuck.
                + (p.bot && p.act && p.st !== 'title' ? ' <span class="dim">' + esc(p.act) + '</span>' : '') + '</div>');
        }
        const on = onTitle && Coop.world.on;
        if (on && Coop.world.slotsOf(on.runId)[on.stamp]) rows.push('<div class="row">' + esc(on.by) + ' has carried on a run you share. Continue opens on the matching save.</div>');
        if (onTitle && Coop.connected && !rows.length) rows.push('<div class="row dim">co-op: nobody else here yet</div>');
        if (onTitle || (enteredAt && Date.now() - enteredAt < 60000)) rows.push('<div class="row dim">F1: how playing together works</div>');
        const html = rows.join('');
        if (html !== lastHud) { hud.innerHTML = html; lastHud = html; }
    }
    setInterval(drawHud, 250);

    // Said once their name has arrived; an AI partner introduces itself instead.
    Coop.on('join', function (peer) {
        setTimeout(function () {
            const p = Coop.peers.get(peer.id);
            // Late, so it never covers something that matters more.
            if (p && !p.bot && !/^Player \d+$/.test(p.name) && Coop.world.live && toast.style.opacity !== '1') Coop.toast(p.name + ' connected.');
        }, 1500);
    });
    // Someone who never gave a name ("Player 3") was never really here.
    Coop.on('leave', function (peer) { if (Coop.world.live && !/^Player \d+$/.test(peer.name)) Coop.toast(peer.name + ' disconnected.'); });

    // A menu freezes this player's picture, not the world: the others play on.
    // Said on opening one, now and then, so a still screen is not taken for a pause.
    let menuToldAt = 0;
    const _menuStart = Scene_MenuBase.prototype.start;
    Scene_MenuBase.prototype.start = function () {
        _menuStart.call(this);
        const others = Coop.world.live ? Coop.others().filter((p) => p.st && p.st !== 'title') : [];
        if (others.length && Date.now() - menuToldAt > 120000) {
            menuToldAt = Date.now();
            Coop.toast('The world does not stop while you are in here.', 4000);
        }
    };
})();
