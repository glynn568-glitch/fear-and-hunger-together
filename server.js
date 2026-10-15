// Serves the Steam install of Fear & Hunger to a browser, overlays the co-op
// client on top of it, and relays messages between the players.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { WebSocketServer, WebSocket } = require('ws');

const { findGame, SETTINGS } = require('./tools/find-game');
const GAME = findGame();
if (!GAME || !fs.existsSync(path.join(GAME, 'index.html'))) {
    console.error('Fear & Hunger was not found' + (GAME ? ' at ' + GAME : '') + '.\n'
        + 'Put its folder in settings.json, for example:  "game": "D:\\\\SteamLibrary\\\\steamapps\\\\common\\\\Fear & Hunger"');
    process.exit(1);
}
// Which build of the game this is; players on different builds are kept apart.
const { fingerprint, ensureCensus, modPrint } = require('./tools/version');
const BUILD = Object.assign(fingerprint(GAME), modPrint());
if (ensureCensus(GAME, BUILD.fp)) console.log('This copy of the game is a different build from the last one seen here; the census was rebuilt for it.');
const { Room } = require('./room'); // reads the census
const { Partners } = require('./partners');
const { Tunnel } = require('./tools/tunnel');

// FH_JOIN: play in a friend's game. This server serves this PC's own copy of
// the game and passes only the co-op traffic (the socket and the save files)
// on to the friend's server, the host.
// The game's Together panel switches this while the server runs (/coop/app).
let JOIN = null;
function parseJoin(link) {
    const u = new URL(String(link || '').trim());
    if (!/^https?:$/.test(u.protocol)) throw new Error('not a web link');
    return { origin: u.origin, key: u.searchParams.get('k') || '', link: u.origin + '/' + (u.searchParams.get('k') ? '?k=' + u.searchParams.get('k') : '') };
}
if (process.env.FH_JOIN) {
    try { JOIN = parseJoin(process.env.FH_JOIN); } catch (e) {
        console.error('That is not a link from a host (' + e.message + '). It looks like https://something.trycloudflare.com/?k=...');
        process.exit(1);
    }
}
const PORT = Number(process.env.PORT || 8420);
const CLIENT = path.join(__dirname, 'client');
const DATA = path.join(__dirname, 'data');
const SAVES = process.env.FH_SAVES || path.join(DATA, 'saves');

// Everything the console shows (partners' lines included) also goes to a file,
// so a session can be read back after the window is closed.
fs.mkdirSync(path.dirname(SAVES), { recursive: true });
const LOG = fs.createWriteStream(path.join(path.dirname(SAVES), 'server-' + PORT + '.log'), { flags: 'w' });
LOG.on('error', () => { /* a log that cannot be written is no reason to stop */ });
for (const level of ['log', 'error']) {
    const orig = console[level];
    console[level] = function (...args) {
        orig.apply(console, args);
        LOG.write(new Date().toTimeString().slice(0, 8) + ' ' + args.map((a) => (typeof a === 'string' ? a : require('util').inspect(a))).join(' ') + '\n');
    };
}

const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
    '.webm': 'video/webm', '.mp4': 'video/mp4', '.ttf': 'font/ttf', '.otf': 'font/otf',
    '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.json', '.css', '.txt']);

// Client scripts, in load order. They are appended to the plugin list so they
// load after every plugin the game ships with.
const COOP_SCRIPTS = ['net', 'fixes', 'state', 'presence', 'events', 'battle', 'video', 'death', 'save', 'recover', 'trade', 'talk', 'chat', 'setup', 'together', 'sheet', 'light', 'rules', 'ui', 'meter'];

// A link pasted into a chat program shows as a card saying what it is. The
// program fetches the page and the picture itself, with no cookie, so the
// picture's address carries the key the link came with.
function linkCard(req, url) {
    const host = /^[\w.\-:\[\]]+$/.test(req.headers.host || '') ? req.headers.host : 'localhost';
    const proto = req.headers['x-forwarded-proto'] === 'https' || req.headers['cf-connecting-ip'] ? 'https' : 'http';
    const k = KEY && url.searchParams.get('k') === KEY ? '?k=' + KEY : '';
    return [
        '<meta property="og:type" content="website">',
        '<meta property="og:title" content="Fear &amp; Hunger co-op">',
        '<meta property="og:description" content="A friend\'s Fear &amp; Hunger game. Each player plays from their own copy.">',
        `<meta property="og:image" content="${proto}://${host}/coop/icon.png${k}">`,
        '<link rel="icon" href="coop/icon.png">',
        '<meta name="theme-color" content="#7a1f17">',
    ].join('\n        ');
}

