// Saves, the room's answers, and what the host's page is told (g16b).
// Ports 8574 (host) and 8674 (a joiner). A file standing where a folder should
// be makes the write throw, which is how a full disk used to kill the process.
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { startServer, launch, openPlayer, waitFor, sleep, ROOT } = require('./lib');
const { checker } = require('./common');
const install = require('./helpers');

const PORT = 8574, JOINER = PORT + 100; // 8674

function textOf(rel) {
    const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    // A twin is compiled into the server, and handed to the page, but a comment
    // is neither. Read it the same way the twin runner does, or the text check
    // would still be looking at the fixed line.
    if (!process.env.FH_TWIN) return raw;
    const tw = require('./twins').twinSource(process.env.FH_TWIN, rel, raw);
    return tw == null ? raw : tw;
}

function req(port, method, pathname, headers, body) {
    return new Promise((resolve) => {
        const r = http.request({ host: 'localhost', port, path: pathname, method, headers: headers || {}, timeout: 8000 }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
        });
        r.on('error', () => resolve({ status: 0, body: '' }));
        r.on('timeout', () => { r.destroy(); resolve({ status: 0, body: '' }); });
        if (body != null) r.write(body);
        r.end();
    });
}

function socket(port, query) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket('ws://localhost:' + port + '/coop/ws' + query);
        ws.inbox = [];
        ws.closed = 0;
        ws.on('message', (raw, isBinary) => { if (!isBinary) { try { ws.inbox.push(JSON.parse(String(raw))); } catch (e) { /* not json */ } } });
        ws.on('close', (code) => { ws.closed = code || 1006; });
        ws.on('open', () => resolve(ws));
        ws.on('error', reject);
        ws.on('unexpected-response', (q, res) => reject(new Error('refused ' + res.statusCode)));
    });
}

function turnedAway(query) {
    return new Promise((resolve) => {
        const ws = new WebSocket('ws://localhost:' + PORT + '/coop/ws?' + query);
        const inbox = [];
        ws.on('message', (raw) => { try { inbox.push(JSON.parse(String(raw))); } catch (e) { /* not json */ } });
        const late = setTimeout(() => { try { ws.terminate(); } catch (e) { /* gone */ } resolve({ code: 0, inbox }); }, 8000);
        ws.on('close', (code) => { clearTimeout(late); resolve({ code, inbox }); });
        ws.on('error', () => { clearTimeout(late); resolve({ code: 0, inbox }); });
    });
}

const until = async (pred, ms) => {
    const start = Date.now();
    while (Date.now() - start < ms) { if (pred()) return true; await sleep(40); }
    return false;
};
const quiet = async (page, fn, ms, what, ...args) => {
    try { await waitFor(page, fn, ms, what, ...args); return true; }
    catch (e) { return false; }
};
const watch = (proc) => {
    proc.logs = '';
    const add = (d) => { proc.logs += d; };
    proc.stdout.on('data', add);
    proc.stderr.on('data', add);
};
const fileInstead = (dir) => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.writeFileSync(dir, 'not-a-dir');
};

