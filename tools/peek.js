// Looks at what a player's screen is showing right now, by asking their game
// to stream to a spare browser the way it would to a dead partner.
//   node tools/peek.js <player name> [out.png] [url]
const path = require('path');
const os = require('os');
const puppeteer = require('puppeteer-core');

const who = process.argv[2];
const outFile = process.argv[3] || path.join(os.tmpdir(), 'fh-peek.png');
const url = process.argv[4] || 'http://localhost:8420/';

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: 'new',
        args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'],
        defaultViewport: { width: 900, height: 700 }, userDataDir: path.join(os.tmpdir(), 'fh-coop-peek-' + process.pid),
    });
    try {
        const page = (await browser.pages())[0];
        await page.goto(url + '?name=Peek' + (process.pid % 1000), { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, { timeout: 90000, polling: 250 });
        await new Promise((r) => setTimeout(r, 1500));
        const target = await page.evaluate((name) => { const p = Coop.others().find((x) => x.name.toLowerCase() === name.toLowerCase()); return p ? { id: p.id, st: p.st, m: p.m } : null; }, who);
        if (!target) { console.log('no player called ' + who + ' is connected'); return; }
        await page.evaluate((id) => { Coop.stream.noVideo = true; Coop.viewer.show(id); Coop.sendTo(id, 'watch', { on: true }); }, target.id);
        await new Promise((r) => setTimeout(r, 4000));
        const info = await page.evaluate(() => {
            const src = Coop.viewer.pictureSource();
            const c = document.createElement('canvas'); c.width = 204; c.height = 156;
            const x = c.getContext('2d'); x.drawImage(src, 0, 0, 204, 156);
            const d = x.getImageData(0, 0, 204, 156).data; let sum = 0, lit = 0;
            for (let i = 0; i < d.length; i += 4) { const v = d[i] + d[i + 1] + d[i + 2]; sum += v; if (v > 60) lit++; }
            return { mode: Coop.viewer.video ? 'video' : 'stills', frames: Coop.viewer.frames, averageBrightness: Math.round(sum / (d.length / 4) / 3), litShare: +(lit / (d.length / 4)).toFixed(2) };
        });
        await page.screenshot({ path: outFile });
        await page.evaluate((id) => Coop.sendTo(id, 'watch', { on: false }), target.id);
        console.log(who, JSON.stringify(target), JSON.stringify(info), '->', outFile);
    } catch (e) { console.error(e.message); }
    await browser.close();
    process.exit(0);
})();
