// Shared helpers for the browser-driven tests: start the server, open the
// game in headless Chrome, and reach into the running engine.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function startServer(port, env) {
    const saves = path.join(OUT, 'saves-' + port);
    fs.rmSync(saves, { recursive: true, force: true });
    // A broken twin (test/twins.js) is put in as Node loads the server.
    const twin = process.env.FH_TWIN ? ['-r', path.join(__dirname, 'twin-hook.js')] : [];
    const proc = spawn(process.execPath, [...twin, path.join(ROOT, 'server.js')], {
        // Direct fight video unless a suite asks otherwise (FH_TEST_RELAY=1: every suite with
        // Hide my IP at its default); null leaves a setting at its default.
        env: Object.fromEntries(Object.entries({ ...process.env, FH_RELAY: process.env.FH_TEST_RELAY ? null : '0', PORT: String(port), FH_SAVES: saves, ...(env || {}) }).filter(([, v]) => v !== null)), stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.saves = saves;
    proc.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
    await new Promise((resolve, reject) => {
        // A server already on the port (another test, or another project's) is not ours to test against.
        proc.stdout.on('data', (d) => {
            if (String(d).includes('already running')) reject(new Error('port ' + port + ' is taken by another server'));
            else if (String(d).includes('open http')) resolve();
        });
        proc.on('exit', (code) => reject(new Error('server exited ' + code)));
        setTimeout(() => reject(new Error('server start timeout')), 10000);
    });
    return proc;
}

function alive(pid) {
    try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

const GPU_DIED = 'chrome: its GPU process died';

async function launch() {
    // Profiles left by earlier runs (they exit too soon to remove their own);
    // one still in use by a running test cannot be removed and is skipped.
    fs.mkdirSync(OUT, { recursive: true });
    for (const name of fs.readdirSync(OUT)) {
        const m = /^chrome-profile-(\d+)$/.exec(name);
        if (!m || Number(m[1]) === process.pid || alive(Number(m[1]))) continue;
        try { fs.rmSync(path.join(OUT, name), { recursive: true, force: true }); } catch (e) { /* in use after all */ }
    }
    const profile = path.join(OUT, 'chrome-profile-' + process.pid);
    // The real GPU by default; FH_TEST_GPU=0 renders in software (leaves the card to a game).
    const gl = process.env.FH_TEST_GPU === '0'
        ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
        : ['--use-angle=d3d11'];
    const browser = await puppeteer.launch({
        executablePath: CHROME,
        headless: 'new',
        args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--window-size=900,700',
            ...gl, '--ignore-gpu-blocklist',
            // Linux under WSL runs everything as root, where Chrome will not start sandboxed.
            ...(process.getuid && process.getuid() === 0 ? ['--no-sandbox'] : []),
            '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
            // Chrome's own warnings and errors, read below.
            '--enable-logging=stderr', '--log-level=1',
            // Chrome 158 (installed here 11/23) draws its pages through Skia Graphite on Dawn/D3D. From then on
            // its GPU process died now and then mid-gate (exit 34, the driver lost the device), 7 times in two
            // gates, never before. This is the drawing every earlier gate had; the game's WebGL is unchanged.
            '--disable-features=SkiaGraphite'],
        userDataDir: profile,
    });
    // What Chrome says about its GPU process goes into every page's log. On 11/24 that process died
    // in the middle of gates 1 and 2: every page of its browser lost WebGL at once, the game stopped on
    // "The graphics driver reset", and the test only saw a title or a map that never came.
    // Exit code 34 is Chrome giving up on its GPU process after the graphics driver lost the device
    // ("some drivers can't recover from errors"). The suite's stderr says so, for test/run.js.
    browser.pages_ = [];
    const proc = browser.process();
    if (proc && proc.stderr) proc.stderr.on('data', (d) => {
        for (const line of String(d).split('\n')) {
            if (!/gpu|GPU|watchdog|D3D|DXGI|[Dd]evice (lost|removed|hung|reset)|context lost|ANGLE|angle/.test(line) || /CONSOLE/.test(line)) continue;
            for (const p of browser.pages_) p.logs.push('[chrome] ' + line.trim().slice(0, 300));
            if (/GPU process exited unexpectedly/.test(line)) process.stderr.write(GPU_DIED + ': ' + line.trim().slice(0, 200) + '\n');
        }
    });
    return browser;
}

// A broken twin of a client file (test/twins.js): the page is handed that file
// with its fix taken out, whichever server it asks. slow: { 'lobby.js': ms } holds
// those co-op scripts back that long, as a slow PC loads them.
async function serveTwin(page, slow) {
    const { TWINS, twinSource } = require('./twins');
    const t = TWINS[process.env.FH_TWIN];
    const twin = t && t.file.startsWith('client/') ? t.file.slice('client/'.length) : null;
    const late = slow || {};
    const names = [...new Set([twin, ...Object.keys(late)].filter(Boolean))];
    if (!names.length) return;
    const cdp = await page.target().createCDPSession();
    cdp.on('Fetch.requestPaused', (e) => {
        const name = names.find((n) => e.request.url.includes('/coop/' + n));
        const answer = () => (name === twin
            ? cdp.send('Fetch.fulfillRequest', {
                requestId: e.requestId, responseCode: 200,
                responseHeaders: [{ name: 'Content-Type', value: 'application/javascript; charset=utf-8' }, { name: 'Cache-Control', value: 'no-store' }],
                body: Buffer.from(twinSource(process.env.FH_TWIN, t.file, fs.readFileSync(path.join(ROOT, t.file), 'utf8'))).toString('base64'),
            })
            : cdp.send('Fetch.continueRequest', { requestId: e.requestId })).catch(() => { /* page gone */ });
        setTimeout(answer, late[name] || 0);
    });
    await cdp.send('Fetch.enable', { patterns: names.map((n) => ({ urlPattern: '*/coop/' + n + '*', requestStage: 'Request' })) });
}

// Open one player's tab. Each gets its own incognito context so local storage
// is not shared between the two players.
async function openPlayer(browser, url, label, slow) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 900, height: 700 });
    page.errors = [];
    page.logs = [];
    if (browser.pages_) browser.pages_.push(page);
    page.on('pageerror', (e) => page.errors.push(String(e && e.stack || e)));
    page.on('console', (m) => {
        const text = m.text();
        page.logs.push(`[${m.type()}] ${text}`);
        if (m.type() === 'error') page.errors.push(text);
    });
    page.on('requestfailed', (r) => page.logs.push(`[requestfailed] ${r.url()} ${r.failure() && r.failure().errorText}`));
    page.on('response', (r) => { if (r.status() >= 400) page.logs.push(`[http ${r.status()}] ${r.url()}`); });
    page.label = label;
    await serveTwin(page, slow);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    return page;
}

