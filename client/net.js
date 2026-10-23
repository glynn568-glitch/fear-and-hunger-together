//=============================================================================
// fh-coop: connection to the relay, the list of other players, message bus.
//=============================================================================
var Coop = {
    id: 0,
    name: '',
    peers: new Map(), // id -> { id, name, mapId, x, y, state, hp, ... }
    connected: false,
    _handlers: {},
    _binaryHandlers: {},
    _ws: null,
    _retry: 0,
    log: [],
};

Coop.note = function (text) {
    Coop.log.push(text);
    if (Coop.log.length > 400) Coop.log.shift();
    // And into the host's log, so a session can be read back from the host's PC
    // afterwards. Kept while the line is down and sent once it is back.
    Coop._notesOut.push({ at: Date.now(), text: String(text) });
    if (Coop._notesOut.length > 200) Coop._notesOut.shift();
    console.log('[coop] ' + text);
};
Coop._notesOut = [];
setInterval(function () {
    const ws = Coop._ws;
    if (!Coop._notesOut.length || !ws || ws.readyState !== 1) return;
    const now = Date.now();
    // A note held back by a dropped line says when it was made.
    const lines = Coop._notesOut.splice(0, 50).map((n) => (now - n.at > 5000 ? '[' + new Date(n.at).toTimeString().slice(0, 8) + '] ' : '') + n.text);
    Coop.send({ t: 'notes', lines });
}, 2000);

