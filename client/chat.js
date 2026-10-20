//=============================================================================
// fh-coop: talking. Y opens a line at the bottom left, Enter sends it to
// everyone in the world, Esc throws it away. Lines fade after a while; the
// last few come back whenever the line is open.
//=============================================================================
(function () {
    const KEEP = 8; // lines on screen at most
    const FADE = 16000; // ms a line stays up

    const style = document.createElement('style');
    style.textContent = [
        '#coop-chat { position: fixed; left: 12px; bottom: 12px; z-index: 56; width: min(46vw, 560px); pointer-events: none;',
        '  font: 16px/1.4 Georgia, "Times New Roman", serif; color: #e0d4bc; }',
        '#coop-chat .line { margin-top: 3px; padding: 2px 8px; background: rgba(12, 8, 7, 0.72); border-left: 2px solid #4a3c30;',
        '  transition: opacity 0.6s; overflow-wrap: anywhere; }',
        '#coop-chat .line.gone { opacity: 0; }',
        '#coop-chat.open .line.gone { opacity: 0.85; }',
        '#coop-chat .who { color: #f2d28a; }',
        '#coop-chat .line.me .who { color: #b9ad98; }',
        '#coop-chat input { display: none; width: 100%; box-sizing: border-box; margin-top: 5px; pointer-events: auto;',
        '  font: inherit; color: #e8dcc0; background: rgba(20, 12, 10, 0.9); border: 1px solid #6b5a45; padding: 4px 8px; outline: none; }',
        '#coop-chat.open input { display: block; }',
    ].join('\n');
    document.head.appendChild(style);

    const box = document.createElement('div');
    box.id = 'coop-chat';
    const lines = document.createElement('div');
    const input = document.createElement('input');
    input.maxLength = 200;
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.placeholder = 'Say something (Enter sends, Esc cancels)';
    box.appendChild(lines);
    box.appendChild(input);
    (document.body ? Promise.resolve() : new Promise((r) => window.addEventListener('DOMContentLoaded', r))).then(() => document.body.appendChild(box));

    function scale() {
        const s = Math.max(1, Math.min(2.2, (Graphics._realScale || 1) * 0.75));
        box.style.fontSize = Math.round(16 * s) + 'px';
    }

    function show(name, text, mine) {
        scale();
        const row = document.createElement('div');
        row.className = 'line' + (mine ? ' me' : '');
        const who = document.createElement('span');
        who.className = 'who';
        who.textContent = name + ': ';
        row.appendChild(who);
        row.appendChild(document.createTextNode(text));
        lines.appendChild(row);
        while (lines.children.length > KEEP) lines.removeChild(lines.firstChild);
        setTimeout(function () { row.classList.add('gone'); }, Math.max(FADE, text.length * 90));
    }

    Coop.say = function (text) {
        text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        if (!text || !Coop.connected) return false;
        Coop.send({ t: 'chat', text });
        show(Coop.name || 'You', text, true);
        return true;
    };

    Coop.on('chat', function (msg) {
        const peer = Coop.peers.get(msg.from);
        const text = String(msg.text || '').slice(0, 200);
        if (!peer || !text) return;
        show(peer.name, text, false);
        Coop.emit('heard', { from: msg.from, name: peer.name, text });
    });

    // F8 calls an AI partner in, or sends one home; Shift+F8 calls another.
    // Only the host's own browser may; the server says so to anyone else.
    window.addEventListener('keydown', function (e) {
        if (e.code !== 'F8' || e.repeat || !Coop.connected) return;
        e.preventDefault();
        Coop.send(e.shiftKey ? { t: 'partner', on: true } : { t: 'partner', toggle: true });
    }, true);
    Coop.on('partnernote', function (msg) {
        if (Coop.toast) Coop.toast(String(msg.text || ''), 7000);
    });

    // An AI partner says what it is the first time it turns up.
    Coop.on('p', function (msg) {
        const peer = Coop.peers.get(msg.from);
        if (!peer || !peer.bot || peer._introduced || !Coop.world.live || !peer.st || peer.st === 'title') return;
        peer._introduced = true;
        if (Coop.toast) Coop.toast(peer.name + ' is an AI partner. Press ' + Coop.keyName('Y') + ' to talk to them: give orders, ask for things.', 8000);
    });

    function open() {
        scale();
        box.classList.add('open');
        input.value = '';
        input.focus();
    }
    function close() {
        box.classList.remove('open');
        input.blur();
    }

    // Keys typed into the line never reach the game. The key that closes it
    // is still down when the game gets the keyboard back; it is ignored until
    // it has been let go.
    let closingKey = '';
    for (const type of ['keydown', 'keyup', 'keypress']) {
        input.addEventListener(type, function (e) {
            e.stopPropagation();
            if (type !== 'keydown') return;
            if (e.key === 'Enter') { closingKey = e.code; Coop.say(input.value); close(); }
            else if (e.key === 'Escape') { closingKey = e.code; close(); }
        });
    }
    input.addEventListener('focus', function () { Input.clear(); });
    input.addEventListener('blur', function () { box.classList.remove('open'); });
    window.addEventListener('keydown', function (e) {
        if (closingKey && e.code === closingKey) { e.stopImmediatePropagation(); return; }
        if (e.code !== 'KeyY' || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
        const typing = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
        // At the title too: players waiting there still talk to each other.
        if (typing || !Coop.connected || !window.SceneManager) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        open();
    }, true);
    window.addEventListener('keyup', function (e) {
        if (e.code === closingKey) closingKey = '';
    }, true);
})();
