// A tunnel that drops while a friend is already in the world.
// FH_TUNNEL_FAKE_DROP tells the host their link died. That callback does not close the
// friend's socket, so the line in front of the fake address is cut too: that is what a
// dead tunnel does to someone in the run. The ports named for this suite were already
// taken, so this file uses the next free pair.
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const { checker } = require('./common');
const install = require('./helpers');
const { titleReady, choose } = require('./lobbylib');
const { chaosLink } = require('./chaos');

const HOST = 8505, LINE = 8506;
const FRIEND = HOST + 100;
// The timer starts when hosting starts. Both pages are already at the title by then,
// so the drop lands in the run and not during the load.
const DROP = 120000;

(async () => {
    const check = checker();
    let line, host, friend, browser, pages = [];
    try {
        line = await chaosLink(LINE, 'http://localhost:' + HOST);
        host = await startServer(HOST, { FH_MIND: 'none', FH_TUNNEL_FAKE: line.url, FH_TUNNEL_FAKE_DROP: String(DROP) });
        friend = await startServer(FRIEND, { FH_MIND: 'none' });
        browser = await launch();
        const a = await openPlayer(browser, `http://localhost:${HOST}/?name=Ann`, 'Ann');
        const b = await openPlayer(browser, `http://localhost:${FRIEND}/?name=Bo`, 'Bo');
        pages = [a, b];
        for (const p of pages) {
            await waitFor(p, titleReady, 120000, p.label + ' at the title');
            await p.evaluate(install);
            await p.evaluate(() => {
                window.__toasts = [];
                window.__downs = 0;
                const toast = Coop.toast;
                Coop.toast = function (text) { window.__toasts.push(String(text)); return toast.apply(this, arguments); };
                Coop.on('hostdown', () => { window.__downs++; });
            });
        }
        const online = (on) => fetch(`http://localhost:${HOST}/coop/app/online`, { method: 'POST', headers: { 'x-fh-app': '1', 'content-type': 'application/json' }, body: JSON.stringify({ on, private: true }) }).then((r) => r.json());
        const app = await online(true);
        check('the host has a link', !!app.ready && !!app.link, JSON.stringify(app).slice(0, 240));
        // Left open: the drop is written into the panel as well as the toast.
        await choose(a, 'Together');
        await choose(b, 'Together');
        await b.evaluate((l) => { document.querySelector('[data-field=join]').value = l; }, app.link);
        await b.click('#coop-together [data-do=join]');
        await waitFor(b, () => /Joined/.test(document.querySelector('#coop-together .why').textContent), 20000, 'Bo joined');
        await b.evaluate(() => Coop.together.close());
        await b.evaluate(() => T.quickStart(3, 28, 67));
        await waitFor(b, () => T.onMap(), 60000, 'Bo on the map');
        await b.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(b, () => Coop.world.hostWait === 'Ann', 15000, 'Bo waits for Ann');
        await a.evaluate(() => T.quickStart(1, 27, 67));
        await waitFor(a, () => T.onMap(), 60000, 'Ann on the map');
        await a.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(b, () => Coop.world.live, 20000, 'Bo in the run');
        const before = await (await fetch(`http://localhost:${HOST}/coop/app`, { headers: { 'x-fh-app': '1' } })).json();
        check('Bo is in the world before the tunnel drops', before.droppedAt === 0 && await b.evaluate(() => Coop.world.live), 'droppedAt ' + before.droppedAt);
        let dropped = before;
        for (let i = 0; i < 80 && !dropped.droppedAt; i++) {
            await sleep(2000);
            dropped = await (await fetch(`http://localhost:${HOST}/coop/app`, { headers: { 'x-fh-app': '1' } })).json();
        }
        check('the tunnel drops', dropped.droppedAt > 0, 'droppedAt ' + dropped.droppedAt);
        line.cut();
        let hostText = '';
        for (let i = 0; i < 20 && !/Host online again/.test(hostText); i++) {
            await sleep(500);
            hostText = await a.evaluate(() => window.__toasts.join(' | ') + ' | ' + ((document.querySelector('#coop-together .why') || {}).textContent || '') + ' | ' + ((document.getElementById('coop-toast') || {}).textContent || ''));
        }
        check('the host is told to host again', /Host online again/.test(hostText), hostText.slice(0, 300));
        const heard = await waitFor(b, () => window.__downs >= 1, 25000, 'Bo to hear the host is down').then(() => true, () => false);
        const since = Date.now();
        await waitFor(b, () => window.__downs >= 2, 20000, 'Bo to try again').catch(() => {});
        const left = 33000 - (Date.now() - since);
        if (heard && left > 0) await sleep(left);
        const bo = await b.evaluate(() => ({
            downs: window.__downs,
            toasts: window.__toasts.join(' | '),
            log: Coop.log.join(' | '),
            hud: (document.getElementById('coop-hud') || {}).innerText || '',
            toast: (document.getElementById('coop-toast') || {}).textContent || '',
            refused: Coop.refused || '',
        }));
        check('Bo\'s page notes the host is down and keeps trying', heard && bo.downs >= 2 && /lost the connection|hostdown/.test(bo.log) && !bo.refused, JSON.stringify({ downs: bo.downs, refused: bo.refused, log: bo.log.slice(-400) }));
        const ask = bo.toasts + ' | ' + bo.log + ' | ' + bo.hud + ' | ' + bo.toast;
        check('after about 30s Bo is told to ask for the new link', /link/i.test(ask), ask.slice(-500));
    } catch (e) {
        console.error(e);
        check('test ran to the end', false);
    }
    const code = check.finish(pages);
    if (browser) await browser.close();
    if (line) line.close();
    if (friend) friend.kill();
    if (host) host.kill();
    process.exit(code);
})();
