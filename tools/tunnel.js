// The link a friend joins by: a free Cloudflare quick tunnel to this PC's
// server. cloudflared is fetched from its official releases the first time.
// The address changes every time and dies with the tunnel.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const EXE = path.join(__dirname, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
// One exact release, checked against the SHA-256 Cloudflare publishes with it.
const VERSION = '2026.10.0';
const BUILD = process.platform === 'win32'
    ? { file: 'cloudflared-windows-amd64.exe', sha256: '86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c' }
    : { file: 'cloudflared-linux-amd64', sha256: 'd33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db' };
const RELEASE = 'https://github.com/cloudflare/cloudflared/releases/download/' + VERSION + '/' + BUILD.file;
const sha256 = (buf) => require('crypto').createHash('sha256').update(buf).digest('hex');

async function fetchCloudflared() {
    // A copy already here is used only if it is that exact build.
    if (fs.existsSync(EXE)) {
        if (sha256(fs.readFileSync(EXE)) === BUILD.sha256) return;
        fs.rmSync(EXE, { force: true });
    }
    let body;
    try {
        const res = await fetch(RELEASE, { redirect: 'follow', signal: AbortSignal.timeout(180000) });
        if (!res.ok) throw new Error('the download answered ' + res.status);
        body = Buffer.from(await res.arrayBuffer());
    } catch (e) { throw new Error('could not download cloudflared: ' + (e.name === 'TimeoutError' ? 'no answer in 3 minutes' : e.message)); }
    if (sha256(body) !== BUILD.sha256) throw new Error('could not download cloudflared: the download did not match Cloudflare\'s published checksum');
    const tmp = EXE + '.part';
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, EXE);
    if (process.platform !== 'win32') fs.chmodSync(EXE, 0o755);
}

class Tunnel {
    constructor(port) {
        this.port = port;
        this.proc = null;
        this.url = '';
        this.starting = null;
        process.on('exit', () => this.stop());
    }

    // Resolves with the public address, e.g. https://some-words.trycloudflare.com
    start() {
        if (this.url) return Promise.resolve(this.url);
        if (this.starting) return this.starting;
        // FH_TUNNEL_FAKE: the tests get an address without the internet.
        if (process.env.FH_TUNNEL_FAKE) { this.url = process.env.FH_TUNNEL_FAKE; return Promise.resolve(this.url); }
        this.starting = fetchCloudflared().then(() => new Promise((resolve, reject) => {
            const proc = spawn(EXE, ['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:' + this.port], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
            this.proc = proc;
            let said = '';
            const timer = setTimeout(() => { this.stop(); reject(new Error('no tunnel address after 40 seconds')); }, 40000);
            // Could not be started at all (an antivirus took the file, say): told, not a crash.
            proc.on('error', (err) => {
                clearTimeout(timer);
                if (this.proc === proc) this.proc = null;
                reject(new Error(err.code === 'ENOENT' ? 'cloudflared.exe is missing (an antivirus may have removed it)' : 'cloudflared could not start: ' + err.message));
            });
            proc.stderr.on('data', (d) => {
                said = (said + d).slice(-4000);
                const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(said);
                if (m && !this.url) { this.url = m[0]; clearTimeout(timer); resolve(this.url); }
            });
            proc.on('exit', (code) => {
                clearTimeout(timer);
                const was = this.url;
                this.proc = null;
                this.url = '';
                if (!was) reject(new Error('cloudflared stopped (' + code + '): ' + said.trim().split('\n').pop()));
                else if (this.onDrop) this.onDrop();
            });
        })).finally(() => { this.starting = null; });
        return this.starting;
    }

    stop() {
        const proc = this.proc;
        this.proc = null;
        this.url = '';
        // url is cleared first, so the exit handler does not report a drop.
        if (proc) { try { proc.kill(); } catch (e) { /* gone */ } }
    }
}

module.exports = { Tunnel };
