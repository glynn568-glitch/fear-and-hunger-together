// The mod's own screens: a join link focuses Join, a dead host is explained once, the bug
// report says what this PC can still see, a pad can leave the name box, and a mouse can
// finish the lines it can open. One page, port 8572 (8672 is this job's other port and is
// not started: nothing here needs a second server).
const http = require('http');
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const { checker } = require('./common');

const PORT = 8572;
const TRYING = 'Cannot reach the host. Trying again...';
const HOST_LINK = "The host's link may have changed. Ask them for it again: Together, Leave, then Join with the new link.";
const UNREAD = 'The server log could not be read. Send app\\data\\server-*.log and launcher.log.';
const COPIED = 'Bug report copied. Paste it into your message about the bug.';
const PARK_EMPTY = 'Nothing was kept from that drop. The last bed save is the safe point.';
const PARK_NO = 'Your place could not be kept. The last bed save is the safe point.';
const REPLACED = 'This game is open in another tab or window.';
const NAME_KEY = 'Type a name first (bottom left).';
const NAME_PAD = 'Type a name first (bottom left). Steam+X opens the keyboard on a Steam Deck.';

function post(port, pathname, body, headers) {
    return new Promise((resolve) => {
        const data = JSON.stringify(body || {});
        const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, headers || {}) }, (res) => {
            res.resume();
            res.on('end', () => resolve({ status: res.statusCode }));
        });
        req.on('error', () => resolve({ status: 0 }));
        req.end(data);
    });
}

function plugIn() {
    const pad = { index: 0, id: 'test pad', connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: [] };
    for (let i = 0; i < 17; i++) pad.buttons.push({ pressed: false, touched: false, value: 0 });
    window.PAD = pad;
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
}
const hold = (page, i, on) => page.evaluate((i, on) => { PAD.buttons[i].pressed = on; PAD.buttons[i].value = on ? 1 : 0; }, i, on);

async function until(page, fn, ms, what, ...args) {
    try { await waitFor(page, fn, ms, what, ...args); return true; }
    catch (e) { return e.message; }
}
async function click(page, sel) {
    try { await page.click(sel); return ''; }
    catch (e) { return e.message; }
}


