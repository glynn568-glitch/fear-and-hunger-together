// A friend's line to the internet that a test can break: a reverse proxy in
// front of the host's link (the tunnel), which the friend's own server joins
// through. Not a suite; test/humans.js uses it, and test/quietline.js the quiet line below.
//   stall(true)  everything held, sockets left open: Wi-Fi gone for a moment
//   cut()        every connection closed, and refused until restore()
//   delay(ms)    each message held that long more, in order
const http = require('http');
const https = require('https');
const WebSocket = require('ws');

function chaosLink(port, target) {
    const t = new URL(target);
    const lib = t.protocol === 'https:' ? https : http;
    const st = { stalled: false, down: false, delay: 0, held: [], pairs: new Set() };
    const later = (fn) => {
        if (st.stalled) st.held.push(fn);
        else if (st.delay) setTimeout(fn, st.delay);
        else fn();
    };
    const server = http.createServer((req, res) => {
        if (st.down) { req.socket.destroy(); return; }
        later(() => {
            const headers = Object.assign({}, req.headers, { host: t.host });
            const up = lib.request({ hostname: t.hostname, port: t.port || (t.protocol === 'https:' ? 443 : 80), path: req.url, method: req.method, headers }, (r) => {
                res.writeHead(r.statusCode, r.headers);
                r.pipe(res);
            });
            up.on('error', () => { try { res.writeHead(502); res.end(); } catch (e) { /* gone */ } });
            req.pipe(up);
        });
    });
    const wss = new WebSocket.Server({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
        if (st.down) { socket.destroy(); return; }
        wss.handleUpgrade(req, socket, head, (local) => {
            const headers = {};
            for (const [k, v] of Object.entries(req.headers)) if (!/^(host|connection|upgrade|sec-websocket-.*)$/i.test(k)) headers[k] = v;
            const up = new WebSocket((t.protocol === 'https:' ? 'wss://' : 'ws://') + t.host + req.url, { headers, maxPayload: 32 * 1024 * 1024 });
            const pair = { local, up };
            st.pairs.add(pair);
            const waiting = [];
            local.on('message', (data, binary) => later(() => {
                if (up.readyState === WebSocket.OPEN) up.send(data, { binary }); else if (up.readyState === WebSocket.CONNECTING) waiting.push([data, binary]);
            }));
            up.on('open', () => { for (const [data, binary] of waiting.splice(0)) up.send(data, { binary }); });
            up.on('message', (data, binary) => later(() => { if (local.readyState === WebSocket.OPEN) local.send(data, { binary }); }));
            const end = () => { st.pairs.delete(pair); try { local.terminate(); } catch (e) { /* gone */ } try { up.terminate(); } catch (e) { /* gone */ } };
            local.on('close', end); up.on('close', end);
            local.on('error', end); up.on('error', end);
        });
    });
    return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({
        url: 'http://localhost:' + port,
        // Nothing is read off the sockets either, so the relay's pings go
        // unanswered as they would over a dead radio.
        stall(on) {
            st.stalled = !!on;
            for (const p of st.pairs) for (const s of [p.local._socket, p.up._socket]) if (s) { if (on) s.pause(); else s.resume(); }
            if (!on) for (const fn of st.held.splice(0)) fn();
        },
        cut() {
            st.down = true;
            st.held.length = 0;
            for (const p of Array.from(st.pairs)) { try { p.local.terminate(); } catch (e) { /* gone */ } try { p.up.terminate(); } catch (e) { /* gone */ } }
        },
        restore() { st.down = false; },
        delay(ms) { st.delay = ms; },
        close() { this.cut(); server.close(); },
    })));
}

// A line that goes quiet without closing, as a dropped line through the Cloudflare
// tunnel did on 10/20: every connection stays open and whatever is sent is taken,
// but nothing gets through either way, a close included. Plain TCP, so the pings
// and their answers are the two servers' own, as through Cloudflare.
//   quiet(true)   nothing through from now on; new connections are taken and swallowed too
//   quiet(false)  through again; a connection whose other end closed meanwhile closes now
//                 (quiet(false, ms): that long after, as when its far end next sends on it)
//   hung()        connections still open whose sender's words were swallowed (a handshake, say)
function quietLine(port, targetPort) {
    const net = require('net');
    const st = { quiet: false, pairs: new Set() };
    const server = net.createServer((a) => {
        const b = net.connect(targetPort, '127.0.0.1');
        const pair = { a, b, dead: false, lost: false };
        st.pairs.add(pair);
        a.on('data', (d) => { if (!st.quiet) b.write(d); else pair.lost = true; });
        b.on('data', (d) => { if (!st.quiet) a.write(d); });
        const end = () => {
            if (st.quiet) { pair.dead = true; return; }
            st.pairs.delete(pair);
            a.destroy(); b.destroy();
        };
        for (const s of [a, b]) { s.on('close', end); s.on('error', end); }
    });
    return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({
        url: 'http://localhost:' + port,
        quiet(on, linger) {
            st.quiet = !!on;
            const dead = Array.from(st.pairs).filter((p) => p.dead);
            const shut = () => { for (const p of dead) { st.pairs.delete(p); p.a.destroy(); p.b.destroy(); } };
            if (!on) { if (linger) setTimeout(shut, linger); else shut(); }
        },
        hung() { return Array.from(st.pairs).filter((p) => p.lost && !p.dead).length; },
        close() { for (const p of st.pairs) { p.a.destroy(); p.b.destroy(); } server.close(); },
    })));
}

module.exports = { chaosLink, quietLine };
