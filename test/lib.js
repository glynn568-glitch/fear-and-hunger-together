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
    const proc = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
        env: { ...process.env, PORT: String(port), FH_SAVES: saves, ...(env || {}) }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.saves = saves;
    proc.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
    await new Promise((resolve, reject) => {
        proc.stdout.on('data', (d) => { if (String(d).includes('open http')) resolve(); });
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
    const browser = await puppeteer.launch({
        executablePath: CHROME,
        headless: 'new',
        args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--window-size=900,700',
            '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
            '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
        userDataDir: profile,
    });
    return browser;
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
