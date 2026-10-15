// The server on its own: hostile or broken input must not crash it, leak
// saves, or let one player take another's name.
const http = require('http');
const os = require('os');
const WebSocket = require('ws');
const { startServer, sleep } = require('./lib');
const { checker } = require('./common');

const PORT = 8447, OFFLINE = 8457;
const KEY = 'srvtest';

function get(pathname, headers, at) {
    return new Promise((resolve) => {
        const req = http.request(Object.assign({ host: 'localhost', port: PORT, path: pathname, headers: headers || {} }, at), (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode));
        });
        req.on('error', () => resolve(0));
        req.end();
    });
}

function client(headers) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${PORT}/coop/ws` + require('../tools/version').socketQuery(), { headers: headers || {} });
        ws.inbox = [];
        ws.on('message', (raw, isBinary) => { if (!isBinary) ws.inbox.push(JSON.parse(raw)); });
        ws.on('open', () => resolve(ws));
        ws.on('error', reject);
        ws.on('unexpected-response', (req, res) => reject(new Error('refused ' + res.statusCode)));
    });
}
const say = (ws, msg) => ws.send(JSON.stringify(msg));
const got = (ws, t) => ws.inbox.filter((m) => m.t === t);

(async () => {
    const check = checker();
    // Hosting online, as through the tunnel: other PCs come with the key.
    const server = await startServer(PORT, { FH_KEY: KEY });
    const offline = await startServer(OFFLINE);
    try {
        // Paths.
        check('the install\'s own save folder is refused', await get('/save/global.rpgsave') === 403);
        check('...also when the path is disguised', await get('/js%2F..%2Fsave%2Fglobal.rpgsave') === 403 && await get('/SAVE/config.rpgsave') === 403);
        check('nothing under the project data folder is served', [403, 404].includes(await get('/coop/data/Saves/demoted.log')) && [403, 404].includes(await get('/coop/data/usage.json')));
        check('climbing out of the client folder is refused', [403, 404].includes(await get('/coop/..%2Fserver.js')) && [403, 404].includes(await get('/coop/..%5Croom.js')));
        check('the game itself is served', await get('/js/rpg_core.js') === 200 && await get('/coop/census.json') === 200);

        // A pasted link shows as a card that says what it is.
        const page = await new Promise((resolve) => http.get({ host: 'localhost', port: PORT, path: '/', headers: { Host: 'some-words.trycloudflare.com', 'cf-connecting-ip': '203.0.113.9', cookie: 'fhk=' + KEY } },
            (res) => { let t = ''; res.on('data', (d) => { t += d; }); res.on('end', () => resolve(t)); }));
        const remote = { 'cf-connecting-ip': '203.0.113.9', cookie: 'fhk=' + KEY };
        check('the page describes itself to a chat program', /og:title" content="Fear &amp; Hunger co-op"/.test(page) && /their own copy/.test(page)
            && /og:image" content="https:\/\/some-words\.trycloudflare\.com\/coop\/icon\.png/.test(page) && await get('/coop/icon.png', remote) === 200
            && await get('/icon/icon.png', remote) === 403);

        // Another PC gets no game files: only how to join with its own copy.
        check('a remote visitor is shown how to join', page.includes('fhtogether://join?link=' + encodeURIComponent('https://some-words.trycloudflare.com/?k=' + KEY)) && page.includes('value="https://some-words.trycloudflare.com/?k=' + KEY + '"') && !/rpg_core/.test(page));
        check('a remote visitor gets no game files', await get('/js/rpg_core.js', remote) === 403 && await get('/data/System.json', remote) === 403
            && await get('/img/titles1/title.png', remote) === 403 && await get('/coop/census.json', remote) === 403);

        // A socket from another build is told why and closed.
        const other = await new Promise((resolve) => {
            const ws = new WebSocket(`ws://localhost:${PORT}/coop/ws?fp=0000&build=1&mod=x&v=0.0.1`);
            const inbox = [];
            ws.on('message', (raw) => inbox.push(JSON.parse(raw)));
            ws.on('close', (code) => resolve({ code, inbox }));
            ws.on('error', () => resolve({ code: 0, inbox }));
        });
        check('another build of the game is turned away with a reason', other.code === 4001 && other.inbox.length === 1 && other.inbox[0].t === 'version' && other.inbox[0].game === true);

        // A page from another site may not open the socket.
        let refused = false;
        try { await client({ Origin: 'http://evil.example' }); } catch (e) { refused = true; }
        check('a foreign web page cannot open the socket', refused);

        const a = await client(), b = await client();
        await sleep(200);
        say(a, { t: 'name', name: 'Bob', token: 'tab-a' });
        await sleep(150);
        say(b, { t: 'name', name: 'bob', token: 'tab-b' });
        await sleep(200);
        check('a second player cannot take a name in use', got(b, 'nametaken').length === 1 && got(a, 'name').every((m) => m.name !== 'bob'));
        say(b, { t: 'name', name: 'Cy', token: 'tab-b' });
        await sleep(150);
        check('a free name is accepted', got(b, 'nameok').length === 1);
        // The same tab reconnecting before the old line dropped gets its name back.
        const a2 = await client();
        await sleep(100);
        say(a2, { t: 'name', name: 'Bob', token: 'tab-a' });
        await sleep(300);
        check('the same tab can reclaim its own name', got(a2, 'nameok').length === 1 && a.readyState !== WebSocket.OPEN);

        // Saves: another PC reaches only the saves of the name its own tab holds.
        const far = (token) => Object.assign({ 'cf-connecting-ip': '203.0.113.9', cookie: 'fhk=' + KEY }, token ? { 'x-fh-token': token } : {});
        check('another PC cannot read saves without its tab\'s token', await get('/coop/store/Bob/index', far()) === 403);
        check('...or someone else\'s with its own', await get('/coop/store/Bob/index', far('tab-b')) === 403 && await get('/coop/store/Cy/index', far('tab-a')) === 403);
        check('...but reads its own', await get('/coop/store/Bob/index', far('tab-a')) === 200 && await get('/coop/store/Cy/index', far('tab-b')) === 200);
        check('this PC reads any', await get('/coop/store/Bob/index') === 200);

        // Broken and hostile world writes.
        say(a2, { t: 'world?', runId: '' });
        await sleep(150);
        const founded = got(a2, 'world')[0];
        check('first player in founds a run', founded && founded.founded && !!founded.runId);
        for (const bad of [{ t: 'w', w: [1] }, { t: 'w', w: [['__proto__', 'polluted', 1]] }, { t: 'w', w: [['sw', '__proto__', 1]] }, { t: 'w', w: 'x' },
            { t: 'w', w: [['sw', 5, { a: 1 }]] }, { t: 'to' }, { t: 'map', mapId: {} }, { t: 'savepoint', stamp: '../../x' }, [1, 2], 'hi', null]) {
            a2.send(JSON.stringify(bad));
        }
        a2.send('{not json');
        a2.send(Buffer.from([1]), { binary: true });
        a2.send(Buffer.from([1, 250, 9, 9]), { binary: true });
        say(a2, { t: 'w', w: [['sw', 25, 1], ['bogus', 1, 1], ['ss', '1,5,A', 1], ['va', 121, 3]] });
        await sleep(300);
        check('the server survives malformed messages', await get('/coop/census.json') === 200);
        say(b, { t: 'world?', runId: '' });
        await sleep(200);
        const joined = got(b, 'world')[0];
        check('good writes are kept and bad ones dropped', joined && joined.world.sw['25'] === 1 && joined.world.ss['1,5,A'] === 1 && joined.world.va['121'] === 3
            && Object.keys(joined.world).sort().join() === 'ss,sw,va' && joined.world.sw['5'] === undefined, JSON.stringify(joined && joined.world));
        check('the second player joins rather than founds', joined && !joined.founded && joined.runId === founded.runId);

        // Someone who joins later learns at once where everyone already is,
        // even if those players' tabs are asleep and send nothing more.
        say(b, { t: 'p', st: 'away', m: 77, x: 42, y: 52, an: 'Mercenary' });
        await sleep(150);
        const late = await client();
        await sleep(200);
        const hello = got(late, 'hello')[0];
        const known = hello && hello.peers.find((p) => p.name === 'Cy');
        check('a late joiner is told where a silent player is', known && known.last && known.last.m === 77 && known.last.st === 'away', JSON.stringify(known));
        late.close();

        // A save from some other run cannot be poured into this one.
        const c = await client();
        await sleep(100);
        say(c, { t: 'world?', runId: 'someotherrun', stamp: 5 });
        await sleep(200);
        check('a save from a different run is kept out', got(c, 'worldbusy').length === 1 && got(c, 'world').length === 0);
        for (const ws of [a2, b, c]) ws.close();

        // Only this PC reaches the server at all: other machines on the network get no answer.
        const lan = Object.values(os.networkInterfaces()).flat().find((n) => n.family === 'IPv4' && !n.internal);
        const both = await get('/js/rpg_core.js', {}, { host: '127.0.0.1' }) === 200 && await get('/js/rpg_core.js', {}, { host: '::1' }) === 200;
        check('the server answers on this PC only', both && (!lan || await get('/', {}, { host: lan.address }) === 0), lan ? lan.address : 'no network');

        // A web page that points its own domain at this PC (DNS rebinding) is not this PC's player.
        const rebound = { Host: 'evil.example:' + OFFLINE };
        const at = { port: OFFLINE };
        const appRebound = await get('/coop/app', Object.assign({ 'x-fh-app': '1' }, rebound), at);
        const wsRebound = await new Promise((resolve) => {
            const ws = new WebSocket(`ws://localhost:${OFFLINE}/coop/ws` + require('../tools/version').socketQuery(), { headers: Object.assign({ Origin: 'http://evil.example:' + OFFLINE }, rebound) });
            ws.on('open', () => { ws.close(); resolve('open'); });
            ws.on('unexpected-response', (r, res) => { r.destroy(); resolve(res.statusCode); });
            ws.on('error', () => resolve('error'));
        });
        check('a rebound web page gets no panel, no game and no seat', appRebound === 403 && await get('/js/rpg_core.js', rebound, at) === 403
            && await get('/coop/store/Bob/index', rebound, at) === 403 && wsRebound !== 'open', appRebound + ' ws ' + wsRebound);
        check('...while this PC\'s own page gets all of it', await get('/coop/app', { 'x-fh-app': '1' }, at) === 200 && await get('/js/rpg_core.js', {}, at) === 200);
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish([]);
    server.kill();
    offline.kill();
    process.exit(code);
})();
