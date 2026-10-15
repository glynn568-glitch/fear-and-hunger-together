// Cover images for the store pages: itch (630x500) and GitHub's link preview
// (1280x640), from the icon and a real screenshot. Run after test/shots.js.
//   node test/cover.js   -> dist/press/cover-itch.png, cover-github.png
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const PRESS = path.join(ROOT, 'dist', 'press');
const b64 = (file) => fs.readFileSync(file).toString('base64');
const icon = 'data:image/svg+xml;base64,' + b64(path.join(ROOT, 'tools', 'launcher', 'icon.svg'));
const fight = 'data:image/png;base64,' + b64(path.join(PRESS, 'clean-fight.png'));

const page = (w, h) => `<html><body style="margin:0;width:${w}px;height:${h}px;background:#0c0908;overflow:hidden;position:relative;font-family:Georgia,'Times New Roman',serif">
  <div style="position:absolute;right:0;top:0;width:${Math.round(w * 0.62)}px;height:${h}px;background:url(${fight}) ${w < 1000 ? '62% 0/auto 140%' : 'center/cover'} no-repeat;filter:saturate(0.85) brightness(0.8)"></div>
  <div style="position:absolute;inset:0;background:linear-gradient(90deg,#0c0908 38%,rgba(12,9,8,0.82) 55%,rgba(12,9,8,0.15) 80%,rgba(12,9,8,0.35))"></div>
  <div style="position:absolute;inset:0;background:radial-gradient(ellipse at 70% 45%,transparent 45%,rgba(0,0,0,0.6))"></div>
  <div style="position:absolute;left:${Math.round(w * 0.06)}px;top:50%;transform:translateY(-50%);width:${Math.round(w * 0.5)}px">
    <img src="${icon}" style="width:${Math.round(h * 0.3)}px;height:${Math.round(h * 0.3)}px;display:block;margin-bottom:${Math.round(h * 0.04)}px">
    <div style="color:#ebdfc4;font-size:${Math.round(h * 0.085)}px;line-height:1.05;letter-spacing:0.5px">Fear &amp; Hunger<br><span style="color:#d13a2a">Together</span></div>
    <div style="color:#c9bb9c;font-size:${Math.round(h * 0.036)}px;margin-top:${Math.round(h * 0.035)}px;line-height:1.4">Co-op for up to four.<br>Friends or AI partners. Free.</div>
    <div style="color:#7d7262;font-size:${Math.round(h * 0.024)}px;margin-top:${Math.round(h * 0.03)}px">A fan mod. Every player needs their own copy of Fear &amp; Hunger.</div>
  </div>
</body></html>`;

(async () => {
    const exe = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find((p) => fs.existsSync(p));
    const browser = await puppeteer.launch({ executablePath: exe, headless: 'new' });
    for (const [name, w, h] of [['cover-itch', 630, 500], ['cover-github', 1280, 640]]) {
        const p = await browser.newPage();
        await p.setViewport({ width: w, height: h, deviceScaleFactor: name === 'cover-itch' ? 2 : 1 });
        await p.setContent(page(w, h));
        await new Promise((r) => setTimeout(r, 400));
        await p.screenshot({ path: path.join(PRESS, name + '.png') });
        await p.close();
        console.log(name);
    }
    await browser.close();
})();
