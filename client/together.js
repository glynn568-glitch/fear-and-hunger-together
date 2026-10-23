//=============================================================================
// fh-coop: "Together" on the title screen. Host online (a link to send),
// join a friend's game (paste their link), call in an AI partner. The server
// on this PC does the switching (/coop/app in server.js); the page then
// reconnects through whatever it has become.
//=============================================================================
(function () {
    const style = document.createElement('style');
    style.textContent = [
        '#coop-together { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 60; display: none;',
        '  width: min(90vw, 600px); box-sizing: border-box; padding: 18px 22px 16px; background: rgba(14, 9, 8, 0.97); border: 1px solid #6b5a45;',
        '  font: 16px/1.45 Georgia, "Times New Roman", serif; color: #e0d4bc; }',
        '#coop-together.open { display: block; }',
        '#coop-together h2 { margin: 0 0 4px; font-size: 1.25em; font-weight: normal; color: #f2d28a; }',
        '#coop-together h3 { margin: 16px 0 6px; font-size: 1em; font-weight: normal; color: #c9a86a; }',
        '#coop-together .status { color: #b9ad97; }',
        '#coop-together input[type=text] { width: 100%; box-sizing: border-box; font: 14px monospace; color: #e8dcc0; background: rgba(20, 12, 10, 0.9);',
        '  border: 1px solid #6b5a45; padding: 6px 8px; outline: none; }',
        '#coop-together .row { display: flex; gap: 10px; margin-top: 8px; flex-wrap: wrap; align-items: center; }',
        '#coop-together button { font: inherit; color: #e8dcc0; background: #2a1d17; border: 1px solid #6b5a45; padding: 4px 14px; cursor: pointer; }',
        '#coop-together button.big { background: #5a2018; border-color: #a0533c; }',
        '#coop-together button:focus { outline: 1px solid #f2d28a; }',
        '#coop-together label { font-size: 0.9em; color: #b9ad97; cursor: pointer; }',
        '#coop-together .why { min-height: 1.4em; margin-top: 8px; color: #b9ad97; }',
        '#coop-together .why.bad { color: #e7a07a; }',
        '#coop-together .row input[type=text] { flex: 1; width: auto; min-width: 0; }',
        '#coop-together [hidden] { display: none !important; }',
    ].join('\n');
    document.head.appendChild(style);

    const box = document.createElement('div');
    box.id = 'coop-together';
    box.innerHTML = '<h2>Together</h2><div class="status"></div>'
        + '<div data-part="host"><h3>Play with friends</h3>'
        + '<div class="row"><button class="big" data-do="online">Host online</button><button data-do="offline" hidden>Stop hosting</button>'
        + '<label><input type="checkbox" data-do="private"> Hide my IP address</label></div>'
        + '<div class="row" data-part="link" hidden><input type="text" readonly data-field="link"><button data-do="copy">Copy</button></div></div>'
        + '<div data-part="join"><h3>Join a friend</h3>'
        + '<div class="row"><input type="text" spellcheck="false" autocomplete="off" placeholder="Paste the link your friend sent" data-field="join"></div>'
        + '<div class="row"><button class="big" data-do="join">Join</button></div></div>'
        + '<div data-part="leave" hidden><div class="row"><button data-do="leave">Leave their game</button></div></div>'
        + '<div data-part="import"><h3>Single-player saves</h3><div class="row"><button data-do="import">Bring mine in</button></div></div>'
        + '<div data-part="partner"><h3>AI partner</h3><div class="row"><button data-do="partner">Call one in</button><button data-do="home">Send one home</button><button data-do="mind">How it thinks</button></div></div>'
        + '<div class="why"></div>'
        + '<div class="row" style="justify-content: space-between"><button data-do="report">Copy a bug report</button><button data-do="close">Close</button></div>';
    (document.body ? Promise.resolve() : new Promise((r) => window.addEventListener('DOMContentLoaded', r))).then(() => document.body.appendChild(box));
    const $ = (sel) => box.querySelector(sel);
    const why = $('.why');
    let state = { mode: 'local' };
    let busy = false;
    let copyWhenReady = false;

    function api(pathname, body) {
        return fetch('coop/app' + pathname, {
            method: body ? 'POST' : 'GET',
            headers: body ? { 'x-fh-app': '1', 'Content-Type': 'application/json' } : { 'x-fh-app': '1' },
            body: body ? JSON.stringify(body) : undefined,
        }).then((r) => r.json().then((j) => { if (!r.ok || j.error) throw new Error(j.error || 'Something went wrong.'); return j; }));
    }

    function show(s) {
        state = s;
        const joined = s.mode === 'joined', online = s.mode === 'online';
        $('.status').textContent = joined ? 'You are in a friend\'s game.' : online ? (s.ready ? 'Online. Send your friends the link.' : 'Online. Your link is being published; it is copied as soon as it works.') : 'Just you, on this PC.';
        $('[data-part=host]').hidden = joined;
        $('[data-part=join]').hidden = joined || online;
        $('[data-part=leave]').hidden = !joined;
        $('[data-part=partner]').hidden = joined;
        $('[data-do=online]').hidden = online;
        $('[data-do=offline]').hidden = !online;
        $('[data-part=link]').hidden = !online || !s.ready;
        $('[data-field=link]').value = s.link || '';
        $('[data-do=private]').checked = !!s.private;
        $('[data-do=private]').disabled = online;
    }

    // Saves from playing alone (the game's own save folder) copied into free
    // slots here, once each. Loading one starts a co-op run from that moment.
    async function importSaves() {
        if (!onTitle()) throw new Error('Go back to the title screen first.');
        if (!Coop.name) throw new Error('Type your name first (bottom left): your saves are kept under it.');
        const get = (file) => fetch('coop/solo/' + file, { cache: 'no-store' }).then((r) => (r.ok ? r.text() : ''), () => '');
        let theirs = null;
        try { theirs = JSON.parse(LZString.decompressFromBase64(await get('global'))); } catch (e) { /* none */ }
        if (!Array.isArray(theirs) || !theirs.some(Boolean)) return 'No single-player saves were found in the game\'s folder.';
        const mine = DataManager.loadGlobalInfo() || [];
        const max = DataManager.maxSavefiles();
        const had = new Set(mine.filter(Boolean).map((i) => i.coopFrom).filter(Boolean));
        let brought = 0, already = 0, full = 0;
        for (let i = 1; i < theirs.length; i++) {
            const info = theirs[i];
            if (!info) continue;
            const from = i + ':' + info.timestamp;
            if (had.has(from)) { already++; continue; }
            let slot = 1;
            while (slot <= max && mine[slot]) slot++;
            if (slot > max) { full++; continue; }
            let json = '';
            try { json = LZString.decompressFromBase64(await get('file' + i)) || ''; } catch (e) { /* unreadable */ }
            if (!json) continue;
            StorageManager.save(slot, json);
            mine[slot] = Object.assign({}, info, { coopFrom: from });
            brought++;
        }
        if (brought) DataManager.saveGlobalInfo(mine);
        if (!brought && already) return 'Those saves are already here. Continue lists them.';
        if (!brought && full) return 'No free save slot is left here for them.';
        if (!brought) return 'No single-player saves could be read.';
        return 'Brought in ' + brought + ' save' + (brought > 1 ? 's' : '') + '. Continue lists ' + (brought > 1 ? 'them' : 'it') + '.' + (full ? ' ' + full + ' did not fit.' : '');
    }

    function act(what) {
        if (busy) return;
        const run = (text, p, after) => {
            busy = true;
            why.classList.remove('bad');
            why.textContent = text;
            p.then((s) => { busy = false; why.textContent = ''; show(s); if (after) after(s); })
                .catch((e) => { busy = false; why.textContent = e.message; why.classList.add('bad'); });
        };
        if (what === 'online') {
            run('Going online... (the first time takes a little longer)', api('/online', { on: true, private: $('[data-do=private]').checked }), (s) => { if (s.ready) copy(s.link, 'Online. The link is copied: send it to your friends.'); else copyWhenReady = true; });
        } else if (what === 'offline') {
            run('', api('/online', { on: false, private: $('[data-do=private]').checked }));
        } else if (what === 'copy') {
            copy(state.link, 'Copied.');
        } else if (what === 'join') {
            const link = $('[data-field=join]').value.trim();
            if (!link) { why.textContent = 'Paste your friend\'s link first.'; return; }
            Coop.refused = null;
            run('Joining...', api('/join', { link, fromTitle: onTitle() }), () => { why.textContent = 'Joined. Start a new game or continue, as your friend did.'; });
        } else if (what === 'leave') {
            Coop.refused = null;
            run('', api('/leave', { fromTitle: onTitle() }));
        } else if (what === 'partner') {
            Coop.send({ t: 'partner', on: true });
        } else if (what === 'home') {
            Coop.send({ t: 'partner', on: false });
        } else if (what === 'mind') {
            Coop.openPartnerSetup();
        } else if (what === 'import') {
            busy = true;
            why.classList.remove('bad');
            why.textContent = 'Looking for your saves...';
            importSaves().then((said) => { busy = false; why.textContent = said; }, (e) => { busy = false; why.textContent = e.message; why.classList.add('bad'); });
        } else if (what === 'report') {
            bugReport().then((said) => { why.classList.remove('bad'); why.textContent = said; });
        } else if (what === 'close') close();
    }

    // Versions, this PC's logs (from the server, keys taken out) and what the
    // game is doing, on the clipboard to paste into a bug report.
    function bugReport() {
        const scene = SceneManager._scene;
        const here = [
            'scene: ' + (scene ? scene.constructor.name : '?') + (window.$gameMap && $gameMap.mapId() ? ', map ' + $gameMap.mapId() + ' at ' + $gamePlayer.x + ',' + $gamePlayer.y : ''),
            'this player: ' + (Coop.name || '(no name)') + (window.$gameParty && $gameParty._actors ? ', party ' + $gameParty._actors.join(',') : '') + (Coop.dead ? ', dead' : ''),
            'others: ' + Array.from(Coop.peers.values()).map((p) => p.name + ' (' + p.st + (p.m ? ' map ' + p.m : '') + ')').join(', '),
            'browser: ' + navigator.userAgent,
            '', '--- this game (end) ---', Coop.log.slice(-120).join('\n'),
        ].join('\n');
        return fetch('coop/app/report', { headers: { 'x-fh-app': '1' } }).then((r) => r.ok ? r.text() : '(the server log could not be read)', () => '(the server could not be reached)')
            .then((server) => {
                const text = server + '\n\n' + here.replace(/([?&]k=)[0-9a-zA-Z]+/g, '$1(key)');
                return writeClipboard(text).then(() => 'Bug report copied. Paste it into your message about the bug.', () => 'Could not copy. The logs are in the app\\data folder.');
            });
    }
    function writeClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).catch(() => fallback());
        return fallback();
        function fallback() {
            const area = document.createElement('textarea');
            area.value = text;
            area.style.cssText = 'position:fixed;left:-9999px;top:0;';
            document.body.appendChild(area);
            area.select();
            const ok = document.execCommand('copy');
            area.remove();
            return ok ? Promise.resolve() : Promise.reject(new Error('copy refused'));
        }
    }
    // In the middle of a game: Ctrl+Shift+B.
    window.addEventListener('keydown', function (e) {
        if (!(e.ctrlKey && e.shiftKey && e.code === 'KeyB') || e.repeat) return;
        e.preventDefault();
        bugReport().then((said) => Coop.toast(said, 6000));
    });
    Coop.bugReport = bugReport;

    const onTitle = () => SceneManager._scene instanceof Scene_Title;

    // A clicked fhtogether:// link reaches this PC's server through the
    // launcher; it is offered here. Checked every couple of seconds.
    let offered = 0;
    let dropSeen = null; // null until the first answer: a drop from before this page loaded is old news
    setInterval(function () {
        if (!window.SceneManager || !SceneManager._scene) return;
        api('').then(function (s) {
            // The open panel follows what the server became (a tunnel that dropped, say).
            if (box.classList.contains('open') && !busy) show(s);
            // The link Cloudflare was slow to publish works now.
            if (copyWhenReady && s.mode === 'online' && s.ready) {
                copyWhenReady = false;
                writeClipboard(s.link).then(() => { why.textContent = 'Your link works now and is copied: send it to your friends.'; Coop.toast('Your link works now and is copied: send it to your friends.', 8000); },
                    () => { why.textContent = 'Your link works now. Press Copy, then send it to your friends.'; Coop.toast('Your link works now. Open Together and press Copy.', 10000); });
            }
            if (s.mode !== 'online') copyWhenReady = false;
            // The tunnel dropped: the link friends have is dead, and only the host can make a new one.
            if (s.droppedAt !== dropSeen) {
                if (dropSeen !== null && s.droppedAt && s.mode === 'local') {
                    const said = 'Your link stopped working. Host online again and send the new link.';
                    Coop.toast(said, 15000);
                    if (box.classList.contains('open')) { why.classList.add('bad'); why.textContent = said; }
                }
                dropSeen = s.droppedAt;
            }
            if (!s.offer || s.offerAt === offered) return;
            offered = s.offerAt;
            if (!onTitle()) { Coop.toast('A link to join a friend arrived. Go back to the title screen to join.', 8000); return; }
            if (s.mode === 'joined' && s.joined === s.offer) return;
            open();
            $('[data-field=join]').value = s.offer;
            why.textContent = 'Press Join to play in your friend\'s game.';
        }).catch(function () {});
    }, 2000);

    function copy(text, said) {
        if (!text) return;
        const done = () => { why.textContent = said; };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => { $('[data-field=link]').select(); document.execCommand('copy'); done(); });
        else { $('[data-field=link]').select(); document.execCommand('copy'); done(); }
    }

    function open() {
        why.textContent = '';
        box.classList.add('open');
        Input.clear();
        show(state); // the last known state at once, then the server's answer
        api('').then(show).catch(() => {});
        setTimeout(() => { const b = box.querySelector('button.big:not([hidden])'); if (b) b.focus(); }, 0);
    }
    function close() {
        box.classList.remove('open');
        if (document.activeElement) document.activeElement.blur();
        Input.clear();
        const scene = SceneManager._scene;
        if (scene instanceof Scene_Title && scene._commandWindow) scene._commandWindow.activate();
    }
    Coop.together = { open, close, isOpen: () => box.classList.contains('open'), act };

    box.addEventListener('click', function (e) {
        const b = e.target.closest('button');
        if (b) act(b.getAttribute('data-do'));
    });
    // Keys typed here never reach the game.
    for (const type of ['keydown', 'keyup', 'keypress']) {
        box.addEventListener(type, function (e) {
            e.stopPropagation();
            if (type !== 'keydown') return;
            const el = document.activeElement;
            if (e.key === 'Escape') close();
            else if (e.key === 'Enter' && el && el.getAttribute('data-field') === 'join') act('join');
        });
    }
    // A partner's arrival or refusal is said here too while the panel is open.
    Coop.on('partnernote', function (msg) { if (box.classList.contains('open')) why.textContent = String(msg.text || ''); });

    // The title menu: New Game, Continue, Together.
    const _makeList = Window_TitleCommand.prototype.makeCommandList;
    Window_TitleCommand.prototype.makeCommandList = function () {
        _makeList.call(this);
        this.addCommand('Together', 'together');
    };
    const _createCommand = Scene_Title.prototype.createCommandWindow;
    Scene_Title.prototype.createCommandWindow = function () {
        _createCommand.call(this);
        this._commandWindow.setHandler('together', open);
    };
})();