// What someone on another PC sees at the host's link: how to join with their
// own copy of the game.
const DOWNLOAD = 'https://github.com/glynn568-glitch/fear-and-hunger-together/releases/latest';
function joinPage(req, url) {
    const host = /^[\w.\-:\[\]]+$/.test(req.headers.host || '') ? req.headers.host : 'localhost';
    const proto = req.headers['x-forwarded-proto'] === 'https' || req.headers['cf-connecting-ip'] ? 'https' : 'http';
    const link = `${proto}://${host}/` + (KEY ? '?k=' + KEY : '');
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <title>Fear &amp; Hunger co-op</title>
        ${linkCard(req, url)}
        <style>
        body { background: #120c0b; color: #d9cbb8; font: 17px/1.5 Georgia, serif; margin: 0; padding: 48px 16px; }
        main { max-width: 34em; margin: 0 auto; }
        h1 { color: #c9442f; font-weight: normal; font-size: 26px; margin: 0 0 18px; }
        ol { padding-left: 1.3em; } li { margin: 6px 0; }
        input { width: 100%; box-sizing: border-box; background: #1e1513; color: #f0e4d2; border: 1px solid #5a2a20; padding: 10px; font: 15px monospace; }
        </style></head><body><main>
        <h1>A friend is hosting Fear &amp; Hunger</h1>
        <p>You play from your own copy of the game (Steam or itch).</p>
        <ol>
        <li>Get <a href="${DOWNLOAD}" style="color:#e0a27a">Fear &amp; Hunger Together</a> (free) and run it once.</li>
        <li>Press the button below, or pick <b>Together</b> on the title screen and paste this link:</li>
        </ol>
        <input readonly value="${link}" onclick="this.select()">
        <p style="margin-top:22px"><a href="fhtogether://join?link=${encodeURIComponent(link)}" style="display:inline-block;background:#5a2018;border:1px solid #a0533c;color:#f0e4d2;padding:10px 18px;text-decoration:none">Open in Fear &amp; Hunger Together</a></p>
        <p style="color:#9d8f7a;font-size:15px">Already have it? The button opens it and offers to join.</p>
        </main></body></html>`;
}

function indexHtml(req, url) {
    let html = fs.readFileSync(path.join(GAME, 'index.html'), 'utf8');
    // Only the engine's own scripts. Other mod loaders (Mattie's overwrites
    // this page) would run alongside the co-op and fight it.
    html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>\s*/gi, (tag) => {
        const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag);
        return src && /^js\/(libs\/[\w.\-]+|rpg_\w+|plugins|main)\.js$/.test(src[1]) ? tag : '';
    });
    // The window shows this mod's icon, not the game's.
    html = html.replace(/<link\b[^>]*\brel="(icon|apple-touch-icon)"[^>]*>\s*/gi, '');
    html = html.replace('<title>', linkCard(req, url) + '\n        $&');
    // Which build this copy is; the host compares it with its own.
    const build = { fp: BUILD.fp, build: BUILD.build, mod: BUILD.mod, version: BUILD.version, joined: !!JOIN };
    html = html.replace('<title>', '<script>window.COOP_BUILD = ' + JSON.stringify(build) + ';</script>\n        $&');
    html = html.replace('<script type="text/javascript" src="js/libs/pixi.js">',
        '<script type="text/javascript" src="coop/shim.js"></script>\n        $&');
    html = html.replace('<script type="text/javascript" src="js/main.js">',
        '<script type="text/javascript" src="coop/boot.js"></script>\n        $&');
    return html;
}

const gzCache = new Map(); // path -> { mtimeMs, buf }
function gzipped(file, stat) {
    const hit = gzCache.get(file);
    if (hit && hit.mtimeMs === stat.mtimeMs) return hit.buf;
    const buf = zlib.gzipSync(fs.readFileSync(file), { level: 6 });
    gzCache.set(file, { mtimeMs: stat.mtimeMs, buf });
    return buf;
}

function sendFile(req, res, file, cache) {
    fs.stat(file, (err, stat) => {
        if (err || !stat.isFile()) { res.writeHead(404); res.end('not found'); return; }
        const ext = path.extname(file).toLowerCase();
        const etag = `"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
        const head = {
            'Content-Type': MIME[ext] || 'application/octet-stream',
            'Cache-Control': cache ? 'public, max-age=604800' : 'no-cache',
            'ETag': etag,
            'Accept-Ranges': 'bytes',
        };
        if (req.headers['if-none-match'] === etag) { res.writeHead(304, head); res.end(); return; }
        if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
            const buf = gzipped(file, stat);
            res.writeHead(200, { ...head, 'Content-Encoding': 'gzip', 'Content-Length': buf.length, 'Vary': 'Accept-Encoding' });
            res.end(req.method === 'HEAD' ? undefined : buf);
            return;
        }
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
        if (range) {
            const start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
            const end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
            if (start > end || start >= stat.size) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); res.end(); return; }
            res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
            if (req.method === 'HEAD') { res.end(); return; }
            fs.createReadStream(file, { start, end }).pipe(res);
            return;
        }
        res.writeHead(200, { ...head, 'Content-Length': stat.size });
        if (req.method === 'HEAD') { res.end(); return; }
        fs.createReadStream(file).pipe(res);
    });
}

