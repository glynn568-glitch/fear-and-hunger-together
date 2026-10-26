// The AI partner: opens the game in its own Chrome and plays alongside you,
// with a language model choosing its moves and words (tools/brain.js).
//
//   node tools/bot.js                         join the server on this PC
//   node tools/bot.js "https://...?k=KEY"     join through a link (another PC)
//   options:  --name Claude   --char knight|outlander|priest|mercenary
//             --follow Ann  (stick to that player)   --show  (visible window)
//             --brain claude|anthropic|openai|none     (default: claude if installed)
//             --model opus   --effort low   (claude: opus, sonnet, haiku; API: a model id)
//             --url https://api.x.ai/v1 --key ...      (openai-style endpoints)
//             --verbose  (print every answer the model gives)
//
// It waits at the title until a player is in the dungeon, then appears beside
// them as a protagonist nobody has taken. Y in the game talks to it. Ctrl+C
// sends it home.
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const puppeteer = require('puppeteer-core');
const installBot = require('./bot-page');
const { createBrain, detect } = require('./brain');

const args = process.argv.slice(2);
// "partner" in settings.json holds the same options; the command line wins.
const SAVED = require('./find-game').SETTINGS.partner || {};
function option(name, fallback) {
    const i = args.indexOf('--' + name);
    if (i >= 0 && args[i + 1]) return args[i + 1];
    const saved = SAVED[name === 'char' ? 'character' : name];
    return saved !== undefined && saved !== '' && saved !== null ? String(saved) : fallback;
}
const urlArg = args.find((a) => /^https?:\/\//.test(a)) || 'http://localhost:' + (process.env.PORT || 8420) + '/';
const botName = option('name', 'Claude');
const show = args.includes('--show');
const LOCAL = process.env.LOCALAPPDATA || '';
const CHROME = process.env.CHROME || ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(LOCAL, 'Google\\Chrome\\Application\\chrome.exe'), 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    // Linux: the names play.sh looks for on the PATH, then Flatpaks (SteamOS installs browsers only as those;
    // 10/21: a Deck player could not call a partner in).
    ...(process.platform === 'linux' ? linuxBrowsers() : [])].find((p) => fs.existsSync(p));
function linuxBrowsers() {
    const onPath = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable', 'brave-browser']
        // Not a Snap: its sandbox cannot write the partner's profile and puppeteer often cannot drive it.
        .flatMap((b) => (process.env.PATH || '').split(':').filter((d) => d && !d.startsWith('/snap/')).map((d) => path.join(d, b)));
    const flatpaks = ['com.google.Chrome', 'org.chromium.Chromium', 'com.microsoft.Edge', 'com.brave.Browser']
        .flatMap((id) => ['/var/lib/flatpak/exports/bin', path.join(process.env.HOME || '', '.local/share/flatpak/exports/bin')].map((d) => path.join(d, id)));
    return [...onPath, ...flatpaks];
}
// A Flatpak browser may only write in its own folder: the partner's profile goes there.
const FLATPAK = CHROME && /\/flatpak\/exports\/bin\//.test(CHROME) ? path.basename(CHROME) : '';

let browser = null;
let page = null;
let stopping = false;

// Sent home, including while the title is still loading: leave quietly, then kill Chrome
// without puppeteer's taskkill (that one prints SUCCESS/ERROR into this process).
async function stop() {
    if (stopping) return;
    stopping = true;
    const leave = (async () => {
        if (!page) return;
        // Alive: the title first, so a drop is not kept. Dead: park this body and stay out of the
        // title, which would throw it away; the next call would be someone new.
        const left = await page.evaluate(() => {
            if (window.BOT) BOT.leaving = true;
            if (!(window.Coop && Coop.world && Coop.world.live && window.SceneManager)) return '';
            // Dead and cannot park now (line down): the title would throw the body away.
            if (Coop.dead) return Coop.parkNow && Coop.parkNow(true) ? Coop._parkWait : '';
            SceneManager.goto(Scene_Title);
            return 'alive';
        });
        // Dead: do not close until the host has this body.
        if (typeof left === 'number') { try { await page.waitForFunction((n) => Coop._parkAck === n, { timeout: 5000 }, left); } catch (e) { /* no answer */ } }
        else if (left) await new Promise((r) => setTimeout(r, 1500));
    })();
    try { await Promise.race([leave, new Promise((r) => setTimeout(r, 6500))]); } catch (e) { /* the page is already gone */ }
    try {
        const proc = browser && browser.process && browser.process();
        const pid = proc && proc.pid;
        if (pid && process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        else if (proc) { try { proc.kill('SIGKILL'); } catch (e2) { /* gone */ } }
        // close() now finds the process already gone, so its own taskkill stays quiet, and it drops the exit hook.
        if (browser) await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 1000))]);
    } catch (e) { /* already gone */ }
    process.exit(0);
}