(async () => {
    const check = checker();
    let server, browser, page;
    try {
        server = await startServer(PORT);
        browser = await launch();
        page = await openPlayer(browser, 'http://127.0.0.1:' + PORT + '/', 'page');
        await waitFor(page, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && SceneManager._scene._commandWindow && window.Coop && Coop.connected && Coop.toast, 90000, 'title + connection');
        await sleep(400);
        await page.evaluate(() => {
            if (!navigator.clipboard) navigator.clipboard = {};
            navigator.clipboard.writeText = (t) => { window.__clip = String(t); return Promise.resolve(); };
            // Y is listened for on the window, on the way down. F1 is on document. The bug-report chord bubbles to the window.
            window.__key = function (code, keyName, extra) {
                const ev = new KeyboardEvent('keydown', Object.assign({ code: code, key: keyName, bubbles: true, cancelable: true }, extra || {}));
                (code === 'KeyY' ? window : document).dispatchEvent(ev);
            };
        });
        await page.evaluate(plugIn);

        // The name box: A submits, B leaves, and the held button is not also the game's.
        await page.evaluate(() => {
            const input = document.querySelector('#coop-name input');
            input.value = 'Zed';
            input.focus();
        });
        await hold(page, 0, true);
        await sleep(400);
        const named = await page.evaluate(() => ({
            name: Coop.name,
            ok: Input.isPressed('ok'),
            left: !(document.activeElement && document.activeElement.closest && document.activeElement.closest('#coop-name')),
        }));
        await hold(page, 0, false);
        await sleep(300);
        check('A on the name box submits the name', named.name === 'Zed' && named.left, JSON.stringify(named));
        check('the A held on the name box is not OK in the game', named.ok === false, JSON.stringify(named));

        await page.evaluate(() => {
            const input = document.querySelector('#coop-name input');
            input.value = 'Qin';
            input.focus();
        });
        await hold(page, 1, true);
        await sleep(400);
        const left = await page.evaluate(() => ({
            name: Coop.name,
            cancel: Input.isPressed('cancel'),
            left: !(document.activeElement && document.activeElement.closest && document.activeElement.closest('#coop-name')),
        }));
        await hold(page, 1, false);
        await sleep(300);
        check('B leaves the name box', left.left && left.name === 'Qin' && left.cancel === false, JSON.stringify(left));

        const toasts = await page.evaluate((keyLine, padLine) => {
            const scene = SceneManager._scene;
            const input = document.querySelector('#coop-name input');
            const toast = () => document.getElementById('coop-toast').textContent;
            Coop.padUsed = true;
            input.value = '';
            Coop.setName('');
            scene.commandNewGame();
            const steam = toast();
            Coop.padUsed = false;
            input.value = '';
            Coop.setName('');
            scene.commandNewGame();
            return { steam, plain: toast(), keyLine, padLine };
        }, NAME_KEY, NAME_PAD);
        check('after a controller, an empty name says how to open the keyboard', toasts.steam === NAME_PAD, toasts.steam);
        check('on a keyboard, the empty-name line stays as it was', toasts.plain === NAME_KEY, toasts.plain);

        const nameClick = await click(page, '#coop-name input');
        const started = await page.evaluate(() => {
            const scene = SceneManager._scene;
            const win = scene._commandWindow;
            const saved = { setup: DataManager.setupNewGame, close: win.close, fade: scene.fadeOutAll, goto: SceneManager.goto, push: SceneManager.push };
            let setupN = 0, pushN = 0;
            DataManager.setupNewGame = () => { setupN++; };
            win.close = () => {};
            scene.fadeOutAll = () => {};
            SceneManager.goto = () => {};
            SceneManager.push = () => { pushN++; };
            try {
                const input = document.querySelector('#coop-name input');
                const focused = document.activeElement === input;
                input.value = 'Mouse';
                Coop.setName('');
                scene.commandNewGame();
                const neu = { name: Coop.name, setup: setupN };
                input.value = 'Cont';
                Coop.setName('');
                scene.commandContinue();
                return { focused, neu, cont: { name: Coop.name, push: pushN } };
            } finally {
                DataManager.setupNewGame = saved.setup;
                win.close = saved.close;
                scene.fadeOutAll = saved.fade;
                SceneManager.goto = saved.goto;
                SceneManager.push = saved.push;
            }
        });
        check('a click lands in the name box', !nameClick && started.focused, nameClick || JSON.stringify(started));
        check('New Game and Continue take the name in the box', started.neu.name === 'Mouse' && started.neu.setup === 1 && started.cont.name === 'Cont' && started.cont.push === 1, JSON.stringify(started));

        await page.evaluate(() => {
            window.__nameok = '';
            Coop.on('nameok', (m) => { window.__nameok = m && m.name; });
            Coop.setName('Ann');
        });
        const took = await until(page, () => window.__nameok === 'Ann' && Coop.decides === true, 10000, 'Ann taken');
        check('the name is taken', took === true, took === true ? '' : took);

        const link = 'http://127.0.0.1:9/?k=abc';
        const offered = await post(PORT, '/coop/app/offer', { link }, { 'x-fh-app': '1' });
        const focused = await until(page, (want) => {
            const el = document.activeElement;
            const field = document.querySelector('#coop-together [data-field=join]');
            const why = document.querySelector('#coop-together .why');
            return !!(window.Coop && Coop.together && Coop.together.isOpen() && field && field.value === want && el && el.getAttribute('data-do') === 'join' && why && why.textContent.indexOf('Press Join') >= 0);
        }, 8000, 'Join focused', link);
        check('an offered link focuses Join', offered.status === 200 && focused === true, focused === true ? 'offer ' + offered.status : focused);

        const beforeLoot = await page.evaluate(() => document.querySelector('#coop-together [data-rule=loot]').checked);
        const lootErr = await click(page, '#coop-together [data-rule=loot]');
        const afterLoot = await page.evaluate(() => document.querySelector('#coop-together [data-rule=loot]').checked);
        check('a click flips a run option', !lootErr && beforeLoot !== afterLoot, lootErr || (beforeLoot + ' -> ' + afterLoot));

        await page.evaluate(() => { document.querySelector('#coop-together [data-field=join]').value = ''; });
        const joinErr = await click(page, '#coop-together [data-do=join]');
        const joinWhy = await page.evaluate(() => document.querySelector('#coop-together .why').textContent);
        check('Join with no link says so', !joinErr && joinWhy === "Paste your friend's link first.", joinErr || joinWhy);

        const mindErr = await click(page, '#coop-together [data-do=mind]');
        const setupOpen = await until(page, () => document.getElementById('coop-setup').classList.contains('open'), 3000, 'setup open');
        const setupErr = await click(page, '#coop-setup [data-do=close]');
        const setupShut = await page.evaluate(() => !document.getElementById('coop-setup').classList.contains('open'));
        check('How it thinks opens and a click closes it', !mindErr && setupOpen === true && !setupErr && setupShut, mindErr || setupErr || String(setupOpen));

        const closeErr = await click(page, '#coop-together [data-do=close]');
        const shut = await page.evaluate(() => !Coop.together.isOpen());
        check('Close leaves Together', !closeErr && shut, closeErr);

        const chat = await page.evaluate(() => {
            const open = (pad) => {
                Coop.padUsed = pad;
                if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
                window.__key('KeyY', 'y');
                const text = document.querySelector('#coop-chat input').placeholder;
                document.querySelector('#coop-chat input').blur();
                return text;
            };
            return { pad: open(true), keys: open(false) };
        });
        check('chat names the pad buttons', chat.pad === 'Say something (A sends, B cancels)', chat.pad);
        check('chat names Enter and Esc on a keyboard', chat.keys === 'Say something (Enter sends, Esc cancels)', chat.keys);

        const help = await page.evaluate(() => {
            const press = () => window.__key('F1', 'F1');
            const read = () => {
                const box = document.getElementById('coop-help');
                const dt = (k) => box.querySelector('dt[data-key="' + k + '"]').textContent;
                return { open: box.style.display !== 'none', enter: dt('Enter'), f: dt('F'), y: dt('Y'), f8: box.querySelector('dd[data-row=F8]').textContent, g: box.querySelector('footer:not(.pad)').textContent };
            };
            Coop.padUsed = true;
            document.getElementById('coop-help').style.display = 'none';
            press();
            const pad = read();
            Coop.padUsed = false;
            press();
            press();
            return { pad, enter: read().enter };
        });
        check('help names the pad buttons', help.pad.open && help.pad.enter === 'A' && help.pad.f === 'R3' && help.pad.y === 'Start', JSON.stringify(help.pad));
        check('F8 says it is also on Together', help.pad.f8.indexOf('Together on the title') >= 0, help.pad.f8);
        check('G says the trap is also in the bag', help.pad.g.indexOf('from the bag') >= 0, help.pad.g);
        check('help names Enter again after a key', help.enter === 'Enter', help.enter);

        const planted = await page.evaluate(() => {
            try {
                const data = [];
                data[663] = true;
                StorageManager.save(2, JsonEx.stringify({ switches: { _data: data } }));
                const info = DataManager.loadGlobalInfo() || [];
                info[2] = { coopRun: 'run42', coopStamp: 77, characters: [['People1', 0]] };
                DataManager.saveGlobalInfo(info);
                return { ok: true };
            } catch (e) { return { ok: false, err: String(e && (e.stack || e.message) || e) }; }
        });
        check('this PC has a save to list', planted.ok, planted.err || '');

        await page.evaluate(() => {
            const w = Coop.world;
            const saved = { refused: Coop.refused, connected: Coop.connected, drop: Coop._drop, live: w.live, entering: w._entering, hostWait: w.hostWait, waiting: w.waiting, otherRun: w.otherRun };
            try {
                Coop.refused = 'turned-away';
                Coop.connected = false;
                Coop._drop = { code: 1006, at: Date.now() - 2500, hostdown: true };
                w.live = true;
                w._entering = true;
                w.hostWait = 'Bo';
                w.waiting = true;
                w.otherRun = true;
                window.__key('KeyB', 'B', { ctrlKey: true, shiftKey: true });
            } finally {
                Coop.refused = saved.refused;
                Coop.connected = saved.connected;
                Coop._drop = saved.drop;
                w.live = saved.live;
                w._entering = saved.entering;
                w.hostWait = saved.hostWait;
                w.waiting = saved.waiting;
                w.otherRun = saved.otherRun;
            }
        });
        const reported = await until(page, (want) => document.getElementById('coop-toast').textContent === want, 8000, 'bug report copied', COPIED);
        const clip = await page.evaluate(() => window.__clip || '');
        check('a bug report is copied', reported === true, reported === true ? '' : reported);
        check('the report has the line, the world and this PC\'s save while the line is down',
            /connection: refused turned-away, connected no/.test(clip)
            && /closed 1006, down \d+\.\ds, hostdown yes/.test(clip)
            && /world: live true, entering true, hostWait Bo, waiting true, otherRun true/.test(clip)
            && /slot 2, run run42, stamp 77, character Enki/.test(clip)
            && !/character People1/.test(clip),
            clip.slice(clip.indexOf('connection:'), clip.indexOf('connection:') + 500));

        await page.evaluate(() => {
            window.__fetch = window.fetch;
            window.fetch = function (url) {
                if (String(url).indexOf('coop/app/report') >= 0) return Promise.reject(new Error('unread'));
                return window.__fetch.apply(this, arguments);
            };
            window.__key('KeyB', 'B', { ctrlKey: true, shiftKey: true });
        });
        const unread = await until(page, (want) => document.getElementById('coop-toast').textContent === want, 8000, 'unread report', UNREAD);
        const unreadToast = await page.evaluate(() => document.getElementById('coop-toast').textContent);
        check('an unreadable server log says which files to send', unread === true && unreadToast !== COPIED, unreadToast);

        // The carry-on line, while the game loop still polls the pad (a script error stops it).
        await page.evaluate(() => {
            window.__sent = [];
            window.__send = Coop.send;
            Coop.send = (m) => { window.__sent.push(m); };
            Coop.emit('parked', { has: true, ageSec: 30 });
        });
        const banner = await until(page, () => {
            const el = document.getElementById('coop-resume');
            if (!el || el.style.display === 'none' || el.textContent.indexOf('Or click here.') < 0) return false;
            const r = el.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) return false;
            const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            window.__resume = { text: el.textContent, pe: getComputedStyle(el).pointerEvents, w: Math.round(r.width), h: Math.round(r.height), hit: !!(at && at.closest && at.closest('#coop-resume')) };
            return true;
        }, 5000, 'the carry-on line');
        const resume = await page.evaluate(() => window.__resume || {});
        check('the carry-on line can be clicked', banner === true && resume.pe === 'auto' && resume.hit, banner === true ? JSON.stringify(resume) : banner);

        await page.evaluate(() => { window.__sent = []; });
        const bannerErr = await click(page, '#coop-resume');
        const clicked = await page.evaluate(() => window.__sent.filter((m) => m && m.t === 'park!').length);
        check('clicking the carry-on line asks for the parked place', !bannerErr && clicked === 1, bannerErr || String(clicked));

        const empty = await page.evaluate((said) => {
            Coop.emit('parkdata', {});
            return { toast: document.getElementById('coop-toast').textContent, noted: Coop.log.some((l) => l.indexOf(said) >= 0) };
        }, PARK_EMPTY);
        check('an empty park says nothing was kept', empty.toast === PARK_EMPTY && empty.noted, JSON.stringify(empty));

        await page.evaluate(() => {
            window.__sent = [];
            Coop.emit('parked', { has: true, ageSec: 30 });
            if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        });
        await sleep(200);
        await page.keyboard.press('KeyR');
        await sleep(300);
        const byKey = await page.evaluate(() => window.__sent.filter((m) => m && m.t === 'park!').length);
        check('R still asks for the parked place', byKey === 1, String(byKey));

        await page.evaluate(() => {
            window.__sent = [];
            Coop.emit('parked', { has: true, ageSec: 30 });
            if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        });
        await hold(page, 7, true);
        await sleep(400);
        await hold(page, 7, false);
        await sleep(250);
        const byPad = await page.evaluate(() => window.__sent.filter((m) => m && m.t === 'park!').length);
        check('RT at the title still asks for the parked place', byPad === 1, String(byPad));

        const kept = await page.evaluate((said) => {
            Coop._receive({ t: 'parkno', why: 'disk full' });
            return {
                toast: document.getElementById('coop-toast').textContent,
                noted: Coop.log.some((l) => l.indexOf(said) >= 0 && l.indexOf('disk full') >= 0),
            };
        }, PARK_NO);
        check('a park that did not write says the bed save is the safe point', kept.toast === PARK_NO && kept.noted, JSON.stringify(kept));
        await page.evaluate(() => { if (window.__send) Coop.send = window.__send; });

        const version = await page.evaluate(() => {
            Coop._receive({ t: 'version', game: false, yours: { version: '0.1.22' }, mine: { version: '0.1.23' } });
            const noted = Coop.log.some((l) => l.indexOf('0.1.22') >= 0 && l.indexOf('0.1.23') >= 0);
            const toast = document.getElementById('coop-toast').textContent;
            Coop.refused = null;
            return { noted, toast };
        });
        check('a version refusal is noted', version.noted && version.toast.indexOf('0.1.22') >= 0 && version.toast.indexOf('0.1.23') >= 0, version.toast);

        const replaced = await page.evaluate((said) => {
            const old = Coop._ws;
            Coop._receive({ t: 'replaced' });
            const toast = document.getElementById('coop-toast').textContent;
            const refused = Coop.refused;
            Coop._ws = null;
            Coop.connect();
            const opened = Coop._ws;
            if (opened && opened !== old) { try { opened.close(); } catch (e) { /* already gone */ } }
            Coop._ws = old;
            Coop.refused = null;
            return { toast, refused, opened: !!(opened && opened !== old), said };
        }, REPLACED);
        check('a second tab stops this one reconnecting', replaced.toast === REPLACED && replaced.refused === REPLACED && replaced.opened === false, JSON.stringify({ toast: replaced.toast, refused: replaced.refused, opened: replaced.opened }));

        const boom = await page.evaluate(() => {
            const orig = console.error;
            console.error = function () {};
            try {
                SceneManager.catchException(new Error('boom-marker'));
                return { log: Coop.log.filter((l) => l.indexOf('boom-marker') >= 0).join(' '), err: Coop._scriptError || '' };
            } catch (e) {
                return { log: Coop.log.filter((l) => l.indexOf('boom-marker') >= 0).join(' '), err: 'THREW ' + (e && e.message) };
            } finally {
                console.error = orig;
            }
        });
        check('a script error is noted', boom.log.indexOf('script error: Error: boom-marker') >= 0, boom.err || boom.log.slice(0, 300));
        await page.evaluate(() => { if (window.__fetch) window.fetch = window.__fetch; window.__key('KeyB', 'B', { ctrlKey: true, shiftKey: true }); });
        const again = await until(page, () => window.__clip && window.__clip.indexOf('boom-marker') >= 0, 8000, 'the report includes the script error');
        check('the bug report includes the script error', again === true, again === true ? '' : again);

        // Last: about 30 seconds, and its toast would cover the ones above.
        await page.evaluate(() => Coop._receive({ t: 'hostdown' }));
        await sleep(800);
        const early = await page.evaluate((trying) => ({
            toast: document.getElementById('coop-toast').textContent,
            hud: document.getElementById('coop-hud').textContent,
            n: Coop.log.filter((l) => l.indexOf('may have changed') >= 0).length,
            trying: trying,
        }), TRYING);
        check('a dead host still says it is trying', early.toast === TRYING && early.hud.indexOf('may have changed') < 0 && early.n === 0, early.toast);

        const warned = await until(page, (line) => {
            const toast = document.getElementById('coop-toast').textContent;
            const hud = document.getElementById('coop-hud').textContent;
            return toast.indexOf(line) >= 0 && hud.indexOf(line) >= 0;
        }, 45000, 'the host-link warning', HOST_LINK);
        check('after about 30 seconds the host link is explained once', warned === true, warned === true ? '' : warned);
        if (warned === true) {
            const once = await page.evaluate((line) => {
                Coop._receive({ t: 'hostdown' });
                return {
                    toast: document.getElementById('coop-toast').textContent,
                    n: Coop.log.filter((l) => l.indexOf('may have changed') >= 0).length,
                    refused: Coop.refused,
                    line: line,
                };
            }, HOST_LINK);
            check('a later retry does not say it again, and the page keeps trying', once.toast.indexOf(once.line) >= 0 && once.n === 1 && once.refused == null, JSON.stringify({ toast: once.toast.slice(0, 80), n: once.n, refused: once.refused }));
            await page.evaluate(() => Coop.emit('online', null));
            await sleep(300);
            await page.evaluate(() => Coop._receive({ t: 'hostdown' }));
            await sleep(400);
            const reset = await page.evaluate((trying) => ({
                toast: document.getElementById('coop-toast').textContent,
                hud: document.getElementById('coop-hud').textContent,
                n: Coop.log.filter((l) => l.indexOf('may have changed') >= 0).length,
                trying: trying,
            }), TRYING);
            check('once the host answers, the next drop says it is trying again', reset.toast === TRYING && reset.hud.indexOf('may have changed') < 0 && reset.n === 1, reset.toast);
        }
    } catch (e) {
        check('test ran to the end', false, e && e.stack ? e.stack.slice(0, 500) : String(e));
    } finally {
        try { if (browser) await browser.close(); } catch (e) { /* already closed */ }
        if (server) server.kill();
    }
    process.exit(check.finish(page ? [page] : []));
})();