// Resolve a URL path inside a root folder; null if it escapes the root.
function resolveIn(root, rel) {
    const file = path.normalize(path.join(root, rel));
    return file === root || file.startsWith(root + path.sep) ? file : null;
}

// When FH_KEY is set (the start script sets it before opening a tunnel), a
// visitor needs the key once, in the link; after that a cookie carries it.
let KEY = process.env.FH_KEY || ''; // a fresh one each time the game goes online from the Together panel
// The host's own browser. Requests that came in through the tunnel also
// arrive from this machine, but carry the visitor's address.
// A page reached under any other name is some web site that pointed its own
// domain at this PC (DNS rebinding), not this PC's player.
const LOOPBACK_NAME = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
function isHost(req) {
    const addr = req.socket.remoteAddress || '';
    // A joiner's server passing its player's traffic on is never the host.
    if (req.headers['x-fh-join']) return false;
    const viaTunnel = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'];
    return !viaTunnel && LOOPBACK_NAME.test(req.headers.host || '') && (addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1');
}
function allowed(req, url) {
    // Not online: only what this PC opens under its own name.
    if (!KEY) return LOOPBACK_NAME.test(req.headers.host || '');
    if (isHost(req)) return true; // the host's own browser needs no key
    if (url.searchParams.get('k') === KEY) return true;
    return (req.headers.cookie || '').split(/;\s*/).includes('fhk=' + KEY);
}

// Each player's save files live on the host, under their name.
function storeFile(pathname) {
    const m = /^\/coop\/store\/([\w \-']{1,16})\/(global|file\d{1,3})$/.exec(pathname);
    return m ? path.join(SAVES, 'players', m[1].trim().toLowerCase(), m[2] + '.rpgsave') : null;
}

function handleStore(req, res, file) {
    if (req.method === 'GET') {
        fs.readFile(file, 'utf8', (err, text) => {
            if (err) { res.writeHead(404); res.end(); return; }
            res.writeHead(200, { 'Content-Type': MIME['.txt'], 'Cache-Control': 'no-store' });
            res.end(text);
        });
    } else if (req.method === 'PUT') {
        const chunks = [];
        let size = 0;
        req.on('data', (c) => { size += c.length; if (size > 64 * 1024 * 1024) req.destroy(); else chunks.push(c); });
        req.on('end', () => {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file + '.tmp', Buffer.concat(chunks));
            fs.renameSync(file + '.tmp', file);
            res.writeHead(204); res.end();
        });
    } else if (req.method === 'DELETE') {
        fs.rm(file, { force: true }, () => { res.writeHead(204); res.end(); });
    } else { res.writeHead(405); res.end(); }
}

const server = http.createServer((req, res) => {
    let pathname, url;
    try { url = new URL(req.url, 'http://x'); pathname = decodeURIComponent(url.pathname); } catch (e) { res.writeHead(400); res.end(); return; }
    if (!allowed(req, url)) { res.writeHead(403, { 'Content-Type': MIME['.txt'] }); res.end('Ask the host for the full link.'); return; }
    // A joining server is for its own PC's player only: nobody else on the network gets the game or a seat.
    if (JOIN && !isHost(req)) { res.writeHead(403, { 'Content-Type': MIME['.txt'] }); res.end('This PC is playing in a friend\'s game.'); return; }
    if (KEY && url.searchParams.get('k') === KEY) res.setHeader('Set-Cookie', `fhk=${KEY}; Path=/; Max-Age=2592000; SameSite=Lax`);
    // What a joiner's server asks before it switches over: is this a game, and the same build?
    if (pathname === '/coop/hello') {
        res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ fh: 'together', fp: BUILD.fp, build: BUILD.build, mod: BUILD.mod, version: BUILD.version, hosting: !JOIN }));
        return;
    }
    if (pathname === '/coop/app' || pathname.startsWith('/coop/app/')) { handleApp(req, res, pathname); return; }
    // Joining: save files live on the host, as for every player.
    if (JOIN && pathname.startsWith('/coop/store/')) { proxyStore(req, res); return; }
    // Hosting: the game itself is only for this PC. Everyone else plays from
    // their own copy and reaches this server only for the socket and saves.
    if (!JOIN && !isHost(req) && !pathname.startsWith('/coop/store/')) {
        if (pathname === '/coop/icon.png') { sendFile(req, res, path.join(CLIENT, 'icon.png'), true); return; }
        res.writeHead(pathname === '/' || pathname === '/index.html' ? 200 : 403, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
        res.end(joinPage(req, url));
        return;
    }
    // Save files: another PC's player reaches only their own, by the token
    // their tab sent with its name. This PC (and its AI partners) may reach any.
    const storeName = /^\/coop\/store\/([\w \-']{1,16})\//.exec(pathname);
    if (storeName && !isHost(req) && !room.ownsName(storeName[1], req.headers['x-fh-token'])) {
        res.writeHead(403, { 'Content-Type': MIME['.txt'] }); res.end('not your saves'); return;
    }
    const index = /^\/coop\/store\/([\w \-']{1,16})\/index$/.exec(pathname);
    if (index) {
        const dir = path.join(SAVES, 'players', index[1].trim().toLowerCase());
        fs.readdir(dir, (err, names) => {
            const keys = err ? [] : names.filter((n) => n.endsWith('.rpgsave')).map((n) => n.slice(0, -8));
            res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
            res.end(JSON.stringify(keys));
        });
        return;
    }
    const store = storeFile(pathname);
    if (store) { handleStore(req, res, store); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }

    if (pathname === '/' || pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
        res.end(indexHtml(req, url));
        return;
    }
    if (pathname === '/coop/scripts.json') {
        res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify(COOP_SCRIPTS.filter((n) => fs.existsSync(path.join(CLIENT, n + '.js')))));
        return;
    }
    if (pathname.startsWith('/coop/')) {
        const file = resolveIn(CLIENT, pathname.slice('/coop/'.length));
        if (!file) { res.writeHead(403); res.end(); return; }
        sendFile(req, res, file, false);
        return;
    }
    // The install's own save folder is never served. The test is made on the
    // resolved file, so no spelling of the path gets around it.
    const file = resolveIn(GAME, pathname.slice(1));
    const ownSaves = path.join(GAME, 'save').toLowerCase();
    if (!file || file.toLowerCase() === ownSaves || file.toLowerCase().startsWith(ownSaves + path.sep)) { res.writeHead(403); res.end(); return; }
    const top = pathname.split('/')[1];
    sendFile(req, res, file, top === 'img' || top === 'audio' || top === 'movies' || top === 'fonts');
});

// Only a page this server sent may open the socket; any other site a
// player has open in their browser may not.
function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true; // not a browser
    try { return new URL(origin).host === req.headers.host; } catch (e) { return false; }
}

const room = new Room(SAVES);
const wss = new WebSocketServer({
    server, path: '/coop/ws', maxPayload: 32 * 1024 * 1024,
    verifyClient: (info) => sameOrigin(info.req) && allowed(info.req, new URL(info.req.url, 'http://x')),
});
room.partners = new Partners(PORT, SETTINGS);
// A partner that could not start, or fell over: the host hears why.
room.partners.onFail = (name, why) => {
    for (const p of room.peers.values()) if (p.host) room.send(p, { t: 'partnernote', text: name + ' could not stay: ' + String(why).slice(0, 160) });
};
wss.on('connection', (ws, req) => {
    const q = new URL(req.url, 'http://x').searchParams;
    const theirs = { fp: q.get('fp') || '', build: q.get('build') || '?', mod: q.get('mod') || '', version: q.get('v') || '?' };
    if (theirs.fp !== BUILD.fp || theirs.mod !== BUILD.mod) {
        // Told once, then closed for good: the page does not retry.
        console.log('turned away a player on another build: game ' + theirs.build + '/' + theirs.fp + ', mod ' + theirs.version + '/' + theirs.mod);
        ws.send(JSON.stringify({ t: 'version', game: theirs.fp !== BUILD.fp, mine: { build: BUILD.build, version: BUILD.version }, yours: { build: theirs.build, version: theirs.version } }));
        ws.close(4001, 'version');
        return;
    }
    if (JOIN) {
        // A joining server is for its own PC's player only.
        if (!isHost(req)) { ws.close(4004, 'not from this PC'); return; }
        passOn(ws, req);
    } else room.accept(ws, isHost(req));
});

// --- the Together panel --------------------------------------------------------
// Host online or not, join a friend or leave. Only the browser on this PC may
// ask, and only with the x-fh-app header, which a page from another site
// cannot send to this server without being refused first by the browser.
const tunnel = new Tunnel(PORT);
let online = false; // hosting through the tunnel
let offer = ''; // a join link handed over by the launcher
let offerAt = 0; // when: the same link clicked twice is offered twice
tunnel.onDrop = () => { online = false; KEY = process.env.FH_KEY || ''; console.log('the tunnel dropped; not online any more'); };

function appState() {
    return {
        mode: JOIN ? 'joined' : online ? 'online' : 'local',
        link: online && tunnel.url ? tunnel.url + '/?k=' + KEY : '',
        joined: JOIN ? JOIN.link : '',
        private: !!room.relayOnly,
        offer: offer, // a join link that came from a clicked fhtogether:// link, for the panel
        offerAt: offerAt,
    };
}

// What a player pastes into a bug report: versions, mode, and the end of this
// PC's logs. Nothing that opens a door: link keys, API keys and the Windows
// user name in paths are taken out.
function bugReport() {
    const tail = (file, n) => { try { return fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(-n).join('\n'); } catch (e) { return '(none)'; } };
    const data = path.dirname(SAVES);
    const text = [
        'Fear & Hunger Together ' + BUILD.version + ' (mod ' + BUILD.mod + '), game build ' + BUILD.build + ' (' + BUILD.fp + ')',
        'mode: ' + appState().mode + (room.relayOnly ? ', private' : '') + '; players here: ' + room.peers.size,
        'Node ' + process.version + ', ' + os.type() + ' ' + os.release() + ', ' + new Date().toISOString(),
        '', '--- server log (end) ---', tail(path.join(data, 'server-' + PORT + '.log'), 300),
        '', '--- launcher log (end) ---', tail(path.join(data, 'launcher.log'), 40),
    ].join('\n');
    const home = os.homedir();
    return text.split(home).join('~')
        .replace(/([?&]k=)[0-9a-zA-Z]+/g, '$1(key)').replace(/fhk=[0-9a-zA-Z]+/g, 'fhk=(key)')
        .replace(/\b(sk-[A-Za-z0-9_-]{8})[A-Za-z0-9_-]+/g, '$1(rest of key)').replace(/\bxai-[A-Za-z0-9_-]+/g, 'xai-(key)');
}

// The page reconnects by itself, through whatever this server now is.
function reconnectPages() {
    for (const ws of wss.clients) ws.close(4003, 'mode');
}

// Asks the link's server what it is before switching over to it.
async function probeHost(j) {
    let res;
    try {
        res = await fetch(j.origin + '/coop/hello', { headers: joinHeaders(j), signal: AbortSignal.timeout(10000) });
    } catch (e) { return 'Cannot reach that link. Is your friend still hosting?'; }
    if (res.status === 401 || res.status === 403) return 'That link is old or cut short. Ask your friend to copy it again.';
    if (res.status === 404 || res.status === 530 || res.status === 502) return 'Nobody is hosting at that link any more. Ask for a new one.';
    let hello = null;
    try { hello = await res.json(); } catch (e) { /* not ours */ }
    if (!hello || hello.fh !== 'together') return 'That link is not a Fear & Hunger Together game.';
    if (!hello.hosting) return 'That player is not hosting; they joined someone else.';
    if (hello.fp !== BUILD.fp) return 'Your copy of Fear & Hunger is a different version from your friend\'s (yours ' + BUILD.build + ', theirs ' + hello.build + '). Update both to the newest.';
    if (hello.mod !== BUILD.mod) return 'Your Fear & Hunger Together is not the same version as your friend\'s (yours ' + BUILD.version + ', theirs ' + hello.version + '). Use the same download.';
    return '';
}

function readJson(req) {
    return new Promise((resolve) => {
        let text = '';
        req.on('data', (c) => { text += c; if (text.length > 4096) req.destroy(); });
        req.on('end', () => { try { resolve(JSON.parse(text || '{}')); } catch (e) { resolve({}); } });
    });
}

async function handleApp(req, res, pathname) {
    const reply = (code, body) => { res.writeHead(code, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    if (!isHost(req) || req.headers['x-fh-app'] !== '1') { reply(403, { error: 'only from this PC' }); return; }
    if (req.method === 'GET' && pathname === '/coop/app') { reply(200, appState()); return; }
    if (req.method === 'GET' && pathname === '/coop/app/report') {
        res.writeHead(200, { 'Content-Type': MIME['.txt'], 'Cache-Control': 'no-store' });
        res.end(bugReport());
        return;
    }
    if (req.method !== 'POST') { reply(405, {}); return; }
    const body = await readJson(req);
    if (pathname === '/coop/app/online') {
        if (JOIN) { reply(200, { error: 'You are in a friend\'s game. Leave it first.' }); return; }
        room.relayOnly = !!body.private;
        // Every page, a joiner's too, stops or starts direct video at once.
        room.broadcast({ t: 'relay', on: room.relayOnly });
        if (!body.on) {
            tunnel.stop();
            online = false;
            KEY = process.env.FH_KEY || '';
            reply(200, appState());
            return;
        }
        if (!online) {
            KEY = require('crypto').randomBytes(8).toString('hex');
            try { await tunnel.start(); } catch (e) { KEY = process.env.FH_KEY || ''; reply(200, { error: 'Could not go online: ' + e.message }); return; }
            online = true;
            console.log('online at ' + tunnel.url + '/?k=' + KEY + (room.relayOnly ? ' (private)' : ''));
        }
        reply(200, appState());
        return;
    }
    if (pathname === '/coop/app/join') {
        if (!body.fromTitle) { reply(200, { error: 'Go back to the title screen first.' }); return; }
        let j;
        try { j = parseJoin(body.link); } catch (e) { reply(200, { error: 'That is not a link. It looks like https://some-words.trycloudflare.com/?k=...' }); return; }
        const why = await probeHost(j);
        if (why) { reply(200, { error: why }); return; }
        tunnel.stop();
        online = false;
        KEY = process.env.FH_KEY || '';
        JOIN = j;
        offer = '';
        console.log('joined ' + j.origin);
        reconnectPages();
        reply(200, appState());
        return;
    }
    // The launcher's window was closed: partners, tunnel and server go, cleanly.
    if (pathname === '/coop/app/quit') {
        reply(200, {});
        console.log('the game window was closed; stopping');
        setTimeout(() => { room.partners.stopAll(); tunnel.stop(); process.exit(0); }, 100);
        return;
    }
    // The launcher hands over a link someone clicked; the panel offers it.
    if (pathname === '/coop/app/offer') {
        try { offer = parseJoin(body.link).link; offerAt = Date.now(); } catch (e) { reply(200, { error: 'not a link' }); return; }
        reply(200, appState());
        return;
    }
    if (pathname === '/coop/app/leave') {
        if (!body.fromTitle) { reply(200, { error: 'Go back to the title screen first.' }); return; }
        if (JOIN) { console.log('left ' + JOIN.origin); JOIN = null; reconnectPages(); }
        reply(200, appState());
        return;
    }
    reply(404, {});
}

// --- joining a host ----------------------------------------------------------
const joinHeaders = (j = JOIN) => (j.key ? { cookie: 'fhk=' + j.key, 'x-fh-join': '1' } : { 'x-fh-join': '1' });

// The page's socket, passed on to the host's. Messages sent before the host
// answers wait in order. Binary messages are fight pictures: when the line
// to the host falls behind they are dropped, as the page itself does, so
// nothing piles up here.
const BEHIND = 1500000;
function passOn(local, req) {
    const target = JOIN.origin.replace(/^http/, 'ws') + '/coop/ws' + new URL(req.url, 'http://x').search;
    const up = new WebSocket(target, { headers: joinHeaders(), maxPayload: 32 * 1024 * 1024 });
    const waiting = [];
    let failed = false;
    local.on('message', (data, isBinary) => {
        if (up.readyState === WebSocket.OPEN) {
            if (isBinary && up.bufferedAmount > BEHIND) return;
            up.send(data, { binary: isBinary });
        } else if (!isBinary) waiting.push(data);
    });
    up.on('open', () => { for (const d of waiting.splice(0)) up.send(d, { binary: false }); });
    up.on('message', (data, isBinary) => {
        if (local.readyState !== WebSocket.OPEN || isBinary && local.bufferedAmount > BEHIND) return;
        local.send(data, { binary: isBinary });
    });
    up.on('unexpected-response', (r, res) => {
        failed = true;
        r.destroy(); // with this listener the ws library leaves the refused request open

        // Only a refused key is final. Anything else (the host restarting, the
        // tunnel answering for a server that is down) is retried.
        if (res.statusCode === 401 || res.statusCode === 403) {
            const why = 'The host turned the link away: the key in it is wrong or old. Ask for the link again.';
            console.log('joining failed: ' + why);
            if (local.readyState === WebSocket.OPEN) local.send(JSON.stringify({ t: 'joinfail', why }));
            local.close(4002, 'joinfail');
            return;
        }
        console.log('the host answered ' + res.statusCode + '; trying again');
        if (local.readyState === WebSocket.OPEN) local.send(JSON.stringify({ t: 'hostdown' }));
        local.close(1011, 'host unavailable');
    });
    up.on('error', (err) => {
        if (failed) return;
        console.log('the host could not be reached: ' + err.message);
        if (local.readyState === WebSocket.OPEN) local.send(JSON.stringify({ t: 'hostdown' }));
        local.close(1011, 'host unreachable');
    });
    up.on('close', (code, reason) => { if (!failed) local.close(code >= 4000 && code < 5000 ? code : 1011, String(reason || '').slice(0, 100)); });
    local.on('close', () => { if (up.readyState === WebSocket.OPEN || up.readyState === WebSocket.CONNECTING) up.terminate(); });
    local.on('error', () => up.terminate());
}

// A save file read or written on the host.
function proxyStore(req, res) {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
        const init = { method: req.method, headers: Object.assign({ 'content-type': 'text/plain' }, joinHeaders()) };
        if (req.headers['x-fh-token']) init.headers['x-fh-token'] = String(req.headers['x-fh-token']);
        if (req.method === 'PUT') init.body = Buffer.concat(chunks);
        fetch(JOIN.origin + req.url, init).then((r) => r.arrayBuffer().then((buf) => {
            res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || MIME['.txt'], 'Cache-Control': 'no-store' });
            res.end(Buffer.from(buf));
        })).catch((err) => { res.writeHead(502, { 'Content-Type': MIME['.txt'] }); res.end('the host could not be reached: ' + err.message); });
    });
}

// Starting it twice is the common mistake; say so plainly instead of a stack trace.
function onListenError(err) {
    if (err && err.code === 'EADDRINUSE') {
        console.log(`The co-op server is already running on this PC (port ${PORT}).`);
        console.log(`Nothing more to start: open http://localhost:${PORT}/ in Chrome.`);
        if (process.env.FH_PARTNER) console.log('To bring in an AI partner, press F8 in the game.');
        process.exit(0);
    }
    throw err;
}
server.on('error', onListenError);
wss.on('error', onListenError);

// This PC only: the tunnel and a joiner's server both come in from here, and
// nothing else on the network gets an answer (nor a firewall prompt for it).
// "localhost" may mean either loopback address, so both are answered.
require('net').createServer((socket) => server.emit('connection', socket))
    .on('error', () => { /* no IPv6 on this PC */ }).listen(PORT, '::1');
server.listen(PORT, '127.0.0.1', () => {
    console.log(`fh-coop serving ${GAME}`);
    console.log(`open http://localhost:${PORT}/`);
    // Started "with an AI partner": one is called in right away and waits at the title.
    if (process.env.FH_PARTNER) room.partners.start(new Set());
});