(async () => {
    const check = checker();
    let host, joiner, browser, page;
    try {
        const readme = textOf('README.md');
        const serverText = textOf('server.js');
        const savesLine = readme.split(/\r?\n/).find((l) => l.includes('Saves live')) || '';
        check('saves are described as each player\'s own',
            savesLine.includes("each player's own PC") && !savesLine.includes("host's PC")
            && serverText.includes("on that player's own PC") && !serverText.includes('live on the host'),
            savesLine.slice(0, 160));

        host = await startServer(PORT, { FH_TEST_BOOM: '1' });
        joiner = await startServer(JOINER, { FH_JOIN: 'http://localhost:' + PORT + '/' });
        watch(host);
        watch(joiner);
        const q = require('../tools/version').socketQuery();
        const hello0 = await req(PORT, 'GET', '/coop/hello');
        let info = {};
        try { info = JSON.parse(hello0.body); } catch (e) { info = {}; }

        // A name used on the host before, with a joiner who has nothing under it.
        const hostFile = path.join(host.saves, 'players', 'enki', 'file1.rpgsave');
        fs.mkdirSync(path.dirname(hostFile), { recursive: true });
        fs.writeFileSync(hostFile, 'HOST-ENKI');
        const enki = await socket(PORT, q);
        enki.send(JSON.stringify({ t: 'name', name: 'Enki', token: 'tok-enki' }));
        const enkiNamed = await until(() => enki.inbox.some((m) => m.t === 'nameok'), 5000);
        check('the host took the name those old saves sit under', enkiNamed, enki.inbox.map((m) => m.t).join(','));
        const token = { 'x-fh-token': 'tok-enki' };
        const idx = await req(JOINER, 'GET', '/coop/store/enki/index', token);
        let keys = null;
        try { keys = JSON.parse(idx.body); } catch (e) { keys = null; }
        check('a joiner lists only the saves on their own PC', idx.status === 200 && Array.isArray(keys) && keys.length === 0, idx.status + ' ' + String(idx.body).slice(0, 120));
        const copied = path.join(joiner.saves, 'players', 'enki', 'file1.rpgsave');
        const got = await req(JOINER, 'GET', '/coop/store/enki/file1', token);
        check('a joiner is not handed a save left on the host', got.status === 404 && !fs.existsSync(copied), 'status ' + got.status + ' copied ' + fs.existsSync(copied));
        const del = await req(JOINER, 'DELETE', '/coop/store/enki/file1', token);
        check('a joiner cannot delete a save left on the host', del.status === 204 && fs.readFileSync(hostFile, 'utf8') === 'HOST-ENKI', 'status ' + del.status);
        try { enki.close(); } catch (e) { /* gone */ }

        const a = await socket(PORT, q);
        const b = await socket(PORT, q);
        a.send(JSON.stringify({ t: 'name', name: 'Zed', token: 'tab-zed' }));
        const aNamed = await until(() => a.inbox.some((m) => m.t === 'nameok'), 5000);
        b.send(JSON.stringify({ t: 'name', name: 'Zed', token: 'tab-zed' }));
        const replaced = await until(() => a.inbox.some((m) => m.t === 'replaced') && a.closed === 4003, 5000);
        const bNamed = await until(() => b.inbox.filter((m) => m.t === 'nameok').length >= 1, 5000);
        check('the old tab is told it was replaced, then the line closes', aNamed && replaced && bNamed,
            'a ' + a.inbox.map((m) => m.t).join(',') + ' closed ' + a.closed + ' b ' + b.inbox.map((m) => m.t).join(','));
        try { a.terminate(); } catch (e) { /* gone */ }
        try { b.terminate(); } catch (e) { /* gone */ }

        fileInstead(path.join(host.saves, 'players', 'zio'));
        const put = await req(PORT, 'PUT', '/coop/store/zio/file1', { 'Content-Type': 'text/plain' }, 'xyz');
        const up = await req(PORT, 'GET', '/coop/hello');
        check('a save that cannot be written answers, and the server stays up',
            put.status === 500 && put.body === 'the save folder could not be made' && up.status === 200 && host.logs.includes('could not write a save'),
            'put ' + put.status + ' ' + put.body.slice(0, 80) + ' hello ' + up.status);

        // A write that kills the process never gets a page. Say so here, or the next wait is a title that cannot load.
        if (up.status === 200) {
        browser = await launch();
        page = await openPlayer(browser, 'http://localhost:' + PORT + '/?name=Ann', 'Ann');
        const titled = await quiet(page, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected && Coop.name === 'Ann', 90000, 'title');
        check('the host\'s page is at the title', titled);
        if (titled) {
            await page.evaluate(install);
            const qv = (name, extra) => 'fp=' + encodeURIComponent(info.fp || '') + '&build=' + encodeURIComponent(extra || info.build || '')
                + '&mod=' + encodeURIComponent(extra ? info.mod : 'deadbeef') + '&v=' + encodeURIComponent(extra ? info.version : '0.1.22')
                + (name ? '&name=' + encodeURIComponent(name) : '');
            const enkiAway = 'Enki was turned away: they have Together 0.1.22, you have ' + info.version + '. Use the same download.';
            const sock = await turnedAway(qv('Enki'));
            const told = await quiet(page, (want) => ((document.getElementById('coop-toast') || {}).textContent || '') === want && Coop.log.indexOf(want) >= 0, 8000, 'Enki turned away', enkiAway);
            check('the host is told who was turned away, and why', told && sock.code === 4001 && sock.inbox.length === 1 && sock.inbox[0].t === 'version' && sock.inbox[0].game === false,
                'close ' + sock.code + ' ' + (sock.inbox[0] && sock.inbox[0].t));
            const gameAway = 'Cahara was turned away: they have Fear & Hunger 9.9.9, you have ' + info.build + '. Update both to the newest.';
            const gameSock = await turnedAway(qv('Cahara', '9.9.9'));
            const toldGame = await quiet(page, (want) => ((document.getElementById('coop-toast') || {}).textContent || '') === want && Coop.log.indexOf(want) >= 0, 8000, 'Cahara turned away', gameAway);
            check('a different game build is named the same way', toldGame && gameSock.inbox[0] && gameSock.inbox[0].game === true, (gameSock.inbox[0] && gameSock.inbox[0].t) || 'no message');
            const anon = 'A player was turned away: they have Together 0.1.22, you have ' + info.version + '. Use the same download.';
            await turnedAway(qv(''));
            const toldAnon = await quiet(page, (want) => ((document.getElementById('coop-toast') || {}).textContent || '') === want && Coop.log.indexOf(want) >= 0, 8000, 'unnamed turned away', anon);
            check('a page that sent no name is still named in the note', toldAnon);

            await page.evaluate(() => T.quickStart(1, 27, 67));
            const onMap = await quiet(page, () => T.onMap(), 60000, 'on the map');
            if (onMap) await page.evaluate(() => T.settle());
            if (onMap) await page.evaluate(() => T.begin());
            const live = onMap && await quiet(page, () => Coop.world.live && T.onMap(), 20000, 'in the run');
            check('the page is in the run', live);
            if (live) {
                await page.evaluate(() => T.settle());
                await quiet(page, () => T.onMap() && !$gameMap.isEventRunning() && !$gameMessage.isBusy() && !$gamePlayer.isTransferring(), 20000, 'idle');
                // Already past the old 15s, and the only peer is in a fight. Both used to leave them where they were.
                await page.evaluate(() => {
                    Coop.peers.set(50, { id: 50, name: 'Bo', m: 1, x: 30, y: 67, d: 2, st: 'battle', cn: '', ci: 0 });
                    Coop.world._bringBy = Date.now() - 20000;
                });
                const brought = await quiet(page, () => {
                    const moved = $gamePlayer.x === 30 || $gamePlayer._newX === 30;
                    return Coop.world._bringBy === 0 && moved && Coop.log.some((l) => l.indexOf('set down beside Bo') >= 0);
                }, 5000, 'set down beside a fight');
                check('a character from another run is set down beside a fight, with no deadline', brought);
                await page.evaluate(() => Coop.peers.delete(50));
                await quiet(page, () => T.onMap() && !$gamePlayer.isTransferring() && !$gameMap.isEventRunning(), 20000, 'settled after the move');
                await page.evaluate(() => T.settle());

                fileInstead(path.join(host.saves, 'players', 'ann'));
                let own = { ok: true, toast: '', log: '' };
                try {
                    own = await page.evaluate(() => {
                        const ok = DataManager.saveGame(1);
                        return { ok, toast: (document.getElementById('coop-toast') || {}).textContent || '', log: Coop.log.filter((l) => l.indexOf('save failed:') >= 0).join(' | ') };
                    });
                } catch (e) { own = { ok: true, toast: '', log: String(e).slice(0, 200) }; }
                check('your own save says it did not write', own.ok === false && /Your save did not write/.test(own.toast) && /save failed:/.test(own.log) && /could not be made/.test(own.toast),
                    'ok ' + own.ok + ' ' + own.toast.slice(0, 140));
                await page.evaluate(() => Coop.emit('savepoint', { t: 'savepoint', slot: 1, stamp: 1, by: 'Bo', runId: Coop.world.runId }));
                const along = await quiet(page, () => Coop.log.some((l) => l.indexOf('save alongside failed:') >= 0), 15000, 'alongside');
                const alongToast = await page.evaluate(() => (document.getElementById('coop-toast') || {}).textContent || '');
                check('a save alongside someone says it did not write', along && /The save with Bo did not write/.test(alongToast) && /Save from the menu when you can/.test(alongToast),
                    alongToast.slice(0, 180));

                fileInstead(path.join(host.saves, 'parked'));
                await page.evaluate(() => {
                    window.__park = [];
                    Coop.on('parkno', (m) => window.__park.push(m && m.why || ''));
                    Coop.send({ t: 'park', n: 1, runId: Coop.world.runId, blob: 'abc' });
                });
                const parked = await quiet(page, () => window.__park.length > 0, 8000, 'parkno');
                const why = parked ? await page.evaluate(() => window.__park.join(' | ')) : '';
                check('a park that does not write is told to that player', parked && why.indexOf('the save folder could not be made') >= 0, why.slice(0, 160));

                // Ann's own save folder works again; a good bed in slot 4 first.
                const annDir = path.join(host.saves, 'players', 'ann');
                fs.rmSync(annDir, { recursive: true, force: true });
                const bed = (n) => page.evaluate((slot) => { $gameSystem.onBeforeSave(); return DataManager.saveGame(slot); }, n);
                const slotFile = (n) => { try { return fs.readFileSync(path.join(annDir, 'file' + n + '.rpgsave'), 'utf8'); } catch (e) { return null; } };
                const goodSaved = await bed(4);
                await sleep(1500);
                const good = slotFile(4);
                const goodStamp = await page.evaluate(() => ((DataManager.loadGlobalInfo() || [])[4] || {}).coopStamp || 0);

                const runId = await page.evaluate(() => Coop.world.runId);
                const failsBefore = await page.evaluate(() => Coop.log.filter((l) => l.indexOf('save failed:') >= 0).length);
                fileInstead(path.join(host.saves, 'runs', String(runId).replace(/[^\w-]/g, '')));
                await page.evaluate(() => Coop.send({ t: 'w', w: [['sw', 25, 1]] }));
                await bed(4);
                await quiet(page, (n) => Coop.log.filter((l) => l.indexOf('save failed:') >= 0).length > n, 8000, 'savefail', failsBefore);
                await sleep(6500);
                const still = await req(PORT, 'GET', '/coop/hello');
                check('a world that cannot be written is logged, and the server stays up',
                    still.status === 200 && host.logs.includes('could not save the world') && host.logs.includes('could not keep the save'),
                    'hello ' + still.status);
                // That bed's world is not kept: a save of it would carry on into an empty world, so the saver is told,
                // and the slot is the save it was before (11/24 review: the good one was gone, the message untrue).
                const told = await page.evaluate(() => Coop.log.filter((l) => l.indexOf('save failed:') >= 0));
                check('a bed whose world the host could not keep is said to its saver', told.length > failsBefore && /could not be made/.test(told[told.length - 1]), told.slice(-1).join(''));
                const after4 = await page.evaluate(() => ((DataManager.loadGlobalInfo() || [])[4] || {}).coopStamp || 0);
                check('and the slot it went into holds the save it had before', goodSaved && good && slotFile(4) === good && after4 === goodStamp && goodStamp > 0,
                    'saved ' + goodSaved + ' stamp ' + goodStamp + ' now ' + after4 + ' same file ' + (slotFile(4) === good));
                await bed(5);
                await quiet(page, (n) => Coop.log.filter((l) => l.indexOf('save failed:') >= 0).length > n, 8000, 'savefail 5', told.length);
                await sleep(500);
                const five = await page.evaluate(() => ({ exists: StorageManager.exists(5), info: !!(DataManager.loadGlobalInfo() || [])[5] }));
                check('a slot that held no save is empty again', slotFile(5) === null && !five.exists && !five.info, JSON.stringify(five) + ' file ' + (slotFile(5) !== null));

                await page.evaluate(() => {
                    Coop.world.live = false;
                    Coop.world._entering = false;
                    Coop.world._how = 'boom';
                    Coop.world.enter();
                });
                const failed = await quiet(page, () => !Coop.world._entering && SceneManager._scene instanceof Scene_Title
                    && Coop.log.some((l) => l.indexOf('Could not enter the shared world') >= 0), 15000, 'worldfail');
                const back = await page.evaluate(() => ({
                    entering: Coop.world._entering, title: SceneManager._scene instanceof Scene_Title,
                    toast: (document.getElementById('coop-toast') || {}).textContent || '',
                }));
                check('a world ask that throws sends the player back to the title',
                    failed && back.title && !back.entering && /Could not enter the shared world \(boom\)/.test(back.toast) && /back at the title/.test(back.toast),
                    back.toast.slice(0, 180));

                if (back.title) {
                    await page.evaluate(() => {
                        DataManager.loadGame = function () { return false; };
                        Coop.toast('SWAP WORKED', 9000);
                        Coop.world._resumeNote = 'SWAP WORKED';
                        Coop.world._reload = 2;
                    });
                    const heard = await quiet(page, () => Coop.log.some((l) => l.indexOf('could not be read') >= 0), 8000, 'unread slot');
                    const slot = await page.evaluate(() => ({
                        toast: (document.getElementById('coop-toast') || {}).textContent || '',
                        note: Coop.world._resumeNote,
                    }));
                    check('a slot that cannot be read says so, not that the swap worked',
                        heard && /could not be read/.test(slot.toast) && /Continue/.test(slot.toast) && /someone new/.test(slot.toast) && slot.note === '' && slot.toast.indexOf('SWAP WORKED') < 0,
                        slot.toast.slice(0, 180));
                }
            }
        }
        } else check('the host\'s page is at the title', false, 'the server was already down');
    } catch (e) {
        check('the suite ran through', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' ').slice(0, 400));
    } finally {
        // The engine logs a failed save on purpose (it returns false). That line is the failure under test.
        if (page && page.errors) page.errors = page.errors.filter((e) => !/the save folder could not be made|the save could not be written|the save folder cannot be written|the disk is full|the save was not kept|could not save alongside|Failed to load resource: the server responded with a status of 500/.test(String(e)));
        const code = check.finish(page ? [page] : []);
        if (browser) { try { await browser.close(); } catch (e) { /* already gone */ } }
        if (host) { try { host.kill(); } catch (e) { /* already gone */ } }
        if (joiner) { try { joiner.kill(); } catch (e) { /* already gone */ } }
        process.exit(code);
    }
})();