// Script errors go in the log too, for a bug report.
window.addEventListener('error', function (e) {
    Coop.note('script error: ' + e.message + (e.filename ? ' (' + String(e.filename).replace(/^.*\//, '') + ':' + e.lineno + ')' : ''));
});
window.addEventListener('unhandledrejection', function (e) {
    Coop.note('script error: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason));
});

Coop.on = function (type, fn) {
    (Coop._handlers[type] = Coop._handlers[type] || []).push(fn);
};

Coop.emit = function (type, msg) {
    const list = Coop._handlers[type];
    if (!list) return;
    for (const fn of list) {
        try { fn(msg); } catch (e) { console.error('[coop] handler for ' + type + ' failed', e); Coop.note('script error in the ' + type + ' handler: ' + (e && (e.stack || e.message) || e)); }
    }
};

Coop.send = function (msg) {
    const ws = Coop._ws;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
};

// Message for one player only.
Coop.sendTo = function (id, kind, body) {
    Coop.send(Object.assign({ t: 'to', to: id, k: kind }, body));
};

// Binary payloads (battle frames) carry a two-byte header: kind, target id.
// The relay swaps the target for the sender before passing it on.
Coop.sendBinary = function (kind, targetId, buffer) {
    const ws = Coop._ws;
    if (!ws || ws.readyState !== 1) return false;
    if (ws.bufferedAmount > 1500000) return false; // link is behind; drop this one
    const out = new Uint8Array(buffer.byteLength + 2);
    out[0] = kind;
    out[1] = targetId;
    out.set(new Uint8Array(buffer), 2);
    ws.send(out);
    return true;
};

Coop.onBinary = function (kind, fn) {
    Coop._binaryHandlers[kind] = fn;
};

Coop.others = function () {
    return Array.from(Coop.peers.values());
};

Coop.isAlone = function () {
    return Coop.peers.size === 0;
};

Coop.loadName = function () {
    let name = '';
    try { name = localStorage.getItem('fhcoop.name') || ''; } catch (e) { /* storage blocked */ }
    const fromUrl = new URLSearchParams(location.search).get('name');
    return (fromUrl || name || '').slice(0, 16);
};

Coop.setName = function (name) {
    Coop.name = String(name || '').replace(/[^\w \-']/g, '').trim().slice(0, 16);
    try { localStorage.setItem('fhcoop.name', Coop.name); } catch (e) { /* storage blocked */ }
    Coop.send({ t: 'name', name: Coop.name, token: Coop.token() });
};

// Identifies this tab across reconnects, so it can reclaim its own name.
Coop.token = function () {
    try {
        let t = sessionStorage.getItem('fhcoop.token');
        if (!t) { t = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('fhcoop.token', t); }
        return t;
    } catch (e) { return ''; }
};

Coop.connect = function () {
    const scheme = location.protocol === 'https:' ? 'wss://' : 'ws://';
    if (Coop.refused) return; // another build, or a dead link: retrying cannot help
    const b = window.COOP_BUILD || {};
    const query = '?fp=' + encodeURIComponent(b.fp || '') + '&build=' + encodeURIComponent(b.build || '')
        + '&mod=' + encodeURIComponent(b.mod || '') + '&v=' + encodeURIComponent(b.version || '') + (b.stale ? '&stale=1' : '');
    const ws = new WebSocket(scheme + location.host + '/coop/ws' + query);
    ws.binaryType = 'arraybuffer';
    Coop._ws = ws;
    ws.onopen = function () {
        Coop._retry = 0;
    };
    ws.onmessage = function (ev) {
        if (typeof ev.data !== 'string') {
            const head = new Uint8Array(ev.data, 0, 2);
            const fn = Coop._binaryHandlers[head[0]];
            if (fn) fn(head[1], ev.data.slice(2));
            return;
        }
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        Coop._receive(msg);
    };
    ws.onclose = function () {
        const was = Coop.connected;
        Coop.connected = false;
        if (was) {
            Coop.note('lost the connection, retrying');
            for (const id of Array.from(Coop.peers.keys())) Coop._dropPeer(id);
            Coop.emit('offline', {});
        }
        Coop._retry = Math.min(Coop._retry + 1, 6);
        setTimeout(Coop.connect, 500 * Coop._retry);
    };
    ws.onerror = function () { /* onclose follows */ };
};

Coop._dropPeer = function (id) {
    const peer = Coop.peers.get(id);
    if (!peer) return;
    Coop.peers.delete(id);
    Coop.emit('leave', peer);
};

Coop._receive = function (msg) {
    switch (msg.t) {
    case 'relay':
        // "Hide my IP address" turned on or off on the host: no direct connections
        // between browsers while it is on. Only the server says this.
        if (msg.from) break;
        Coop.relayOnly = !!msg.on;
        Coop.emit('relay', msg);
        break;
    case 'hello':
        Coop.relayOnly = !!msg.relayOnly;
        Coop.id = msg.id;
        Coop.connected = true;
        Coop.peers.clear();
        for (const p of msg.peers) {
            if (p.id === Coop.id) continue;
            const peer = Object.assign({ id: p.id, name: p.name }, p.last || { st: 'title', m: 0 });
            peer.id = p.id;
            peer.host = !!p.host;
            peer._moved = true;
            Coop.peers.set(p.id, peer);
        }
        if (!Coop.name) Coop.name = Coop.loadName();
        if (Coop.name) Coop.send({ t: 'name', name: Coop.name, token: Coop.token() });
        Coop.note('connected as player ' + Coop.id + ', ' + Coop.peers.size + ' other(s) here');
        Coop.emit('online', msg);
        break;
    case 'join':
        Coop.peers.set(msg.id, { id: msg.id, name: msg.name, m: 0, st: 'title', host: !!msg.host });
        Coop.note(msg.name + ' joined');
        Coop.emit('join', Coop.peers.get(msg.id));
        break;
    case 'leave':
        if (Coop.peers.has(msg.id)) Coop.note(Coop.peers.get(msg.id).name + ' left');
        Coop._dropPeer(msg.id);
        break;
    case 'name': {
        const peer = Coop.peers.get(msg.id);
        if (peer) peer.name = msg.name;
        break;
    }
    case 'nametaken':
        // Someone here already has it; this player has to pick another.
        if (Coop.name.toLowerCase() === String(msg.name).toLowerCase()) Coop.name = '';
        Coop.emit('nametaken', msg);
        break;
    case 'to':
        Coop.emit('to:' + msg.k, msg);
        break;
    case 'version': // the host is on another build of the game or of this mod
        Coop.refused = msg.game
            ? 'Your copy of Fear & Hunger is a different version from the host\'s (yours ' + msg.yours.build + ', theirs ' + msg.mine.build + '). Update both to the newest.'
            : 'Your co-op mod is not the same as the host\'s (yours ' + msg.yours.version + ', theirs ' + msg.mine.version + '). Use the same download.';
        Coop.emit('refused', { text: Coop.refused });
        break;
    case 'joinfail':
        Coop.refused = String(msg.why || 'The host could not be joined.');
        Coop.emit('refused', { text: Coop.refused });
        break;
    default:
        Coop.emit(msg.t, msg);
    }
};

// Synchronous request to the server; used where the engine expects an
// immediate answer (save files).
Coop.fetchSync = function (method, url, body) {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, false);
    if (body != null) xhr.setRequestHeader('Content-Type', 'text/plain');
    // Proves to the host that this tab is the player whose saves these are.
    xhr.setRequestHeader('x-fh-token', Coop.token());
    try { xhr.send(body == null ? null : body); } catch (e) { return { status: 0, text: '' }; }
    return { status: xhr.status, text: xhr.responseText };
};

Coop.connect();
