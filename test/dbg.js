// Opens the LIVE server (port 8420) the way the user's browser does and
// reports any error on the way to the title screen and into a new game.
const path = require('path');
const puppeteer = require('puppeteer-core');
const { OUT, sleep } = require('./lib');

(async () => {
    const browser = await puppeteer.launch({
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: 'new',
        args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--window-size=1500,1100', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'],
        defaultViewport: { width: 1500, height: 1000 }, userDataDir: path.join(OUT, 'chrome-dbg-' + process.pid),
    });
    const page = (await browser.pages())[0];
    const errors = [];
    page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e && e.stack || e).slice(0, 600)));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type().toUpperCase() + ' ' + m.text().slice(0, 400)); });
    page.on('response', (r) => { if (r.status() >= 400) errors.push('HTTP ' + r.status() + ' ' + r.url()); });
    page.on('requestfailed', (r) => errors.push('FAILED ' + r.url() + ' ' + (r.failure() && r.failure().errorText)));
    try {
        await page.goto('http://localhost:8420/', { waitUntil: 'domcontentloaded' });
        // Same stored name as the user.
        await page.evaluate((n) => { try { localStorage.setItem('fhcoop.name', n); } catch (e) { /* ignore */ } }, process.argv[2] || 'Pho');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await sleep(12000);
        const state = await page.evaluate(() => ({
            scene: window.SceneManager && SceneManager._scene ? SceneManager._scene.constructor.name : 'none', stopped: window.SceneManager && SceneManager._stopped,
            printer: document.getElementById('ErrorPrinter') ? document.getElementById('ErrorPrinter').innerText.slice(0, 400) : '',
            coop: window.Coop ? { connected: Coop.connected, name: Coop.name, id: Coop.id, log: Coop.log.slice(-6) } : null,
            continueOk: window.DataManager ? DataManager.isAnySavefileExists() : null,
        }));
        console.log('at title:', JSON.stringify(state));
        await page.screenshot({ path: path.join(OUT, 'dbg-title.png') });
        // New game, as a person would: Enter.
        await page.keyboard.down('Enter'); await sleep(140); await page.keyboard.up('Enter');
        await sleep(9000);
        const after = await page.evaluate(() => ({
            scene: SceneManager._scene ? SceneManager._scene.constructor.name : 'none', stopped: SceneManager._stopped, map: window.$gameMap ? $gameMap.mapId() : 0,
            printer: document.getElementById('ErrorPrinter') ? document.getElementById('ErrorPrinter').innerText.slice(0, 400) : '',
        }));
        console.log('after Enter:', JSON.stringify(after));
        await page.screenshot({ path: path.join(OUT, 'dbg-after.png') });
    } catch (e) { console.log('script failed:', e.message); }
    console.log('errors (' + errors.length + '):');
    for (const e of [...new Set(errors)].slice(0, 15)) console.log('  ' + e);
    await browser.close();
    process.exit(0);
})();