// The host goes online, privately, the way the Together panel does it, and follows on until
// Cloudflare has published the link. Stopped and started again at once (to change Hide my IP, say):
// the old cloudflared's exit once took the new tunnel's place, and no link came.
// Cloudflare refuses a quick tunnel now and then, more often when several are asked for at once
// (the internet gate brings up three suites together). The app's answer says to try again in a
// minute, and so does this; any other failure is the test's to report.
async function goOnline(port) {
    const head = { 'x-fh-app': '1', 'content-type': 'application/json' };
    const online = (on) => fetch(`http://localhost:${port}/coop/app/online`, { method: 'POST', headers: head, body: JSON.stringify({ on, private: true }) }).then((r) => r.json());
    let app;
    for (let tries = 0; tries < 4; tries++) {
        await online(true);
        await online(false);
        app = await online(true);
        if (!/gave out no link/.test(app.error || '')) break;
        await sleep(60000);
    }
    for (let i = 0; i < 60 && app.mode === 'online' && !app.ready; i++) {
        await sleep(2000);
        app = await (await fetch(`http://localhost:${port}/coop/app`, { headers: head })).json();
    }
    return app;
}

async function waitFor(page, fn, timeout, what, ...args) {
    try {
        await page.waitForFunction(fn, { timeout: timeout || 30000, polling: 100 }, ...args);
    } catch (e) {
        throw new Error(`${page.label}: timed out waiting for ${what || fn}`);
    }
}

async function shot(page, name) {
    fs.mkdirSync(OUT, { recursive: true });
    const file = path.join(OUT, name + '.png');
    // A picture left open in a viewer is locked; that must not fail a test.
    try { await page.screenshot({ path: file }); } catch (e) { return file + ' (not written: ' + e.code + ')'; }
    return file;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { startServer, launch, openPlayer, goOnline, waitFor, shot, sleep, OUT, ROOT, GPU_DIED };
