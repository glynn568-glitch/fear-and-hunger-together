// A new link Cloudflare has not published yet (on a bad day, for minutes):
// the host is not handed a link that does not work yet, it is copied as soon
// as it does; a friend who pastes a link too soon is told to try again in a
// minute, not that nobody is hosting. "As soon as it does" is asked of
// trycloudflare.com's own nameservers: a public resolver asked too early kept
// the link from him for 90 s (10/20).
const { startServer, launch, openPlayer, waitFor } = require('./lib');
const { checker } = require('./common');

const HOST = 8484, FRIEND = 8584, DNS = 8684, REFUSED = 8785, SERVICE = 8885, ZONE = 8721, DEAF = 8722;
const { addressIn, whyStopped, Tunnel } = require('../tools/tunnel');
const dgram = require('dgram');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const panel = (p) => p.evaluate(() => {
    const box = document.getElementById('coop-together');
    const el = box.querySelector('[data-part=link]');
    return { status: box.querySelector('.status').textContent, why: box.querySelector('.why').textContent, linkShown: !el.hidden, link: box.querySelector('[data-field=link]').value };
});

(async () => {
    const check = checker();
    // What cloudflared 2026.10.0 says, word for word: with an address, and when Cloudflare is out of reach.
    const box = 'INF |  https://pads-through-samba-context.trycloudflare.com                                      |';
    const unreachable = 'failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": context deadline exceeded (Client.Timeout exceeded while awaiting headers)';
    check('the tunnel\'s address is read from what cloudflared says', addressIn('INF Requesting new quick Tunnel on trycloudflare.com...\n' + box) === 'https://pads-through-samba-context.trycloudflare.com');
    check('...and Cloudflare\'s own service, named in its errors, is never taken for it', addressIn('INF Requesting new quick Tunnel on trycloudflare.com...\n' + unreachable) === '');
    check('Cloudflare out of reach is put in words', /could not be reached.*internet connection/.test(whyStopped(1, unreachable))
        && /busy day/.test(whyStopped(1, 'quick tunnel provisioning failed with status 429')));

    // Cloudflare's service refuses a new address (as it does when busy, or after many in a
    // short time): the real cloudflared is told so by a stand-in, and the panel says what to do.
    const service = require('http').createServer((req, res) => { res.writeHead(429, { 'Content-Type': 'text/plain' }); res.end('error code: 1015'); });
    await new Promise((r) => service.listen(SERVICE, '127.0.0.1', r));
    // Cloudflare's DNS, standing in: a name does not exist until it is published.
    const published = new Set();
    // trycloudflare.com's own nameservers, asked over UDP as the tunnel asks them. They remember nothing.
    const zoneAsked = {};
    const zone = dgram.createSocket('udp4');
    zone.on('message', (q, from) => {
        let at = 12;
        const labels = [];
        while (q[at]) { labels.push(q.toString('latin1', at + 1, at + 1 + q[at])); at += q[at] + 1; }
        const name = labels.join('.').toLowerCase();
        zoneAsked[name] = (zoneAsked[name] || 0) + 1;
        const yes = published.has(name);
        const head = Buffer.alloc(12);
        q.copy(head, 0, 0, 2);
        head.writeUInt16BE(0x8400 | (q.readUInt16BE(2) & 0x0100) | (yes ? 0 : 3), 2); // an authoritative answer, or "no such name"
        head.writeUInt16BE(1, 4);
        head.writeUInt16BE(yes ? 1 : 0, 6);
        const answer = yes ? Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 127, 0, 0, 1]) : Buffer.alloc(0);
        zone.send(Buffer.concat([head, q.subarray(12, at + 5), answer]), from.port, from.address);
    });
    await new Promise((r) => zone.bind(ZONE, '127.0.0.1', r));
    // A public resolver over HTTPS (1.1.1.1): asked about a name before it exists, it went on
    // saying so for about a minute after it did (10/20).
    const dohAsked = {}, nxAt = {};
    let nxMemory = 60000;
    const dns = require('http').createServer((req, res) => {
        const name = new URL(req.url, 'http://x').searchParams.get('name');
        dohAsked[name] = (dohAsked[name] || 0) + 1;
        const remembered = Date.now() - (nxAt[name] || -Infinity) < nxMemory;
        const yes = published.has(name) && !remembered;
        if (!yes && !remembered) nxAt[name] = Date.now();
        res.setHeader('Content-Type', 'application/dns-json');
        res.end(JSON.stringify(yes ? { Status: 0, Answer: [{ type: 1, data: '127.0.0.1' }] } : { Status: 3 }));
    });
    await new Promise((r) => dns.listen(DNS, '127.0.0.1', r));

    // Where nothing answers on UDP port 53 (blocked here), DNS over HTTPS is asked instead, and
    // still waited for. Which server is asked is the point here, so this resolver remembers nothing.
    const deaf = dgram.createSocket('udp4');
    await new Promise((r) => deaf.bind(DEAF, '127.0.0.1', r));
    {
        nxMemory = 0;
        process.env.FH_NS = '127.0.0.1:' + DEAF;
        process.env.FH_DOH = `http://127.0.0.1:${DNS}/dns-query`;
        const name = 'blocked-port-zz9q.trycloudflare.com';
        const t = new Tunnel(0);
        t.url = 'https://' + name;
        t.registered = true;
        t.watchPublished();
        const t0 = Date.now();
        while (!dohAsked[name] && !t.ready && Date.now() - t0 < 20000) await sleep(100);
        const fellBack = Date.now() - t0;
        await sleep(3000);
        check('with the nameservers out of reach, DNS over HTTPS is asked, and the link held while it says no such name', !t.ready && dohAsked[name] >= 2,
            'over HTTPS after ' + (fellBack / 1000).toFixed(1) + ' s, asked ' + (dohAsked[name] || 0) + 'x, ready ' + t.ready);
        published.add(name);
        const t1 = Date.now();
        while (!t.ready && Date.now() - t1 < 10000) await sleep(100);
        check('...and handed out once it answers', t.ready, ((Date.now() - t1) / 1000).toFixed(1) + ' s');
        t.stop();
        delete process.env.FH_NS;
        delete process.env.FH_DOH;
        nxMemory = 60000;
    }

    const host = await startServer(HOST, { FH_TUNNEL_FAKE: `http://localhost:${HOST}`, FH_NS: '127.0.0.1:' + ZONE, FH_DOH: `http://127.0.0.1:${DNS}/dns-query`, FH_TUNNEL_FAKE_DROP: '8000' });
    const friend = await startServer(FRIEND);
    const refused = await startServer(REFUSED, { FH_QUICK_SERVICE: `http://127.0.0.1:${SERVICE}` });
    const browser = await launch();
    let a, b, c;
    try {
        c = await openPlayer(browser, `http://localhost:${REFUSED}/?name=Cy`, 'refused');
        await waitFor(c, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected && window.Coop.together, 90000, 'title');
        await c.evaluate(() => { Coop.together.open(); Coop.together.act('online'); });
        await waitFor(c, () => /Could not go online/.test(document.querySelector('#coop-together .why').textContent), 60000, 'refused host is answered');
        const no = await panel(c);
        check('a host Cloudflare gives no address is told to try again, not left waiting', /Try again in a minute/.test(no.why) && /Just you/.test(no.status) && !no.linkShown, JSON.stringify(no));

        a = await openPlayer(browser, `http://localhost:${HOST}/?name=Ann`, 'host');
        b = await openPlayer(browser, `http://localhost:${FRIEND}/?name=Bo`, 'friend');
        for (const p of [a, b]) await waitFor(p, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected && window.Coop.together, 90000, 'title');
        await a.browserContext().overridePermissions(`http://localhost:${HOST}`, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);

        await a.evaluate(() => { Coop.together.open(); Coop.together.act('online'); });
        await waitFor(a, () => /being published/.test(document.querySelector('#coop-together .status').textContent), 20000, 'online, link not yet published');
        const early = await panel(a);
        check('while Cloudflare has not published it, the link is not shown or copied', !early.linkShown && /being published/.test(early.status), JSON.stringify(early));
        // Still unpublished a few seconds on, and trycloudflare.com's nameservers are being asked meanwhile.
        await sleep(6000);
        const still = await panel(a);
        check('...nor while its nameservers still say the name does not exist', !still.linkShown && zoneAsked.localhost >= 2, JSON.stringify(still) + ' asked ' + zoneAsked.localhost + 'x');
        published.add('localhost');
        const t0 = Date.now();
        const copied = await waitFor(a, () => /works now and is copied/.test(document.querySelector('#coop-together .why').textContent), 20000, 'the link is copied once it works').then(() => true, () => false);
        const secs = (Date.now() - t0) / 1000;
        check('it is copied within seconds of Cloudflare publishing it, not a minute later', copied && secs < 6, copied ? secs.toFixed(1) + ' s' : 'not within 20 s');
        check('...and the public resolver was never asked (it would have remembered "no such name" for a minute)', !dohAsked.localhost, 'asked ' + (dohAsked.localhost || 0) + 'x');
        const later = await panel(a);
        const clip = await a.evaluate(() => navigator.clipboard.readText());
        check('once it works it is shown and copied', later.linkShown && /^Online\. Send/.test(later.status) && clip === later.link && /\?k=[0-9a-f]{16}$/.test(clip), JSON.stringify(later) + ' clipboard ' + clip);

        // A friend pastes a quick-tunnel link that does not exist (yet).
        await b.evaluate(() => { Coop.together.open(); document.querySelector('#coop-together [data-field=join]').value = 'https://not-published-yet-zz9q.trycloudflare.com/?k=0123456789abcdef'; Coop.together.act('join'); });
        await waitFor(b, () => document.querySelector('#coop-together .why').textContent && !/Joining/.test(document.querySelector('#coop-together .why').textContent), 20000, 'the friend is answered');
        const said = (await panel(b)).why;
        check('a friend who pastes it too soon is told to try again in a minute', /not live yet.*Try again in a minute/.test(said), said);

        // The host's tunnel drops by itself (FH_TUNNEL_FAKE_DROP): friends hold a dead link now.
        await waitFor(a, () => /stopped working/.test(document.querySelector('#coop-together .why').textContent), 30000, 'the host is told the link died');
        const dead = await panel(a);
        check('a host whose tunnel dropped is told to host again and send the new link', /Host online again/.test(dead.why) && /Just you/.test(dead.status) && !dead.linkShown
            && await a.evaluate(() => /stopped working/.test(document.getElementById('coop-toast').textContent)), JSON.stringify(dead));
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish([a, b, c].filter(Boolean));
    await browser.close();
    host.kill(); friend.kill(); refused.kill(); dns.close(); service.close(); zone.close(); deaf.close();
    process.exit(code);
})();
