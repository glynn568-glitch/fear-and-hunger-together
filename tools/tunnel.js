// The link a friend joins by: a free Cloudflare quick tunnel to this PC's
// server. cloudflared is fetched from its official releases the first time.
// The address changes every time and dies with the tunnel.
const dns = require('dns');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const EXE = path.join(__dirname, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
// One exact release, checked against the SHA-256 Cloudflare publishes with it.
const VERSION = '2026.10.0';
// sha256 is the program's, as Cloudflare publishes it. The Mac builds come
// packed (.tgz): the archive is checked against GitHub's digest of it, and
// the program inside against Cloudflare's.
const BUILDS = {
    'win32-x64': { file: 'cloudflared-windows-amd64.exe', sha256: '86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c' },
    'linux-x64': { file: 'cloudflared-linux-amd64', sha256: 'd33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db' },
    'linux-arm64': { file: 'cloudflared-linux-arm64', sha256: 'e6422b9d4f72d3194bc5a38676f13667c06666523217b842a877d72a80b5ac08' },
    'darwin-x64': { file: 'cloudflared-darwin-amd64.tgz', archive: '903845b81828c8cb3c5d13d816a2de71c06a3da5785469df8eb0e1b736d92f9f', sha256: '0560c9ab7281ac3f746055323623ed23bc0405b6dab9400474020cba33a978da' },
    'darwin-arm64': { file: 'cloudflared-darwin-arm64.tgz', archive: 'a2f79ff7b9420aa537d74af239f376da170bbabeb529aec416002adac6a72e70', sha256: '72edfd3eea463aef4d5cb89e2e209cecb048cc756c2b01915de2e0ad7cb39830' },
};
const BUILD = BUILDS[process.platform + '-' + process.arch] || null;
const RELEASE = BUILD && 'https://github.com/cloudflare/cloudflared/releases/download/' + VERSION + '/' + BUILD.file;
const sha256 = (buf) => require('crypto').createHash('sha256').update(buf).digest('hex');

async function fetchCloudflared() {
    if (!BUILD) throw new Error('hosting online is not available on this system (' + process.platform + ' ' + process.arch + ')');
    // unlinkSync, not rmSync: Node 24's rmSync does nothing at all in a folder whose name is not plain ASCII (José, Иван).
    const remove = (file) => { try { fs.unlinkSync(file); } catch (e) { /* not there */ } };
    // A copy already here is used only if it is that exact build.
    if (fs.existsSync(EXE)) {
        if (sha256(fs.readFileSync(EXE)) === BUILD.sha256) return;
        remove(EXE);
    }
    let body;
    try {
        const res = await fetch(RELEASE, { redirect: 'follow', signal: AbortSignal.timeout(180000) });
        if (!res.ok) throw new Error('the download answered ' + res.status);
        body = Buffer.from(await res.arrayBuffer());
    } catch (e) { throw new Error('could not download cloudflared: ' + (e.name === 'TimeoutError' ? 'no answer in 3 minutes' : e.message)); }
    if (sha256(body) !== (BUILD.archive || BUILD.sha256)) throw new Error('could not download cloudflared: the download did not match its published checksum');
    const tmp = EXE + '.part';
    fs.writeFileSync(tmp, body);
    if (BUILD.archive) {
        const out = require('child_process').spawnSync('tar', ['-xzf', tmp, '-C', __dirname], { stdio: 'ignore' });
        remove(tmp);
        if (out.status !== 0 || !fs.existsSync(EXE) || sha256(fs.readFileSync(EXE)) !== BUILD.sha256) {
            remove(EXE);
            throw new Error('could not unpack cloudflared, or what was inside did not match Cloudflare\'s published checksum');
        }
    } else fs.renameSync(tmp, EXE);
    if (process.platform !== 'win32') fs.chmodSync(EXE, 0o755);
}

// The tunnel's own address in what cloudflared says. Its errors name the service that hands
// addresses out (https://api.trycloudflare.com/tunnel), and that once became the link (10/20).
function addressIn(said) {
    const m = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/.exec(said);
    return m ? m[0] : '';
}

// The addresses of trycloudflare.com's own nameservers (kevin and marjory.ns.cloudflare.com
// on 10/20), looked up once. FH_NS: stand-ins for them (tests), as address:port, comma-separated.
let nameservers = null;
function zoneServers() {
    if (process.env.FH_NS) return Promise.resolve(process.env.FH_NS.split(','));
    if (!nameservers) {
        nameservers = dns.promises.resolveNs('trycloudflare.com').catch(() => ['kevin.ns.cloudflare.com', 'marjory.ns.cloudflare.com'])
            .then((names) => Promise.all(names.slice(0, 4).map((n) => dns.promises.resolve4(n).then((a) => a[0], () => null))))
            .then((found) => { const list = found.filter(Boolean); if (!list.length) throw new Error('no nameserver address'); return list; });
        nameservers.catch(() => { nameservers = null; }); // looked up again next time
    }
    return nameservers;
}

// Why cloudflared stopped before it had an address, for the Together panel.
function whyStopped(code, said) {
    if (/quick tunnel provisioning failed|failed to unmarshal quick Tunnel/i.test(said)) return 'Cloudflare gave out no link just now (it does on a busy day, or after many links in a short time). Try again in a minute.';
    if (/failed to request quick Tunnel/i.test(said)) return 'Cloudflare could not be reached. Check this PC\'s internet connection and try again in a minute.';
    return 'cloudflared stopped (' + code + '): ' + said.trim().split('\n').pop();
}

class Tunnel {
    constructor(port) {
        this.port = port;
        this.proc = null;
        this.url = '';
        this.ready = false; // the address is published and connected, so a friend's PC can reach it
        this.registered = false; // cloudflared has its connection to Cloudflare (it prints the address before that)
        this.starting = null;
        this.round = 0;
        process.on('exit', () => this.stop());
    }

    // A new quick tunnel's name takes a moment to reach DNS (and on a bad day,
    // minutes: Cloudflare's "DNS Update Delays", 10/19/26). A friend whose PC
    // asks too early is told it does not exist, and Windows remembers that for
    // a while. So the link is only handed out once DNS answers for it.
    // Asked of trycloudflare.com's own nameservers, which keep nothing: a public
    // resolver asked before the name exists remembers "no such name" for about a
    // minute (10/20: the nameservers answered at 11 s, 1.1.1.1 at 64 s, and the
    // link was held 90 s). Over HTTPS only where this PC cannot ask them.
    watchPublished() {
        const round = ++this.round;
        const name = new URL(this.url).hostname;
        const since = Date.now();
        const done = () => { if (round === this.round && !this.ready) { this.ready = true; if (this.onReady) this.onReady(); } };
        // After a minute and a half the link is handed out anyway: better a link
        // that may need a minute more than none at all.
        const gone = () => {
            if (round !== this.round || !this.url) return true;
            if (Date.now() - since > 90000) { done(); return true; }
            return false;
        };
        let failures = 0;
        const viaHttps = () => {
            if (gone()) return;
            fetch((process.env.FH_DOH || 'https://cloudflare-dns.com/dns-query') + '?name=' + name + '&type=A', { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(5000) })
                .then((r) => r.json())
                .then((j) => {
                    if (round !== this.round) return;
                    if (j.Status === 0 && Array.isArray(j.Answer) && j.Answer.length && this.registered) done(); else setTimeout(viaHttps, 2000);
                }, () => {
                    // Cannot ask (DNS over HTTPS blocked here): after a few tries, trust the usual few seconds.
                    if (round !== this.round) return;
                    if (++failures >= 4 && this.registered) done(); else setTimeout(viaHttps, 2500);
                });
        };
        // Every nameserver that answers must know the name: a friend's resolver may ask any of them.
        let unanswered = 0;
        const viaZone = (servers) => {
            const askers = servers.map((s) => { const r = new dns.promises.Resolver({ timeout: 2000, tries: 1 }); r.setServers([s]); return r; });
            const ask = () => {
                if (gone()) return;
                Promise.all(askers.map((r) => r.resolve4(name).then((a) => (a.length ? 'yes' : 'no'), (e) => (e.code === 'ENOTFOUND' || e.code === 'ENODATA' ? 'no' : 'none'))))
                    .then((said) => {
                        if (round !== this.round) return;
                        if (said.every((s) => s === 'none')) {
                            // No answer three times running: UDP port 53 is blocked here.
                            if (++unanswered >= 3) { console.log('trycloudflare.com\'s nameservers do not answer here; asking over HTTPS'); viaHttps(); return; }
                        } else {
                            unanswered = 0;
                            if (!said.includes('no') && this.registered) { done(); return; }
                        }
                        setTimeout(ask, 1000);
                    });
            };
            ask();
        };
        zoneServers().then(viaZone).catch(() => viaHttps());
    }

    // Resolves once the address answers, or after `ms` either way.
    whenReady(ms) {
        if (this.ready || !this.url) return Promise.resolve(this.ready);
        return new Promise((resolve) => {
            const t0 = Date.now();
            const tick = () => { if (this.ready || !this.url || Date.now() - t0 > ms) resolve(this.ready); else setTimeout(tick, 250); };
            tick();
        });
    }

    // Resolves with the public address, e.g. https://some-words.trycloudflare.com
    start() {
        if (this.url) return Promise.resolve(this.url);
        if (this.starting) return this.starting;
        // FH_TUNNEL_FAKE: the tests get an address without the internet.
        // FH_NS, FH_DOH: and stand-ins for Cloudflare's DNS, so the wait for the address to be published is the real one.
        if (process.env.FH_TUNNEL_FAKE) {
            this.url = process.env.FH_TUNNEL_FAKE;
            this.registered = true;
            this.ready = !process.env.FH_DOH && !process.env.FH_NS;
            if (!this.ready) this.watchPublished();
            // FH_TUNNEL_FAKE_DROP: and it drops by itself that many ms after it works.
            const drop = Number(process.env.FH_TUNNEL_FAKE_DROP) || 0;
            const round = this.round; // stop() moves it on: a timer from an earlier tunnel drops nothing
            const live = drop && setInterval(() => {
                if (this.round !== round) clearInterval(live);
                else if (this.ready) {
                    clearInterval(live);
                    setTimeout(() => { if (this.round === round && this.url) { this.url = ''; this.ready = false; if (this.onDrop) this.onDrop(); } }, drop);
                }
            }, 250);
            return Promise.resolve(this.url);
        }
        this.starting = fetchCloudflared().then(() => new Promise((resolve, reject) => {
            // FH_QUICK_SERVICE: a stand-in for Cloudflare's service that hands out addresses (tests).
            const service = process.env.FH_QUICK_SERVICE ? ['--quick-service', process.env.FH_QUICK_SERVICE] : [];
            const proc = spawn(EXE, ['tunnel', '--no-autoupdate', ...service, '--url', 'http://127.0.0.1:' + this.port], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
            this.proc = proc;
            let said = '';
            let partial = '';
            let warned = 0;
            let warnedAt = 0;
            const timer = setTimeout(() => { this.stop(); reject(new Error('no tunnel address after 40 seconds')); }, 40000);
            // Could not be started at all (an antivirus took the file, say): told, not a crash.
            proc.on('error', (err) => {
                clearTimeout(timer);
                if (this.proc === proc) this.proc = null;
                reject(new Error(err.code === 'ENOENT' ? 'cloudflared.exe is missing (an antivirus may have removed it)' : 'cloudflared could not start: ' + err.message));
            });
            proc.stderr.on('data', (d) => {
                if (this.proc !== proc) return; // stopped: its address is no one's
                said = (said + d).slice(-4000);
                // Its warnings and errors go in the host's log once it is online: a friend's
                // line that drops (closed 1006) is told apart from this PC's edge connection
                // going down. At most 20 a minute.
                const lines = (partial + d).split('\n');
                partial = lines.pop();
                if (this.url) {
                    for (const line of lines) {
                        if (!/\b(ERR|WRN)\b/.test(line)) continue;
                        if (Date.now() - warnedAt > 60000) { warnedAt = Date.now(); warned = 0; }
                        if (++warned <= 20) console.log('cloudflared: ' + line.replace(/^\S+Z\s+/, '').trim().slice(0, 300));
                    }
                }
                if (/Registered tunnel connection/.test(said)) this.registered = true;
                const address = addressIn(said);
                if (address && !this.url) { this.url = address; this.ready = false; this.registered = /Registered tunnel connection/.test(said); clearTimeout(timer); this.watchPublished(); resolve(this.url); }
            });
            proc.on('exit', (code) => {
                clearTimeout(timer);
                // Stopped by stop(), which let go of it first: nothing to log, and nothing here is
                // this one's any more (a new tunnel may already be starting: Stop, then Host online).
                if (this.proc !== proc) { reject(new Error('stopped')); return; }
                const was = this.url;
                this.proc = null;
                this.url = '';
                if (!was) { console.log('cloudflared stopped (' + code + '): ' + said.trim().split('\n').pop()); reject(new Error(whyStopped(code, said))); }
                else {
                    // Why it went, for the host's log (a Steam Deck's tunnel dropped three times, 10/20, unexplained).
                    console.log('cloudflared stopped (' + code + ') while online; it last said: ' + said.trim().split('\n').slice(-3).map((l) => l.replace(/^\S+Z\s+/, '').trim()).join(' | ').slice(0, 600));
                    if (this.onDrop) this.onDrop();
                }
            });
        })).finally(() => { this.starting = null; });
        return this.starting;
    }

    stop() {
        const proc = this.proc;
        this.proc = null;
        this.url = '';
        this.ready = false;
        this.registered = false;
        this.round++;
        // url is cleared first, so the exit handler does not report a drop.
        if (proc) { try { proc.kill(); } catch (e) { /* gone */ } }
    }
}

module.exports = { Tunnel, fetchCloudflared, addressIn, whyStopped };
