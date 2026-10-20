// A new link Cloudflare has not published yet (on a bad day, for minutes):
// the host is not handed a link that does not work yet, it is copied as soon
// as it does; a friend who pastes a link too soon is told to try again in a
// minute, not that nobody is hosting.
const { startServer, launch, openPlayer, waitFor } = require('./lib');
const { checker } = require('./common');

const HOST = 8484, FRIEND = 8584, DNS = 8684, REFUSED = 8785, SERVICE = 8885;
const { addressIn, whyStopped } = require('../tools/tunnel');
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
    // Cloudflare's DNS, standing in: the name does not exist until it is published.
    let published = false, asked = 0;
    const dns = require('http').createServer((req, res) => {
        asked++;
        res.setHeader('Content-Type', 'application/dns-json');
        res.end(JSON.stringify(published ? { Status: 0, Answer: [{ type: 1, data: '127.0.0.1' }] } : { Status: 3 }));
    });
    await new Promise((r) => dns.listen(DNS, '127.0.0.1', r));
    const host = await startServer(HOST, { FH_TUNNEL_FAKE: `http://localhost:${HOST}`, FH_DOH: `http://127.0.0.1:${DNS}/dns-query`, FH_TUNNEL_FAKE_DROP: '8000' });
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
        // Still unpublished a few seconds on, and Cloudflare's DNS is being asked meanwhile.
        await new Promise((r) => setTimeout(r, 6000));
        const still = await panel(a);
        check('...nor while its DNS still says the name does not exist', !still.linkShown && asked >= 2, JSON.stringify(still) + ' asked ' + asked);
        published = true;
        await waitFor(a, () => /works now and is copied/.test(document.querySelector('#coop-together .why').textContent), 20000, 'the link is copied once it works');
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
    host.kill(); friend.kill(); refused.kill(); dns.close(); service.close();
    process.exit(code);
})();
