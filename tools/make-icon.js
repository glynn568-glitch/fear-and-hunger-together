// Renders the icon drawings (tools/launcher/icon.svg for 48 px and up,
// icon-small.svg for 32 px and below) and packs them into
// tools/launcher/icon.ico for the launcher. Also writes client/icon.png, the
// game window's own icon.
//   node tools/make-icon.js
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(__dirname, 'launcher');
const BIG = [256, 128, 64, 48], SMALL = [32, 24, 16];
const BROWSERS = [
    process.env.CHROME,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

// ICONDIR, one 16-byte entry per image, then the PNGs themselves (Vista and later read PNG entries).
function ico(images) {
    const head = Buffer.alloc(6 + 16 * images.length);
    head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
    let offset = head.length;
    images.forEach((img, i) => {
        const e = 6 + 16 * i;
        head.writeUInt8(img.size % 256, e); head.writeUInt8(img.size % 256, e + 1);
        head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
        head.writeUInt32LE(img.data.length, e + 8); head.writeUInt32LE(offset, e + 12);
        offset += img.data.length;
    });
    return Buffer.concat([head, ...images.map((i) => i.data)]);
}

(async () => {
    const executablePath = BROWSERS.find((b) => fs.existsSync(b));
    if (!executablePath) throw new Error('needs Edge or Chrome (or CHROME=<path>)');
    const browser = await puppeteer.launch({ executablePath, headless: 'new' });
    const render = async (svgFile, size) => {
        const page = await browser.newPage();
        await page.setViewport({ width: size, height: size });
        const svg = fs.readFileSync(path.join(DIR, svgFile), 'utf8');
        await page.setContent(`<html><body style="margin:0;background:transparent"><img width="${size}" height="${size}" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body></html>`);
        const data = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
        await page.close();
        return { size, data: Buffer.from(data) };
    };
    const images = [];
    for (const size of BIG) images.push(await render('icon.svg', size));
    for (const size of SMALL) images.push(await render('icon-small.svg', size));
    await browser.close();
    images.sort((a, b) => a.size - b.size);
    fs.writeFileSync(path.join(DIR, 'icon.ico'), ico(images));
    fs.writeFileSync(path.join(ROOT, 'client', 'icon.png'), images.find((i) => i.size === 256).data);
    console.log('icon.ico (' + images.map((i) => i.size).join(', ') + ') and client/icon.png');
})().catch((e) => { console.error(e.message); process.exit(1); });
