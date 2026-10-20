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
            '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
        userDataDir: profile,
    });
    return browser;
}

// A broken twin of a client file (test/twins.js): the page is handed that file
// with its fix taken out, whichever server it asks.
async function serveTwin(page) {
    const { TWINS, twinSource } = require('./twins');
    const t = TWINS[process.env.FH_TWIN];
    if (!t || !t.file.startsWith('client/')) return;
    const name = t.file.slice('client/'.length);
    const cdp = await page.target().createCDPSession();
    cdp.on('Fetch.requestPaused', (e) => {
        const body = twinSource(process.env.FH_TWIN, t.file, fs.readFileSync(path.join(ROOT, t.file), 'utf8'));
        cdp.send('Fetch.fulfillRequest', {
            requestId: e.requestId, responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'application/javascript; charset=utf-8' }, { name: 'Cache-Control', value: 'no-store' }],
            body: Buffer.from(body).toString('base64'),
        }).catch(() => { /* page gone */ });
    });
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/coop/' + name + '*', requestStage: 'Request' }] });
}

// Open one player's tab. Each gets its own incognito context so local storage
// is not shared between the two players.
async function openPlayer(browser, url, label) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 900, height: 700 });
    page.errors = [];
    page.logs = [];
    page.on('pageerror', (e) => page.errors.push(String(e && e.stack || e)));
    page.on('console', (m) => {
        const text = m.text();
        page.logs.push(`[${m.type()}] ${text}`);
        if (m.type() === 'error') page.errors.push(text);
    });
    page.on('requestfailed', (r) => page.logs.push(`[requestfailed] ${r.url()} ${r.failure() && r.failure().errorText}`));
    page.on('response', (r) => { if (r.status() >= 400) page.logs.push(`[http ${r.status()}] ${r.url()}`); });
    page.label = label;
    await serveTwin(page);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    return page;
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

module.exports = { startServer, launch, openPlayer, waitFor, shot, sleep, OUT, ROOT };