process.on('unhandledRejection', (e) => {
    if (stopping) process.exit(0);
    console.error('[bot] ' + (e && e.stack || e));
    process.exit(1);
});
process.on('uncaughtException', (e) => {
    if (stopping) process.exit(0);
    console.error('[bot] ' + (e && e.stack || e));
    process.exit(1);
});

(async () => {
    if (!CHROME) { console.error('Chrome or Edge was not found. Set CHROME to its path.'); process.exit(1); }
    const url = new URL(urlArg);
    url.searchParams.set('name', botName);
    browser = await puppeteer.launch({
        executablePath: CHROME,
        headless: show ? false : 'new',
        defaultViewport: show ? null : { width: 816, height: 624 },
        args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--window-size=880,720',
            '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
        // One profile per partner name, kept in the mod's own folder and reused:
        // a fresh one each time piled up in the system temp folder.
        userDataDir: path.join(FLATPAK ? path.join(process.env.HOME || '', '.var', 'app', FLATPAK, 'data', 'fh-partners') : path.join(__dirname, '..', 'data', 'partners'), (url.port || '80') + '-' + (botName.replace(/\W/g, '') || 'partner')),
        // Shutting down is ours to do (it leaves the world first), not puppeteer's.
        handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
    });
    page = (await browser.pages())[0] || await browser.newPage();
    page.on('console', (m) => { const t = m.text(); if (t.startsWith('[bot]') || (process.env.BOT_VERBOSE && t.startsWith('[coop]'))) console.log(t); });
    page.on('pageerror', (e) => {
        if (stopping) return;
        // One plugin the game ships fails to parse on every machine; not news.
        if (/physical_attack_animation/.test(String(e && e.stack))) return;
        console.log('[bot] script error: ' + String(e && e.message || e).slice(0, 300));
    });
    // Leaving on purpose: out of the world first, so it is not kept as a dropped player.
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    // Started by another program (the tests): closing its input is the polite stop.
    if (args.includes('--stdin-stop')) { process.stdin.on('end', stop); process.stdin.resume(); }

    // The model is started once the bot knows which character it plays.
    let brain = null;
    const brainOptions = await detect({ brain: option('brain', ''), model: option('model', ''), effort: option('effort', ''), url: option('url', ''), key: option('key', ''),
        name: botName, verbose: args.includes('--verbose'), log: (t) => console.log('[bot] ' + t) });
    try {
        const probe = createBrain(Object.assign({}, brainOptions, { character: '' }));
        console.log('[bot] mind: ' + probe.name);
        probe.close();
    } catch (e) { console.error('[bot] ' + e.message); process.exit(1); }
    await page.exposeFunction('fhBrainCharacter', (character) => {
        if (brain && brain.character === character) return;
        if (brain) brain.close();
        brain = createBrain(Object.assign({}, brainOptions, { character }));
        brain.character = character;
    });
    await page.exposeFunction('fhBrain', (kind, text) => (brain ? brain.ask(kind, text) : null));
    await page.exposeFunction('fhLeave', () => { setTimeout(stop, 2500); });
    const stopBrain = () => { if (brain) brain.close(); };
    process.on('exit', stopBrain);

    console.log(`[bot] ${botName} is opening ${url.origin}`);
    await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, { timeout: 180000, polling: 250 });
    await page.evaluate(installBot, { character: option('char', ''), follow: option('follow', ''), brainless: brainOptions.brain === 'none', story: true });
    console.log('[bot] at the title screen, waiting for a player to be in the dungeon');

    let last = '';
    for (;;) {
        await new Promise((r) => setTimeout(r, 3000));
        let st;
        try { st = await page.evaluate(() => BOT.status()); } catch (e) { if (!stopping) console.log('[bot] the page went away'); break; }
        const line = `${st.character || '-'} | ${st.scene} | map ${st.map} at ${st.x},${st.y} | hp ${st.hp} | ${st.mode}${st.errand ? ' | errand' : ''}${st.connected ? '' : ' | reconnecting'}`;
        if (process.env.BOT_VERBOSE && line !== last) { last = line; console.log('[bot] ' + line); }
    }
    await stop();
})().catch((e) => {
    if (stopping) process.exit(0);
    console.error('[bot] ' + (e && e.stack || e));
    process.exit(1);
});
